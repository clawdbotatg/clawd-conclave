"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import toast from "react-hot-toast";
import { useAccount, useSignMessage } from "wagmi";
import { useChatFeed } from "~~/hooks/conclave/useChatFeed";
import {
  CV_SPEND_MESSAGE,
  clearCachedSignature,
  getCachedSignature,
  makeNonce,
  postChat,
  setCachedSignature,
} from "~~/utils/conclave/chat";
import { CONCLAVE_CV_API_BASE_URL, CONCLAVE_RELAY_URL, CONCLAVE_TOKEN_SYMBOL } from "~~/utils/conclave/config";

const CHAT_CV_COST = 1;

const useCvBalance = (address: string | undefined) => {
  const [balance, setBalance] = useState<number | null>(null);

  const refresh = useMemo(() => {
    return async () => {
      if (!address) {
        setBalance(null);
        return;
      }
      try {
        const res = await fetch(`${CONCLAVE_CV_API_BASE_URL}/balance?address=${address}`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; balance?: number | string };
        if (data.success === false) {
          setBalance(0);
          return;
        }
        const n = typeof data.balance === "string" ? Number(data.balance) : (data.balance ?? 0);
        setBalance(Number.isFinite(n) ? n : 0);
      } catch {
        // leave previous value in place on transient errors
      }
    };
  }, [address]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  return { balance, refresh };
};

const Live: NextPage = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();
  const { messages, connected } = useChatFeed();
  const { balance: cvBalance, refresh: refreshCv } = useCvBalance(address);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // auto-scroll to bottom on new message
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const getSignature = async (): Promise<`0x${string}` | null> => {
    if (!address) return null;
    const cached = getCachedSignature(address);
    if (cached) return cached;
    try {
      const sig = await signMessageAsync({ message: CV_SPEND_MESSAGE });
      setCachedSignature(address, sig);
      return sig;
    } catch {
      return null;
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !draft.trim() || posting) return;
    if (cvBalance !== null && cvBalance < CHAT_CV_COST) {
      toast.error(`You need at least ${CHAT_CV_COST} CV. Stake more on larv.ai.`);
      return;
    }

    setPosting(true);
    try {
      const signature = await getSignature();
      if (!signature) {
        toast.error("Signature required");
        return;
      }
      const result = await postChat({
        wallet: address,
        message: draft.trim(),
        signature,
        nonce: makeNonce(),
        cvCost: CHAT_CV_COST,
      });
      if (!result.ok) {
        if (result.code === "bad_signature") {
          clearCachedSignature(address);
          toast.error("Signature rejected — try again (you'll be re-prompted)");
        } else {
          toast.error(result.error);
        }
        return;
      }
      setDraft("");
      refreshCv();
    } finally {
      setPosting(false);
    }
  };

  if (!isConnected || !address) {
    return (
      <div className="flex flex-col items-center justify-center grow px-5 py-16">
        <h1 className="text-3xl font-bold mb-4">Enter the conclave</h1>
        <p className="text-base-content/60 mb-6 text-center max-w-md">
          Connect your wallet to post in chat. Each message costs {CHAT_CV_COST} CV.
        </p>
      </div>
    );
  }

  if (!CONCLAVE_RELAY_URL) {
    return (
      <div className="flex flex-col items-center justify-center grow px-5 py-16">
        <div className="alert alert-warning max-w-md">
          <span>
            <code>NEXT_PUBLIC_RELAY_URL</code> is not set. Point it at your running relay (default{" "}
            <code>http://localhost:4000</code>).
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="grow flex flex-col lg:flex-row gap-4 p-4 max-w-[1600px] mx-auto w-full">
      {/* Video placeholder — will become the MediaMTX player in Phase 2 */}
      <div className="flex-1 min-h-[60vh] lg:min-h-0 bg-base-300 rounded-xl flex items-center justify-center text-base-content/40 relative">
        <div className="absolute top-3 left-3 badge badge-neutral">offline</div>
        <div className="text-center">
          <div className="text-5xl mb-2">🦞</div>
          <div className="text-sm">Stream will appear here in Phase 2.</div>
        </div>
      </div>

      {/* Chat column */}
      <div className="lg:w-96 flex flex-col bg-base-100 rounded-xl shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-base-300 flex items-center justify-between">
          <div>
            <div className="font-bold">Chat</div>
            <div className="text-xs text-base-content/50 flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${connected ? "bg-success" : "bg-error"}`} />
              {connected ? "connected" : "disconnected"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-base-content/50">Your CV</div>
            <div className="font-bold text-primary">{cvBalance === null ? "—" : cvBalance.toLocaleString()}</div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[40vh] lg:min-h-0">
          {messages.length === 0 ? (
            <div className="text-center text-sm text-base-content/40 pt-8">The conclave is quiet. Say something.</div>
          ) : (
            messages.map(m => (
              <div key={m.id} className="flex flex-col">
                <div className="flex items-center gap-2 text-xs text-base-content/60">
                  <Address address={m.wallet as `0x${string}`} size="xs" onlyEnsOrAddress />
                  <span>· {m.cvCost} CV</span>
                </div>
                <div className="mt-1 break-words">{m.body}</div>
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleSend} className="border-t border-base-300 p-3 space-y-2">
          <textarea
            className="textarea textarea-bordered w-full resize-none text-sm"
            placeholder={`Say something (${CHAT_CV_COST} CV)…`}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={2}
            maxLength={280}
            disabled={posting || isSigning}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-base-content/50">
              {280 - draft.length} chars left · {CONCLAVE_TOKEN_SYMBOL} holder
            </span>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim() || posting || isSigning}>
              {isSigning ? "sign in wallet…" : posting ? "posting…" : `Send (${CHAT_CV_COST} CV)`}
            </button>
          </div>
        </form>
      </div>

      <div className="lg:hidden text-center text-xs text-base-content/40 pt-2">
        <Link href="/" className="link">
          ← home
        </Link>
      </div>
    </div>
  );
};

export default Live;
