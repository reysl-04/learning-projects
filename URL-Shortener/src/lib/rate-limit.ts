export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window limiter. Deliberately simple: it protects a single process.
 *
 * In a real cluster this is NOT enough, because N nodes each allow the full
 * quota (see README: "Rate limiting across nodes"). Production uses a shared
 * Redis counter with an atomic INCR/EXPIRE, or a sliding-window script.
 */
export class FixedWindowRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  take(key: string): RateLimitResult {
    if (this.limit <= 0) {
      return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, retryAfterSeconds: 0 };
    }

    const now = this.now();
    let bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    if (bucket.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    bucket.count += 1;
    return {
      allowed: true,
      remaining: this.limit - bucket.count,
      retryAfterSeconds: 0,
    };
  }

  /** Drop expired buckets so the map does not grow without bound. */
  prune(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}
