import { AppError } from "../lib/errors.ts";
import { isReservedCode, isValidCode, randomCode } from "../lib/codes.ts";
import { normalizeUrl, pointsAtSelf } from "../lib/url.ts";
import type { LinkRecord, LinkStore } from "../store/types.ts";

export interface LinkCache {
  get(key: string): LinkRecord | null | undefined;
  set(key: string, value: LinkRecord | null, ttlMs: number): void;
  delete(key: string): void;
}

export interface ShortenerLogger {
  error(message: string, error: unknown): void;
}

export interface ShortenerOptions {
  codeLength: number;
  cacheTtlMs: number;
  negativeCacheTtlMs: number;
  defaultTtlSeconds: number;
  maxAttempts?: number;
  baseUrl?: string;
  now?: () => number;
  generateCode?: (length: number) => string;
  logger?: ShortenerLogger;
}

export interface ShortenInput {
  url: unknown;
  alias?: unknown;
  ttlSeconds?: unknown;
  ownerId?: string | null;
}

const MAX_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;
const MAX_ATTEMPTS = 5;

interface ResolvedOptions {
  codeLength: number;
  cacheTtlMs: number;
  negativeCacheTtlMs: number;
  defaultTtlSeconds: number;
  maxAttempts: number;
  now: () => number;
  generateCode: (length: number) => string;
  baseUrl: string | undefined;
  logger: ShortenerLogger;
}

const defaultLogger: ShortenerLogger = {
  error: (message, error) => console.error(message, error),
};

export class ShortenerService {
  private readonly store: LinkStore;
  private readonly cache: LinkCache;
  private readonly options: ResolvedOptions;

  constructor(store: LinkStore, cache: LinkCache, options: ShortenerOptions) {
    this.store = store;
    this.cache = cache;
    this.options = {
      codeLength: options.codeLength,
      cacheTtlMs: options.cacheTtlMs,
      negativeCacheTtlMs: options.negativeCacheTtlMs,
      defaultTtlSeconds: options.defaultTtlSeconds,
      maxAttempts: options.maxAttempts ?? MAX_ATTEMPTS,
      now: options.now ?? Date.now,
      generateCode: options.generateCode ?? randomCode,
      baseUrl: options.baseUrl,
      logger: options.logger ?? defaultLogger,
    };
  }

  shorten(input: ShortenInput): LinkRecord {
    const url = normalizeUrl(input.url);
    if (url === null) {
      throw new AppError(400, "invalid_url", "url must be a valid http(s) URL of at most 2048 characters");
    }
    if (this.options.baseUrl !== undefined && pointsAtSelf(url, this.options.baseUrl)) {
      throw new AppError(400, "redirect_loop", "url cannot point back at this shortener");
    }

    const ttlSeconds = this.parseTtl(input.ttlSeconds);
    const now = this.options.now();
    const expiresAt = ttlSeconds === 0 ? null : now + ttlSeconds * 1000;
    const alias = this.parseAlias(input.alias);

    if (alias !== null) {
      return this.createWithAlias(alias, url, now, expiresAt, input.ownerId ?? null);
    }

    for (let attempt = 0; attempt < this.options.maxAttempts; attempt += 1) {
      const code = this.options.generateCode(this.options.codeLength);
      if (isReservedCode(code)) continue;

      const created = this.store.insert({
        code,
        url,
        createdAt: now,
        expiresAt,
        ownerId: input.ownerId ?? null,
      });

      if (created) {
        // A previous lookup may have negative-cached this code.
        this.cache.delete(code);
        return {
          code,
          url,
          createdAt: now,
          expiresAt,
          ownerId: input.ownerId ?? null,
          clicks: 0,
          lastAccessedAt: null,
        };
      }
    }

    // With 62^7 codes and a healthy RNG this is effectively unreachable.
    throw new AppError(503, "code_exhausted", "could not allocate a unique code, please retry");
  }

  /**
   * Cache-aside lookup used by the redirect hot path.
   *
   * Cache misses fall back to SQLite; misses are also cached briefly so a
   * flood of requests for the same unknown code cannot penetrate to the DB.
   */
  resolve(code: string): LinkRecord {
    if (!isValidCode(code)) {
      throw new AppError(404, "not_found", "link not found");
    }

    const cached = this.cache.get(code);
    if (cached !== undefined) {
      if (cached === null) throw new AppError(404, "not_found", "link not found");
      this.countClick(code);
      return cached;
    }

    const record = this.store.find(code);
    if (record === undefined || this.isExpired(record)) {
      if (record !== undefined) this.store.remove(code);
      this.cache.set(code, null, this.options.negativeCacheTtlMs);
      throw new AppError(404, "not_found", "link not found");
    }

    this.cache.set(code, record, this.options.cacheTtlMs);
    this.countClick(code);
    return record;
  }

  stats(code: string): LinkRecord {
    const record = this.store.find(code);
    if (record === undefined || this.isExpired(record)) {
      throw new AppError(404, "not_found", "link not found");
    }
    return record;
  }

  remove(code: string): void {
    const removed = this.store.remove(code);
    this.cache.delete(code);
    if (!removed) throw new AppError(404, "not_found", "link not found");
  }

  count(): number {
    return this.store.count();
  }

  purgeExpired(): number {
    return this.store.deleteExpired(this.options.now());
  }

  private createWithAlias(
    alias: string,
    url: string,
    now: number,
    expiresAt: number | null,
    ownerId: string | null,
  ): LinkRecord {
    const link = { code: alias, url, createdAt: now, expiresAt, ownerId };

    if (this.store.insert(link)) {
      this.cache.delete(alias);
      return { ...link, clicks: 0, lastAccessedAt: null };
    }

    // The alias may belong to an expired row that the sweeper has not removed
    // yet. Reclaiming it keeps alias availability consistent with link expiry.
    const existing = this.store.find(alias);
    if (existing !== undefined && this.isExpired(existing) && this.store.remove(alias)) {
      if (this.store.insert(link)) {
        this.cache.delete(alias);
        return { ...link, clicks: 0, lastAccessedAt: null };
      }
    }

    throw new AppError(409, "alias_taken", "that alias is already in use");
  }

  private parseAlias(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") {
      throw new AppError(400, "invalid_alias", "alias must be a string");
    }

    const alias = value.trim();
    if (!isValidCode(alias)) {
      throw new AppError(
        400,
        "invalid_alias",
        "alias must be 3-32 characters using letters, digits, '-' or '_'",
      );
    }
    if (isReservedCode(alias)) {
      throw new AppError(409, "alias_reserved", "that alias is reserved");
    }
    return alias;
  }

  private parseTtl(value: unknown): number {
    if (value === undefined || value === null || value === "") {
      return this.options.defaultTtlSeconds;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_TTL_SECONDS) {
      throw new AppError(400, "invalid_ttl", `ttlSeconds must be an integer between 0 and ${MAX_TTL_SECONDS}`);
    }
    return value;
  }

  private isExpired(record: LinkRecord): boolean {
    return record.expiresAt !== null && record.expiresAt <= this.options.now();
  }

  /**
   * Analytics are best-effort: a failed click write must never break a
   * redirect. In a real system this becomes an async event stream.
   */
  private countClick(code: string): void {
    try {
      this.store.incrementClicks(code, this.options.now());
    } catch (error) {
      this.options.logger.error("failed to record click", error);
    }
  }
}
