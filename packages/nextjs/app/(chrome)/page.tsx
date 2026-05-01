"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import toast from "react-hot-toast";
import { useAccount, useSignMessage } from "wagmi";
import { ChatMessage } from "~~/components/conclave/ChatMessage";
import { Player } from "~~/components/conclave/Player";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useChatFeed } from "~~/hooks/conclave/useChatFeed";
import {
  CV_SPEND_MESSAGE,
  clearCachedSignature,
  getCachedSignature,
  makeNonce,
  postChat,
  postConfetti,
  postReaction,
  setCachedSignature,
} from "~~/utils/conclave/chat";
import type { ReactionKind } from "~~/utils/conclave/chat";
import {
  CONCLAVE_CV_API_BASE_URL,
  CONCLAVE_MEDIA_HLS_URL,
  CONCLAVE_MEDIA_WHEP_URL,
  CONCLAVE_RELAY_URL,
  CONCLAVE_TOKEN_SYMBOL,
} from "~~/utils/conclave/config";

const CHAT_CV_COST = 250_000;
const CONFETTI_CV_COST = 500_000;
const CONFETTI_MEGA_CV_COST = 1_000_000;
const REACTION_CV_COST = 100_000;

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

const Home: NextPage = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();
  const { messages, connected } = useChatFeed();
  const { balance: cvBalance, refresh: refreshCv } = useCvBalance(address);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [reacting, setReacting] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Start "at bottom" so the first batch of messages auto-pins; flips to false only
  // when the user actively scrolls away.
  const isAtBottomRef = useRef(true);

  // Track whether the user is reading the latest, so we don't yank them down
  // when they've scrolled up to read history.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Pin synchronously on new messages so the first paint already shows the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    if (isAtBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // ReactMarkdown can grow message height after the layout effect ran (code blocks,
  // remote font shifts, etc.). Re-pin whenever the scroll container resizes while the
  // user is still parked at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (isAtBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    const mo = new MutationObserver(() => {
      for (const child of Array.from(el.children)) ro.observe(child);
      if (isAtBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    mo.observe(el, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

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
      toast.error(`You need at least ${CHAT_CV_COST.toLocaleString()} CV. Stake more on larv.ai.`);
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

  const handleConfetti = async (cost: number) => {
    if (!address || reacting) return;
    if (cvBalance !== null && cvBalance < cost) {
      toast.error(`You need at least ${cost.toLocaleString()} CV. Stake more on larv.ai.`);
      return;
    }
    setReacting(true);
    try {
      const signature = await getSignature();
      if (!signature) {
        toast.error("Signature required");
        return;
      }
      const result = await postConfetti({
        wallet: address,
        signature,
        nonce: makeNonce(),
        cvCost: cost,
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
      refreshCv();
    } finally {
      setReacting(false);
    }
  };

  const handleReaction = async (kind: ReactionKind) => {
    if (!address || reacting) return;
    if (cvBalance !== null && cvBalance < REACTION_CV_COST) {
      toast.error(`You need at least ${REACTION_CV_COST.toLocaleString()} CV. Stake more on larv.ai.`);
      return;
    }
    setReacting(true);
    try {
      const signature = await getSignature();
      if (!signature) {
        toast.error("Signature required");
        return;
      }
      const result = await postReaction({
        wallet: address,
        signature,
        nonce: makeNonce(),
        cvCost: REACTION_CV_COST,
        kind,
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
      refreshCv();
    } finally {
      setReacting(false);
    }
  };

  const canPost = isConnected && !!address && !!CONCLAVE_RELAY_URL;

  return (
    <div className="grow flex flex-col lg:flex-row gap-4 p-4 max-w-[1600px] mx-auto w-full">
      {/* Video column — Tries WHEP (WebRTC, ~1s) first; falls back to LL-HLS (~3s) */}
      <div className="flex-1 min-h-[60vh] lg:min-h-0">
        <Player whepUrl={CONCLAVE_MEDIA_WHEP_URL} hlsUrl={CONCLAVE_MEDIA_HLS_URL} />
      </div>

      {/* Chat column */}
      <div className="lg:w-96 flex flex-col bg-base-100 rounded-xl shadow overflow-hidden max-h-[calc(100dvh-6rem)] min-h-0">
        <div className="px-4 py-3 border-b border-base-300 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="relative w-8 h-8 shrink-0">
                <Image alt="Conclave logo" fill src="/logo.jpg" className="rounded-full object-cover" />
              </div>
              <span className="font-bold leading-tight">$CLAWD Conclave</span>
            </div>
            <RainbowKitCustomConnectButton />
          </div>
          <div className="flex items-center justify-between text-xs text-base-content/50">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${connected ? "bg-success" : "bg-error"}`} />
              {connected ? "connected" : "disconnected"}
            </div>
            <div>
              {"CV: "}
              <span className="font-bold text-primary">{cvBalance === null ? "—" : cvBalance.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
          <div className="flex-1" />
          {messages.length === 0 ? (
            <div className="text-center text-sm text-base-content/40">The conclave is quiet. Say something.</div>
          ) : (
            messages.map(m => (
              <div key={m.id} className="flex flex-col">
                <div className="flex items-center gap-2 text-xs text-base-content/60">
                  <Address address={m.wallet as `0x${string}`} size="xs" onlyEnsOrAddress />
                  <span>· {m.cvCost} CV</span>
                </div>
                <ChatMessage body={m.body} className="mt-1 break-words text-sm prose prose-sm max-w-none" />
              </div>
            ))
          )}
        </div>

        {!isConnected || !address ? (
          <div className="border-t border-base-300 p-3 text-center text-sm text-base-content/60 shrink-0">
            Connect your wallet to post ({CHAT_CV_COST.toLocaleString()} CV per message).
          </div>
        ) : !CONCLAVE_RELAY_URL ? (
          <div className="border-t border-base-300 p-3 text-center text-xs text-warning shrink-0">
            <code>NEXT_PUBLIC_RELAY_URL</code> not set — chat disabled.
          </div>
        ) : (
          <form onSubmit={handleSend} className="border-t border-base-300 p-3 space-y-2 shrink-0">
            <textarea
              className="textarea textarea-bordered w-full resize-none text-sm"
              placeholder={`Say something (${CHAT_CV_COST.toLocaleString()} CV)…`}
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
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!draft.trim() || posting || isSigning || !canPost}
              >
                {isSigning ? "sign in wallet…" : posting ? "posting…" : `Send (${CHAT_CV_COST.toLocaleString()} CV)`}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              <button
                type="button"
                onClick={() => handleConfetti(CONFETTI_CV_COST)}
                className="btn btn-secondary btn-xs"
                disabled={reacting || isSigning || !canPost}
                title={`Confetti — ${CONFETTI_CV_COST.toLocaleString()} CV`}
              >
                🎉 500k
              </button>
              <button
                type="button"
                onClick={() => handleConfetti(CONFETTI_MEGA_CV_COST)}
                className="btn btn-secondary btn-xs"
                disabled={reacting || isSigning || !canPost}
                title={`MEGA confetti — ${CONFETTI_MEGA_CV_COST.toLocaleString()} CV`}
              >
                🎉🎊 1M
              </button>
              <button
                type="button"
                onClick={() => handleReaction("up")}
                className="btn btn-secondary btn-xs"
                disabled={reacting || isSigning || !canPost}
                title={`Thumbs up — ${REACTION_CV_COST.toLocaleString()} CV`}
              >
                👍 100k
              </button>
              <button
                type="button"
                onClick={() => handleReaction("down")}
                className="btn btn-secondary btn-xs"
                disabled={reacting || isSigning || !canPost}
                title={`Thumbs down — ${REACTION_CV_COST.toLocaleString()} CV`}
              >
                👎 100k
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default Home;
