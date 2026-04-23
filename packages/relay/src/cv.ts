import { config } from "./config.js";

export type CvSpendResult =
  | { ok: true; newBalance?: number }
  | { ok: false; status: number; error: string; isSigError: boolean };

/**
 * Charges the user's CV via the upstream CV service (larv.ai by default).
 *
 * We deliberately do NOT verify the user's signature here — larv.ai is
 * the authority. ERC-1271 smart-wallet sigs (Coinbase Smart Wallet, Safe)
 * mix chain_id into the signing domain, so we can't reliably verify
 * locally without knowing which chain the wallet is bound to. See the
 * pattern in leftclaw-service-job-66.
 */
export async function spendCv(params: {
  wallet: string;
  amount: number;
  signature: string;
}): Promise<CvSpendResult> {
  const secret = config.getRequiredCvSpendSecret();

  const res = await fetch(`${config.cvApiBaseUrl}/spend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: params.wallet,
      amount: params.amount,
      secret,
      signature: params.signature,
    }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    balance?: number | string;
    newBalance?: number | string;
    error?: string;
  };

  if (!res.ok || data?.success === false) {
    const errText = data?.error || `CV spend failed (HTTP ${res.status})`;
    return {
      ok: false,
      status: res.status,
      error: errText,
      isSigError: /signature|invalid.*sig|sig.*invalid|sig.*length/i.test(errText),
    };
  }
  const raw = data.newBalance ?? data.balance;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return { ok: true, newBalance: Number.isFinite(n as number) ? (n as number) : undefined };
}
