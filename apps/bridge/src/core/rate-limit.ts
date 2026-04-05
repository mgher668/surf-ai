import type { BridgeRateLimitConfig } from "./config";

interface RateLimitBucket {
  windowStartMs: number;
  count: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  resetAfterMs: number;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private checks = 0;

  public constructor(private readonly config: BridgeRateLimitConfig) {}

  public check(key: string, nowMs = Date.now()): RateLimitDecision {
    if (!this.config.enabled) {
      return {
        allowed: true,
        limit: this.config.maxRequests,
        remaining: this.config.maxRequests,
        retryAfterMs: 0,
        resetAfterMs: 0
      };
    }

    const windowMs = this.config.windowMs;
    const limit = this.config.maxRequests;
    const bucket = this.buckets.get(key);

    if (!bucket || nowMs - bucket.windowStartMs >= windowMs) {
      this.buckets.set(key, {
        windowStartMs: nowMs,
        count: 1
      });
      this.cleanup(nowMs);
      return {
        allowed: true,
        limit,
        remaining: Math.max(0, limit - 1),
        retryAfterMs: 0,
        resetAfterMs: windowMs
      };
    }

    if (bucket.count >= limit) {
      const resetAfterMs = Math.max(0, windowMs - (nowMs - bucket.windowStartMs));
      this.cleanup(nowMs);
      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterMs: resetAfterMs,
        resetAfterMs
      };
    }

    bucket.count += 1;
    const resetAfterMs = Math.max(0, windowMs - (nowMs - bucket.windowStartMs));
    this.cleanup(nowMs);
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterMs: 0,
      resetAfterMs
    };
  }

  private cleanup(nowMs: number): void {
    this.checks += 1;
    if (this.checks % 200 !== 0) {
      return;
    }

    const expiresAfter = this.config.windowMs * 2;
    for (const [key, bucket] of this.buckets.entries()) {
      if (nowMs - bucket.windowStartMs > expiresAfter) {
        this.buckets.delete(key);
      }
    }
  }
}
