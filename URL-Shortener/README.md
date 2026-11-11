# URL Shortener

A small but complete URL shortener: create a short link, redirect on visit, count
clicks, expire links, and protect the write path with a rate limiter.

It is deliberately built with **zero runtime dependencies** — Node's built-in
HTTP server, built-in SQLite, and native TypeScript execution — so the whole
system fits in your head. The interesting part is not the code, though. It is
what happens when you try to run this on more than one machine. That is covered
in [Distributed systems problems](#distributed-systems-problems), and in depth in
the study guide: **[Distributed Systems & the URL Shortener](./docs/README.md)**.

```
POST /api/links  ──▶ validate ──▶ generate code ──▶ INSERT (unique) ──▶ 201
GET  /:code      ──▶ LRU cache ──hit──────────────────────────────────▶ 302
                        └──miss──▶ SQLite ──▶ fill cache ──▶ 302
```

## Quick start

Requires **Node 22.18+** (for native `.ts` execution and `node:sqlite`). No
`npm install` is needed to run or test.

```bash
cd URL-Shortener
node src/server.ts
# open http://localhost:3000
```

```bash
npm test          # 30 tests, node:test
npm run lab       # deterministic distributed-systems failure scenarios
npm run dev       # restart on source changes
npm run typecheck # optional; needs `npm install` for TypeScript + @types/node
```

### Hands-on labs

`labs/` is a deterministic failure simulator built on the same service and store
interfaces: virtual time, counter-based faults, and a primary/replica store with
configurable lag. Run everything, or one scenario at a time:

```bash
npm run lab
npm run lab -- stale-read
npm run lab -- split-brain
```

It reproduces stale reads, read-your-writes violations, failover data loss,
split brain, ambiguous writes, cache-through-outage behavior, clock skew, and
lost updates. The exercises and questions are in [`labs/README.md`](./labs/README.md).

Configuration is environment-driven; see [`.env.example`](./.env.example).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Listen address |
| `BASE_URL` | `http://localhost:$PORT` | Public origin used in `shortUrl` |
| `DB_PATH` | `./data/links.db` | SQLite file, or `:memory:` |
| `CODE_LENGTH` | `7` | Generated base62 code length |
| `CACHE_SIZE` | `10000` | In-process LRU entries |
| `CACHE_TTL_MS` | `60000` | Positive cache TTL |
| `NEGATIVE_CACHE_TTL_MS` | `5000` | TTL for “code does not exist” |
| `RATE_LIMIT_PER_MINUTE` | `30` | Link creations per client IP (`0` disables) |
| `DEFAULT_TTL_SECONDS` | `0` | Default link lifetime; `0` = never |
| `CLEANUP_INTERVAL_MS` | `300000` | Expired-row sweep interval |

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/links` | Create a link. Body: `{ url, alias?, ttlSeconds? }` |
| `GET` | `/:code` | `302` redirect and click count |
| `GET` | `/api/links/:code` | Link metadata and click count |
| `DELETE` | `/api/links/:code` | Delete a link and invalidate its cache entry |
| `GET` | `/health` | Liveness, link count, cache hit/miss stats |

```bash
# Create
curl -s -X POST localhost:3000/api/links \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/a/long/path","alias":"launch","ttlSeconds":86400}'
# {"code":"launch","shortUrl":"http://localhost:3000/launch",...}

# Visit (302)
curl -i localhost:3000/launch

# Stats
curl -s localhost:3000/api/links/launch

# Delete
curl -i -X DELETE localhost:3000/api/links/launch
```

Errors are JSON: `{"error":{"code":"alias_taken","message":"..."}}`. Status codes
are `400` invalid input, `404` unknown link, `409` alias conflict, `413` body too
large, `415` wrong content type, `429` rate limited, `503` code allocation failure.

## How it works

- **Code generation.** Seven random base62 characters (`62^7 ≈ 3.52 × 10^12`).
  The code is the primary key, so the database's `UNIQUE` constraint is the
  arbiter. A collision is retried up to 5 times. Random (not sequential) codes
  prevent enumeration of every link in the system.
- **Read path.** Cache-aside through an LRU + TTL cache. Hits never touch
  SQLite for the URL lookup. Misses are cached too (“negative caching”), so a
  flood of requests for a nonexistent code cannot reach the database.
- **Storage.** SQLite in WAL mode, one row per link. Click counting uses
  `UPDATE links SET clicks = clicks + 1`, an atomic read-modify-write inside the
  database rather than in application code.
- **Expiry.** Absolute epoch-ms timestamp per link. Reads treat expired rows as
  missing and delete them lazily; a background sweep removes the rest.
- **Redirects.** `302` with `Cache-Control: private, no-store`. A `301` would be
  cached by browsers and CDNs, which would break click analytics and make
  deletion ineffective.
- **Analytics.** Click writes are best-effort: a failed write never breaks a
  redirect. That trade-off is intentional and is the first thing to redesign at
  scale (see below).
- **Rate limiting.** Fixed-window counter per client IP on `POST /api/links`
  only. The redirect path stays unthrottled by the application.
- **Security basics.** Only `http`/`https` destinations, 2 KB URL limit, 16 KB
  JSON body limit, reserved aliases, no self-referential links, `nosniff`,
  `no-referrer`, and a strict CSP on the UI.

### Layout

```
src/
  server.ts              HTTP adapter, graceful shutdown, cleanup timer
  app.ts                 routes, middleware-ish handlers, serialization
  config.ts              env parsing with validation
  services/shortener.ts  business logic: create, resolve, stats, delete
  store/                 LinkStore contract + SQLite and in-memory implementations
  http/                  tiny router and request/response helpers
  lib/                   base62, code generation, URL validation, LRU, limiter
public/                  index.html, styles.css, app.js (no build step)
labs/                    virtual clock, fault injection, replica simulator, scenarios
tests/                   node:test suites for lib, service, HTTP, and lab layers
```

### Design decisions worth calling out

| Decision | Why |
| --- | --- |
| Random code, not `base62(id)` | Sequential codes leak volume and let anyone enumerate links. |
| Database `UNIQUE` constraint | A collision check in application code is a race between two writers. |
| 302 + `no-store` | Keeps analytics accurate and links deletable; costs origin traffic. |
| Cache-aside, not write-through | Links are read far more than written; writes stay simple. |
| Atomic SQL increment | `read → +1 → write` loses clicks under concurrency. |
| Best-effort click writes | Availability of the redirect beats completeness of analytics. |
| Reclaim expired aliases | Otherwise an alias is unavailable until the sweeper runs. |
| Reserved words (`api`, `health`, …) | A link code must never shadow a real route. |

## Distributed systems problems

Everything above works nicely on one box. Now imagine 10,000 redirects/second,
100 million links, and a dozen servers behind a load balancer. The shortener is
no longer a CRUD app; it becomes a study in **uniqueness, caching, and partial
failure**. These are the problems you hit, roughly in the order you hit them.

> **Want the full picture?** The
> [study guide](./docs/README.md) covers the underlying concepts (replication,
> consistency, consensus, partitioning, idempotency), expands each problem below,
> and ends with a four-week reading path, curated resources, and self-check
> questions. The [labs](./labs/README.md) let you reproduce each failure.

### 1. Unique code allocation and collisions

The core invariant is “one code maps to exactly one URL.” With one process and
one database, `INSERT` plus a `UNIQUE` constraint is enough. With many writers:

- **Random codes collide.** At `62^7` codes the birthday bound gives roughly
  `n² / (2 · 62^7)` colliding pairs. At 1 billion links that is ~140,000 total
  collisions. Any individual insert is still unlikely to collide (~0.03%), so
  retry-on-conflict works, but you must handle it — and you need a bounded retry
  policy so a full or adversarial keyspace does not spin forever.
- **Sequential IDs are worse in a different way.** They are collision-free, but
  they leak how many links exist and let anyone walk the keyspace. They also
  require a central sequence, which is a single point of failure and a write
  bottleneck.
- **Distributed ID schemes.** Snowflake-style IDs (timestamp + machine ID +
  sequence) or per-node ID ranges leased from a coordinator avoid coordination
  per insert, but add clock-skew and lease-renewal failure modes. Twitter's
  Snowflake, ULID, and “allocate a block of 10,000 IDs per node” are all versions
  of this trade-off.
- **Custom aliases are the hard part.** Generated codes can be retried, but a
  user-chosen alias must be globally unique. If alias `launch` can be inserted
  into shard A and shard B independently, both writes succeed and you have a
  split brain. Options: route every alias through a single shard/partition by
  hash of the alias, keep a globally consistent reservation table (Spanner,
  etcd, DynamoDB conditional write), or accept a narrow window and reconcile.
  There is no free lunch; this is a genuine consensus problem.

**In this code:** the `UNIQUE` primary key is the arbiter, collisions retry five
times, and custom aliases return `409`. On one SQLite file this is correct. On
two servers with two databases it is not — see the exercise at the end.

### 2. Read/write asymmetry, caching, and cache coherence

Shorteners are extremely read-heavy, often 100:1 or more. The database becomes
the bottleneck long before the CPU does, so you put a cache in front of it.
That introduces a new class of bugs:

- **Cache stampede / thundering herd.** A popular code expires from cache, 5,000
  requests miss simultaneously, and all 5,000 hit the database. Mitigations:
  request coalescing (singleflight), probabilistic early refresh, serving stale
  data while one worker refreshes, or a per-key lock.
- **Negative caching.** Without it, requests for deleted or nonexistent codes
  are pure database load — and an attacker can generate them cheaply. Cache the
  absence, briefly.
- **Hot keys.** One celebrity link can receive millions of requests while the
  rest of the keyspace is cold. A sharded cache still puts that key on one
  shard. Local (per-process) L1 caches, CDN/edge caching, and read replicas are
  the usual answers. This is also why a shortener is a natural CDN workload.
- **Invalidation races.** Cache-aside has a classic race: reader misses, reads
  the old row; writer updates the row and deletes the cache; reader then writes
  the stale row back into the cache. The cache is now wrong until TTL. Fixes:
  versioned values, write-through, delete-after-delay (“double delete”), or
  invalidation via a change-data-capture stream.
- **Per-node caches are not coherent.** With 12 app servers, each has its own
  LRU. A delete on server 1 does not invalidate the copy on server 7. You need a
  shared cache (Redis/Memcached) or a pub/sub invalidation channel, and even
  then you must reason about missed messages.

**In this code:** the LRU is per process. It demonstrates the read path, not a
production cache tier. A `DELETE` invalidates only the local entry.

### 3. Sharding and hot shards

One database eventually cannot hold 100 million rows or absorb the write rate.
You shard, usually by `hash(code)`:

- **Hash sharding** spreads keys evenly and makes redirects a single-shard
  lookup. Range sharding by code makes range scans easy but concentrates new
  writes on the “last” shard.
- **Cross-shard queries become painful.** “List all links created by user X” no
  longer works if links are partitioned by code. You need a secondary index
  store, a separate user→link table, or a search system. This is the classic
  tension between the hot path (lookup by code) and administrative queries.
- **Hot shards are unavoidable** with skewed popularity. A single viral link
  does not spread across shards just because the hash is uniform. Read replicas,
  local caching, and edge caching are how you protect the shard.
- **Resharding** is its own project: consistent hashing or a lookup service
  reduces data movement, but you still need dual writes, backfills, and a
  cutover plan. Rebalancing while serving traffic is where outages happen.

**In this code:** there is one SQLite file. WAL lets readers proceed during
writes, but there is still a single writer, and `node:sqlite` is synchronous —
it blocks the event loop. That is fine for a demo and a hard ceiling in
production.

### 4. CAP, consistency, and the redirect path

The two paths want different guarantees:

- **Redirects should be AP.** If a region is partitioned from the primary
  database, it is better to serve a slightly stale URL from cache than to return
  a 500. Availability and latency win; a link that moved five seconds ago can
  still resolve to the old destination briefly.
- **Creation and alias uniqueness lean CP.** Two conflicting aliases must not
  both be accepted. Under a partition you may have to reject new aliases (or
  lease them from a quorum) while continuing to serve redirects. That is
  graceful degradation: degrade the write path, keep the read path alive.
- **Read-after-write.** A user creates a link and immediately opens it. If the
  write went to the primary and the read goes to a lagging replica (or another
  region), they get a 404. Fixes: route the creator's reads to the primary for a
  short window, pin the new link in cache, or return a consistency token.
- **Replication lag** also affects deletion and expiry: a link can remain
  resolvable in a replica after it was removed. TTLs and tombstones help;
  “immediately gone everywhere” is a strong consistency requirement and costs
  availability.
- **301 vs 302 is a consistency decision.** A `301` is cached indefinitely by
  browsers and CDNs. It reduces load but makes analytics, edits, and deletion
  approximate at best. A `302` with `no-store` keeps control but sends every
  click to your origin.

**In this code:** redirects read through cache; a cache hit can survive a
database outage because click-write failures are swallowed. Cache misses during
that outage return errors. That is a small, honest AP/CP split.

### 5. Counting clicks without losing them

`clicks = clicks + 1` looks harmless until two requests read the same value and
both write back the same increment. The database's atomic `UPDATE ... SET
clicks = clicks + 1` fixes the lost update on one row, but at scale the write
itself is the problem:

- **Write amplification.** One database write per redirect doubles or triples
  the write load of the entire service just for analytics. At 10k QPS that is
  10k writes/second dedicated to a counter.
- **Hot row contention.** A viral link serializes every increment on one row.
  Row-level locks and replication become the bottleneck.
- **Batching and streams.** Buffer counts in memory and flush every N seconds,
  or emit a click event to Kafka/Kinesis and aggregate downstream. You trade
  freshness and exactness for throughput.
- **Exactly-once is a myth in practice.** Retries and at-least-once delivery
  duplicate events. Use idempotency keys, deduplicate by request ID, or accept
  approximate counts. For unique visitors, HyperLogLog gives cardinality
  estimates in fixed memory.
- **Per-region counters.** Active-active regions can keep local counters and
  merge them (a grow-only counter is a CRDT). The merge is trivial for counts;
  “unique visitors across regions” is not.

**In this code:** every redirect performs one synchronous `UPDATE`. It is
correct on a single node and is exactly what you would move to an async pipeline
first.

### 6. Rate limiting and abuse across nodes

A per-process limiter enforces `limit × number_of_nodes`, because each node has
its own counter. Ten nodes at 30/minute allow 300/minute. Worse, the client can
be routed to a different node on every request.

- **Shared counters.** Put the counter in Redis and use an atomic
  `INCR` + `EXPIRE` (or a Lua script for a sliding window / token bucket). A
  naïve `GET` then `SET` has a race that lets bursts through.
- **Who is the client?** IP is a blunt instrument: NAT puts thousands of users
  behind one address, and `X-Forwarded-For` is spoofable unless a trusted proxy
  overwrites it. Prefer API keys or accounts for authenticated creation; use IP
  only as a coarse edge defense.
- **Distributed denial of service.** Application-level limiting cannot absorb a
  volumetric attack. That belongs at the edge/CDN/WAF, with per-ASN and per-IP
  rules and load shedding.
- **Abuse is the real product risk.** A shortener is an open redirect: attackers
  use it for phishing, malware, and spam. Production systems add blocklists,
  domain reputation, interstitial warning pages, malware scanning, per-account
  quotas, and abuse reporting. Random codes help privacy but not abuse.
- **Enumeration.** Short random codes make walking the keyspace impractical.
  Sequential codes make it trivial, which is another reason not to use them.

**In this code:** fixed-window, in-memory, per-IP, and it trusts
`X-Forwarded-For`. That is explicitly a single-node placeholder.

### 7. Expiry, clocks, and scheduling

TTL sounds simple until clocks disagree:

- **Absolute timestamps** (epoch ms) are what you store. If node A's clock is
  30 seconds ahead, it expires links early; if behind, late. NTP keeps skew
  small but not zero, and leap seconds / VM pauses happen. Use wall-clock time
  for business expiry and monotonic clocks for measuring durations.
- **Lazy vs active expiration.** Checking expiry on read is cheap and always
  correct-ish; a background sweep reclaims space. Every node sweeping the same
  table duplicates work and creates lock contention. Run one sweeper (leader
  election or a singleton cron), or partition the sweep by shard.
- **Expiry is not deletion everywhere.** With replicas and caches, an expired
  link can still be served from a stale cache or a lagging replica. Cache TTLs
  must be shorter than the business TTL, or the cache must store the expiry and
  enforce it.
- **Alias reuse.** If an expired alias is immediately reusable, old links in the
  wild can suddenly point somewhere new. Decide whether that is acceptable;
  many systems add a quarantine period or never reuse aliases.

**In this code:** lazy expiry plus a periodic sweep, both using the process
clock. There is no coordination because there is one process.

### 8. Partial failure, retries, and idempotency

In a distributed system, “the request failed” is ambiguous: it may have
succeeded. A client retrying `POST /api/links` after a timeout can create two
links (and two codes) for one intent.

- **Idempotency keys.** Let the client send a key; the server stores
  `key → result` and returns the same result on retry. This is standard for
  payment APIs and applies equally here.
- **Timeouts and retries.** Retries without jitter and budgets create retry
  storms that finish off a struggling dependency. Use exponential backoff with
  jitter, capped attempts, and a circuit breaker.
- **Bulkheads and backpressure.** Isolate pools (redirect reads vs analytics
  writes) so a slow analytics store cannot starve redirects. Shed load
  explicitly when saturated instead of queueing until everything times out.
- **Graceful degradation.** Serve stale cache, drop analytics, disable custom
  aliases, and keep redirects working. A shortener's core promise is “the link
  resolves”; protect that above all.
- **Health checks and draining.** A node that is shutting down must stop
  accepting new connections and finish in-flight requests. This project handles
  `SIGTERM` that way; a load balancer also needs readiness signals.

### 9. Multi-region and geo-distribution

Users expect a redirect in tens of milliseconds, which usually means serving
from a nearby region.

- **Active-passive** is simpler: one write region, read replicas elsewhere,
  failover on disaster. Writes pay cross-region latency; failover has data loss
  windows.
- **Active-active** gives low latency everywhere but reintroduces global
  uniqueness (aliases), conflict resolution, and counter merging. Links are
  mostly immutable, which helps: create once, replicate, never update except
  delete/expiry.
- **GeoDNS / anycast** routes users to the nearest healthy region. Health
  checks and failover must not create routing loops or split brain.
- **Data residency** may forbid moving URLs across regions, forcing per-region
  partitions and complicating global stats.
- **Consistency at the edge.** CDNs can cache redirects, but then invalidation
  and analytics become approximate. Many shorteners accept a short edge TTL as a
  deliberate trade-off.

### 10. Operations: you cannot fix what you cannot see

At scale the failures are usually operational, not algorithmic:

- **Observability.** Track redirect latency (p50/p95/p99), cache hit ratio, DB
  saturation, 4xx/5xx by route, collision retries, rate-limit rejections, and
  queue depth. Distributed tracing is essential once a redirect touches cache,
  database, and analytics.
- **SLOs and load shedding.** Define “99.9% of redirects under 50 ms” and shed
  or degrade when you cannot meet it, rather than collapsing.
- **Schema migrations.** Adding an index or column to 100M rows is an online
  operation. Use expand/contract migrations, backfills, and dual reads/writes.
- **Backups and restore drills.** A replicated database is not a backup.
  Corrupted writes replicate too.
- **Capacity and cost.** Cache and egress dominate cost; a `302` to origin costs
  more than a CDN-cached `301`, which is why the 301/302 choice is also a
  business decision.

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

## What this implementation deliberately does not do

- No authentication, accounts, or ownership. Anyone can delete any link.
- No abuse pipeline (phishing/malware blocklists, reputation, reporting).
- No shared cache or shared rate limiter; both are per process.
- No sharding, replication, or multi-region support.
- No idempotency keys, so a retried `POST` can create a second link.
- No custom domains, QR codes, or bulk import.
- No async analytics; clicks are written synchronously.
- SQLite is synchronous and single-writer; it is a demo store, not a scale
  store.

## Try the failure modes yourself

The [`labs/`](./labs/README.md) scenarios automate several of these. The
commands below are the manual versions.

1. **Force collisions.** Run with `CODE_LENGTH=4` (`62^4 ≈ 14.7M`) and create
   links in a loop. Collisions become common; the retry loop keeps correctness.
2. **See the rate limiter.** Set `RATE_LIMIT_PER_MINUTE=2` and create three
   links; the third returns `429` with `Retry-After`.
3. **Break global uniqueness.** Start two instances with different databases:

   ```bash
   PORT=3001 DB_PATH=./data/a.db node src/server.ts
   PORT=3002 DB_PATH=./data/b.db node src/server.ts
   curl -X POST localhost:3001/api/links -d '{"url":"https://a.example","alias":"same"}' -H 'content-type: application/json'
   curl -X POST localhost:3002/api/links -d '{"url":"https://b.example","alias":"same"}' -H 'content-type: application/json'
   ```

   Both return `201`. Two nodes accepted the same globally unique alias because
   each database only knows its own rows. That is the split-brain problem from
   section 1, reproduced in two commands.
4. **Watch the cache carry the read path.** Create a link, visit it once (cache
   it), then stop the database or make it read-only. Repeated visits still
   redirect from cache until the TTL expires; a cache miss fails. Availability
   is a spectrum, not a boolean.
5. **Expire a link.** Create with `ttlSeconds: 1`, wait, and visit; it is `404`
   and the row is removed lazily.

## Further reading

- Kleppmann, *Designing Data-Intensive Applications* — caching, replication,
  partitioning, consensus, and exactly-once processing.
- The original [Snowflake](https://blog.x.com/engineering/en_us/a/2010/announcing-snowflake)
  post on distributed unique IDs.
- System design write-ups of Bitly/TinyURL for the read-heavy, cache-first
  shape of this problem.
- Redis docs on `INCR`, Lua scripting, and distributed rate limiting.
