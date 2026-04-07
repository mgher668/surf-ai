import { spawn } from "node:child_process";

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export async function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const settleReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", handleAbort);
      reject(error);
    };

    const settleResolve = (result: ProcessResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", handleAbort);
      resolve(result);
    };

    const handleAbort = (): void => {
      child.kill("SIGKILL");
      settleReject(new Error(`Command aborted: ${command}`));
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        settleReject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
      }, timeoutMs);
    }

    signal?.addEventListener("abort", handleAbort);

    child.on("error", (error) => {
      settleReject(error);
    });

    child.on("close", (code) => {
      settleResolve({ code, stdout, stderr });
    });
  });
}
