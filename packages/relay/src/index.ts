import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { extractBearer, getAdminBySession, isAdminAddress, issueAdminNonce, revokeSession, verifyAdminSiwe } from "./auth.js";
import { CV_SPEND_MESSAGE, MAX_MESSAGE_LENGTH, config } from "./config.js";
import { spendCv } from "./cv.js";
import { db } from "./db.js";
import { isKnownFanoutId, listFanouts, shutdownAllFanouts, startFanout, stopFanout } from "./fanout.js";
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

// --- POST /confetti ---------------------------------------------------------
// Pay-to-celebrate: spends a fixed CV amount and tells the overlay (and any
// other subscribers) to drop a confetti burst. Same nonce/sig flow as /chat,
// no DB row — confetti is ephemeral.

const CONFETTI_TIERS = {
  500_000: { body: "🎉👏🎊🎉" },
  1_000_000: { body: "🎉🎊🎉👏🎊🎉🎊👏🎉" },
} as const;
const CONFETTI_VALID_COSTS = Object.keys(CONFETTI_TIERS).map(Number);

type ConfettiBody = {
  wallet?: unknown;
  signature?: unknown;
  nonce?: unknown;
  cvCost?: unknown;
};

app.post<{ Body: ConfettiBody }>("/confetti", async (req, reply) => {
  const body = (req.body ?? {}) as ConfettiBody;
  const wallet = typeof body.wallet === "string" ? body.wallet.toLowerCase() : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  const cvCost = typeof body.cvCost === "number" && Number.isFinite(body.cvCost) ? body.cvCost : 0;

  if (!/^0x[a-f0-9]{40}$/.test(wallet)) return reply.code(400).send({ error: "Invalid wallet address" });
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return reply.code(400).send({ error: "Invalid signature format" });
  if (!nonce || nonce.length < 8 || nonce.length > 64) return reply.code(400).send({ error: "Invalid nonce" });
  const tier = CONFETTI_TIERS[cvCost as keyof typeof CONFETTI_TIERS];
  if (!tier) {
    return reply.code(400).send({ error: `cvCost must be one of ${CONFETTI_VALID_COSTS.join(", ")}` });
  }

  const rl = checkRateLimit(wallet);
  if (!rl.allowed) {
    return reply
      .code(429)
      .send({ error: rl.reason === "too-fast" ? "Slow down" : "Too many posts; try later", retryAfterMs: rl.retryAfterMs });
  }

  const nonceInsert = await db
    .insert(nonces)
    .values({ wallet, nonce })
    .onConflictDoNothing()
    .returning({ nonce: nonces.nonce });
  if (nonceInsert.length === 0) {
    releaseRateLimit(wallet);
    return reply.code(409).send({ error: "Nonce already used" });
  }

  const charge = await spendCv({ wallet, amount: cvCost, signature });
  if (!charge.ok) {
    releaseRateLimit(wallet);
    return reply.code(charge.status === 402 ? 402 : 502).send({
      error: charge.error,
      code: charge.isSigError ? "bad_signature" : undefined,
    });
  }

  const celebrationBody = tier.body;
  const [inserted] = await db
    .insert(messages)
    .values({ wallet, body: celebrationBody, cvCost })
    .returning({ id: messages.id, createdAt: messages.createdAt });
  if (!inserted) {
    app.log.error(
      `[CONFETTI_RECONCILE] wallet=${wallet} charged=${cvCost} CV but message insert failed. Manual refund required.`,
    );
    return reply.code(500).send({ error: "Confetti charged but chat insert failed — contact support" });
  }

  const createdAt = inserted.createdAt.toISOString();
  broadcast({
    type: "chat",
    id: inserted.id,
    wallet,
    body: celebrationBody,
    cvCost,
    createdAt,
  });
  broadcast({ type: "confetti", id: inserted.id, wallet, cvCost, createdAt });

  return { ok: true, id: inserted.id, newBalance: charge.newBalance };
});

// --- POST /reaction ---------------------------------------------------------
// Lightweight thumbs up / thumbs down. Same flow as /confetti but the chat row
// is just the bare emoji and the overlay floats those emojis instead of dropping
// confetti pieces.

const REACTION_KINDS = {
  up: { body: "👍" },
  down: { body: "👎" },
} as const;
const REACTION_CV_COST = 100_000;

type ReactionBody = {
  wallet?: unknown;
  signature?: unknown;
  nonce?: unknown;
  cvCost?: unknown;
  kind?: unknown;
};

app.post<{ Body: ReactionBody }>("/reaction", async (req, reply) => {
  const body = (req.body ?? {}) as ReactionBody;
  const wallet = typeof body.wallet === "string" ? body.wallet.toLowerCase() : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  const cvCost = typeof body.cvCost === "number" && Number.isFinite(body.cvCost) ? body.cvCost : 0;
  const kind = body.kind === "up" || body.kind === "down" ? body.kind : null;

  if (!/^0x[a-f0-9]{40}$/.test(wallet)) return reply.code(400).send({ error: "Invalid wallet address" });
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return reply.code(400).send({ error: "Invalid signature format" });
  if (!nonce || nonce.length < 8 || nonce.length > 64) return reply.code(400).send({ error: "Invalid nonce" });
  if (!kind) return reply.code(400).send({ error: "kind must be 'up' or 'down'" });
  if (cvCost !== REACTION_CV_COST) {
    return reply.code(400).send({ error: `cvCost must be ${REACTION_CV_COST}` });
  }

  const rl = checkRateLimit(wallet);
  if (!rl.allowed) {
    return reply
      .code(429)
      .send({ error: rl.reason === "too-fast" ? "Slow down" : "Too many posts; try later", retryAfterMs: rl.retryAfterMs });
  }

  const nonceInsert = await db
    .insert(nonces)
    .values({ wallet, nonce })
    .onConflictDoNothing()
    .returning({ nonce: nonces.nonce });
  if (nonceInsert.length === 0) {
    releaseRateLimit(wallet);
    return reply.code(409).send({ error: "Nonce already used" });
  }

  const charge = await spendCv({ wallet, amount: cvCost, signature });
  if (!charge.ok) {
    releaseRateLimit(wallet);
    return reply.code(charge.status === 402 ? 402 : 502).send({
      error: charge.error,
      code: charge.isSigError ? "bad_signature" : undefined,
    });
  }

  const reactionBody = REACTION_KINDS[kind].body;
  const [inserted] = await db
    .insert(messages)
    .values({ wallet, body: reactionBody, cvCost })
    .returning({ id: messages.id, createdAt: messages.createdAt });
  if (!inserted) {
    app.log.error(
      `[REACTION_RECONCILE] wallet=${wallet} charged=${cvCost} CV but message insert failed. Manual refund required.`,
    );
    return reply.code(500).send({ error: "Reaction charged but chat insert failed — contact support" });
  }

  const createdAt = inserted.createdAt.toISOString();
  broadcast({
    type: "chat",
    id: inserted.id,
    wallet,
    body: reactionBody,
    cvCost,
    createdAt,
  });
  broadcast({ type: "reaction", id: inserted.id, wallet, kind, cvCost, createdAt });

  return { ok: true, id: inserted.id, newBalance: charge.newBalance };
});

// --- WS /ws -----------------------------------------------------------------

app.register(async function wsRoutes(fastify) {
  fastify.get("/ws", { websocket: true }, socket => {
    addSocket(socket);
    socket.send(JSON.stringify({ type: "hello", phase: 1 }));
  });
});

// --- SIWE admin auth --------------------------------------------------------

app.get<{ Querystring: { address?: string } }>("/auth/siwe/nonce", async (req, reply) => {
  const address = req.query.address ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return reply.code(400).send({ error: "Invalid address" });
  }
  // Don't reveal whether an address is admin via nonce issue — issue for
  // anyone, reject at /verify. Keeps admin-address list from being probed.
  const nonce = await issueAdminNonce(address);
  return { nonce };
});

type SiweVerifyBody = { message?: unknown; signature?: unknown };

app.post<{ Body: SiweVerifyBody }>("/auth/siwe/verify", async (req, reply) => {
  const body = (req.body ?? {}) as SiweVerifyBody;
  const message = typeof body.message === "string" ? body.message : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!message || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    return reply.code(400).send({ error: "Missing message or signature" });
  }
  const result = await verifyAdminSiwe(message, signature as `0x${string}`);
  if (!result.ok) return reply.code(401).send({ error: result.error });
  return { token: result.token, address: result.address, expiresIn: config.adminSessionTTLSeconds };
});

app.post("/auth/logout", async req => {
  const token = extractBearer(req.headers.authorization);
  if (token) await revokeSession(token);
  return { ok: true };
});

/**
 * Middleware-ish: returns the admin address for the request, or sends 401
 * and returns null. Callers must check the return value.
 */
async function requireAdmin(req: { headers: { authorization?: string } }, reply: { code: (c: number) => { send: (body: unknown) => unknown } }): Promise<string | null> {
  const token = extractBearer(req.headers.authorization);
  const address = await getAdminBySession(token);
  if (!address) {
    reply.code(401).send({ error: "Unauthorized" });
    return null;
  }
  return address;
}

// --- /admin/status ----------------------------------------------------------

type MediamtxPath = {
  name: string;
  ready: boolean;
  tracks: string[];
  readers: Array<{ type: string }>;
  inboundBytes: number;
  source: { type: string } | null;
};
type MediamtxPathList = { items: MediamtxPath[] };
type WebrtcSession = { state: string; bytesSent: number };
type WebrtcSessionList = { items: WebrtcSession[] };

app.get("/admin/status", async (req, reply) => {
  const address = await requireAdmin(req, reply);
  if (!address) return;

  // Fetch both in parallel; tolerate MediaMTX being unreachable without
  // failing the whole status call.
  const [pathsRes, webrtcRes] = await Promise.allSettled([
    fetch(`${config.mediamtxApiUrl}/v3/paths/list`).then(r => r.json() as Promise<MediamtxPathList>),
    fetch(`${config.mediamtxApiUrl}/v3/webrtcsessions/list`).then(r => r.json() as Promise<WebrtcSessionList>),
  ]);

  const paths = pathsRes.status === "fulfilled" ? pathsRes.value.items ?? [] : [];
  const webrtc = webrtcRes.status === "fulfilled" ? webrtcRes.value.items ?? [] : [];

  // Identify the canonical "live" path and the Opus transcode.
  const live = paths.find(p => p.name === "live/conclave");
  const liveRtc = paths.find(p => p.name === "live/conclave-rtc");

  const activeWebrtc = webrtc.filter(s => s.state === "read").length;
  const webrtcBytes = webrtc.reduce((sum, s) => sum + (s.bytesSent || 0), 0);

  return {
    admin: address,
    publishing: {
      ready: Boolean(live?.ready),
      tracks: live?.tracks ?? [],
      inboundBytes: live?.inboundBytes ?? 0,
      source: live?.source?.type ?? null,
    },
    webrtc: {
      rtcPathReady: Boolean(liveRtc?.ready),
      rtcTracks: liveRtc?.tracks ?? [],
      activeViewers: activeWebrtc,
      bytesSent: webrtcBytes,
    },
    chat: {
      wsClients: connectedCount(),
      chatCvCost: config.chatCvCost,
    },
    obs: {
      rtmpUrl: "rtmp://conclave.larv.ai:1935/live",
      streamKeyHint: "conclave?user=<MEDIAMTX_PUBLISH_USER>&pass=<MEDIAMTX_PUBLISH_PASS>",
      note: "See .env.stream on the server for the real credentials.",
    },
    mediamtxReachable: pathsRes.status === "fulfilled",
  };
});

// --- Me (who am I) ---
// Useful for the frontend to decide whether to show admin nav links at all.
// Public endpoint: just returns whether a given address is admin.
app.get<{ Querystring: { address?: string } }>("/auth/is-admin", async req => {
  const address = req.query.address ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return { isAdmin: false };
  return { isAdmin: isAdminAddress(address) };
});

// --- /admin/fanouts (restream destinations) --------------------------------

app.get("/admin/fanouts", async (req, reply) => {
  const address = await requireAdmin(req, reply);
  if (!address) return;
  return { fanouts: listFanouts() };
});

app.post<{ Params: { id: string } }>("/admin/fanouts/:id/start", async (req, reply) => {
  const address = await requireAdmin(req, reply);
  if (!address) return;
  if (!isKnownFanoutId(req.params.id)) return reply.code(404).send({ error: "Unknown destination" });
  const result = startFanout(req.params.id, line => app.log.info(line));
  if (!result.ok) return reply.code(400).send({ error: result.error });
  return { ok: true };
});

app.post<{ Params: { id: string } }>("/admin/fanouts/:id/stop", async (req, reply) => {
  const address = await requireAdmin(req, reply);
  if (!address) return;
  if (!isKnownFanoutId(req.params.id)) return reply.code(404).send({ error: "Unknown destination" });
  const result = stopFanout(req.params.id);
  if (!result.ok) return reply.code(400).send({ error: result.error });
  return { ok: true };
});

// --- /admin/chat/clear ------------------------------------------------------
// Wipes every chat message. Connected clients reset their feeds via the
// chat-cleared broadcast. Used to start a fresh "session".

app.post("/admin/chat/clear", async (req, reply) => {
  const address = await requireAdmin(req, reply);
  if (!address) return;
  const deleted = await db.delete(messages).returning({ id: messages.id });
  const clearedAt = new Date().toISOString();
  broadcast({ type: "chat-cleared", clearedAt });
  app.log.info(`[CHAT_CLEAR] admin=${address} removed=${deleted.length}`);
  return { ok: true, removed: deleted.length, clearedAt };
});

// Cleanly terminate ffmpeg children on relay shutdown so YouTube sees a
// proper "stream ended" rather than a drop.
process.on("SIGTERM", () => shutdownAllFanouts());
process.on("SIGINT", () => shutdownAllFanouts());

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
