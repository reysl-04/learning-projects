# Labs: break the shortener on purpose

These are deterministic simulations of the failure modes described in the main
README. There is no network, no sleeping, and no randomness: a virtual clock and
counter-based faults make every run reproducible.

They import the real `ShortenerService` and the real `LinkStore` contract, so the
service code is not special-cased for teaching. Only the storage layer is
swapped for a simulator.

```bash
npm run lab                    # run every scenario
npm run lab -- stale-read      # run one
npm test                       # includes the replica lab tests
```

## Scenarios

| Command | What it demonstrates | Question to answer |
| --- | --- | --- |
| `stale-read` | A write succeeds, but an immediate read from a replica 404s | What did the client observe vs. what the system stored? |
| `read-your-writes` | Pinning new codes to the primary hides lag — until the pin expires | How long should the pin be? What if the user switches devices? |
| `failover` | Promoting a replica loses writes that had not replicated | Is it better to lose writes or reject them? |
| `split-brain` | Two nodes accept the same “globally unique” alias | What would it take to make this impossible? |
| `ambiguous-write` | The write commits, the response is lost, the retry duplicates it | Design an idempotency scheme that fixes this |
| `cache-outage` | Cache hits survive a DB outage; misses fail | Which SLO are you protecting, and which are you sacrificing? |
| `clock-skew` | A node 5 minutes ahead expires (and deletes) a live link | How would you make expiry robust to skew? |
| `lost-update` | Two read-modify-write increments produce one click | Why does the SQL atomic increment fix it? What still breaks at scale? |

## Exercises

### 1. Make replication synchronous

Change `replicationLagMs` to `0` in `stale-read` (or in
`ReplicatedStoreOptions`). The replica sees the row immediately.

Now reason about the cost: a synchronous write must wait for every replica to
acknowledge. What happens to write latency when a replica is slow? What happens
to availability when a replica is down? This is the latency/consistency trade-off
in one knob.

### 2. Break the read-your-writes fix

In `readYourWrites`, set `readYourWritesMs: 0` and re-run. The immediate resolve
now fails. Then set it longer than the replication lag (e.g. `70_000`) and see it
hold.

The deeper lesson: a per-process pin only helps the client that created the link.
Another client, or another app server, still reads the replica and still sees the
old state.

### 3. Fail over before the replica catches up

In `failover`, promote the replica *before* calling `store.flush()`. Both links
disappear. The data-loss window is exactly the replication lag.

Then decide: would you rather return an error on writes during failover, or
accept the loss? Most systems choose a bounded loss window and make it explicit.

### 4. Implement idempotency

Add `labs/idempotent.ts` and make the ambiguous-write scenario produce **one**
row instead of two. Two viable designs:

- **Deterministic code:** derive the code from a client idempotency key, e.g.
  `base62(sha256(key))` truncated to the code length. A retry computes the same
  code; the `UNIQUE` constraint rejects the duplicate, and you return the
  existing row.
- **Key table:** store `idempotency_key → result` and return the stored result on
  retry. The key must be written atomically with the link, or you have the same
  race in a different place.

Then re-run `ambiguous-write` and assert `primary.count() === 1`.

### 5. Add quorum replication

Extend `ReplicatedLinkStore` to three replicas and require acknowledgements from
two before `insert` returns. On read, query two replicas and pick the newest
value (or require the same value from both).

Questions:

- If `W = 2` and `R = 2` with `N = 3`, why does `R + W > N` guarantee overlap?
- What happens when one replica is down? Can you still write? Read?
- What does “newest” mean when clocks disagree?

This is the step from single-leader replication to Dynamo-style quorums.

### 6. Shard the keyspace (next lab)

Build a hash ring over N stores and route `find`/`insert` by `hash(code)`. Then
try to list all links for a user. The lookup path stays fast; the administrative
query becomes a scatter-gather across every shard. That is the partitioning
trade-off.

## The questions that matter

After each scenario, write one paragraph answering:

1. **What did the client see?** (status code, latency, data)
2. **What did the system actually do?** (which writes committed, which replicas saw them)
3. **Which invariant broke?** (uniqueness, read-your-writes, exactly-once, ...)
4. **What did the fix cost?** (latency, availability, complexity, money)

If you can answer those four for each scenario, you have the basics.

## Mapping to reading

- Replication and lag: DDIA chapter 5.
- Unreliable networks, clocks, and partial failure: DDIA chapter 8.
- Consistency and consensus: DDIA chapter 9.
- Quorums and leaderless replication: the Dynamo paper.

## A warning

These labs are models, not production code. The real versions of these problems
involve disk fsync, TCP retransmits, leader leases, log compaction, and failure
detectors — none of which are simulated here. The goal is to make the trade-offs
tangible before you meet them in a real system.
