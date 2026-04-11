import type { BridgeConnection, BridgeRunStreamEvent } from "@surf-ai/shared";

export interface BridgeRunStreamOptions {
  connection: BridgeConnection;
  sessionId: string;
  runId: string;
  onEvent: (event: BridgeRunStreamEvent) => void;
  onError?: (error: Error) => void;
}

export interface BridgeRunStreamHandle {
  close: () => void;
}

export function openBridgeRunStream(options: BridgeRunStreamOptions): BridgeRunStreamHandle {
  const controller = new AbortController();

  void streamLoop(options, controller.signal).catch((error) => {
    if (controller.signal.aborted) {
      return;
    }
    options.onError?.(error instanceof Error ? error : new Error("bridge_stream_failed"));
  });

  return {
    close: () => {
      controller.abort();
    }
  };
}

async function streamLoop(
  options: BridgeRunStreamOptions,
  signal: AbortSignal
): Promise<void> {
  const response = await fetch(
    `${options.connection.baseUrl}/sessions/${options.sessionId}/runs/${options.runId}/stream`,
    {
      method: "GET",
      headers: buildBridgeHeaders(options.connection),
      signal,
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error(`bridge_stream_http_${response.status}`);
  }

  if (!response.body) {
    throw new Error("bridge_stream_missing_body");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex >= 0) {
      const chunk = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const event = parseSseChunk(chunk);
      if (event) {
        options.onEvent(event);
      }
      separatorIndex = buffer.indexOf("\n\n");
    }
  }
}

function parseSseChunk(chunk: string): BridgeRunStreamEvent | null {
  const lines = chunk
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  if (dataLines.length === 0) {
    return null;
  }

  const jsonRaw = dataLines.join("\n");
  try {
    return JSON.parse(jsonRaw) as BridgeRunStreamEvent;
  } catch {
    return null;
  }
}

function buildBridgeHeaders(connection: BridgeConnection): Record<string, string> {
  const headers: Record<string, string> = {
    ...(connection.userId ? { "x-surf-user-id": connection.userId } : {})
  };
  if (connection.token) {
    headers["x-surf-token"] = connection.token;
  }
  return headers;
}
