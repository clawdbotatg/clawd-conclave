import { config } from "./config.js";
import { db } from "./db.js";
import { adminNonces, adminSessions } from "./schema.js";
import { randomBytes } from "node:crypto";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { generateSiweNonce, parseSiweMessage, verifySiweMessage } from "viem/siwe";
import { and, eq, gt, lt } from "drizzle-orm";

const NONCE_TTL_MS = 10 * 60 * 1000;

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(
    config.alchemyApiKey
      ? `https://eth-mainnet.g.alchemy.com/v2/${config.alchemyApiKey}`
      : // Fallback — only used if ALCHEMY_API_KEY isn't set. Works for EOAs
        // (no on-chain call needed); will fail for smart-wallet signatures.
        undefined,
  ),
});

/**
 * Is this address allowed to sign in to /admin? Case-insensitive check
 * against the comma-separated ADMIN_ADDRESSES env.
 */
export function isAdminAddress(address: string): boolean {
  return config.adminAddresses.includes(address.toLowerCase());
}

/**
 * Issue a fresh SIWE challenge nonce bound to an address. The same address
 * can have multiple outstanding nonces (useful across multiple tabs). Old
 * nonces are pruned opportunistically on issue.
 */
export async function issueAdminNonce(address: string): Promise<string> {
  const nonce = generateSiweNonce();
  const cutoff = new Date(Date.now() - NONCE_TTL_MS);
  // Best-effort cleanup of expired rows so the table doesn't grow forever.
  await db.delete(adminNonces).where(lt(adminNonces.createdAt, cutoff));
  await db.insert(adminNonces).values({ nonce, address: address.toLowerCase() });
  return nonce;
}

export type SiweVerifyResult = { ok: true; address: string; token: string } | { ok: false; error: string };

/**
 * Verify a SIWE sign-in attempt. Checks:
 *  - nonce was issued by us, not expired, not yet consumed
 *  - signature verifies (EOA or ERC-1271)
 *  - SIWE message's domain matches ADMIN_DOMAIN
 *  - SIWE message's address is in ADMIN_ADDRESSES
 *
 * On success, consumes the nonce and issues a session token valid for
 * ADMIN_SESSION_TTL_SECONDS.
 */
export async function verifyAdminSiwe(message: string, signature: `0x${string}`): Promise<SiweVerifyResult> {
  const parsed = parseSiweMessage(message);
  if (!parsed.address || !parsed.nonce || !parsed.domain) {
    return { ok: false, error: "Malformed SIWE message" };
  }

  const address = parsed.address.toLowerCase();

  if (parsed.domain !== config.adminDomain) {
    return { ok: false, error: `Domain mismatch (expected ${config.adminDomain})` };
  }
  if (!isAdminAddress(address)) {
    return { ok: false, error: "Address not authorized" };
  }

  // Look up the nonce — must exist, be for THIS address, and not be expired.
  const cutoff = new Date(Date.now() - NONCE_TTL_MS);
  const row = await db
    .select()
    .from(adminNonces)
    .where(and(eq(adminNonces.nonce, parsed.nonce), gt(adminNonces.createdAt, cutoff)))
    .limit(1);
  const storedNonce = row[0];
  if (!storedNonce) {
    return { ok: false, error: "Unknown or expired nonce" };
  }
  if (storedNonce.address !== address) {
    return { ok: false, error: "Nonce/address mismatch" };
  }

  // Verify the signature (ERC-1271 via publicClient for smart wallets).
  let valid = false;
  try {
    valid = await verifySiweMessage(publicClient, {
      message,
      signature,
      nonce: parsed.nonce,
      domain: config.adminDomain,
    });
  } catch (err) {
    return { ok: false, error: `Signature verify failed: ${(err as Error).message}` };
  }
  if (!valid) return { ok: false, error: "Invalid signature" };

  // Consume the nonce so it can't be replayed.
  await db.delete(adminNonces).where(eq(adminNonces.nonce, parsed.nonce));

  // Issue a session token.
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + config.adminSessionTTLSeconds * 1000);
  await db.insert(adminSessions).values({ token, address, expiresAt });

  return { ok: true, address, token };
}

/**
 * Look up a session token, return the admin address if the token is valid
 * and unexpired, else null. Also prunes expired sessions opportunistically.
 */
export async function getAdminBySession(token: string | undefined | null): Promise<string | null> {
  if (!token || typeof token !== "string" || token.length < 32) return null;
  const now = new Date();
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, now));
  const row = await db
    .select()
    .from(adminSessions)
    .where(and(eq(adminSessions.token, token), gt(adminSessions.expiresAt, now)))
    .limit(1);
  const session = row[0];
  if (!session) return null;
  // Double-check the address is still an admin (in case ADMIN_ADDRESSES
  // changed after issue).
  if (!isAdminAddress(session.address)) return null;
  return session.address;
}

export async function revokeSession(token: string): Promise<void> {
  await db.delete(adminSessions).where(eq(adminSessions.token, token));
}

/**
 * Extract a bearer token from the Authorization header.
 */
export function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader);
  return match ? match[1] ?? null : null;
}
