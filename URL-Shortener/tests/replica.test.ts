import { test } from "node:test";
import assert from "node:assert/strict";
import { FaultyStore } from "../labs/faulty-store.ts";
import { ReplicatedLinkStore } from "../labs/replicated-store.ts";
import { VirtualClock } from "../labs/virtual-clock.ts";
import { MemoryLinkStore } from "../src/store/memory-store.ts";
import type { NewLink } from "../src/store/types.ts";

function newLink(code: string, url = `https://example.com/${code}`): NewLink {
  return { code, url, createdAt: 0, expiresAt: null, ownerId: null };
}

function replicaSetup(options: {
  lagMs: number;
  readYourWritesMs?: number;
  start?: number;
}) {
  const clock = new VirtualClock(options.start ?? 1_000);
  const primary = new MemoryLinkStore();
  const replica = new MemoryLinkStore();
  const store = new ReplicatedLinkStore({
    primary,
    replicas: [replica],
    replicationLagMs: options.lagMs,
    now: clock.now,
    readYourWritesMs: options.readYourWritesMs,
  });
  return { clock, primary, replica, store };
}

test("replica reads lag behind primary writes", () => {
  const { clock, primary, replica, store } = replicaSetup({ lagMs: 5_000 });

  assert.equal(store.insert(newLink("abc1234")), true);
  assert.equal(primary.find("abc1234")?.code, "abc1234");
  assert.equal(replica.find("abc1234"), undefined);
  assert.equal(store.find("abc1234"), undefined);

  clock.advance(5_000);
  assert.equal(store.pendingCount(), 1);
  store.flush();

  assert.equal(store.pendingCount(), 0);
  assert.equal(replica.find("abc1234")?.code, "abc1234");
  assert.equal(store.find("abc1234")?.code, "abc1234");
});

test("read-your-writes pin routes to the primary until it expires", () => {
  const { clock, replica, store } = replicaSetup({
    lagMs: 60_000,
    readYourWritesMs: 10_000,
  });

  store.insert(newLink("pin1234"));
  assert.equal(store.find("pin1234")?.code, "pin1234");
  assert.equal(replica.find("pin1234"), undefined);

  clock.advance(10_000);
  assert.equal(store.find("pin1234"), undefined);

  clock.advance(50_000);
  store.flush();
  assert.equal(store.find("pin1234")?.code, "pin1234");
});

test("zero replication lag makes writes visible immediately", () => {
  const { replica, store } = replicaSetup({ lagMs: 0 });

  store.insert(newLink("zero123"));
  assert.equal(store.pendingCount(), 0);
  assert.equal(replica.find("zero123")?.code, "zero123");
});

test("clicks and deletes replicate too", () => {
  const { clock, replica, store } = replicaSetup({ lagMs: 1_000 });

  store.insert(newLink("sync1234"));
  clock.advance(1_000);
  store.flush();

  store.incrementClicks("sync1234", 42);
  clock.advance(1_000);
  store.flush();
  assert.equal(replica.find("sync1234")?.clicks, 1);
  assert.equal(replica.find("sync1234")?.lastAccessedAt, 42);

  store.remove("sync1234");
  clock.advance(1_000);
  store.flush();
  assert.equal(replica.find("sync1234"), undefined);
});

test("failover loses writes that had not replicated yet", () => {
  const { clock, store } = replicaSetup({ lagMs: 10_000 });

  store.insert(newLink("aaaa111"));
  clock.advance(10_000);
  store.flush();
  store.insert(newLink("bbbb222"));

  const promoted = store.replicaAt(0);
  assert.ok(promoted);
  assert.equal(promoted.find("aaaa111")?.code, "aaaa111");
  assert.equal(promoted.find("bbbb222"), undefined);
});

test("expired rows are swept from replicas as well", () => {
  const { clock, replica, store } = replicaSetup({ lagMs: 1_000 });

  store.insert({ ...newLink("exp1234"), expiresAt: 1_500 });
  clock.advance(1_000);
  store.flush();
  assert.notEqual(replica.find("exp1234"), undefined);

  assert.equal(store.deleteExpired(2_000), 1);
  assert.equal(replica.find("exp1234"), undefined);
});

test("an ambiguous write commits before the error reaches the caller", () => {
  const primary = new MemoryLinkStore();
  const faulty = new FaultyStore(primary, { ambiguousWriteEvery: 1 });

  assert.throws(() => faulty.insert(newLink("amb1234")), /timeout after commit/);
  assert.equal(primary.find("amb1234")?.code, "amb1234");
  assert.equal(faulty.count(), 1);

  faulty.setConfig({ down: true });
  assert.throws(() => faulty.find("amb1234"), /store unavailable/);
});
