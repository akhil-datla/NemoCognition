import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export function createClient(databaseUrl: string): { db: Database; close: () => Promise<void> } {
  const sql = postgres(databaseUrl, { max: 10, idle_timeout: 30 });
  const db = drizzle(sql, { schema });
  return { db, close: () => sql.end() };
}
