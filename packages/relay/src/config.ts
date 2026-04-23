import "dotenv/config";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Required env var ${name} is not set`);
  return v;
};

const optional = (name: string, fallback: string): string => process.env[name] ?? fallback;

export const config = {
  port: Number(optional("PORT", "4000")),
  host: optional("HOST", "0.0.0.0"),

  corsOrigins: optional("CORS_ORIGINS", "*")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean),

  // CV service — defaults to larv.ai
  cvApiBaseUrl: optional("CV_API_BASE_URL", "https://larv.ai/api/cv"),

  // Server-only. Required for /chat — relay refuses to boot the route if missing.
  cvSpendSecret: process.env.CV_SPEND_SECRET,

  // Chat pricing (CV per post). Editable later from /admin.
  chatCvCost: Number(optional("CHAT_CV_COST", "1")),

  // Simple per-wallet rate limit: N posts per M ms.
  rateLimitMax: Number(optional("RATE_LIMIT_MAX", "30")),
  rateLimitWindowMs: Number(optional("RATE_LIMIT_WINDOW_MS", "60000")),
  rateLimitMinGapMs: Number(optional("RATE_LIMIT_MIN_GAP_MS", "1500")),

  databaseUrl: process.env.DATABASE_URL,

  getRequiredCvSpendSecret: () => required("CV_SPEND_SECRET"),
  getRequiredDatabaseUrl: () => required("DATABASE_URL"),
} as const;

export const CV_SPEND_MESSAGE = "larv.ai CV Spend";
export const MAX_MESSAGE_LENGTH = 280;
