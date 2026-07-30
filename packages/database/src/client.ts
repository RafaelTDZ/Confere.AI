import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | null = null;

export function getPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) {
    throw new Error("DATABASE_URL nao configurada");
  }
  if (!pool) {
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

export function createDb(connectionString?: string): Database {
  return drizzle(getPool(connectionString), { schema });
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
