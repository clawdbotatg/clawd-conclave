import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Chat messages posted to the conclave. Wallet is stored lowercased so
 * equality comparisons are case-insensitive.
 */
export const messages = sqliteTable("messages", {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  wallet: text().notNull(),
  body: text().notNull(),
  cvCost: integer().notNull(),
  createdAt: integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Used nonces for anti-replay. A (wallet, nonce) pair can only be inserted
 * once — unique index enforces this at DB level so concurrent /chat
 * requests with the same nonce can't both succeed.
 */
export const nonces = sqliteTable(
  "nonces",
  {
    wallet: text().notNull(),
    nonce: text().notNull(),
    usedAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [uniqueIndex("nonces_wallet_nonce_idx").on(table.wallet, table.nonce)],
);
