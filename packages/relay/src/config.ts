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

  // Admin (SIWE) config
  // Comma-separated list of addresses allowed to sign in to /admin.
  adminAddresses: optional("ADMIN_ADDRESSES", "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
  // Frontend domain where the user signs the SIWE message. SIWE message's
  // `domain` field must equal this — prevents an attacker from replaying
  // a signature obtained on a different site.
  adminDomain: optional("ADMIN_DOMAIN", "localhost:3000"),
  // How long an admin session token stays valid, in seconds.
  adminSessionTTLSeconds: Number(optional("ADMIN_SESSION_TTL_SECONDS", String(24 * 60 * 60))),

  // Alchemy key for on-chain ERC-1271 signature verification (smart-wallet
  // admin sign-in). Optional — EOA sign-in doesn't need it.
  alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? process.env.ALCHEMY_API_KEY ?? "",

  // MediaMTX admin API URL — used by /admin/status to fetch paths, viewer counts, etc.
  mediamtxApiUrl: optional("MEDIAMTX_API_URL", "http://127.0.0.1:9997"),

  getRequiredCvSpendSecret: () => required("CV_SPEND_SECRET"),
  getRequiredDatabaseUrl: () => required("DATABASE_URL"),
} as const;

export const CV_SPEND_MESSAGE = "larv.ai CV Spend";
export const MAX_MESSAGE_LENGTH = 280;
