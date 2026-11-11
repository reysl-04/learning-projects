import { createServer } from "node:http";
import { Readable } from "node:stream";
import { loadConfig } from "./config.ts";
import { createApp } from "./app.ts";
import { SqliteLinkStore } from "./store/sqlite-store.ts";

try {
  // Optional .env support without a dependency (Node >= 20.12).
  process.loadEnvFile(".env");
} catch {
  // No .env file; environment variables alone are fine.
}

const config = loadConfig();
const store = new SqliteLinkStore(config.dbPath);
const { app, service, cache, limiter } = createApp({
  store,
  baseUrl: config.baseUrl,
  codeLength: config.codeLength,
  cacheSize: config.cacheSize,
  cacheTtlMs: config.cacheTtlMs,
  negativeCacheTtlMs: config.negativeCacheTtlMs,
  defaultTtlSeconds: config.defaultTtlSeconds,
  rateLimitPerMinute: config.rateLimitPerMinute,
});

const server = createServer(async (request, response) => {
  const startedAt = performance.now();

  try {
    const host = request.headers.host ?? `localhost:${config.port}`;
    const url = new URL(request.url ?? "/", `http://${host}`);

    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined) continue;
      headers.set(name, Array.isArray(value) ? value.join(",") : value);
    }

    const init: RequestInit & { duplex?: "half" } = {
      method: request.method ?? "GET",
      headers,
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = Readable.toWeb(request) as unknown as ReadableStream;
      init.duplex = "half";
    }

    const webResponse = await app.fetch(new Request(url, init));

    response.statusCode = webResponse.status;
    webResponse.headers.forEach((value, name) => response.setHeader(name, value));

    if (webResponse.body === null || request.method === "HEAD") {
      response.end();
    } else {
      const body = Readable.fromWeb(
        webResponse.body as unknown as import("node:stream/web").ReadableStream,
      );
      body.on("error", (error) => {
        console.error("response stream failed", error);
        response.destroy();
      });
      body.pipe(response);
    }
  } catch (error) {
    console.error("request failed", error);
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    }
    response.end(JSON.stringify({ error: { code: "internal_error", message: "something went wrong" } }));
  } finally {
    const duration = (performance.now() - startedAt).toFixed(1);
    console.log(`${request.method} ${request.url} ${response.statusCode} ${duration}ms`);
  }
});

const cleanup = setInterval(() => {
  try {
    const removed = service.purgeExpired();
    limiter.prune();
    if (removed > 0) console.log(`swept ${removed} expired link(s)`);
  } catch (error) {
    console.error("cleanup failed", error);
  }
}, config.cleanupIntervalMs);
cleanup.unref();

server.listen(config.port, config.host, () => {
  console.log(`URL shortener listening on http://${config.host}:${config.port}`);
  console.log(`Public base URL: ${config.baseUrl}`);
  console.log(`SQLite: ${config.dbPath} | cache entries: ${cache.stats().size}`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, draining connections...`);

  clearInterval(cleanup);
  server.close(() => {
    store.close();
    console.log("shutdown complete");
    process.exit(0);
  });

  // Do not hang forever on keep-alive connections.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
