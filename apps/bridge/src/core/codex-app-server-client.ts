import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type JsonRpcId = string | number;

interface JsonRpcResponse {
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface PendingRpcCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface StartOptions {
  cwd: string;
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private nextRequestId = 1;
  private readonly pendingCalls = new Map<JsonRpcId, PendingRpcCall>();
  private readonly notificationListeners = new Set<(message: JsonRpcNotification) => void>();
  private readonly requestListeners = new Set<(message: JsonRpcRequest) => void>();
  private readonly closeListeners = new Set<(error?: Error) => void>();
  private startPromise: Promise<void> | null = null;
  private startOptions: StartOptions | null = null;

  public async ensureStarted(options: StartOptions): Promise<void> {
    this.startOptions = options;
    if (this.child) {
      return;
    }
    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = this.start(options);
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  public async restart(): Promise<void> {
    this.shutdown();
    if (!this.startOptions) {
      throw new Error("codex_app_server_start_options_missing");
    }
    await this.ensureStarted(this.startOptions);
  }

  public onNotification(listener: (message: JsonRpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  public onRequest(listener: (message: JsonRpcRequest) => void): () => void {
    this.requestListeners.add(listener);
    return () => {
      this.requestListeners.delete(listener);
    };
  }

  public onClose(listener: (error?: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  public async call(method: string, params?: unknown): Promise<unknown> {
    if (!this.child) {
      throw new Error("codex_app_server_not_started");
    }
    const id = this.nextRequestId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params })
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingCalls.set(id, { resolve, reject });
    });
    this.write(payload);
    return await promise;
  }

  public respond(requestId: JsonRpcId, result: unknown): void {
    this.write({
      jsonrpc: "2.0",
      id: requestId,
      result
    });
  }

  public respondError(requestId: JsonRpcId, code: number, message: string, data?: unknown): void {
    this.write({
      jsonrpc: "2.0",
      id: requestId,
      error: {
        code,
        message,
        ...(data === undefined ? {} : { data })
      }
    });
  }

  public shutdown(): void {
    const process = this.child;
    this.child = null;
    this.stdoutBuffer = "";
    if (process) {
      process.removeAllListeners();
      process.stdout.removeAllListeners();
      process.stderr.removeAllListeners();
      process.kill("SIGTERM");
    }
    this.rejectAllPending(new Error("codex_app_server_shutdown"));
  }

  private async start(options: StartOptions): Promise<void> {
    const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
      cwd: options.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    child.stderr.on("data", (chunk: Buffer) => {
      // Keep stderr drained to avoid deadlocks. Logs are surfaced as runtime errors elsewhere.
      void chunk;
    });

    child.stdout.on("data", (chunk: Buffer) => {
      this.handleStdoutChunk(chunk.toString("utf8"));
    });

    child.once("error", (error) => {
      this.handleClose(error);
    });

    child.once("close", (code, signal) => {
      if (this.child !== child) {
        return;
      }
      const codeText = typeof code === "number" ? String(code) : "unknown";
      const signalText = signal ?? "none";
      this.handleClose(
        new Error(`codex_app_server_closed: code=${codeText} signal=${signalText}`)
      );
    });

    this.child = child;

    await this.initialize();
  }

  private async initialize(): Promise<void> {
    const initResult = await this.call("initialize", {
      clientInfo: {
        name: "surf-ai-bridge",
        title: "Surf AI Bridge",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: []
      }
    });

    if (!initResult || typeof initResult !== "object") {
      throw new Error("codex_app_server_initialize_failed");
    }
  }

  private write(payload: unknown): void {
    if (!this.child) {
      throw new Error("codex_app_server_not_started");
    }
    const line = JSON.stringify(payload);
    this.child.stdin.write(`${line}\n`);
  }

  private handleStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      this.handleJsonLine(line);
    }
  }

  private handleJsonLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      return;
    }

    const maybeResponse = parsed as Partial<JsonRpcResponse> & {
      method?: unknown;
    };

    if (
      Object.prototype.hasOwnProperty.call(maybeResponse, "id") &&
      (Object.prototype.hasOwnProperty.call(maybeResponse, "result") ||
        Object.prototype.hasOwnProperty.call(maybeResponse, "error")) &&
      typeof maybeResponse.method === "undefined"
    ) {
      this.handleRpcResponse(maybeResponse as JsonRpcResponse);
      return;
    }

    const message = parsed as { method?: unknown; id?: unknown; params?: unknown };
    if (typeof message.method !== "string") {
      return;
    }

    if (typeof message.id === "string" || typeof message.id === "number") {
      for (const listener of this.requestListeners) {
        listener({
          id: message.id,
          method: message.method,
          ...(message.params === undefined ? {} : { params: message.params })
        });
      }
      return;
    }

    for (const listener of this.notificationListeners) {
      listener({
        method: message.method,
        ...(message.params === undefined ? {} : { params: message.params })
      });
    }
  }

  private handleRpcResponse(response: JsonRpcResponse): void {
    const pending = this.pendingCalls.get(response.id);
    if (!pending) {
      return;
    }
    this.pendingCalls.delete(response.id);

    if (response.error) {
      const message = response.error.message ?? "codex_app_server_rpc_error";
      const codeText =
        typeof response.error.code === "number" ? String(response.error.code) : "unknown";
      pending.reject(new Error(`${message} (code=${codeText})`));
      return;
    }

    pending.resolve(response.result);
  }

  private handleClose(error?: Error): void {
    const current = this.child;
    this.child = null;
    if (current) {
      current.removeAllListeners();
      current.stdout.removeAllListeners();
      current.stderr.removeAllListeners();
    }
    this.rejectAllPending(error ?? new Error("codex_app_server_closed"));
    for (const listener of this.closeListeners) {
      listener(error);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingCalls.values()) {
      pending.reject(error);
    }
    this.pendingCalls.clear();
  }
}
