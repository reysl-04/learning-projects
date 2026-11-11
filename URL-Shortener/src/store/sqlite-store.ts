import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LinkRecord, LinkStore, NewLink } from "./types.ts";

interface LinkRow {
  code: string;
  url: string;
  createdAt: number;
  expiresAt: number | null;
  ownerId: string | null;
  clicks: number;
  lastAccessedAt: number | null;
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const withCode = error as Error & { errcode?: number };
  if (withCode.errcode === 1555 || withCode.errcode === 2067) return true;
  return /UNIQUE constraint failed/i.test(error.message);
}

export class SqliteLinkStore implements LinkStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS links (
        code             TEXT PRIMARY KEY,
        url              TEXT NOT NULL,
        created_at       INTEGER NOT NULL,
        expires_at       INTEGER,
        owner_id         TEXT,
        clicks           INTEGER NOT NULL DEFAULT 0,
        last_accessed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_links_expires_at
        ON links (expires_at)
        WHERE expires_at IS NOT NULL;
    `);
  }

  insert(link: NewLink): boolean {
    try {
      this.db
        .prepare(
          `INSERT INTO links (code, url, created_at, expires_at, owner_id)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(link.code, link.url, link.createdAt, link.expiresAt, link.ownerId);
      return true;
    } catch (error) {
      // A collision is expected occasionally; the caller retries with a new code.
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  find(code: string): LinkRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT code, url, created_at AS createdAt, expires_at AS expiresAt,
                owner_id AS ownerId, clicks, last_accessed_at AS lastAccessedAt
         FROM links
         WHERE code = ?`,
      )
      .get(code) as unknown as LinkRow | undefined;

    return row;
  }

  remove(code: string): boolean {
    const result = this.db.prepare("DELETE FROM links WHERE code = ?").run(code);
    return Number(result.changes) > 0;
  }

  incrementClicks(code: string, accessedAt: number): void {
    this.db
      .prepare(
        `UPDATE links
         SET clicks = clicks + 1, last_accessed_at = ?
         WHERE code = ?`,
      )
      .run(accessedAt, code);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS total FROM links").get() as unknown as
      | { total: number }
      | undefined;
    return row?.total ?? 0;
  }

  deleteExpired(now: number): number {
    const result = this.db
      .prepare("DELETE FROM links WHERE expires_at IS NOT NULL AND expires_at <= ?")
      .run(now);
    return Number(result.changes);
  }

  close(): void {
    this.db.close();
  }
}
