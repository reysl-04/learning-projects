import pool from "../db/pool.js";
import User from "../types/user.types.js"


export async function findAllUsers(): Promise<User[]> {
  const result = await pool.query(
    "SELECT id, email, password_hash, hashed_rt, created_at, updated_at FROM users ORDER BY id"
  );
  return result.rows;
}

export async function findUserById(id: number): Promise<User | null> {
  const result = await pool.query(
    "SELECT id, email, password_hash, hashed_rt, created_at, updated_at FROM users WHERE id = $1",
    [id]
  );
  return result.rows[0] || null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const result = await pool.query(
    "SELECT id, email, password_hash, hashed_rt, created_at, updated_at FROM users WHERE email = $1",
    [email]
  );
  return result.rows[0] || null;
}

export async function createUser(data: {
  email: string;
  password_hash: string;
  hashed_rt: string;
}): Promise<User> {
  const result = await pool.query(
    "INSERT INTO users (email, password_hash, hashed_rt) VALUES ($1, $2, $3) RETURNING id, email, password_hash, hashed_rt, created_at, updated_at",
    [data.email, data.password_hash, data.hashed_rt]
  );
  return result.rows[0];
}

export async function updateUser(
  id: number,
  data: Partial<{
    email: string;
    password_hash: string;
    hashed_rt: string;
  }>
): Promise<User | null> {
  const updates: string[] = [];
  const values: unknown[] = [id];
  let paramCount = 2;

  if (data.email !== undefined) {
    updates.push(`email = $${paramCount}`);
    values.push(data.email);
    paramCount++;
  }

  if (data.password_hash !== undefined) {
    updates.push(`password_hash = $${paramCount}`);
    values.push(data.password_hash);
    paramCount++;
  }

  if (data.hashed_rt !== undefined) {
    updates.push(`hashed_rt = $${paramCount}`);
    values.push(data.hashed_rt);
    paramCount++;
  }

  if (updates.length === 0) {
    return findUserById(id);
  }

  const query = `UPDATE users SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING id, email, password_hash, hashed_rt, created_at, updated_at`;

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

export async function deleteUser(id: number): Promise<number | null> {
  const result = await pool.query("DELETE FROM users WHERE id = $1 RETURNING id", [id]);
  return result.rows[0]?.id || null;
}
