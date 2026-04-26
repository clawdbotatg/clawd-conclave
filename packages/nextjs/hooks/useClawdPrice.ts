"use client";

import { useEffect, useState } from "react";
import { useFetchNativeCurrencyPrice } from "@scaffold-ui/hooks";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import scaffoldConfig from "~~/scaffold.config";

const UNISWAP_V4_STATE_VIEW = "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71" as const;
const CLAWD_POOL_ID = "0x9fd58e73d8047cb14ac540acd141d3fc1a41fb6252d674b730faf62fe24aa8ce" as const;

const stateViewAbi = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
] as const;

export function useClawdPrice(): number {
  const { price: ethPrice } = useFetchNativeCurrencyPrice();
  const [clawdPrice, setClawdPrice] = useState(0);

  useEffect(() => {
    if (!ethPrice) return;

    const client = createPublicClient({
      chain: base,
      transport: http(`https://base-mainnet.g.alchemy.com/v2/${scaffoldConfig.alchemyApiKey}`),
    });

    const fetchPrice = async () => {
      try {
        const slot0 = await client.readContract({
          address: UNISWAP_V4_STATE_VIEW,
          abi: stateViewAbi,
          functionName: "getSlot0",
          args: [CLAWD_POOL_ID],
        });
        const sqrtPriceX96 = slot0[0];
        const Q96 = BigInt(2) ** BigInt(96);
        const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
        const clawdPerWeth = sqrtPrice * sqrtPrice;
        if (clawdPerWeth === 0) return;
        setClawdPrice((1 / clawdPerWeth) * ethPrice);
      } catch {
        // leave previous value on transient error
      }
    };

    fetchPrice();
    const id = setInterval(fetchPrice, 30_000);
    return () => clearInterval(id);
  }, [ethPrice]);

  return clawdPrice;
}
