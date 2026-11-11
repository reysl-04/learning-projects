export interface Config {
  port: number;
  host: string;
  baseUrl: string;
  dbPath: string;
  codeLength: number;
  cacheSize: number;
  cacheTtlMs: number;
  negativeCacheTtlMs: number;
  rateLimitPerMinute: number;
  defaultTtlSeconds: number;
  cleanupIntervalMs: number;
}

function readInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}: expected an integer in [${min}, ${max}], got "${raw}"`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = readInt(env, "PORT", 3000, 1, 65535);
  const baseUrl = (env.BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, "");

  return {
    port,
    host: env.HOST ?? "127.0.0.1",
    baseUrl,
    dbPath: env.DB_PATH ?? "./data/links.db",
    codeLength: readInt(env, "CODE_LENGTH", 7, 4, 16),
    cacheSize: readInt(env, "CACHE_SIZE", 10_000, 0, 1_000_000),
    cacheTtlMs: readInt(env, "CACHE_TTL_MS", 60_000, 0, 86_400_000),
    negativeCacheTtlMs: readInt(env, "NEGATIVE_CACHE_TTL_MS", 5_000, 0, 86_400_000),
    rateLimitPerMinute: readInt(env, "RATE_LIMIT_PER_MINUTE", 30, 0, 1_000_000),
    defaultTtlSeconds: readInt(env, "DEFAULT_TTL_SECONDS", 0, 0, 31_536_000),
    cleanupIntervalMs: readInt(env, "CLEANUP_INTERVAL_MS", 300_000, 1_000, 86_400_000),
  };
}
