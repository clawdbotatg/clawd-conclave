"use client";

import { useEffect, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { ChatMessage } from "~~/components/conclave/ChatMessage";
import { useChatFeed } from "~~/hooks/conclave/useChatFeed";
import type { ChatEvent } from "~~/utils/conclave/chat";

const BUBBLE_LIFETIME_MS = 25_000;

type Bubble = ChatEvent & { bornAt: number };

const Overlay: NextPage = () => {
  const { messages, connected } = useChatFeed();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPreview(new URLSearchParams(window.location.search).has("preview"));
  }, []);

  const [hasBootstrapped, setHasBootstrapped] = useState(false);

  useEffect(() => {
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

  useEffect(() => {
    if (bubbles.length === 0) return;
    const id = setInterval(() => {
      const cutoff = Date.now() - BUBBLE_LIFETIME_MS;
      setBubbles(prev => prev.filter(b => b.bornAt > cutoff));
    }, 500);
    return () => clearInterval(id);
  }, [bubbles.length]);

  return (
    <div className={`overlay-root ${preview ? "overlay-preview" : ""}`}>
      {preview && (
        <div className="overlay-devbar">
          <span className={`overlay-dot ${connected ? "overlay-dot-on" : "overlay-dot-off"}`} />
          {connected ? "WS connected" : "WS disconnected"} · {bubbles.length} bubble{bubbles.length === 1 ? "" : "s"} ·
          preview mode (drop <code>?preview=1</code> before using in OBS)
        </div>
      )}
      <div className="overlay-column">
        {bubbles.map(b => (
          <div key={b.id} className="overlay-bubble">
            <Address address={b.wallet as `0x${string}`} disableAddressLink size="sm" />
            <ChatMessage body={b.body} className="overlay-bubble-body" />
          </div>
        ))}
      </div>

      <style>{`
        :root, html, body { background: transparent !important; }
        .overlay-preview, .overlay-preview :where(html, body) {
          background: #0b0c10 !important;
          min-height: 100vh;
          color: #eee;
        }
        .overlay-devbar {
          position: fixed;
          top: 12px;
          left: 12px;
          padding: 6px 10px;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.55);
          color: #ddd;
          font-size: 12px;
          font-family: ui-monospace, Menlo, monospace;
        }
        .overlay-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
          vertical-align: middle;
        }
        .overlay-dot-on { background: #22c55e; }
        .overlay-dot-off { background: #ef4444; }
        .overlay-root {
          position: fixed;
          inset: 0;
          pointer-events: none;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .overlay-column {
          position: absolute;
          right: 24px;
          bottom: 24px;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 6px;
          max-width: 480px;
        }
        .overlay-bubble {
          background: rgba(8, 8, 10, 0.85);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          color: white;
          padding: 10px 14px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          animation: slide-in 250ms ease-out, fade-out 1500ms ease-in forwards 23500ms;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
          width: 100%;
        }
        .overlay-bubble-body {
          font-size: 22px;
          line-height: 1.35;
          margin-top: 4px;
          word-break: break-word;
        }
        .overlay-bubble-body a {
          color: #c084fc;
          word-break: break-all;
        }
        @keyframes slide-in {
          from { transform: translateX(30px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fade-out {
          to { opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default Overlay;
