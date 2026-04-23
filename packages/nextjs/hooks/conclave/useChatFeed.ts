"use client";

import { useEffect, useRef, useState } from "react";
import { ChatEvent, chatWsUrl, fetchRecentChat } from "~~/utils/conclave/chat";

/**
 * Loads recent chat history, then keeps it live via WebSocket. Dedupe by id
 * so the seed fetch and the WS event don't double-up a message posted while
 * we were connecting.
 */
export function useChatFeed() {
  const [messages, setMessages] = useState<ChatEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const pushMessage = (m: ChatEvent) => {
      if (seenIds.current.has(m.id)) return;
      seenIds.current.add(m.id);
      setMessages(prev => [...prev, m]);
    };

    (async () => {
      const recent = await fetchRecentChat();
      if (cancelled) return;
      for (const m of recent) pushMessage(m);
    })();

    const connect = () => {
      const url = chatWsUrl();
      if (!url) return;
      try {
        socket = new WebSocket(url);
      } catch {
        return;
      }
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        socket = null;
        if (cancelled) return;
        reconnectTimeout = setTimeout(connect, 2000);
      };
      socket.onerror = () => {
        socket?.close();
      };
      socket.onmessage = ev => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === "chat") pushMessage(data as ChatEvent);
        } catch {
          // ignore non-JSON frames
        }
      };
    };
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      socket?.close();
    };
  }, []);

  return { messages, connected };
}
