# Distributed Systems & the URL Shortener

A study guide to the concepts behind the code in this folder: what distributed
systems are, why a URL shortener is a surprisingly good example, the failure
modes you will meet at scale, and what to read next.

> This is the conceptual companion to the implementation. For the API, setup,
> and code layout, see the [project README](../README.md). For runnable
> experiments, see the [labs](../labs/README.md).

**Contents**

1. [The basics](#part-i--the-basics)
2. [Why a URL shortener is a good specimen](#part-ii--why-a-url-shortener-is-a-good-specimen)
3. [The problems in detail](#part-iii--the-problems-in-detail)
4. [Hands-on labs](#part-iv--hands-on-labs)
5. [A four-week learning path](#part-v--a-four-week-learning-path)
6. [Resources](#part-vi--resources)
7. [Self-check questions](#part-vii--self-check-questions)
8. [Glossary](#glossary)

---

## Part I — The basics

### What is a distributed system?

A distributed system is a set of independent computers that cooperate over a
network and appear to users as one system.

The network is the boundary that makes it hard. Messages can be delayed, lost,
duplicated, or reordered. Nodes can fail independently. There is no shared
memory and no global clock. A program that works perfectly on one machine can
fail in surprising ways when its components are spread across many.

The classic list of wrong assumptions is the **fallacies of distributed
computing**:

1. The network is reliable.
2. Latency is zero.
3. Bandwidth is infinite.
4. The network is secure.
5. Topology does not change.
6. There is one administrator.
7. Transport cost is zero.
8. The network is homogeneous.

Every distributed-systems problem in this guide is a consequence of one of these
being false.

### The eight ideas

You do not need to know every algorithm to understand distributed systems. You
need these eight ideas.

#### 1. Partial failure

In a single process, a function either returns or throws. In a distributed
system, part of the system can fail while the rest keeps working: the database is
down but the cache is up, one replica is slow, one region is partitioned.

The hardest consequence is **ambiguity**. If a client times out waiting for a
write, the write may have committed or not. The client cannot tell the
difference. This is why retries and idempotency exist.

**In the shortener:** a cache hit still redirects while the database is down; a
cache miss fails. A retried `POST` can create a duplicate link.

#### 2. Asynchrony and time

There is no bound on how long a message can take, and no global “now.” Each node
has its own clock, and clocks drift. A timeout is a local guess, not proof that
the remote node failed.

Consequences:

- You cannot order events across nodes by wall-clock time alone.
- Expiry based on wall clocks can differ by node.
- “Slow” and “dead” are indistinguishable to a client.

**In the shortener:** a link with a 60-second TTL can expire early on a node
whose clock is five minutes ahead.

#### 3. Replication

Replication keeps copies of data on multiple nodes. It buys durability,
availability, and lower read latency. The cost is **replication lag**: replicas
can be behind the primary.

Replication models:

- **Single-leader**: one node accepts writes, others replicate. Simple, common.
- **Multi-leader**: several nodes accept writes; conflicts must be resolved.
- **Leaderless / quorum**: writes go to several replicas; reads query several.

**In the shortener:** the `labs/replicated-store.ts` model is single-leader with
asynchronous replication. Reads go to replicas and can be stale.

#### 4. Partitioning (sharding)

Partitioning splits data across nodes by a key. It buys scale and isolation. The
cost is that operations spanning partitions become expensive or impossible.

- **Hash partitioning** spreads load evenly but destroys range queries.
- **Range partitioning** keeps ranges together but can create hot spots.
- **Consistent hashing** minimizes data movement when nodes join or leave.

**In the shortener:** shard by `hash(code)`. Lookup stays a single-shard read,
but “list all links for a user” becomes a scatter-gather across every shard.

#### 5. Consistency

Consistency is a contract about what a read is allowed to return. It is a
spectrum, not a boolean:

- **Linearizable (strong):** every read sees the latest completed write, as if
  there were one copy.
- **Sequential:** operations appear in some total order consistent with each
  client's order.
- **Causal:** effects are seen after their causes; concurrent events may be
  ordered differently by different nodes.
- **Read-your-writes:** a client sees its own writes.
- **Monotonic reads:** a client never goes backward in time.
- **Eventual:** replicas converge if writes stop.

Stronger consistency usually costs latency, availability, or both.

**In the shortener:** a redirect can tolerate slightly stale data; a custom alias
cannot tolerate two conflicting owners.

#### 6. Consensus

Consensus is how a set of nodes agrees on one value despite failures. It is the
foundation of leader election, distributed locks, and globally unique names.

Key ideas:

- **Quorum:** a majority of nodes must agree.
- **Leader election:** one node coordinates writes for a term.
- **Split brain:** two nodes both believe they are leader. Fencing tokens
  (monotonically increasing numbers attached to writes) prevent the old leader
  from corrupting data after a pause.
- **Raft / Paxos:** the two best-known consensus protocols.

Consensus is expensive. It needs a round trip to a quorum and cannot make
progress during a partition without a majority.

**In the shortener:** if alias `launch` must be globally unique, two independent
databases can both accept it. That is split brain. Fixing it requires one
authority: partition by alias, a conditional write in a globally consistent
store, or consensus.

#### 7. Idempotency and retries

Because failures are ambiguous, clients retry. A retry must be safe.

- **Idempotent operation:** doing it twice has the same effect as doing it once.
- **Idempotency key:** a client-generated key stored with the result; a retry
  with the same key returns the first result.
- **At-least-once delivery:** messages may arrive more than once. Pair it with
  idempotent consumers to get **effectively-once**.

**In the shortener:** a timeout after a successful insert, followed by a retry,
creates two links unless creation is idempotent.

#### 8. Observability

You cannot debug a partial failure without a global view. You need:

- **Metrics:** request rate, errors, duration (the “RED” method), plus
  utilization, saturation, errors (“USE”).
- **Logs:** structured, correlated by request ID.
- **Traces:** a single request followed across services.
- **SLOs:** an explicit target such as “99.9% of redirects under 50 ms.”

**In the shortener:** cache hit ratio, p95/p99 redirect latency, database
saturation, collision retries, and rate-limit rejections are the metrics that
matter.

### CAP and PACELC, without the mythology

**CAP** says that during a network partition, a distributed system cannot be both
linearizably consistent and available for every request. You must choose.

- **C** means linearizability, not “has a database.”
- **A** means every non-failing node returns a response, not “the system is up.”
- **P** is not optional on a real network.

**PACELC** extends it: if there is a **P**artition, choose **A** or **C**;
**E**lse (no partition), choose **L**atency or **C**onsistency. Even without a
partition, strong consistency costs latency.

Most real systems are not “CP” or “AP” in a simple sense. Different operations
make different choices. A shortener usually wants **AP redirects** and
**CP-ish alias creation**.

---

## Part II — Why a URL shortener is a good specimen

The API is tiny, but the system touches almost every hard problem:

| Property | Why it matters |
| --- | --- |
| **One code → one URL** | A uniqueness invariant across all writers |
| **Extreme read/write ratio** | Often 100:1 or more; caching dominates the design |
| **Huge keyspace, small values** | 62⁷ ≈ 3.5 trillion codes; each row is tiny |
| **Mutable metadata** | Click counts and expiry change after creation |
| **Global aliases** | A user-chosen name must be unique everywhere |
| **Hot keys** | One viral link can dominate traffic |
| **Open redirect** | Abuse and phishing are product risks, not edge cases |
| **Two different paths** | Redirects want availability; creation wants correctness |

The core invariant is simple enough to state in one sentence, which makes the
failure modes easy to see:

> Every code resolves to exactly one URL, until it is deleted or expires.

The rest of this guide is about what happens to that sentence when there is more
than one machine.

---

## Part III — The problems in detail

### 1. Unique code allocation and collisions

**What breaks.** Two writers allocate the same code for different URLs, or two
users claim the same custom alias.

**Why.** A check-then-insert in application code is a race:

```
read code -> not found
                         another writer inserts the same code
insert code -> conflict or overwrite
```

With one database, a `UNIQUE` constraint makes the database the arbiter. With
many databases, each one only enforces uniqueness over its own rows.

**The math.** For random codes of length 7 over base62:

- Keyspace: `62⁷ = 3,521,614,606,208`.
- Expected colliding pairs after `n` inserts: about `n² / (2 · 62⁷)`.
- At 1 billion links: about 140,000 colliding pairs total.
- Per-insert collision probability at that point: about 0.03%.

So collisions are rare per insert but inevitable in aggregate. Retry with a
bounded number of attempts.

**Alternatives.**

- **Sequential IDs + base62.** Collision-free, but leaks volume and lets anyone
  enumerate every link. A central sequence is also a bottleneck and a single
  point of failure.
- **Snowflake-style IDs.** Timestamp + machine ID + sequence. No coordination
  per insert, but clock skew and machine-ID assignment become the new problems.
- **ULIDs.** Time-ordered, 128-bit, often encoded in base32.
- **Leased ranges.** A coordinator hands each node a block of IDs; nodes allocate
  locally until the block runs out.

**Custom aliases are harder.** Generated codes can be retried; a user-chosen
alias must be globally unique. Two shards can both accept `launch` if they do not
share an authority. Fixes:

- Partition aliases by `hash(alias)` so one shard owns each name.
- Use a globally consistent conditional write (Spanner, DynamoDB, etcd).
- Use consensus for the reservation.
- Accept a reconciliation window and resolve conflicts later (rarely acceptable
  for user-facing names).

**In this project.** The primary key is `UNIQUE`; collisions retry up to five
times; aliases return `409`. The `split-brain` lab shows two databases accepting
the same alias.

---

### 2. Read/write asymmetry, caching, and coherence

**What breaks.** The database melts under read traffic, so you add a cache — and
then the cache and database disagree.

**Why.** Shorteners are read-heavy. A cache absorbs the hot path, but every cache
introduces a coherence problem:

- **Cache stampede / thundering herd.** A popular key expires and thousands of
  requests miss at once, all hitting the database. Fix with request coalescing
  (singleflight), stale-while-revalidate, or probabilistic early refresh.
- **Negative caching.** Requests for deleted or nonexistent codes are pure
  database load. Cache the absence briefly, or an attacker can generate misses
  cheaply.
- **Hot keys.** One viral link can receive millions of requests while the rest of
  the keyspace is cold. A sharded cache still puts that key on one shard. Use a
  local L1 cache, a CDN, and read replicas.
- **Invalidation race.** A reader misses, reads the old row; a writer updates the
  row and deletes the cache; the reader writes the stale row back. The cache is
  wrong until TTL. Fix with versioned values, write-through, delayed double
  delete, or CDC invalidation.
- **Per-node caches are not coherent.** Twelve app servers each have their own
  LRU. A delete on server 1 does not invalidate server 7. Use a shared cache, a
  pub/sub invalidation channel, or accept a short TTL.

**In this project.** The cache is an in-process LRU with TTL and negative
caching. It demonstrates the read path, not a production cache tier.

---

### 3. Sharding and hot shards

**What breaks.** One database cannot hold the rows or absorb the write rate, so
you shard — and then queries that used to be trivial become distributed.

**Why.** Hash sharding by code gives even distribution and single-shard lookups.
But:

- **Cross-shard queries.** “List all links created by user X” now needs a
  secondary index or a scatter-gather across every shard.
- **Hot shards.** Uniform hashing does not help a single viral link. One key is
  still one shard. Read replicas and caching protect it.
- **Resharding.** Adding nodes moves data. Consistent hashing limits movement,
  but you still need dual writes, backfills, and a cutover plan. Rebalancing
  under load is where outages happen.

**In this project.** One SQLite file, WAL mode, one writer. `node:sqlite` is
synchronous and blocks the event loop; it is a demo store, not a scale store.

---

### 4. Consistency, CAP, and the redirect path

**What breaks.** A user creates a link and immediately gets a 404, or a deleted
link keeps redirecting, or two regions disagree about which URL a code points to.

**Why.** The two paths want different guarantees:

- **Redirects should be AP.** During a partition, serve a slightly stale URL from
  cache rather than a 500. Availability and latency win.
- **Creation and alias uniqueness lean CP.** Two conflicting aliases must not
  both be accepted. Under a partition, reject new aliases while keeping redirects
  alive.
- **Read-after-write.** A write goes to the primary; the next read goes to a
  lagging replica. The creator sees a 404. Fix by routing the creator's reads to
  the primary briefly, pinning the new code in cache, or returning a consistency
  token.
- **Deletion and expiry.** A tombstone can take time to reach every replica and
  cache. “Immediately gone everywhere” is a strong requirement and costs
  availability.
- **301 vs 302.** A `301` is cached aggressively by browsers and CDNs. It reduces
  load but makes analytics, edits, and deletion approximate. A `302` with
  `no-store` keeps control but sends every click to the origin.

**In this project.** Redirects are `302` with `no-store`; cache hits can survive
a database outage because click-write failures are swallowed; cache misses fail.
That is a small, honest AP/CP split.

---

### 5. Click counting

**What breaks.** Clicks are lost, or the counter becomes a write bottleneck.

**Why.**

```
read clicks (0)
                another request reads clicks (0)
write 1
                write 1
final: 1, expected 2
```

A read-modify-write in application code loses updates. An atomic
`UPDATE ... SET clicks = clicks + 1` fixes one row, but at scale the write itself
is the problem:

- **Write amplification.** One database write per redirect can double the write
  load of the entire service.
- **Hot-row contention.** A viral link serializes every increment on one row.
- **Streams and batching.** Buffer counts in memory and flush periodically, or
  emit click events to Kafka and aggregate downstream. Trade freshness and
  exactness for throughput.
- **Exactly-once is usually at-least-once + idempotency.** Retries duplicate
  events. Use request IDs, deduplication, or accept approximate counts.
- **Unique visitors.** HyperLogLog estimates cardinality in fixed memory.
- **Multi-region.** Keep per-region counters and merge them (a grow-only counter
  is a CRDT). “Unique visitors across regions” is harder.

**In this project.** Every redirect does one synchronous atomic `UPDATE`. It is
correct on one node and is the first thing to move async at scale.

---

### 6. Rate limiting and abuse across nodes

**What breaks.** A per-process limiter enforces `limit × number_of_nodes`, and
clients can be routed to a different node on every request.

**Why.**

- **Shared counters.** Put the counter in Redis and use an atomic `INCR` with an
  expiry set atomically (Lua or `MULTI`). A `GET` then `SET` has a race.
- **Identity.** IP is blunt: NAT puts thousands of users behind one address, and
  `X-Forwarded-For` is spoofable unless a trusted proxy overwrites it. Prefer API
  keys or accounts for authenticated creation.
- **Volumetric attacks.** Application-level limiting cannot absorb a DDoS. That
  belongs at the edge/CDN/WAF, with per-ASN and per-IP rules.
- **Abuse.** A shortener is an open redirect: phishing, malware, and spam are the
  real product risks. Production adds blocklists, reputation, interstitial
  warnings, malware scanning, per-account quotas, and abuse reporting.
- **Enumeration.** Random codes make walking the keyspace impractical; sequential
  codes make it trivial.

**In this project.** Fixed-window, in-memory, per-IP, trusting
`X-Forwarded-For`. Explicitly a single-node placeholder.

---

### 7. Expiry, clocks, and scheduling

**What breaks.** Links expire early or late, or expired rows are never reclaimed,
or an alias is reused while old links still point at it.

**Why.**

- **Clock skew.** Absolute timestamps are interpreted by each node's wall clock.
  A node 30 seconds ahead expires links early; one behind expires them late. Use
  NTP, and keep TTLs comfortably larger than expected skew.
- **Lazy vs active expiration.** Checking expiry on read is cheap and always
  correct-ish; a background sweep reclaims space. Every node sweeping the same
  table duplicates work and creates lock contention. Run one sweeper, or
  partition the sweep by shard.
- **Cache TTL vs link TTL.** If the cache TTL is longer than the link TTL, a stale
  cache can serve an expired link. Store the expiry in the cached value and
  enforce it, or keep the cache TTL shorter.
- **Alias reuse.** Reusing an expired alias can silently repoint old links.
  Consider a quarantine period or never reuse aliases.

**In this project.** Lazy expiry plus a periodic sweep, both using the process
clock. The `clock-skew` lab shows a five-minute-ahead node deleting a live link.

---

### 8. Partial failure, retries, and idempotency

**What breaks.** A request fails, the client retries, and the system performs the
operation twice.

**Why.** “The request failed” is ambiguous. It may have succeeded.

- **Idempotency keys.** The client sends a key; the server stores `key → result`
  and returns the same result on retry. The key must be written atomically with
  the operation.
- **Retries.** Use exponential backoff with jitter and a retry budget. Retries
  without limits create storms that finish off a struggling dependency.
- **Circuit breakers.** Stop calling a failing dependency for a while.
- **Bulkheads.** Isolate pools so a slow analytics store cannot starve redirects.
- **Backpressure and load shedding.** Reject work explicitly when saturated
  instead of queueing until everything times out.
- **Graceful degradation.** Serve stale cache, drop analytics, disable custom
  aliases, and keep redirects working.
- **Draining.** On `SIGTERM`, stop accepting new connections and finish in-flight
  requests; the load balancer needs readiness signals.

**In this project.** `SIGTERM` drains connections; creation is not idempotent;
the `ambiguous-write` lab reproduces the duplicate.

---

### 9. Multi-region and geo-distribution

**What breaks.** A user in Sydney waits 200 ms for a redirect, or two regions
disagree about an alias, or data cannot legally leave a region.

**Why.**

- **Active-passive.** One write region, read replicas elsewhere. Simpler, but
  writes pay cross-region latency and failover has a data-loss window.
- **Active-active.** Low latency everywhere, but global uniqueness, conflict
  resolution, and counter merging return. Links are mostly immutable, which
  helps: create once, replicate, never update except delete/expiry.
- **Routing.** GeoDNS or anycast sends users to the nearest healthy region.
  Health checks and failover must not create loops or split brain.
- **Data residency.** Regulations may forbid moving URLs across regions.
- **Edge caching.** CDNs can cache redirects, but invalidation and analytics
  become approximate. A short edge TTL is a deliberate trade-off.

**In this project.** Single region, single database. The replica lab is the
first step toward understanding the trade-offs.

---

### 10. Operations: you cannot fix what you cannot see

**What breaks.** An incident happens and nobody can tell which component is
failing, or a schema migration takes the service down.

**Why.**

- **Observability.** Track redirect latency (p50/p95/p99), cache hit ratio,
  database saturation, 4xx/5xx by route, collision retries, rate-limit
  rejections, and queue depth. Use distributed tracing once a redirect touches
  cache, database, and analytics.
- **SLOs and load shedding.** Define a target such as “99.9% of redirects under
  50 ms” and degrade when you cannot meet it.
- **Schema migrations.** Adding an index or column to 100 million rows is an
  online operation. Use expand/contract migrations, backfills, and dual
  reads/writes.
- **Backups and restore drills.** A replicated database is not a backup.
  Corrupted writes replicate too.
- **Capacity and cost.** Cache and egress dominate cost; a `302` to origin costs
  more than a CDN-cached `301`.

**In this project.** `/health`, structured-ish logs, and cache stats. No metrics,
tracing, or SLOs.

---

### Summary

| Problem | Single-node symptom | At-scale failure | Main mitigation |
| --- | --- | --- | --- |
| Code uniqueness | `UNIQUE` constraint | Collisions, alias split brain | Retry + global reservation / partition by alias |
| Read load | SQLite handles it | DB saturated, stampedes | Cache-aside, singleflight, negative cache, replicas |
| Hot keys | One row is fine | One shard melts | L1 cache, CDN, read replicas |
| Sharding | No sharding | Cross-shard queries, resharding | Hash shard by code + secondary indexes |
| Consistency | Strong by default | Lag, stale reads, 404 after create | AP redirects, read-your-writes, tombstones |
| Click counts | Atomic `UPDATE` | Write amplification, contention | Batch/stream, idempotency, CRDT counters |
| Rate limits | Per-process counter | N× quota, spoofed IPs | Shared atomic counters, edge WAF |
| Expiry | Local clock | Clock skew, duplicate sweeps | NTP, lazy + single sweeper, cache TTL < link TTL |
| Retries | No retries | Duplicate links, retry storms | Idempotency keys, backoff + jitter, breakers |
| Multi-region | N/A | Global uniqueness, residency | Active-passive or CRDT/merge strategy |
| Operations | `console.log` | Blind during incidents | Metrics, tracing, SLOs, migrations, backups |

---

## Part IV — Hands-on labs

The [`labs/`](../labs/README.md) folder is a deterministic simulator built on the
same `ShortenerService` and `LinkStore` interfaces as the real app. There is no
network and no sleeping: a virtual clock and counter-based faults make every run
reproducible.

```bash
npm run lab                    # all scenarios
npm run lab -- stale-read      # one scenario
npm test                       # 30 tests, including the replica lab
```

| Scenario | What it demonstrates |
| --- | --- |
| `stale-read` | A write succeeds, but an immediate replica read 404s |
| `read-your-writes` | Pinning new codes to the primary hides lag until the pin expires |
| `failover` | Promoting a replica loses writes that had not replicated |
| `split-brain` | Two nodes accept the same globally unique alias |
| `ambiguous-write` | The write commits, the response is lost, the retry duplicates it |
| `cache-outage` | Cache hits survive a DB outage; misses fail |
| `clock-skew` | A node five minutes ahead expires and deletes a live link |
| `lost-update` | Two read-modify-write increments produce one click |

After each scenario, answer four questions:

1. **What did the client see?** (status code, latency, data)
2. **What did the system actually do?** (which writes committed, which replicas
   saw them)
3. **Which invariant broke?** (uniqueness, read-your-writes, exactly-once, ...)
4. **What did the fix cost?** (latency, availability, complexity, money)

The exercises in [`labs/README.md`](../labs/README.md) walk through synchronous
replication, breaking the read-your-writes fix, failing over early, implementing
idempotency, and adding quorum replication.

---

## Part V — A four-week learning path

Roughly three hours per week. Read a little, build a little, break a lot.

### Week 1 — Failure and time

- **Read:** DDIA chapter 8; the fallacies of distributed computing.
- **Run:** `stale-read`, `cache-outage`, `clock-skew`.
- **Build:** the two-instance split-brain experiment in the project README.
- **Learn:** crash-stop vs crash-recovery, omission vs Byzantine failures, why a
  timeout is ambiguous.

### Week 2 — Replication and consistency

- **Read:** DDIA chapter 5 and the first half of chapter 9.
- **Run:** `read-your-writes`, `failover`.
- **Build:** a primary/replica wrapper with configurable lag; add read-your-writes
  pinning; measure stale reads.
- **Learn:** single-leader replication, sync vs async, replication lag,
  linearizability vs eventual consistency.

### Week 3 — Partitioning and caching

- **Read:** DDIA chapter 6; skim the Dynamo paper.
- **Build:** a hash-ring store over three in-memory shards; add a second cache and
  observe incoherence on delete; fix it with pub/sub invalidation or a short TTL.
- **Learn:** hash vs range sharding, consistent hashing, hot shards, cache
  coherence, negative caching.

### Week 4 — Consensus intuition and resilience

- **Read:** the first four sections of the Raft paper, or watch MIT 6.5840
  lectures 1–3.
- **Build:** idempotency keys, retries with jitter, batched click counts; run a
  chaos test that randomly fails 10% of store calls.
- **Learn:** quorums, leader election, split brain, fencing tokens, at-least-once
  delivery, backpressure.

You do **not** need to implement Raft to get the basics. Implement it later if you
want the deepest possible intuition.

### If you only have five hours

Read DDIA chapter 8, run `stale-read` and `split-brain`, and read the Raft paper's
introduction. That covers most of the mental model.

---

## Part VI — Resources

Start with the first three. The rest are for when a specific question comes up.

### Start here

1. **Martin Kleppmann, _Designing Data-Intensive Applications_** — the single best
   book for this field. Read chapters 1, 8, 5, 6, and 9, in that order.
   [dataintensive.net](https://dataintensive.net/)
2. **MIT 6.5840 (formerly 6.824), Distributed Systems** — lectures and the famous
   Raft labs. The labs are the best forced exercise in the field.
   [pdos.csail.mit.edu/6.5840](https://pdos.csail.mit.edu/6.5840/)
3. **Jepsen** — analyses of real databases under partitions. Read two or three;
   they teach you how systems fail in ways the documentation does not mention.
   [jepsen.io/analyses](https://jepsen.io/analyses)

### Books

- **_Designing Data-Intensive Applications_** — Kleppmann. The default choice.
- **_Distributed Systems_** — van Steen and Tanenbaum. Free, academic, broad.
  [distributed-systems.net](https://www.distributed-systems.net/index.php/books/ds4/)
- **_Database Internals_** — Alex Petrov. Storage engines and distributed data.
  [databass.dev](https://www.databass.dev/)
- **_Understanding Distributed Systems_** — Roberto Vitillo. A gentler,
  practitioner-oriented introduction. [understandingdistributed.systems](https://understandingdistributed.systems/)
- **_Site Reliability Engineering_** — Google. Free online; read the chapters on
  SLOs, load shedding, and cascading failures.
  [sre.google/sre-book](https://sre.google/sre-book/table-of-contents/)

### Courses

- **MIT 6.5840** — lectures on YouTube; labs in Go.
- **Cloud Computing Concepts** — Indranil Gupta, Coursera. Good for the basics of
  gossip, membership, and consensus.
  [coursera.org/learn/cloud-computing](https://www.coursera.org/learn/cloud-computing)
- **CMU 15-440/15-640** — distributed systems course with projects. Search for
  the current offering.

### Papers

Read the abstract, introduction, and evaluation first. You do not need to
understand every proof.

- **Dynamo: Amazon's Highly Available Key-value Store** (2007) — leaderless
  replication, quorums, eventual consistency.
  [PDF](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)
- **In Search of an Understandable Consensus Algorithm (Raft)** (2014) —
  leader election, log replication, safety. [raft.github.io](https://raft.github.io/)
- **Paxos Made Simple** (2001) — the other consensus protocol, in Lamport's
  famously understated style.
- **Spanner: Google's Globally-Distributed Database** (2012) — global
  consistency with TrueTime and bounded clock uncertainty.
  [research.google](https://research.google/pubs/pub39966/)
- **The Google File System** (2003) — replication, failure detection, and the
  assumptions behind large-scale storage.
- **MapReduce** (2004) — the original batch-processing model.
- **Bigtable** (2006) — a distributed sorted map; the ancestor of many NoSQL
  stores.
- **Kafka: a Distributed Messaging System for Log Processing** (2011) — the log as
  a system-building primitive.
- **Time, Clocks, and the Ordering of Events in a Distributed System** (Lamport,
  1978) — happens-before and logical clocks.
  [PDF](https://lamport.azurewebsites.net/pubs/time-clocks.pdf)
- **Brewer's Conjecture and the Feasibility of Consistent, Available,
  Partition-Tolerant Web Services** (Gilbert & Lynch, 2002) — the formal CAP
  result.
- **Consistency Tradeoffs in Modern Distributed Database System Design** (Abadi,
  2012) — PACELC.
- **The Tail at Scale** (Dean & Barroso, 2013) — why p99 latency is a systems
  problem, not a code problem.
- **Dapper** (2010) — distributed tracing at Google.
- **A Note on Distributed Computing** (Waldo et al., 1994) — why distributed
  objects are not local objects.
- **Simple Testing Can Prevent Most Critical Failures** (Yuan et al., 2014) — an
  empirical study of catastrophic failures in distributed systems.

### Blogs and articles

- **Martin Kleppmann's blog** — [martin.kleppmann.com](https://martin.kleppmann.com/)
- **Marc Brooker's blog** — timeouts, retries, queues, and realistic distributed
  systems. [brooker.co.za/blog](https://brooker.co.za/blog/)
- **AWS Builders' Library** — short, practical articles on timeouts, retries,
  backoff, and load shedding. [aws.amazon.com/builders-library](https://aws.amazon.com/builders-library/)
- **Jepsen** — [jepsen.io](https://jepsen.io/)
- **“How to do distributed locking”** — Kleppmann on fencing tokens and why a
  lock without one is not safe.
  [martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- **“Is Redlock safe?”** — antirez's response; read both sides.
  [antirez.com/news/101](http://antirez.com/news/101)
- **“There is no now”** — Justin Sheehy on time and order in distributed systems.
  [ACM Queue](https://queue.acm.org/detail.cfm?id=2745385)
- **The System Design Primer** — a broad map of system-design topics.
  [github.com/donnemartin/system-design-primer](https://github.com/donnemartin/system-design-primer)
- **Awesome Distributed Systems** — a curated reading list.
  [github.com/theanalyst/awesome-distributed-systems](https://github.com/theanalyst/awesome-distributed-systems)

### Practice

- **MIT 6.5840 labs** — MapReduce, Raft, a fault-tolerant KV store, sharded KV.
- **This repo's labs** — run them, then modify the knobs and predict the output.
- **Jepsen analyses** — reproduce one locally if you can; even reading the
  methodology helps.
- **Write a small Raft** — after the basics, implement leader election and log
  replication. It is the single best way to internalize consensus.

### How to read a paper

Use the three-pass method (S. Keshav):

1. **First pass (5–10 min):** title, abstract, introduction, section headings,
   conclusions. Decide whether to continue.
2. **Second pass (30–60 min):** figures, diagrams, and the key claims. Summarize
   the paper in your own words.
3. **Third pass (hours):** details, proofs, and reimplementation. Only for papers
   you need deeply.

[How to Read a Paper (PDF)](https://web.stanford.edu/class/ee384m/Handouts/HowtoReadPaper.pdf)

---

## Part VII — Self-check questions

Try to answer before opening the details.

<details>
<summary><strong>1. Why not use sequential IDs for short codes?</strong></summary>

They are collision-free, but they leak how many links exist and let anyone
enumerate the keyspace. They also require a central sequence, which is a
bottleneck and a single point of failure. Random codes avoid enumeration; if you
need ordering, use a time-based ID with a random component and encode it.
</details>

<details>
<summary><strong>2. Why is a 301 a problem for a shortener?</strong></summary>

Browsers and CDNs cache a `301` aggressively. That reduces load, but clicks no
longer reach your origin, edits are not picked up, and deletion is ineffective.
A `302` with `no-store` keeps control at the cost of origin traffic.
</details>

<details>
<summary><strong>3. Why is <code>UPDATE clicks = clicks + 1</code> safer than read-modify-write?</strong></summary>

The database performs the read and write atomically under a row lock. In
application code, two requests can both read the same value and write back the
same increment, losing one. At scale, even the atomic update can become a hot
row; then you batch or stream.
</details>

<details>
<summary><strong>4. What does <code>R + W &gt; N</code> guarantee?</strong></summary>

If a write is acknowledged by `W` of `N` replicas and a read contacts `R`
replicas, then the read set and the write set must overlap by at least one
replica, so the read can see the latest write. It assumes the write is the latest
and that the read can identify it (versions, timestamps, or quorum reads). It
does not give you linearizability by itself, and sloppy quorums can violate the
overlap.
</details>

<details>
<summary><strong>5. Why is global alias uniqueness harder than code uniqueness?</strong></summary>

Generated codes can be retried until an insert succeeds. An alias is a
user-facing name that must have exactly one owner across every shard and region.
Two independent databases can both accept it, which is split brain. You need one
authority: partition by alias, a conditional write in a globally consistent
store, or consensus.
</details>

<details>
<summary><strong>6. What is the difference between a timeout and a failure?</strong></summary>

A timeout is a local decision that you have waited long enough. The remote
operation may still succeed, may have already succeeded, or may fail later. That
ambiguity is why retries need idempotency. A failure is an observed outcome, not
something a timeout can prove.
</details>

<details>
<summary><strong>7. Why does caching make consistency harder?</strong></summary>

A cache is another replica, but with its own TTL and invalidation path. It can
serve a value after the database changed, and a cache-aside race can write a
stale value back after a delete. You need versioning, write-through, short TTLs,
or a change-data-capture invalidation stream.
</details>

<details>
<summary><strong>8. What is a fencing token?</strong></summary>

A monotonically increasing number attached to a lock or leadership term. A node
that was paused (e.g., a long GC) may still believe it holds the lock. The
storage layer rejects writes with an older token, so the paused node cannot
corrupt data after a new leader takes over.
</details>

<details>
<summary><strong>9. Why doesn't sharding fix a hot key?</strong></summary>

Sharding distributes keys, not requests. A single viral code still maps to one
shard (or one cache key). You need local caches, CDN/edge caching, read replicas,
or request coalescing to protect that shard.
</details>

<details>
<summary><strong>10. What breaks when clocks are five minutes apart?</strong></summary>

TTL checks, lease expiry, log timestamps, and “last write wins” conflict
resolution. A link can expire early, a leader can believe its lease is still
valid, or an older write can appear newer. Use NTP, bounded clock uncertainty,
monotonic clocks for durations, and logical version numbers for ordering.
</details>

<details>
<summary><strong>11. Why is “exactly-once” usually “at-least-once + idempotency”?</strong></summary>

Networks duplicate and retry. True exactly-once delivery requires coordination
between the producer, broker, and consumer, and often only holds within one
system's boundary. The practical pattern is at-least-once delivery plus
idempotent processing keyed by a request or event ID, which yields
effectively-once behavior.
</details>

<details>
<summary><strong>12. Why is a per-node rate limiter insufficient?</strong></summary>

Each node enforces its own quota, so `N` nodes allow `N × limit`. A client can
also be routed to a different node each request. Use a shared atomic counter
(Redis `INCR` + expiry, or a Lua sliding window), or enforce at the edge.
</details>

<details>
<summary><strong>13. When would you choose CP over AP for a shortener?</strong></summary>

For alias creation and ownership changes. Accepting two conflicting aliases is
worse than briefly rejecting new aliases during a partition. Redirects can remain
AP and serve stale data, because a slightly stale URL is usually better than a
500.
</details>

<details>
<summary><strong>14. What does a negative cache protect against?</strong></summary>

Repeated requests for codes that do not exist, including malicious scans. Without
it, every miss reaches the database. Cache the absence briefly, and keep the TTL
short so a newly created code is not hidden for long.
</details>

<details>
<summary><strong>15. Why is a cache stampede dangerous?</strong></summary>

When a popular key expires, thousands of requests miss simultaneously and hit the
database at once. The spike can saturate the database and cascade into timeouts
and retries. Fix with singleflight/request coalescing, stale-while-revalidate, or
probabilistic early refresh.
</details>

---

## Glossary

- **AP / CP** — during a partition, choose availability or consistency (CAP).
- **Backpressure** — slowing or rejecting producers when consumers cannot keep up.
- **Bulkhead** — isolating resources so one failing dependency cannot exhaust all.
- **Cache-aside** — the application reads the cache, falls back to the database,
  and populates the cache.
- **Cache stampede** — many simultaneous misses for the same expired key.
- **CAP** — consistency, availability, partition tolerance; pick two during a
  partition.
- **CDC** — change data capture; streaming database changes to other systems.
- **Circuit breaker** — stop calling a failing dependency for a cooldown period.
- **Consensus** — agreement on a value across nodes despite failures.
- **Consistent hashing** — a hash ring that moves few keys when nodes change.
- **CRDT** — conflict-free replicated data type; merges concurrent updates
  deterministically.
- **Eventual consistency** — replicas converge if writes stop.
- **Fencing token** — a monotonically increasing number that invalidates writes
  from an old leader.
- **Hot key / hot shard** — a key or shard receiving disproportionate traffic.
- **Idempotency key** — a client-generated key that makes retries return the
  original result.
- **Leader election** — choosing one node to coordinate writes for a term.
- **Linearizability** — the strongest single-object consistency: reads see the
  latest completed write.
- **Negative cache** — caching the fact that a key does not exist.
- **PACELC** — during a partition choose A or C; else choose latency or
  consistency.
- **Quorum** — a majority (or configured subset) of replicas whose agreement is
  required.
- **Read-your-writes** — a client sees its own completed writes.
- **Replication lag** — how far a replica is behind the primary.
- **Saga** — a sequence of local transactions with compensating actions instead of
  a distributed transaction.
- **Singleflight** — coalescing concurrent identical requests into one.
- **Split brain** — two nodes both believe they are the leader/owner.
- **SLO** — service-level objective, e.g. 99.9% of requests under 50 ms.
- **Thundering herd** — many clients retrying or waking at the same time.
- **Tombstone** — a marker recording a deletion so it can propagate.
- **Two-phase commit (2PC)** — a blocking atomic commit protocol with a
  coordinator.
- **Write amplification** — one logical write causing multiple physical writes.

---

## Where to go next

- Read the [project README](../README.md) for the implementation and API.
- Run the [labs](../labs/README.md) and do the exercises.
- Then pick one direction:
  - **Replication:** implement quorum reads/writes with three replicas.
  - **Partitioning:** build a hash ring and a scatter-gather query.
  - **Consensus:** implement Raft leader election.
  - **Resilience:** add idempotency keys, retries, and a chaos test.

The goal is not to memorize the vocabulary. It is to be able to look at a system
and ask: *what happens when this part is slow, that part is down, and the network
between them is lying?*
