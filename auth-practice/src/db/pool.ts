import pg from "pg";

import "dotenv/config.js"

const connectionString = process.env.DATABASE_URL;

const pool = new pg.Pool({
    connectionString: connectionString,
    ssl: process.env.NODE_ENV === "Production" ? {rejectUnauthorized: false}: false
})

export default pool