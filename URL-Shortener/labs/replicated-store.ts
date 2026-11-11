import type { LinkRecord, LinkStore, NewLink } from "../src/store/types.ts";

type ReplicationOp =
  | { applyAt: number; kind: "insert"; link: NewLink }
  | { applyAt: number; kind: "remove"; code: string }
  | { applyAt: number; kind: "increment"; code: string; at: number };

export interface ReplicatedStoreOptions {
  primary: LinkStore;
  replicas: LinkStore[];
  /** How long a write takes to become visible on every replica. */
  replicationLagMs: number;
  now: () => number;
  /**
   * Route reads for a newly created code back to the primary for this long.
   * This is the "read-your-writes" fix. 0 disables it.
   */
  readYourWritesMs?: number;
}

/**
 * Single-leader, asynchronous replication over in-memory stores.
 *
 * Writes go to the primary and are queued for each replica. A write becomes
 * visible on a replica only after `replicationLagMs` has passed *and* the
 * pending queue is drained. Reads are served by replicas in round-robin order,
 * so they can be stale — which is the whole point of the lab.
 *
 * This is a teaching model, not a production replication protocol. It has no
 * log persistence, no acknowledgements, no quorums, and no leader election.
 */
export class ReplicatedLinkStore implements LinkStore {
  private readonly primary: LinkStore;
  private readonly replicas: LinkStore[];
  private readonly lagMs: number;
  private readonly now: () => number;
  private readonly readYourWritesMs: number;
  private pending: ReplicationOp[] = [];
  private readonly pins = new Map<string, number>();
  private nextReplica = 0;

  constructor(options: ReplicatedStoreOptions) {
    if (options.replicationLagMs < 0) {
      throw new RangeError("replicationLagMs must be non-negative");
    }

    this.primary = options.primary;
    this.replicas = options.replicas;
    this.lagMs = options.replicationLagMs;
    this.now = options.now;
    this.readYourWritesMs = options.readYourWritesMs ?? 0;
  }

  insert(link: NewLink): boolean {
    const inserted = this.primary.insert(link);
    if (!inserted) return false;

    this.enqueue({ applyAt: this.now() + this.lagMs, kind: "insert", link });
    if (this.readYourWritesMs > 0) {
      this.pins.set(link.code, this.now() + this.readYourWritesMs);
    }
    return true;
  }

  find(code: string): LinkRecord | undefined {
    this.applyDue();

    const pinUntil = this.pins.get(code);
    if (pinUntil !== undefined) {
      if (pinUntil > this.now()) return this.primary.find(code);
      this.pins.delete(code);
    }

    return this.pickReplica().find(code);
  }

  remove(code: string): boolean {
    const removed = this.primary.remove(code);
    if (!removed) return false;

    this.pins.delete(code);
    this.enqueue({ applyAt: this.now() + this.lagMs, kind: "remove", code });
    return true;
  }

  incrementClicks(code: string, accessedAt: number): void {
    this.primary.incrementClicks(code, accessedAt);
    this.enqueue({
      applyAt: this.now() + this.lagMs,
      kind: "increment",
      code,
      at: accessedAt,
    });
  }

  count(): number {
    return this.primary.count();
  }

  deleteExpired(now: number): number {
    this.applyDue();
    const removed = this.primary.deleteExpired(now);
    for (const replica of this.replicas) replica.deleteExpired(now);
    return removed;
  }

  close(): void {
    this.primary.close();
    for (const replica of this.replicas) replica.close();
  }

  /** Apply every replication operation whose delay has elapsed. */
  flush(): void {
    this.applyDue();
  }

  pendingCount(): number {
    return this.pending.length;
  }

  replicaAt(index: number): LinkStore | undefined {
    return this.replicas[index];
  }

  private pickReplica(): LinkStore {
    if (this.replicas.length === 0) return this.primary;
    const replica = this.replicas[this.nextReplica % this.replicas.length] as LinkStore;
    this.nextReplica += 1;
    return replica;
  }

  private enqueue(op: ReplicationOp): void {
    if (this.lagMs === 0) {
      for (const replica of this.replicas) this.applyOp(replica, op);
      return;
    }
    this.pending.push(op);
  }

  private applyDue(): void {
    if (this.pending.length === 0) return;

    const now = this.now();
    const remaining: ReplicationOp[] = [];

    for (const op of this.pending) {
      if (op.applyAt <= now) {
        for (const replica of this.replicas) this.applyOp(replica, op);
      } else {
        remaining.push(op);
      }
    }

    this.pending = remaining;
  }

  private applyOp(replica: LinkStore, op: ReplicationOp): void {
    switch (op.kind) {
      case "insert":
        replica.insert(op.link);
        break;
      case "remove":
        replica.remove(op.code);
        break;
      case "increment":
        replica.incrementClicks(op.code, op.at);
        break;
    }
  }
}
