export interface BridgeConfig {
  host: string;
  port: number;
  dbPath: string;
  token?: string;
  users: BridgeUserAccount[];
  defaultAdapter: "mock" | "codex" | "claude";
  minimaxTts: MiniMaxTtsConfig;
  security: BridgeSecurityConfig;
}

export interface BridgeUserAccount {
  id: string;
  name: string;
  token?: string;
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

export interface BridgeSecurityConfig {
  corsAllowedOriginPatterns: string[];
  requireHttps: boolean;
  trustProxy: boolean;
  rateLimit: BridgeRateLimitConfig;
  retention: BridgeRetentionConfig;
}

export interface BridgeRateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
}

export interface BridgeRetentionConfig {
  enabled: boolean;
  sessionDays: number;
  auditDays: number;
}

export function readConfig(): BridgeConfig {
  const portRaw = process.env.SURF_AI_PORT ?? "43127";
  const parsedPort = Number(portRaw);
  const token = process.env.SURF_AI_TOKEN;
  const apiKey = process.env.SURF_AI_MINIMAX_API_KEY ?? process.env.MINIMAX_API_KEY;
  const users = readUsers(token);
  const security = readSecurityConfig();

  const base: Omit<BridgeConfig, "token"> = {
    host: process.env.SURF_AI_HOST ?? "127.0.0.1",
    port: Number.isFinite(parsedPort) ? parsedPort : 43127,
    dbPath: process.env.SURF_AI_DB_PATH ?? "./data/surf-ai.sqlite",
    users,
    defaultAdapter: normalizeAdapter(process.env.SURF_AI_DEFAULT_ADAPTER),
    security,
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

function readUsers(legacyToken: string | undefined): BridgeUserAccount[] {
  const raw = process.env.SURF_AI_USERS_JSON?.trim();
  if (!raw) {
    return [
      {
        id: process.env.SURF_AI_DEFAULT_USER_ID ?? "local",
        name: process.env.SURF_AI_DEFAULT_USER_NAME ?? "Local User",
        ...(legacyToken ? { token: legacyToken } : {})
      }
    ];
  }

  try {
    const parsed = JSON.parse(raw) as Array<{
      id?: unknown;
      name?: unknown;
      token?: unknown;
    }>;
    const normalized = parsed
      .map((item) => {
        const id = typeof item.id === "string" ? item.id.trim() : "";
        const name = typeof item.name === "string" ? item.name.trim() : "";
        const token = typeof item.token === "string" ? item.token.trim() : "";
        if (!id || !name) {
          return null;
        }
        return {
          id,
          name,
          ...(token ? { token } : {})
        } satisfies BridgeUserAccount;
      })
      .filter((item): item is BridgeUserAccount => Boolean(item));

    if (normalized.length > 0) {
      return normalized;
    }
  } catch {
    // Fall through to local default user.
  }

  return [
    {
      id: process.env.SURF_AI_DEFAULT_USER_ID ?? "local",
      name: process.env.SURF_AI_DEFAULT_USER_NAME ?? "Local User",
      ...(legacyToken ? { token: legacyToken } : {})
    }
  ];
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

function readSecurityConfig(): BridgeSecurityConfig {
  const corsAllowedOriginPatterns = parseCommaList(
    process.env.SURF_AI_CORS_ALLOW_ORIGINS,
    [
      "chrome-extension://*",
      "http://localhost:*",
      "https://localhost:*",
      "http://127.0.0.1:*",
      "https://127.0.0.1:*"
    ]
  );

  const rateLimitEnabled = parseBoolean(process.env.SURF_AI_RATE_LIMIT_ENABLED, true);
  const rateLimitWindowMs = parseNumber(
    process.env.SURF_AI_RATE_LIMIT_WINDOW_MS,
    60_000,
    1_000,
    3_600_000
  );
  const rateLimitMaxRequests = parseNumber(
    process.env.SURF_AI_RATE_LIMIT_MAX_REQUESTS,
    120,
    1,
    10_000
  );
  const retentionEnabled = parseBoolean(process.env.SURF_AI_RETENTION_ENABLED, true);
  const retentionSessionDays = parseNumber(
    process.env.SURF_AI_RETENTION_SESSION_DAYS,
    90,
    1,
    3_650
  );
  const retentionAuditDays = parseNumber(
    process.env.SURF_AI_RETENTION_AUDIT_DAYS,
    30,
    1,
    3_650
  );

  return {
    corsAllowedOriginPatterns,
    requireHttps: parseBoolean(process.env.SURF_AI_REQUIRE_HTTPS, false),
    trustProxy: parseBoolean(process.env.SURF_AI_TRUST_PROXY, false),
    rateLimit: {
      enabled: rateLimitEnabled,
      windowMs: rateLimitWindowMs,
      maxRequests: rateLimitMaxRequests
    },
    retention: {
      enabled: retentionEnabled,
      sessionDays: retentionSessionDays,
      auditDays: retentionAuditDays
    }
  };
}

function parseCommaList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) {
    return fallback;
  }

  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : fallback;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
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
