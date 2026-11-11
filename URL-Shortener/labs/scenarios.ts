/**
 * Runnable failure scenarios for the URL shortener.
 *
 *   npm run lab
 *   npm run lab -- stale-read
 *
 * Every scenario is deterministic: time is virtual, failures are counter-based,
 * and no real network or sleeping is involved.
 */
import { AppError } from "../src/lib/errors.ts";
import { LruCache } from "../src/lib/lru-cache.ts";
import { ShortenerService } from "../src/services/shortener.ts";
import { MemoryLinkStore } from "../src/store/memory-store.ts";
import type { LinkRecord, LinkStore } from "../src/store/types.ts";
import { FaultyStore } from "./faulty-store.ts";
import { ReplicatedLinkStore } from "./replicated-store.ts";
import { VirtualClock } from "./virtual-clock.ts";

const silentLogger = { error: () => {} };

function makeService(
  store: LinkStore,
  now: () => number,
  options: { cacheSize?: number; cacheTtlMs?: number } = {},
): ShortenerService {
  return new ShortenerService(store, new LruCache<LinkRecord | null>(options.cacheSize ?? 0, now), {
    codeLength: 7,
    cacheTtlMs: options.cacheTtlMs ?? 0,
    negativeCacheTtlMs: 0,
    defaultTtlSeconds: 0,
    now,
    logger: silentLogger,
  });
}

function header(title: string): void {
  console.log(`\n${"=".repeat(72)}`);
  console.log(title);
  console.log("=".repeat(72));
}

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(42)} ${String(value)}`);
}

function lesson(text: string): void {
  console.log(`\n  Lesson: ${text}`);
}

function describe(error: unknown): string {
  if (error instanceof AppError) return `${error.status} ${error.code} (${error.message})`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function failure(label: string, fn: () => unknown): void {
  try {
    fn();
    line(label, "unexpected success");
  } catch (error) {
    line(label, `failed: ${describe(error)}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Async replication means reads can be stale.
// ---------------------------------------------------------------------------
function staleRead(): void {
  header("1. Asynchronous replication → stale reads");

  const clock = new VirtualClock();
  const primary = new MemoryLinkStore();
  const replica = new MemoryLinkStore();
  const store = new ReplicatedLinkStore({
    primary,
    replicas: [replica],
    replicationLagMs: 5_000,
    now: clock.now,
  });
  const app = makeService(store, clock.now);

  const link = app.shorten({ url: "https://example.com/launch" });
  line("created on primary", link.code);
  line("replica has the row immediately", replica.find(link.code) !== undefined);
  failure("resolve immediately (reads replica)", () => app.resolve(link.code));

  clock.advance(5_000);
  store.flush();
  line("after 5s, replica has the row", replica.find(link.code) !== undefined);
  line("resolve after replication", app.resolve(link.code).url);

  lesson(
    "The write succeeded and the client got a 201, but a read from a replica can still 404. " +
      "Replication lag is a consistency window, not a bug.",
  );
}

// ---------------------------------------------------------------------------
// 2. Read-your-writes is a band-aid over that window.
// ---------------------------------------------------------------------------
function readYourWrites(): void {
  header("2. Read-your-writes pin (and its expiry)");

  const clock = new VirtualClock();
  const primary = new MemoryLinkStore();
  const replica = new MemoryLinkStore();
  const store = new ReplicatedLinkStore({
    primary,
    replicas: [replica],
    replicationLagMs: 60_000,
    now: clock.now,
    readYourWritesMs: 10_000,
  });
  const app = makeService(store, clock.now);

  const link = app.shorten({ url: "https://example.com/onboarding" });
  line("immediately after create", app.resolve(link.code).url);
  line("replica is still empty", replica.find(link.code) === undefined);

  clock.advance(10_000);
  failure("after 10s pin expires (lag 60s)", () => app.resolve(link.code));

  clock.advance(50_000);
  store.flush();
  line("after 60s, replica catches up", app.resolve(link.code).url);

  lesson(
    "Pinning new codes to the primary fixes read-your-writes, but only inside the pin window. " +
      "If replication lag outlives the pin, the inconsistency comes back.",
  );
}

// ---------------------------------------------------------------------------
// 3. Failover loses whatever had not replicated yet.
// ---------------------------------------------------------------------------
function failover(): void {
  header("3. Failover → a data-loss window");

  const clock = new VirtualClock();
  const primary = new MemoryLinkStore();
  const replica = new MemoryLinkStore();
  const store = new ReplicatedLinkStore({
    primary,
    replicas: [replica],
    replicationLagMs: 10_000,
    now: clock.now,
  });
  const app = makeService(store, clock.now);

  const a = app.shorten({ url: "https://example.com/a" });
  clock.advance(10_000);
  store.flush();

  const b = app.shorten({ url: "https://example.com/b" });
  line("replica has link A", replica.find(a.code) !== undefined);
  line("replica has link B (created just now)", replica.find(b.code) !== undefined);

  const promoted = store.replicaAt(0);
  if (promoted === undefined) throw new Error("scenario expected a replica");
  const afterFailover = makeService(promoted, clock.now);

  line("after promotion, A resolves", afterFailover.resolve(a.code).url);
  failure("after promotion, B resolves", () => afterFailover.resolve(b.code));

  lesson(
    "Promoting a replica is a decision with a cost: every write that had not replicated is gone. " +
      "The size of that window is the replication lag.",
  );
}

// ---------------------------------------------------------------------------
// 4. Two primaries accept the same globally unique alias.
// ---------------------------------------------------------------------------
function splitBrain(): void {
  header("4. Split brain → two nodes accept the same alias");

  const clockA = new VirtualClock();
  const clockB = new VirtualClock();
  const appA = makeService(new MemoryLinkStore(), clockA.now);
  const appB = makeService(new MemoryLinkStore(), clockB.now);

  const a = appA.shorten({ url: "https://a.example", alias: "same" });
  const b = appB.shorten({ url: "https://b.example", alias: "same" });

  line("node A accepted /same", `201 → ${a.url}`);
  line("node B accepted /same", `201 → ${b.url}`);
  line("node A resolves /same", appA.resolve("same").url);
  line("node B resolves /same", appB.resolve("same").url);

  lesson(
    "Each database enforced uniqueness over its own rows, so both writers won. " +
      "Global uniqueness needs one authority: partition by alias, a conditional write in a " +
      "globally consistent store, or consensus.",
  );
}

// ---------------------------------------------------------------------------
// 5. The write committed, but the client saw an error.
// ---------------------------------------------------------------------------
function ambiguousWrite(): void {
  header("5. Ambiguous failure → a duplicate on retry");

  const clock = new VirtualClock();
  const primary = new MemoryLinkStore();
  const faulty = new FaultyStore(primary, { ambiguousWriteEvery: 1 });
  const app = makeService(faulty, clock.now);
  const url = "https://example.com/checkout";

  failure("client's first create", () => app.shorten({ url }));

  faulty.setConfig({ ambiguousWriteEvery: 0 });
  const retry = app.shorten({ url });
  line("client retries", `201 → ${retry.code}`);
  line("rows now stored for the same URL", primary.count());

  lesson(
    "The first write committed before the response was lost. A retry created a second link. " +
      "Idempotency keys (or a code derived from the key) make the retry return the first result.",
  );
}

// ---------------------------------------------------------------------------
// 6. Cache hits survive a database outage; misses do not.
// ---------------------------------------------------------------------------
function cacheOutage(): void {
  header("6. Partial failure → cache carries the read path");

  const clock = new VirtualClock();
  const primary = new MemoryLinkStore();
  const faulty = new FaultyStore(primary);
  const cache = new LruCache<LinkRecord | null>(100, clock.now);
  const app = new ShortenerService(faulty, cache, {
    codeLength: 7,
    cacheTtlMs: 60_000,
    negativeCacheTtlMs: 0,
    defaultTtlSeconds: 0,
    now: clock.now,
    logger: silentLogger,
  });

  const link = app.shorten({ url: "https://example.com/popular" });
  app.resolve(link.code);
  line("cached URL", app.resolve(link.code).url);

  faulty.setConfig({ down: true });
  line("cache hit while DB is down", app.resolve(link.code).url);
  failure("cache miss while DB is down", () => app.resolve("unknown1"));

  lesson(
    "Availability is partial. Popular links keep redirecting from cache, but a cache miss fails. " +
      "This is the AP/CP trade-off in miniature: degrade the read path, do not pretend it is healthy.",
  );
}

// ---------------------------------------------------------------------------
// 7. Clocks disagree, so expiry does too.
// ---------------------------------------------------------------------------
function clockSkew(): void {
  header("7. Clock skew → early expiry");

  const clockA = new VirtualClock();
  const clockB = new VirtualClock();
  clockB.advance(5 * 60_000); // node B is five minutes ahead

  const store = new MemoryLinkStore();
  const appA = makeService(store, clockA.now);
  const appB = makeService(store, clockB.now);

  const link = appA.shorten({ url: "https://example.com/temporary", ttlSeconds: 60 });
  line("node A (correct clock) resolves", appA.resolve(link.code).url);
  failure("node B (5 min ahead) resolves", () => appB.resolve(link.code));
  failure("node A resolves again (row deleted)", () => appA.resolve(link.code));

  lesson(
    "B decided the link was expired and deleted the row. Wall clocks are not a global order; " +
      "keep TTLs comfortably larger than expected skew, and use NTP.",
  );
}

// ---------------------------------------------------------------------------
// 8. Read-modify-write loses concurrent increments.
// ---------------------------------------------------------------------------
function lostUpdate(): void {
  header("8. Lost update → two clicks, one count");

  let clicks = 0;
  const read = () => clicks;
  const write = (value: number) => {
    clicks = value;
  };

  const workerA = read();
  const workerB = read();
  write(workerA + 1);
  write(workerB + 1);
  line("two workers: read → +1 → write", clicks);

  clicks = 0;
  clicks += 1;
  clicks += 1;
  line("atomic increments", clicks);

  lesson(
    "Both workers read 0 and both wrote 1. Do the increment in the database " +
      "(UPDATE ... SET clicks = clicks + 1), or serialize it. At scale, batch the writes.",
  );
}

const scenarios: Record<string, () => void> = {
  "stale-read": staleRead,
  "read-your-writes": readYourWrites,
  failover,
  "split-brain": splitBrain,
  "ambiguous-write": ambiguousWrite,
  "cache-outage": cacheOutage,
  "clock-skew": clockSkew,
  "lost-update": lostUpdate,
};

const requested = process.argv[2];

if (requested !== undefined) {
  const run = scenarios[requested];
  if (run === undefined) {
    console.error(`Unknown scenario "${requested}".`);
    console.error(`Available: ${Object.keys(scenarios).join(", ")}`);
    process.exitCode = 1;
  } else {
    run();
  }
} else {
  for (const run of Object.values(scenarios)) run();
  console.log(`\n${"=".repeat(72)}`);
  console.log("Run one scenario at a time with: npm run lab -- <name>");
  console.log(`Available: ${Object.keys(scenarios).join(", ")}`);
}
