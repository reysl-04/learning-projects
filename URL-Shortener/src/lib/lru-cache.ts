interface Entry<V> {
  value: V;
  expiresAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

/**
 * Small in-process LRU + TTL cache. It plays the role Redis would play in a
 * multi-node deployment: absorb the ~100:1 read/write ratio so redirects do
 * not hit the database every time.
 *
 * Values may be `null`, which is how negative caching ("this code does not
 * exist") is represented.
 */
export class LruCache<V> {
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly map = new Map<string, Entry<V>>();
  private hits = 0;
  private misses = 0;

  constructor(capacity: number, now: () => number = Date.now) {
    this.capacity = capacity;
    this.now = now;
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      this.misses += 1;
      return undefined;
    }

    // Re-insert to mark the entry as most recently used.
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    if (this.capacity === 0) return;

    this.map.delete(key);
    if (ttlMs <= 0) return;
    this.map.set(key, { value, expiresAt: this.now() + ttlMs });

    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  stats(): CacheStats {
    return { hits: this.hits, misses: this.misses, size: this.map.size };
  }
}
