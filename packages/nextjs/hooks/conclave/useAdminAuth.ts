"use client";

import { useCallback, useEffect, useState } from "react";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useSignMessage } from "wagmi";
import {
  checkIsAdmin,
  clearAdminToken,
  fetchSiweNonce,
  getAdminToken,
  logoutAdmin,
  setAdminToken,
  verifySiwe,
} from "~~/utils/conclave/admin";

type State = {
  loading: boolean;
  token: string | null;
  isAdmin: boolean;
  error: string | null;
};

/**
 * Sign-In with Ethereum flow for /admin.
 * - `isAdmin` — is the connected address in ADMIN_ADDRESSES at all?
 * - `token` — is the user authenticated right now?
 * - `signIn()` — triggers the SIWE prompt; on success, stores the token.
 * - `signOut()` — revokes the server session and wipes local storage.
 *
 * Token is scoped by address, so switching wallets requires a new sign-in.
 */
export function useAdminAuth() {
  const { address, chainId } = useAccount();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();
  const [state, setState] = useState<State>({ loading: true, token: null, isAdmin: false, error: null });

  // Hydrate from localStorage + probe the server for admin-ness of the
  // connected address whenever it changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!address) {
        setState({ loading: false, token: null, isAdmin: false, error: null });
        return;
      }
      const token = getAdminToken(address);
      const isAdmin = await checkIsAdmin(address);
      if (cancelled) return;
      setState({ loading: false, token, isAdmin, error: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  const signIn = useCallback(async () => {
    if (!address) return;
    setState(s => ({ ...s, error: null }));

    const nonce = await fetchSiweNonce(address);
    if (!nonce) {
      setState(s => ({ ...s, error: "Couldn't get SIWE nonce from relay" }));
      return;
    }

    const message = createSiweMessage({
      domain: window.location.host,
      address,
      statement: "Sign in to CLAWD Conclave admin.",
      uri: window.location.origin,
      version: "1",
      chainId: chainId ?? 1,
      nonce,
      issuedAt: new Date(),
    });

    let signature: string;
    try {
      signature = await signMessageAsync({ message });
    } catch (err) {
      setState(s => ({ ...s, error: (err as Error).message ?? "User rejected signature" }));
      return;
    }

    const result = await verifySiwe(message, signature);
    if (!result.ok) {
      setState(s => ({ ...s, error: result.error }));
      return;
    }
    setAdminToken(address, result.token);
    setState(s => ({ ...s, token: result.token, error: null }));
  }, [address, chainId, signMessageAsync]);

  const signOut = useCallback(async () => {
    if (!address) return;
    const token = getAdminToken(address);
    if (token) await logoutAdmin(token);
    clearAdminToken(address);
    setState(s => ({ ...s, token: null }));
  }, [address]);

  return {
    address,
    isAdmin: state.isAdmin,
    isSignedIn: Boolean(state.token),
    token: state.token,
    loading: state.loading,
    isSigning,
    error: state.error,
    signIn,
    signOut,
  };
}
