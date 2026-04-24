import { CONCLAVE_RELAY_URL } from "./config";

const tokenKey = (address: string) => `conclave:admin-token:${address.toLowerCase()}`;

export const getAdminToken = (address: string): string | null => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(tokenKey(address));
};

export const setAdminToken = (address: string, token: string) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(tokenKey(address), token);
};

export const clearAdminToken = (address: string) => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(tokenKey(address));
};

export async function fetchSiweNonce(address: string): Promise<string | null> {
  if (!CONCLAVE_RELAY_URL) return null;
  try {
    const res = await fetch(`${CONCLAVE_RELAY_URL}/auth/siwe/nonce?address=${address}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { nonce?: string };
    return data.nonce ?? null;
  } catch {
    return null;
  }
}

export async function verifySiwe(
  message: string,
  signature: string,
): Promise<{ ok: true; token: string; address: string } | { ok: false; error: string }> {
  if (!CONCLAVE_RELAY_URL) return { ok: false, error: "Relay URL not set" };
  try {
    const res = await fetch(`${CONCLAVE_RELAY_URL}/auth/siwe/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    const data = (await res.json()) as { token?: string; address?: string; error?: string };
    if (!res.ok || !data.token || !data.address) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true, token: data.token, address: data.address };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function logoutAdmin(token: string): Promise<void> {
  if (!CONCLAVE_RELAY_URL || !token) return;
  await fetch(`${CONCLAVE_RELAY_URL}/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

export async function checkIsAdmin(address: string): Promise<boolean> {
  if (!CONCLAVE_RELAY_URL) return false;
  try {
    const res = await fetch(`${CONCLAVE_RELAY_URL}/auth/is-admin?address=${address}`, { cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json()) as { isAdmin?: boolean };
    return Boolean(data.isAdmin);
  } catch {
    return false;
  }
}

export type AdminStatus = {
  admin: string;
  publishing: {
    ready: boolean;
    tracks: string[];
    inboundBytes: number;
    source: string | null;
  };
  webrtc: {
    rtcPathReady: boolean;
    rtcTracks: string[];
    activeViewers: number;
    bytesSent: number;
  };
  chat: {
    wsClients: number;
    chatCvCost: number;
  };
  obs: {
    rtmpUrl: string;
    streamKeyHint: string;
    note: string;
  };
  mediamtxReachable: boolean;
};

export async function fetchAdminStatus(token: string): Promise<AdminStatus | null> {
  if (!CONCLAVE_RELAY_URL || !token) return null;
  try {
    const res = await fetch(`${CONCLAVE_RELAY_URL}/admin/status`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    return (await res.json()) as AdminStatus;
  } catch {
    return null;
  }
}
