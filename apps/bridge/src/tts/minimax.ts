import type { BridgeTtsRequest, BridgeTtsResponse } from "@surf-ai/shared";
import type { MiniMaxTtsConfig } from "../core/config";

export class TtsError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  public constructor(
    code: string,
    message: string,
    statusCode: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    if (details) {
      this.details = details;
    }
  }
}

interface MiniMaxResponse {
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
  trace_id?: string;
  data?: {
    audio?: string;
  };
}

export async function synthesizeWithMiniMax(
  request: BridgeTtsRequest,
  config: MiniMaxTtsConfig
): Promise<BridgeTtsResponse> {
  if (!config.apiKey) {
    throw new TtsError(
      "tts_not_configured",
      "MiniMax API key is not configured. Set SURF_AI_MINIMAX_API_KEY.",
      503
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  let upstream: Response;
  try {
    upstream = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        text: request.text,
        stream: false,
        output_format: config.outputFormat,
        voice_setting: {
          voice_id: request.voiceId ?? config.voiceId,
          speed: config.speed,
          vol: config.volume,
          pitch: config.pitch
        },
        audio_setting: {
          sample_rate: config.sampleRate,
          bitrate: config.bitrate,
          format: config.audioFormat,
          channel: config.channel
        }
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new TtsError(
        "tts_timeout",
        `MiniMax request timed out after ${config.timeoutMs}ms.`,
        504
      );
    }

    throw new TtsError(
      "tts_network_error",
      error instanceof Error ? error.message : "MiniMax request failed",
      502
    );
  } finally {
    clearTimeout(timeout);
  }

  const bodyText = await upstream.text();
  const payload = parseJson(bodyText);
  const traceId = typeof payload?.trace_id === "string" ? payload.trace_id : undefined;

  if (!upstream.ok) {
    throw new TtsError(
      "tts_upstream_failed",
      "MiniMax returned a non-2xx response.",
      502,
      {
        upstreamStatus: upstream.status,
        traceId
      }
    );
  }

  const providerStatusCode = payload?.base_resp?.status_code;
  if (providerStatusCode !== 0) {
    throw new TtsError(
      "tts_provider_error",
      payload?.base_resp?.status_msg || "MiniMax returned provider error.",
      502,
      {
        providerStatusCode,
        traceId
      }
    );
  }

  const audio = payload?.data?.audio;
  if (!audio || typeof audio !== "string") {
    throw new TtsError(
      "tts_invalid_response",
      "MiniMax response does not contain audio.",
      502,
      { traceId }
    );
  }

  const base: Omit<BridgeTtsResponse, "audioUrl" | "base64Audio"> = {
    provider: "minimax",
    mimeType: mimeTypeFromAudioFormat(config.audioFormat),
    ...(traceId ? { traceId } : {})
  };

  if (config.outputFormat === "url") {
    return {
      ...base,
      audioUrl: audio
    };
  }

  const base64Audio = hexToBase64(audio);
  return {
    ...base,
    base64Audio
  };
}

function parseJson(input: string): MiniMaxResponse | null {
  try {
    return JSON.parse(input) as MiniMaxResponse;
  } catch {
    return null;
  }
}

function hexToBase64(hex: string): string {
  const normalized = hex.trim();
  if (normalized.length === 0 || normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new TtsError("tts_invalid_audio", "MiniMax returned invalid hex audio data.", 502);
  }
  return Buffer.from(normalized, "hex").toString("base64");
}

function mimeTypeFromAudioFormat(format: MiniMaxTtsConfig["audioFormat"]): string {
  if (format === "wav") return "audio/wav";
  if (format === "flac") return "audio/flac";
  if (format === "pcm") return "audio/L16";
  return "audio/mpeg";
}
