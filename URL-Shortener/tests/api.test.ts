import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";
import { MemoryLinkStore } from "../src/store/memory-store.ts";

const BASE = "http://sho.rt";
let store: MemoryLinkStore;
let app: ReturnType<typeof createApp>["app"];

function create(rateLimitPerMinute = 100) {
  return createApp({
    store,
    baseUrl: BASE,
    rateLimitPerMinute,
    cacheTtlMs: 60_000,
    negativeCacheTtlMs: 5_000,
    now: () => Date.now(),
  });
}

async function post(body: unknown, ip = "10.0.0.1"): Promise<Response> {
  return app.fetch(
    new Request(`${BASE}/api/links`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  store = new MemoryLinkStore();
  app = create().app;
});

test("creates a link, redirects, reports stats, and deletes", async () => {
  const created = await post({ url: "https://example.com/docs?page=2" });
  assert.equal(created.status, 201);

  const body = (await created.json()) as { code: string; shortUrl: string; clicks: number };
  assert.equal(body.shortUrl, `${BASE}/${body.code}`);
  assert.equal(body.clicks, 0);

  const redirect = await app.fetch(new Request(`${BASE}/${body.code}`));
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "https://example.com/docs?page=2");
  assert.equal(redirect.headers.get("cache-control"), "private, no-store");

  const statsResponse = await app.fetch(new Request(`${BASE}/api/links/${body.code}`));
  assert.equal(statsResponse.status, 200);
  const stats = (await statsResponse.json()) as { clicks: number; url: string };
  assert.equal(stats.clicks, 1);
  assert.equal(stats.url, "https://example.com/docs?page=2");

  const deleted = await app.fetch(
    new Request(`${BASE}/api/links/${body.code}`, { method: "DELETE" }),
  );
  assert.equal(deleted.status, 204);

  const gone = await app.fetch(new Request(`${BASE}/${body.code}`));
  assert.equal(gone.status, 404);
});

test("returns structured errors for bad input", async () => {
  const invalidUrl = await post({ url: "javascript:alert(1)" });
  assert.equal(invalidUrl.status, 400);
  const payload = (await invalidUrl.json()) as { error: { code: string } };
  assert.equal(payload.error.code, "invalid_url");

  const badJson = await app.fetch(
    new Request(`${BASE}/api/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }),
  );
  assert.equal(badJson.status, 400);

  const wrongType = await app.fetch(
    new Request(`${BASE}/api/links`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "https://example.com",
    }),
  );
  assert.equal(wrongType.status, 415);

  const missing = await app.fetch(new Request(`${BASE}/nope123`));
  assert.equal(missing.status, 404);
});

test("custom aliases are unique", async () => {
  assert.equal((await post({ url: "https://example.com", alias: "launch" })).status, 201);
  const conflict = await post({ url: "https://other.example", alias: "launch" });
  assert.equal(conflict.status, 409);

  const redirect = await app.fetch(new Request(`${BASE}/launch`));
  assert.equal(redirect.headers.get("location"), "https://example.com/");
});

test("rate limits link creation per client", async () => {
  app = create(2).app;

  assert.equal((await post({ url: "https://example.com/1" }, "1.1.1.1")).status, 201);
  assert.equal((await post({ url: "https://example.com/2" }, "1.1.1.1")).status, 201);

  const limited = await post({ url: "https://example.com/3" }, "1.1.1.1");
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);

  // A different client still has its own budget.
  assert.equal((await post({ url: "https://example.com/4" }, "2.2.2.2")).status, 201);
});

test("serves the UI and health check", async () => {
  const home = await app.fetch(new Request(`${BASE}/`));
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await home.text(), /Shorten it/);

  const health = await app.fetch(new Request(`${BASE}/health`));
  assert.equal(health.status, 200);
  const payload = (await health.json()) as { status: string; links: number };
  assert.equal(payload.status, "ok");
  assert.equal(payload.links, 0);
});

test("expired links return 404 from the redirect path", async () => {
  const created = await post({ url: "https://example.com", ttlSeconds: 1 });
  const { code } = (await created.json()) as { code: string };

  await new Promise((resolve) => setTimeout(resolve, 1100));

  const response = await app.fetch(new Request(`${BASE}/${code}`));
  assert.equal(response.status, 404);
});
