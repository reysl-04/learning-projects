import type { LinkRecord, LinkStore, NewLink } from "../src/store/types.ts";

export interface FaultConfig {
  /** Every operation fails, as if the database were unreachable. */
  down: boolean;
  /** Fail every Nth read; 0 disables. */
  failReadEvery: number;
  /** Fail every Nth write before it commits; 0 disables. */
  failWriteEvery: number;
  /** Commit every Nth write, then throw as if the response were lost. */
  ambiguousWriteEvery: number;
}

/**
 * Wraps a store and injects failures. Deterministic (counter-based, not
 * random) so lab output is reproducible.
 *
 * The important fault is `ambiguousWriteEvery`: the write *succeeds* and then
 * the caller sees an error. That is how duplicate links are born when a client
 * retries a request it believes failed.
 */
export class FaultyStore implements LinkStore {
  private readonly inner: LinkStore;
  private config: FaultConfig;
  private reads = 0;
  private writes = 0;

  constructor(inner: LinkStore, config: Partial<FaultConfig> = {}) {
    this.inner = inner;
    this.config = {
      down: false,
      failReadEvery: 0,
      failWriteEvery: 0,
      ambiguousWriteEvery: 0,
      ...config,
    };
  }

  setConfig(patch: Partial<FaultConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  stats(): { reads: number; writes: number } {
    return { reads: this.reads, writes: this.writes };
  }

  insert(link: NewLink): boolean {
    this.beforeWrite();
    const inserted = this.inner.insert(link);
    if (this.isAmbiguous()) throw new Error("simulated timeout after commit");
    return inserted;
  }

  find(code: string): LinkRecord | undefined {
    this.beforeRead();
    return this.inner.find(code);
  }

  remove(code: string): boolean {
    this.beforeWrite();
    const removed = this.inner.remove(code);
    if (this.isAmbiguous()) throw new Error("simulated timeout after commit");
    return removed;
  }

  incrementClicks(code: string, accessedAt: number): void {
    this.beforeWrite();
    this.inner.incrementClicks(code, accessedAt);
    if (this.isAmbiguous()) throw new Error("simulated timeout after commit");
  }

  count(): number {
    this.beforeRead();
    return this.inner.count();
  }

  deleteExpired(now: number): number {
    this.beforeWrite();
    const removed = this.inner.deleteExpired(now);
    if (this.isAmbiguous()) throw new Error("simulated timeout after commit");
    return removed;
  }

  close(): void {
    this.inner.close();
  }

  private beforeRead(): void {
    this.reads += 1;
    if (this.config.down) throw new Error("store unavailable (simulated outage)");
    if (this.config.failReadEvery > 0 && this.reads % this.config.failReadEvery === 0) {
      throw new Error("simulated read failure");
    }
  }

  private beforeWrite(): void {
    this.writes += 1;
    if (this.config.down) throw new Error("store unavailable (simulated outage)");
    if (this.config.failWriteEvery > 0 && this.writes % this.config.failWriteEvery === 0) {
      throw new Error("simulated write failure before commit");
    }
  }

  private isAmbiguous(): boolean {
    return (
      this.config.ambiguousWriteEvery > 0 &&
      this.writes % this.config.ambiguousWriteEvery === 0
    );
  }
}
