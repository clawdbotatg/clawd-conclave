"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Address, Balance } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatUnits } from "viem";
import { useAccount, useReadContract } from "wagmi";
import {
  CONCLAVE_CV_API_BASE_URL,
  CONCLAVE_TOKEN_ADDRESS,
  CONCLAVE_TOKEN_CHAIN_ID,
  CONCLAVE_TOKEN_SYMBOL,
  erc20BalanceAbi,
} from "~~/utils/conclave/config";

type CvFetchState = { loading: boolean; balance: number | null; error: string | null };

const useCvBalance = (address: string | undefined) => {
  const [state, setState] = useState<CvFetchState>({ loading: false, balance: null, error: null });

  useEffect(() => {
    if (!address) {
      setState({ loading: false, balance: null, error: null });
      return;
    }
    let cancelled = false;
    const load = async () => {
      setState(s => ({ ...s, loading: true, error: null }));
      try {
        const res = await fetch(`${CONCLAVE_CV_API_BASE_URL}/balance?address=${address}`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          balance?: number | string;
        };
        if (cancelled) return;
        if (data.success === false) {
          setState({ loading: false, balance: 0, error: null });
          return;
        }
        const bal = typeof data.balance === "string" ? Number(data.balance) : (data.balance ?? 0);
        setState({ loading: false, balance: Number.isFinite(bal) ? bal : 0, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({ loading: false, balance: null, error: (err as Error).message });
      }
    };
    load();
    const id = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address]);

  return state;
};

const Home: NextPage = () => {
  const { address } = useAccount();

  const { data: tokenBalanceRaw, isLoading: tokenLoading } = useReadContract({
    chainId: CONCLAVE_TOKEN_CHAIN_ID,
    address: CONCLAVE_TOKEN_ADDRESS,
    abi: erc20BalanceAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: tokenDecimals } = useReadContract({
    chainId: CONCLAVE_TOKEN_CHAIN_ID,
    address: CONCLAVE_TOKEN_ADDRESS,
    abi: erc20BalanceAbi,
    functionName: "decimals",
  });

  const tokenBalance =
    tokenBalanceRaw !== undefined && tokenDecimals !== undefined
      ? Number(formatUnits(tokenBalanceRaw as bigint, tokenDecimals as number))
      : null;

  const cv = useCvBalance(address);

  return (
    <div className="flex flex-col grow">
      <div className="flex flex-col items-center pt-16 pb-10 px-5">
        <h1 className="text-center">
          <span className="block text-sm uppercase tracking-[0.3em] text-base-content/60 mb-3">The Conclave</span>
          <span className="block text-5xl md:text-6xl font-bold">CLAWD CONCLAVE</span>
        </h1>
        <p className="max-w-2xl text-center text-base-content/70 mt-6 text-lg">
          A token-gated live broadcast for {CONCLAVE_TOKEN_SYMBOL} stakers. Spend your Conviction to post, vote, and
          summon the agent — every message baked into the stream.
        </p>

        {!address ? (
          <div className="mt-10 text-center">
            <p className="text-base-content/60 mb-4">Connect your wallet to see your conviction.</p>
            <p className="text-sm text-base-content/40">Use the button in the top-right →</p>
          </div>
        ) : (
          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-3xl">
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <div className="text-xs uppercase tracking-wider text-base-content/50">Wallet</div>
                <Address address={address} />
                <div className="mt-2 text-sm text-base-content/60 flex items-center gap-2">
                  <span>ETH balance:</span>
                  <Balance address={address} />
                </div>
              </div>
            </div>

            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <div className="text-xs uppercase tracking-wider text-base-content/50">{CONCLAVE_TOKEN_SYMBOL}</div>
                {tokenLoading ? (
                  <div className="loading loading-dots loading-sm" />
                ) : tokenBalance === null ? (
                  <span className="text-base-content/40">—</span>
                ) : (
                  <div className="text-3xl font-bold">{tokenBalance.toLocaleString()}</div>
                )}
                <div className="text-xs text-base-content/40 mt-1">on-chain holdings</div>
              </div>
            </div>

            <div className="card bg-primary text-primary-content shadow md:col-span-2">
              <div className="card-body">
                <div className="text-xs uppercase tracking-wider opacity-70">Conviction</div>
                {cv.loading ? (
                  <div className="loading loading-dots loading-sm" />
                ) : cv.error ? (
                  <span className="text-sm opacity-70">Could not reach CV API ({cv.error})</span>
                ) : cv.balance === null ? (
                  <span className="opacity-50">—</span>
                ) : (
                  <div className="text-4xl font-bold">
                    {cv.balance.toLocaleString()} <span className="text-lg opacity-70">CV</span>
                  </div>
                )}
                <div className="text-xs opacity-70 mt-1">
                  staked on{" "}
                  <a href="https://larv.ai" target="_blank" rel="noopener noreferrer" className="underline">
                    larv.ai
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-base-300 grow px-5 py-12 flex flex-col items-center">
        <div className="max-w-3xl w-full">
          <h2 className="text-2xl font-bold text-center mb-8">Status</h2>
          <div className="card bg-base-100 shadow">
            <div className="card-body text-center">
              <div className="badge badge-neutral mx-auto">offline</div>
              <p className="mt-3 text-base-content/70">
                The conclave is not live right now. When a session starts, the viewer will open here.
              </p>
              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                <button className="btn btn-primary btn-disabled" disabled>
                  Enter the conclave (phase 1)
                </button>
                <Link href="#" className="btn btn-ghost">
                  How to fork
                </Link>
              </div>
            </div>
          </div>

          <div className="text-center mt-10 text-xs text-base-content/40">
            Open source · self-hostable · token-agnostic — see{" "}
            <Link href="https://github.com/clawdbotatg/clawd-conclave" className="link">
              github.com/clawdbotatg/clawd-conclave
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
