"use client";

import { useEffect, useState } from "react";
import type { NextPage } from "next";
import { useChatFeed } from "~~/hooks/conclave/useChatFeed";
import type { ChatEvent } from "~~/utils/conclave/chat";

const BUBBLE_LIFETIME_MS = 10_000;

type Bubble = ChatEvent & { bornAt: number };

const shortAddress = (addr: string) => (addr.startsWith("0x") ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr);

const Overlay: NextPage = () => {
  const { messages } = useChatFeed();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  // Track which message ids we've already flown in, so the seed fetch
  // doesn't spam the overlay with stale messages when OBS first loads.
  const [hasBootstrapped, setHasBootstrapped] = useState(false);

  useEffect(() => {
    // On the very first population from the history fetch, skip the existing
    // messages — we only want new traffic to animate in.
    if (!hasBootstrapped && messages.length > 0) {
      setHasBootstrapped(true);
      return;
    }
    if (messages.length === 0) return;
    const last = messages[messages.length - 1]!;
    setBubbles(prev => {
      if (prev.some(b => b.id === last.id)) return prev;
      return [...prev, { ...last, bornAt: Date.now() }];
    });
  }, [messages, hasBootstrapped]);

  // Reap old bubbles
  useEffect(() => {
    if (bubbles.length === 0) return;
    const id = setInterval(() => {
      const cutoff = Date.now() - BUBBLE_LIFETIME_MS;
      setBubbles(prev => prev.filter(b => b.bornAt > cutoff));
    }, 500);
    return () => clearInterval(id);
  }, [bubbles.length]);

  return (
    <div className="overlay-root">
      <div className="overlay-column">
        {bubbles.map(b => (
          <div key={b.id} className="overlay-bubble">
            <div className="overlay-bubble-wallet">{shortAddress(b.wallet)}</div>
            <div className="overlay-bubble-body">{b.body}</div>
            <div className="overlay-bubble-cost">{b.cvCost} CV</div>
          </div>
        ))}
      </div>

      <style>{`
        :root, html, body { background: transparent !important; }
        .overlay-root {
          position: fixed;
          inset: 0;
          pointer-events: none;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .overlay-column {
          position: absolute;
          left: 24px;
          bottom: 24px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-width: 520px;
        }
        .overlay-bubble {
          background: rgba(8, 8, 10, 0.82);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          color: white;
          padding: 10px 14px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          animation: slide-in 250ms ease-out, fade-out 1000ms ease-in forwards 9000ms;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
        }
        .overlay-bubble-wallet {
          font-size: 11px;
          font-weight: 600;
          color: #c084fc;
          letter-spacing: 0.02em;
        }
        .overlay-bubble-body {
          font-size: 18px;
          line-height: 1.35;
          margin-top: 2px;
          word-break: break-word;
        }
        .overlay-bubble-cost {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.4);
          margin-top: 4px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        @keyframes slide-in {
          from { transform: translateX(-30px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fade-out {
          to { opacity: 0; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
};

export default Overlay;
