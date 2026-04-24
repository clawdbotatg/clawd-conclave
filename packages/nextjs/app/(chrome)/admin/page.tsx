"use client";

import { useEffect, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import toast from "react-hot-toast";
import { useAdminAuth } from "~~/hooks/conclave/useAdminAuth";
import { AdminStatus, fetchAdminStatus } from "~~/utils/conclave/admin";

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const Admin: NextPage = () => {
  const { address, isAdmin, isSignedIn, token, loading, isSigning, error, signIn, signOut } = useAdminAuth();
  const [status, setStatus] = useState<AdminStatus | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const s = await fetchAdminStatus(token);
      if (!cancelled) setStatus(s);
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token]);

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Couldn't copy — select + cmd-c");
    }
  };

  // --- gate: not connected ---
  if (loading) {
    return (
      <div className="flex grow items-center justify-center p-8">
        <span className="loading loading-dots loading-md" />
      </div>
    );
  }
  if (!address) {
    return (
      <div className="flex flex-col grow items-center justify-center p-8 text-center">
        <h1 className="text-3xl font-bold mb-3">Admin</h1>
        <p className="text-base-content/60 max-w-md">Connect your wallet with the button in the top right.</p>
      </div>
    );
  }

  // --- gate: connected but not an admin ---
  if (!isAdmin) {
    return (
      <div className="flex flex-col grow items-center justify-center p-8 text-center">
        <h1 className="text-3xl font-bold mb-3">Admin</h1>
        <p className="text-base-content/60 max-w-md">
          Your address is not in the admin allowlist. If you think this is wrong, check <code>ADMIN_ADDRESSES</code> on
          the relay.
        </p>
        <div className="mt-4">
          <Address address={address} />
        </div>
      </div>
    );
  }

  // --- gate: admin but not signed in yet ---
  if (!isSignedIn) {
    return (
      <div className="flex flex-col grow items-center justify-center p-8 text-center">
        <h1 className="text-3xl font-bold mb-3">Admin sign-in</h1>
        <p className="text-base-content/60 max-w-md mb-6">
          Sign in with your wallet to unlock the admin dashboard. Wallet signature, no password. Session lasts 24 hours.
        </p>
        <button className="btn btn-primary" onClick={signIn} disabled={isSigning}>
          {isSigning ? "Signing…" : "Sign in as admin"}
        </button>
        {error && <div className="mt-3 text-sm text-error">{error}</div>}
      </div>
    );
  }

  // --- authenticated dashboard ---
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Admin</h1>
        <button className="btn btn-ghost btn-sm" onClick={signOut}>
          Sign out
        </button>
      </div>

      {status === null ? (
        <div className="flex items-center justify-center py-10">
          <span className="loading loading-dots loading-md" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Publishing */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <h2 className="card-title">Publishing</h2>
                <div className={`badge ${status.publishing.ready ? "badge-error animate-pulse" : "badge-neutral"}`}>
                  {status.publishing.ready ? "LIVE" : "offline"}
                </div>
              </div>
              <dl className="text-sm space-y-1 mt-2">
                <div className="flex justify-between">
                  <dt className="text-base-content/60">Tracks</dt>
                  <dd>{status.publishing.tracks.join(", ") || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-base-content/60">Source</dt>
                  <dd>{status.publishing.source ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-base-content/60">Received</dt>
                  <dd>{formatBytes(status.publishing.inboundBytes)}</dd>
                </div>
              </dl>
            </div>
          </div>

          {/* WebRTC */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <h2 className="card-title">WebRTC viewers</h2>
                <div className={`badge ${status.webrtc.rtcPathReady ? "badge-success" : "badge-neutral"}`}>
                  {status.webrtc.rtcPathReady ? "ready" : "not ready"}
                </div>
              </div>
              <dl className="text-sm space-y-1 mt-2">
                <div className="flex justify-between">
                  <dt className="text-base-content/60">RTC tracks</dt>
                  <dd>{status.webrtc.rtcTracks.join(", ") || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-base-content/60">Active viewers</dt>
                  <dd className="font-bold">{status.webrtc.activeViewers}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-base-content/60">Sent to viewers</dt>
                  <dd>{formatBytes(status.webrtc.bytesSent)}</dd>
                </div>
              </dl>
            </div>
          </div>

          {/* Chat */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title">Chat</h2>
              <dl className="text-sm space-y-1 mt-2">
                <div className="flex justify-between">
                  <dt className="text-base-content/60">WebSocket clients</dt>
                  <dd className="font-bold">{status.chat.wsClients}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-base-content/60">Cost per post</dt>
                  <dd>{status.chat.chatCvCost} CV</dd>
                </div>
              </dl>
            </div>
          </div>

          {/* OBS setup */}
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title">OBS setup</h2>
              <p className="text-xs text-base-content/60 mt-1">Custom service in OBS → Settings → Stream.</p>
              <div className="mt-2 space-y-2">
                <div>
                  <div className="text-xs text-base-content/60">Server</div>
                  <div className="flex gap-2">
                    <code className="font-mono text-xs bg-base-200 px-2 py-1 rounded grow break-all">
                      {status.obs.rtmpUrl}
                    </code>
                    <button className="btn btn-ghost btn-xs" onClick={() => copy("Server URL", status.obs.rtmpUrl)}>
                      copy
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-base-content/60">Stream key (format)</div>
                  <code className="font-mono text-xs bg-base-200 px-2 py-1 rounded block break-all">
                    {status.obs.streamKeyHint}
                  </code>
                  <div className="text-xs text-base-content/60 mt-1">{status.obs.note}</div>
                </div>
              </div>
            </div>
          </div>

          {/* MediaMTX */}
          <div className="card bg-base-100 shadow md:col-span-2">
            <div className="card-body flex-row justify-between items-center py-3">
              <div>
                <div className="text-xs text-base-content/60">MediaMTX admin API</div>
                <div className={`badge badge-sm ${status.mediamtxReachable ? "badge-success" : "badge-error"}`}>
                  {status.mediamtxReachable ? "reachable" : "unreachable"}
                </div>
              </div>
              <div className="text-xs text-base-content/60">
                Auto-refresh every 5s · Admin:{" "}
                <Address address={status.admin as `0x${string}`} size="xs" onlyEnsOrAddress />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin;
