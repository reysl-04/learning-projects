import pool from "../db/pool.js";

export async function storeHashedRt(userId: number, hashedRt: string): Promise<void> {
    await pool.query(
        "UPDATE users SET hashed_rt = $1, updated_at = NOW() WHERE id = $2",
        [hashedRt, userId]
    );
}

export async function clearHashedRt(userId: number): Promise<void> {
    await pool.query(
        "UPDATE users SET hashed_rt = '', updated_at = NOW() WHERE id = $1",
        [userId]
    );
}
