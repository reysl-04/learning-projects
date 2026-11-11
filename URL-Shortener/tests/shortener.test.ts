import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { LruCache } from "../src/lib/lru-cache.ts";
import { AppError } from "../src/lib/errors.ts";
import { ShortenerService } from "../src/services/shortener.ts";
import { MemoryLinkStore } from "../src/store/memory-store.ts";
import type { LinkRecord } from "../src/store/types.ts";

let now = 1_700_000_000_000;
let store: MemoryLinkStore;
let cache: LruCache<LinkRecord | null>;
let service: ShortenerService;

beforeEach(() => {
  now = 1_700_000_000_000;
  store = new MemoryLinkStore();
  cache = new LruCache<LinkRecord | null>(100, () => now);
  service = new ShortenerService(store, cache, {
    codeLength: 7,
    cacheTtlMs: 60_000,
    negativeCacheTtlMs: 5_000,
    defaultTtlSeconds: 0,
    now: () => now,
  });
});

function expectStatus(fn: () => unknown, status: number): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, status);
    return true;
  });
}

test("creates a link and resolves it", () => {
  const link = service.shorten({ url: "https://example.com/a?b=c" });
  assert.equal(link.code.length, 7);
  assert.equal(link.url, "https://example.com/a?b=c");

  const resolved = service.resolve(link.code);
  assert.equal(resolved.url, "https://example.com/a?b=c");

  const stats = service.stats(link.code);
  assert.equal(stats.clicks, 1);
  assert.equal(stats.lastAccessedAt, now);
});

test("clicks increment on every resolve, including cache hits", () => {
  const link = service.shorten({ url: "https://example.com" });
  service.resolve(link.code);
  service.resolve(link.code);
  service.resolve(link.code);
  assert.equal(service.stats(link.code).clicks, 3);
});

test("supports custom aliases and rejects duplicates", () => {
  const link = service.shorten({ url: "https://example.com", alias: "launch-notes" });
  assert.equal(link.code, "launch-notes");

  expectStatus(() => service.shorten({ url: "https://other.example", alias: "launch-notes" }), 409);
});

test("rejects reserved aliases and malformed aliases", () => {
  expectStatus(() => service.shorten({ url: "https://example.com", alias: "api" }), 409);
  expectStatus(() => service.shorten({ url: "https://example.com", alias: "a b" }), 400);
  expectStatus(() => service.shorten({ url: "https://example.com", alias: "x" }), 400);
});

test("only accepts http(s) URLs", () => {
  expectStatus(() => service.shorten({ url: "javascript:alert(1)" }), 400);
  expectStatus(() => service.shorten({ url: "ftp://example.com/file" }), 400);
  expectStatus(() => service.shorten({ url: "not a url" }), 400);
  expectStatus(() => service.shorten({ url: "" }), 400);
});

test("rejects links that point back at the shortener", () => {
  const selfAware = new ShortenerService(store, cache, {
    codeLength: 7,
    cacheTtlMs: 60_000,
    negativeCacheTtlMs: 5_000,
    defaultTtlSeconds: 0,
    baseUrl: "https://sho.rt",
    now: () => now,
  });

  expectStatus(() => selfAware.shorten({ url: "https://sho.rt/abc1234" }), 400);
  assert.doesNotThrow(() => selfAware.shorten({ url: "https://example.com" }));
});

test("expired links stop resolving and are removed lazily", () => {
  const link = service.shorten({ url: "https://example.com", ttlSeconds: 60 });
  assert.equal(service.resolve(link.code).code, link.code);

  now += 61_000;

  expectStatus(() => service.resolve(link.code), 404);
  expectStatus(() => service.stats(link.code), 404);
  assert.equal(store.find(link.code), undefined);
});

test("an expired alias can be reused", () => {
  service.shorten({ url: "https://example.com/one", alias: "promo", ttlSeconds: 10 });
  now += 11_000;

  const reused = service.shorten({ url: "https://example.com/two", alias: "promo" });
  assert.equal(reused.url, "https://example.com/two");
  assert.equal(service.resolve("promo").url, "https://example.com/two");
});

test("negative cache stops repeated misses from reaching the store", () => {
  expectStatus(() => service.resolve("missing"), 404);
  expectStatus(() => service.resolve("missing"), 404);

  assert.equal(cache.stats().misses, 1);
});

test("deleting a link invalidates the cache", () => {
  const link = service.shorten({ url: "https://example.com" });
  service.resolve(link.code);

  service.remove(link.code);
  expectStatus(() => service.resolve(link.code), 404);
});

test("retries when a generated code collides", () => {
  store.insert({
    code: "dupdup1",
    url: "https://taken.example",
    createdAt: now,
    expiresAt: null,
    ownerId: null,
  });

  const codes = ["dupdup1", "dupdup1", "uniq123"];
  const colliding = new ShortenerService(store, cache, {
    codeLength: 7,
    cacheTtlMs: 60_000,
    negativeCacheTtlMs: 5_000,
    defaultTtlSeconds: 0,
    now: () => now,
    generateCode: () => codes.shift() as string,
  });

  const link = colliding.shorten({ url: "https://example.com" });
  assert.equal(link.code, "uniq123");
});

test("validates ttl values", () => {
  expectStatus(() => service.shorten({ url: "https://example.com", ttlSeconds: -1 }), 400);
  expectStatus(() => service.shorten({ url: "https://example.com", ttlSeconds: 1.5 }), 400);
  expectStatus(() => service.shorten({ url: "https://example.com", ttlSeconds: "60" }), 400);
});

test("purgeExpired removes rows in bulk", () => {
  service.shorten({ url: "https://example.com/a", ttlSeconds: 10 });
  service.shorten({ url: "https://example.com/b" });
  now += 11_000;

  assert.equal(service.purgeExpired(), 1);
  assert.equal(service.count(), 1);
});
