import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export function createDatabase(connectionString: string, max = 10) {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 1_000,
    statement_timeout: 1_500,
    application_name: "prox3",
  });
  pool.on("error", () => console.error("pg pool error"));
  return { pool, db: drizzle(pool, { schema }) };
}
export type Database = ReturnType<typeof createDatabase>["db"];
