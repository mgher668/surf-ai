export interface BridgeConfig {
  host: string;
  port: number;
  token?: string;
  defaultAdapter: "mock" | "codex" | "claude";
  minimaxTts: MiniMaxTtsConfig;
}

export interface MiniMaxTtsConfig {
  endpoint: string;
  apiKey?: string;
  model: string;
  voiceId: string;
  outputFormat: "hex" | "url";
  audioFormat: "mp3" | "wav" | "flac" | "pcm";
  sampleRate: number;
  bitrate: number;
  channel: 1 | 2;
  speed: number;
  volume: number;
  pitch: number;
  timeoutMs: number;
}

export function readConfig(): BridgeConfig {
  const portRaw = process.env.SURF_AI_PORT ?? "43127";
  const parsedPort = Number(portRaw);
  const token = process.env.SURF_AI_TOKEN;
  const apiKey = process.env.SURF_AI_MINIMAX_API_KEY ?? process.env.MINIMAX_API_KEY;

  const base: Omit<BridgeConfig, "token"> = {
    host: process.env.SURF_AI_HOST ?? "127.0.0.1",
    port: Number.isFinite(parsedPort) ? parsedPort : 43127,
    defaultAdapter: normalizeAdapter(process.env.SURF_AI_DEFAULT_ADAPTER),
    minimaxTts: {
      endpoint: process.env.SURF_AI_MINIMAX_TTS_ENDPOINT ?? "https://api.minimax.io/v1/t2a_v2",
      model: process.env.SURF_AI_MINIMAX_TTS_MODEL ?? "speech-02-hd",
      voiceId: process.env.SURF_AI_MINIMAX_TTS_VOICE_ID ?? "male-qn-qingse",
      outputFormat: normalizeOutputFormat(process.env.SURF_AI_MINIMAX_TTS_OUTPUT_FORMAT),
      audioFormat: normalizeAudioFormat(process.env.SURF_AI_MINIMAX_TTS_AUDIO_FORMAT),
      sampleRate: parseNumber(process.env.SURF_AI_MINIMAX_TTS_SAMPLE_RATE, 32_000),
      bitrate: parseNumber(process.env.SURF_AI_MINIMAX_TTS_BITRATE, 128_000),
      channel: normalizeChannel(process.env.SURF_AI_MINIMAX_TTS_CHANNEL),
      speed: parseNumber(process.env.SURF_AI_MINIMAX_TTS_SPEED, 1, 0.5, 2),
      volume: parseNumber(process.env.SURF_AI_MINIMAX_TTS_VOLUME, 1, 0.1, 10),
      pitch: parseNumber(process.env.SURF_AI_MINIMAX_TTS_PITCH, 0, -12, 12),
      timeoutMs: parseNumber(process.env.SURF_AI_MINIMAX_TTS_TIMEOUT_MS, 30_000, 1_000, 120_000)
    }
  };

  if (!token && !apiKey) {
    return base;
  }

  return {
    ...base,
    ...(token ? { token } : {}),
    minimaxTts: {
      ...base.minimaxTts,
      ...(apiKey ? { apiKey } : {})
    }
  };
}

function normalizeAdapter(value: string | undefined): BridgeConfig["defaultAdapter"] {
  if (value === "codex" || value === "claude" || value === "mock") {
    return value;
  }
  return "mock";
}

function normalizeOutputFormat(value: string | undefined): MiniMaxTtsConfig["outputFormat"] {
  if (value === "url" || value === "hex") {
    return value;
  }
  return "hex";
}

function normalizeAudioFormat(value: string | undefined): MiniMaxTtsConfig["audioFormat"] {
  if (value === "mp3" || value === "wav" || value === "flac" || value === "pcm") {
    return value;
  }
  return "mp3";
}

function normalizeChannel(value: string | undefined): MiniMaxTtsConfig["channel"] {
  if (value === "2") {
    return 2;
  }
  return 1;
}

function parseNumber(
  raw: string | undefined,
  fallback: number,
  min?: number,
  max?: number
): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  if (min !== undefined && value < min) {
    return min;
  }
  if (max !== undefined && value > max) {
    return max;
  }
  return value;
}
