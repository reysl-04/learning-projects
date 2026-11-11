import type { LinkRecord, LinkStore, NewLink } from "./types.ts";

/** In-memory store used by tests and by `DB_PATH=:memory:` demos. */
export class MemoryLinkStore implements LinkStore {
  private readonly links = new Map<string, LinkRecord>();

  insert(link: NewLink): boolean {
    if (this.links.has(link.code)) return false;
    this.links.set(link.code, { ...link, clicks: 0, lastAccessedAt: null });
    return true;
  }

  find(code: string): LinkRecord | undefined {
    const record = this.links.get(code);
    return record === undefined ? undefined : { ...record };
  }

  remove(code: string): boolean {
    return this.links.delete(code);
  }

  incrementClicks(code: string, accessedAt: number): void {
    const record = this.links.get(code);
    if (record === undefined) return;
    record.clicks += 1;
    record.lastAccessedAt = accessedAt;
  }

  count(): number {
    return this.links.size;
  }

  deleteExpired(now: number): number {
    let removed = 0;
    for (const [code, record] of this.links) {
      if (record.expiresAt !== null && record.expiresAt <= now) {
        this.links.delete(code);
        removed += 1;
      }
    }
    return removed;
  }

  close(): void {
    this.links.clear();
  }
}
