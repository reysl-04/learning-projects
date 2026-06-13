import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

export const pool = new Pool({
  connectionString,
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5433),
  user: process.env.DB_USER ?? "user",
  password: process.env.DB_PASSWORD ?? "password",
  database: process.env.DB_NAME ?? "mydb",
});
