/**
 * Database bootstrap — dual driver:
 *  - production: Turso/libsql when TURSO_DATABASE_URL is set (SQLite-
 *    compatible hosted DB; same schema and migrations as local dev)
 *  - dev/local: better-sqlite3 file at .data/neumeric.db
 *
 * All query call-sites use the async drizzle API (`await db.select()...`),
 * which both drivers support, so the driver choice is invisible above here.
 */
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { seedIfEmpty } from "./seed";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

export type DB = LibSQLDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __neumericDb?: Promise<DB> };

async function init(): Promise<DB> {
  let db: DB;
  if (process.env.TURSO_DATABASE_URL) {
    const { createClient } = await import("@libsql/client");
    const { drizzle } = await import("drizzle-orm/libsql");
    const { migrate } = await import("drizzle-orm/libsql/migrator");
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  } else {
    const { default: Database } = await import("better-sqlite3");
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const dataDir = path.join(process.cwd(), ".data");
    fs.mkdirSync(dataDir, { recursive: true });
    const sqlite = new Database(path.join(dataDir, "neumeric.db"));
    sqlite.pragma("journal_mode = WAL");
    const sdb = drizzle(sqlite, { schema });
    migrate(sdb, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    // API-compatible for every awaited drizzle call we make
    db = sdb as unknown as DB;
  }
  await seedIfEmpty(db);
  return db;
}

export function getDb(): Promise<DB> {
  return (globalForDb.__neumericDb ??= init());
}

export * as tables from "./schema";
