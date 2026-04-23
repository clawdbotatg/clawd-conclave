import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const rawUrl = process.env.DATABASE_URL ?? "./data/conclave.db";
const dbPath = rawUrl.replace(/^sqlite:\/\//, "");

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
  casing: "snake_case",
});
