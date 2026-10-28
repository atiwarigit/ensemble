import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Executor = DB | Tx;

const globalForDb = globalThis as unknown as { __ensembleSql?: postgres.Sql };

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // prepare:false keeps the client compatible with transaction-mode poolers (Neon pooled URLs).
  return postgres(url, { prepare: false, max: process.env.NODE_ENV === "production" ? 5 : 10 });
}

export const sqlClient = globalForDb.__ensembleSql ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.__ensembleSql = sqlClient;

export const db: DB = drizzle(sqlClient, { schema, casing: "snake_case" });
export { schema };
