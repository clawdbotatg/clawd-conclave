/**
 * Relay server configuration. Everything comes from env so forkers can
 * point at their own CV service without editing code.
 */

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Required env var ${name} is not set`);
  return v;
};

const optional = (name: string, fallback: string): string => process.env[name] ?? fallback;

export const config = {
  port: Number(optional("PORT", "4000")),
  host: optional("HOST", "0.0.0.0"),

  // Comma-separated list of origins allowed to hit the relay. Set to "*"
  // for a forker who wants anyone to read, or lock down to known domains
  // (vercel app + ENS gateway) in production.
  corsOrigins: optional("CORS_ORIGINS", "*")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean),

  // CV service config — defaults to larv.ai
  cvApiBaseUrl: optional("CV_API_BASE_URL", "https://larv.ai/api/cv"),

  // Server-only — required once we enable /chat in Phase 1. Kept optional
  // for Phase 0 so the relay boots with zero config for `docker compose up`.
  cvSpendSecret: process.env.CV_SPEND_SECRET,

  getRequiredCvSpendSecret: () => required("CV_SPEND_SECRET"),
} as const;
