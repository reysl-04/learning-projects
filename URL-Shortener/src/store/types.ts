export interface LinkRecord {
  code: string;
  url: string;
  createdAt: number;
  expiresAt: number | null;
  ownerId: string | null;
  clicks: number;
  lastAccessedAt: number | null;
}

export interface NewLink {
  code: string;
  url: string;
  createdAt: number;
  expiresAt: number | null;
  ownerId: string | null;
}

/**
 * Storage contract. Keeping it narrow makes it possible to swap SQLite for
 * Postgres/DynamoDB later without touching the service layer.
 */
export interface LinkStore {
  /** Returns false when the code already exists (UNIQUE constraint). */
  insert(link: NewLink): boolean;
  find(code: string): LinkRecord | undefined;
  remove(code: string): boolean;
  /** Atomic increment; a read-modify-write here loses clicks under load. */
  incrementClicks(code: string, accessedAt: number): void;
  count(): number;
  deleteExpired(now: number): number;
  close(): void;
}
