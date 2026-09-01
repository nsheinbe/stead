import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

/**
 * Neon's pooled endpoint is PgBouncer in transaction mode, so named prepared
 * statements are off. `max: 1` keeps a serverless invocation to a single
 * backend connection.
 */
export function createDb(connectionString: string) {
  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
  });
  return drizzle(sql, { schema });
}

let cached: Db | undefined;

export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Point it at the Neon project (see .env.example).");
  }
  cached = createDb(url);
  return cached;
}
