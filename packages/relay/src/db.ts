import * as schema from "./schema.js";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_DB_PATH = "./data/conclave.db";

function resolveDbPath(): string {
  const raw = process.env.DATABASE_URL ?? DEFAULT_DB_PATH;
  return raw.replace(/^sqlite:\/\//, "");
}

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqliteInstance: Database.Database | null = null;

export function getDb() {
  if (dbInstance) return dbInstance;
  const path = resolveDbPath();
  // Ensure the directory exists so a fresh clone works without any setup.
  mkdirSync(dirname(path), { recursive: true });
  sqliteInstance = new Database(path);
  // WAL gives better read concurrency while writes are happening — helpful
  // since the /chat handler and /chat/recent handler can hit the DB at the
  // same time.
  sqliteInstance.pragma("journal_mode = WAL");
  sqliteInstance.pragma("foreign_keys = ON");
  dbInstance = drizzle(sqliteInstance, { schema, casing: "snake_case" });
  return dbInstance;
}

export function closeDb() {
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
    dbInstance = null;
  }
}

const dbProxy = new Proxy(
  {},
  {
    get: (_, prop) => {
      if (prop === "close") return closeDb;
      const db = getDb();
      return db[prop as keyof typeof db];
    },
  },
);

export const db = dbProxy as ReturnType<typeof getDb> & { close: () => void };
