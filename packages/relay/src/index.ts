import cors from "@fastify/cors";
import Fastify from "fastify";
import { config } from "./config.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
  credentials: true,
});

app.get("/health", async () => ({ ok: true, service: "clawd-conclave-relay", phase: 0 }));

/**
 * CV balance proxy. Static-export frontends (Vercel, IPFS, ENS) can hit
 * this single URL regardless of CORS on the upstream CV provider. Pure
 * passthrough — no auth, no caching beyond what the upstream sends.
 */
app.get<{ Params: { address: string } }>("/cv-balance/:address", async (req, reply) => {
  const { address } = req.params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return reply.code(400).send({ error: "Invalid address" });
  }
  try {
    const res = await fetch(`${config.cvApiBaseUrl}/balance?address=${address}`, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      balance?: number | string;
      error?: string;
    };
    if (data.success === false) return { balance: 0, found: false };
    const bal = typeof data.balance === "string" ? Number(data.balance) : (data.balance ?? 0);
    return { balance: Number.isFinite(bal) ? bal : 0, found: true };
  } catch (err) {
    return reply.code(502).send({ error: (err as Error).message });
  }
});

// --- Phase 1 stubs (documented, not implemented yet) -----------------------
// POST /auth/siwe/nonce       → issue SIWE nonce
// POST /auth/siwe/verify      → verify signature, set session cookie
// DELETE /auth/siwe/session   → logout
// POST /chat                  → { sessionId, message, signature, nonce } → CV spend → fan-out on WS
// POST /engagement/:type      → type-specific CV cost, fan-out
// WS   /overlay/:sessionId    → transparent overlay (OBS browser source) subscribes
// WS   /room/:sessionId       → in-app viewers subscribe

app
  .listen({ port: config.port, host: config.host })
  .then(() => {
    app.log.info(
      `clawd-conclave-relay listening on http://${config.host}:${config.port} — CV upstream: ${config.cvApiBaseUrl}`,
    );
  })
  .catch(err => {
    app.log.error(err);
    process.exit(1);
  });
