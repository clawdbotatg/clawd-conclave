import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { CV_SPEND_MESSAGE, MAX_MESSAGE_LENGTH, config } from "./config.js";
import { spendCv } from "./cv.js";
import { db } from "./db.js";
import { checkRateLimit, releaseRateLimit } from "./rateLimit.js";
import { messages, nonces } from "./schema.js";
import { addSocket, broadcast, connectedCount } from "./ws.js";
import { desc } from "drizzle-orm";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: 8 * 1024,
});

await app.register(cors, {
  origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
  credentials: true,
});

await app.register(websocket);

// --- Health -----------------------------------------------------------------

app.get("/health", async () => ({
  ok: true,
  service: "clawd-conclave-relay",
  phase: 1,
  cvUpstream: config.cvApiBaseUrl,
  cvSpendMessage: CV_SPEND_MESSAGE,
  chatCvCost: config.chatCvCost,
  wsClients: connectedCount(),
}));

// --- CV balance passthrough -------------------------------------------------

app.get<{ Params: { address: string } }>("/cv-balance/:address", async (req, reply) => {
  const { address } = req.params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return reply.code(400).send({ error: "Invalid address" });
  try {
    const res = await fetch(`${config.cvApiBaseUrl}/balance?address=${address}`, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      balance?: number | string;
    };
    if (data.success === false) return { balance: 0, found: false };
    const bal = typeof data.balance === "string" ? Number(data.balance) : (data.balance ?? 0);
    return { balance: Number.isFinite(bal) ? bal : 0, found: true };
  } catch (err) {
    return reply.code(502).send({ error: (err as Error).message });
  }
});

// --- Recent chat history ----------------------------------------------------
// Used by /live and /overlay when they first connect, so the UI isn't empty
// until someone posts. Newest at the bottom.

app.get("/chat/recent", async () => {
  const rows = await db.select().from(messages).orderBy(desc(messages.createdAt)).limit(50);
  return rows.reverse().map(r => ({
    id: r.id,
    wallet: r.wallet,
    body: r.body,
    cvCost: r.cvCost,
    createdAt: r.createdAt.toISOString(),
  }));
});

// --- POST /chat -------------------------------------------------------------

type ChatBody = {
  wallet?: unknown;
  message?: unknown;
  signature?: unknown;
  nonce?: unknown;
  cvCost?: unknown;
};

app.post<{ Body: ChatBody }>("/chat", async (req, reply) => {
  const body = (req.body ?? {}) as ChatBody;
  const wallet = typeof body.wallet === "string" ? body.wallet.toLowerCase() : "";
  const message = typeof body.message === "string" ? body.message : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  const cvCost = typeof body.cvCost === "number" && Number.isFinite(body.cvCost) ? body.cvCost : config.chatCvCost;

  if (!/^0x[a-f0-9]{40}$/.test(wallet)) return reply.code(400).send({ error: "Invalid wallet address" });
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return reply.code(400).send({ error: "Invalid signature format" });
  if (!nonce || nonce.length < 8 || nonce.length > 64) return reply.code(400).send({ error: "Invalid nonce" });
  if (cvCost < 1 || cvCost > 1_000_000) return reply.code(400).send({ error: "Invalid cvCost" });
  if (cvCost !== config.chatCvCost) {
    // Client tried to lowball or overpay the fixed price. Reject — don't silently fix.
    return reply.code(400).send({ error: `cvCost must be ${config.chatCvCost}` });
  }

  const sanitized = message.replace(/<[^>]*>/g, "").trim();
  if (sanitized.length === 0) return reply.code(400).send({ error: "Message is empty" });
  if (sanitized.length > MAX_MESSAGE_LENGTH) return reply.code(400).send({ error: `Message too long (max ${MAX_MESSAGE_LENGTH})` });

  // Rate limit first — cheap failure before touching DB / upstream.
  const rl = checkRateLimit(wallet);
  if (!rl.allowed) {
    return reply
      .code(429)
      .send({ error: rl.reason === "too-fast" ? "Slow down" : "Too many posts; try later", retryAfterMs: rl.retryAfterMs });
  }

  // Burn the nonce atomically. If it was already used, the DB rejects it
  // via the unique (wallet, nonce) index — ON CONFLICT DO NOTHING + returning
  // gives us a zero-row result we can detect.
  const nonceInsert = await db
    .insert(nonces)
    .values({ wallet, nonce })
    .onConflictDoNothing()
    .returning({ nonce: nonces.nonce });
  if (nonceInsert.length === 0) {
    releaseRateLimit(wallet);
    return reply.code(409).send({ error: "Nonce already used" });
  }

  // Charge CV. On any failure the nonce stays burned (client generates a new
  // one for the retry). This is the same ordering principle as the mint
  // route in leftclaw-service-job-66: do cheap work first, charge last.
  const charge = await spendCv({ wallet, amount: cvCost, signature });
  if (!charge.ok) {
    releaseRateLimit(wallet);
    return reply.code(charge.status === 402 ? 402 : 502).send({
      error: charge.error,
      code: charge.isSigError ? "bad_signature" : undefined,
    });
  }

  // Record the message and fan out to connected viewers + the overlay.
  const [inserted] = await db
    .insert(messages)
    .values({ wallet, body: sanitized, cvCost })
    .returning({ id: messages.id, createdAt: messages.createdAt });
  if (!inserted) {
    // DB insert failed AFTER charge — manual reconciliation needed.
    app.log.error(
      `[CHAT_RECONCILE] wallet=${wallet} charged=${cvCost} CV but message insert failed. Manual refund required.`,
    );
    return reply.code(500).send({ error: "Post recorded partially — contact support" });
  }

  broadcast({
    type: "chat",
    id: inserted.id,
    wallet,
    body: sanitized,
    cvCost,
    createdAt: inserted.createdAt.toISOString(),
  });

  return { ok: true, id: inserted.id, newBalance: charge.newBalance };
});

// --- WS /ws -----------------------------------------------------------------

app.register(async function wsRoutes(fastify) {
  fastify.get("/ws", { websocket: true }, socket => {
    addSocket(socket);
    socket.send(JSON.stringify({ type: "hello", phase: 1 }));
  });
});

// --- Boot -------------------------------------------------------------------

if (!config.cvSpendSecret) {
  app.log.warn(
    "CV_SPEND_SECRET is not set — /chat will reject all requests. Set it in packages/relay/.env for local dev.",
  );
}
if (!config.databaseUrl) {
  app.log.warn(
    "DATABASE_URL is not set — /chat and /chat/recent will throw. Run `docker compose up -d db` and set DATABASE_URL.",
  );
}

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
