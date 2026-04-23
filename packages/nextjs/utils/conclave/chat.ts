import { CONCLAVE_RELAY_URL } from "./config";

export const CV_SPEND_MESSAGE = "larv.ai CV Spend";

export type ChatEvent = {
  type: "chat";
  id: string;
  wallet: string;
  body: string;
  cvCost: number;
  createdAt: string;
};

const sigKey = (address: string) => `conclave:cv-sig:${address.toLowerCase()}`;

export const getCachedSignature = (address: string): `0x${string}` | null => {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(sigKey(address));
  return v && /^0x[0-9a-fA-F]+$/.test(v) ? (v as `0x${string}`) : null;
};

export const setCachedSignature = (address: string, sig: `0x${string}`) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(sigKey(address), sig);
};

export const clearCachedSignature = (address: string) => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(sigKey(address));
};

export const makeNonce = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback — unlikely path in any modern browser.
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
};

export type PostChatResult =
  | { ok: true; id: string; newBalance?: number }
  | { ok: false; status: number; error: string; code?: "bad_signature" | undefined };

export async function postChat(params: {
  wallet: string;
  message: string;
  signature: string;
  nonce: string;
  cvCost: number;
}): Promise<PostChatResult> {
  if (!CONCLAVE_RELAY_URL) {
    return { ok: false, status: 0, error: "Relay URL not configured (set NEXT_PUBLIC_RELAY_URL)" };
  }
  let res: Response;
  try {
    res = await fetch(`${CONCLAVE_RELAY_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    id?: string;
    newBalance?: number;
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: data.error ?? `Relay returned HTTP ${res.status}`,
      code: data.code === "bad_signature" ? "bad_signature" : undefined,
    };
  }
  return { ok: true, id: data.id ?? "", newBalance: data.newBalance };
}

export async function fetchRecentChat(): Promise<ChatEvent[]> {
  if (!CONCLAVE_RELAY_URL) return [];
  try {
    const res = await fetch(`${CONCLAVE_RELAY_URL}/chat/recent`, { cache: "no-store" });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{
      id: string;
      wallet: string;
      body: string;
      cvCost: number;
      createdAt: string;
    }>;
    return rows.map(r => ({ type: "chat", ...r }));
  } catch {
    return [];
  }
}

export const chatWsUrl = (): string | null => {
  if (!CONCLAVE_RELAY_URL) return null;
  try {
    const u = new URL(CONCLAVE_RELAY_URL);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = u.pathname.replace(/\/$/, "") + "/ws";
    return u.toString();
  } catch {
    return null;
  }
};
