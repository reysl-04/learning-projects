import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LruCache } from "./lib/lru-cache.ts";
import { AppError } from "./lib/errors.ts";
import { FixedWindowRateLimiter } from "./lib/rate-limit.ts";
import { ShortenerService } from "./services/shortener.ts";
import type { LinkRecord, LinkStore } from "./store/types.ts";
import { clientIp, errorResponse, json, readJson } from "./http/helpers.ts";
import { Router, type RouteHandler } from "./http/router.ts";

export interface AppOptions {
  store: LinkStore;
  baseUrl: string;
  codeLength?: number;
  cacheSize?: number;
  cacheTtlMs?: number;
  negativeCacheTtlMs?: number;
  defaultTtlSeconds?: number;
  rateLimitPerMinute?: number;
  now?: () => number;
  publicDir?: string;
}

export interface App {
  fetch(request: Request): Promise<Response>;
}

const ASSETS: Record<string, { file: string; contentType: string }> = {
  "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", contentType: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", contentType: "text/javascript; charset=utf-8" },
};

export function createApp(options: AppOptions) {
  const now = options.now ?? Date.now;
  const cache = new LruCache<LinkRecord | null>(options.cacheSize ?? 10_000, now);
  const limiter = new FixedWindowRateLimiter(
    options.rateLimitPerMinute ?? 30,
    60_000,
    now,
  );
  const service = new ShortenerService(options.store, cache, {
    codeLength: options.codeLength ?? 7,
    cacheTtlMs: options.cacheTtlMs ?? 60_000,
    negativeCacheTtlMs: options.negativeCacheTtlMs ?? 5_000,
    defaultTtlSeconds: options.defaultTtlSeconds ?? 0,
    baseUrl: options.baseUrl,
    now,
  });

  const publicDir = options.publicDir ?? join(import.meta.dirname, "..", "public");

  const router = new Router();

  for (const [path, asset] of Object.entries(ASSETS)) {
    router.add(
      "GET",
      path,
      handle(async () => {
        const body = await readFile(join(publicDir, asset.file), "utf8");
        return new Response(body, {
          headers: {
            "content-type": asset.contentType,
            "cache-control": path === "/" ? "no-cache" : "public, max-age=3600",
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
            "content-security-policy":
              "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'",
          },
        });
      }),
    );
  }

  router.add(
    "GET",
    "/health",
    handle(async () =>
      json({
        status: "ok",
        uptimeSeconds: Math.round(process.uptime()),
        links: service.count(),
        cache: cache.stats(),
      }),
    ),
  );

  router.add(
    "POST",
    "/api/links",
    handle(async ({ request }) => {
      const limit = limiter.take(clientIp(request));
      if (!limit.allowed) {
        return json(
          {
            error: {
              code: "rate_limited",
              message: "too many links created from this client, slow down",
            },
          },
          429,
          { "retry-after": String(limit.retryAfterSeconds) },
        );
      }

      const body = await readJson(request);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError(400, "invalid_body", "request body must be a JSON object");
      }

      const payload = body as Record<string, unknown>;
      const record = service.shorten({
        url: payload.url,
        alias: payload.alias,
        ttlSeconds: payload.ttlSeconds,
      });

      return json(serialize(record, options.baseUrl), 201, {
        "x-ratelimit-remaining": String(limit.remaining),
      });
    }),
  );

  router.add(
    "GET",
    "/api/links/:code",
    handle(async ({ params }) => {
      const record = service.stats(params.code as string);
      return json(serialize(record, options.baseUrl));
    }),
  );

  router.add(
    "DELETE",
    "/api/links/:code",
    handle(async ({ params }) => {
      service.remove(params.code as string);
      return new Response(null, { status: 204 });
    }),
  );

  // Redirect route must come after every literal single-segment route.
  router.add(
    "GET",
    "/:code",
    handle(async ({ params }) => {
      const record = service.resolve(params.code as string);
      return new Response(null, {
        status: 302,
        headers: {
          location: record.url,
          // 302 + no-store keeps analytics accurate and lets links be edited.
          // A 301 would be cached by browsers and CDNs, making both impossible.
          "cache-control": "private, no-store",
          "referrer-policy": "no-referrer",
        },
      });
    }),
  );

  const app: App = {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const match = router.match(request.method, url.pathname);

      if (match === null) {
        if (url.pathname.startsWith("/api/")) {
          return json({ error: { code: "not_found", message: "route not found" } }, 404);
        }
        return new Response("Not found\n", {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }

      return match.handler({ request, url, params: match.params });
    },
  };

  return { app, service, cache, limiter };
}

function handle(handler: RouteHandler): RouteHandler {
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function serialize(record: LinkRecord, baseUrl: string) {
  return {
    code: record.code,
    url: record.url,
    shortUrl: `${baseUrl}/${record.code}`,
    createdAt: new Date(record.createdAt).toISOString(),
    expiresAt: record.expiresAt === null ? null : new Date(record.expiresAt).toISOString(),
    clicks: record.clicks,
    lastAccessedAt:
      record.lastAccessedAt === null ? null : new Date(record.lastAccessedAt).toISOString(),
  };
}
