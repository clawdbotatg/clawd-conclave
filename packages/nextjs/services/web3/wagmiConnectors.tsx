import {
  type Wallet,
  type WalletDetailsParams,
  connectorsForWallets,
  getWalletConnectConnector,
} from "@rainbow-me/rainbowkit";
import {
  baseAccount,
  ledgerWallet,
  metaMaskWallet,
  rainbowWallet,
  safeWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { rainbowkitBurnerWallet } from "burner-connector";
import * as chains from "viem/chains";
import { createConnector } from "wagmi";
import { injected } from "wagmi/connectors";
import scaffoldConfig, { type ScaffoldConfig } from "~~/scaffold.config";

const { burnerWalletMode, targetNetworks } = scaffoldConfig as ScaffoldConfig;

const hasOnlyLocalTargetNetworks = targetNetworks.every(network => network.id === (chains.hardhat as chains.Chain).id);
const showBurnerWallet =
  burnerWalletMode !== "disabled" && (burnerWalletMode === "allNetworks" || hasOnlyLocalTargetNetworks);

const isMobileUserAgent = () =>
  typeof navigator !== "undefined" &&
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

const isPhantomInjected = () =>
  typeof window !== "undefined" &&
  Boolean((window as unknown as { phantom?: { ethereum?: unknown } }).phantom?.ethereum);

// Custom Phantom wallet: the built-in RainbowKit phantomWallet is injected-only,
// so it never appears in the connect modal on mobile browsers outside Phantom's
// in-app browser. This config adds a WalletConnect path with a `phantom://wc`
// deeplink so Phantom shows on mobile and falls back to the injected provider
// when the desktop extension is present.
const phantomWallet = (params: { projectId: string }): Wallet => {
  const useInjected = isPhantomInjected();
  return {
    id: "phantom",
    name: "Phantom",
    rdns: "app.phantom",
    iconUrl:
      "https://187760183-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2F-MVOiF6Zqit57q_hxJYp%2Fuploads%2FHEjleywo9QOnfYebBPCZ%2FPhantom_SVG_Icon.svg?alt=media&token=71b80a0a-def7-4f98-ae70-5e0843fdaaec",
    iconBackground: "#9A8AEE",
    installed: useInjected || undefined,
    downloadUrls: {
      android: "https://play.google.com/store/apps/details?id=app.phantom",
      ios: "https://apps.apple.com/app/phantom-solana-wallet/1598432977",
      mobile: "https://phantom.app/download",
      qrCode: "https://phantom.app/download",
      chrome: "https://chrome.google.com/webstore/detail/phantom/bfnaelmomeimhlpmgjnjophhpkkoljpa",
      browserExtension: "https://phantom.app/download",
    },
    mobile: {
      getUri: useInjected ? undefined : (uri: string) => `phantom://wc?uri=${encodeURIComponent(uri)}`,
    },
    qrCode: useInjected
      ? undefined
      : {
          getUri: (uri: string) => uri,
          instructions: {
            learnMoreUrl: "https://phantom.app/learn",
            steps: [
              {
                description: "Install the Phantom app on your phone if you haven't already.",
                step: "install",
                title: "Install Phantom",
              },
              {
                description: "Open Phantom, tap the QR scanner, and scan this code to connect.",
                step: "scan",
                title: "Scan the QR code",
              },
            ],
          },
        },
    createConnector: useInjected
      ? (walletDetails: WalletDetailsParams) =>
          createConnector(config => {
            const injectedConnector = injected({
              target: () => ({
                id: "phantom",
                name: "Phantom",
                provider: (window as unknown as { phantom?: { ethereum?: any } }).phantom?.ethereum,
              }),
            })(config);
            return { ...injectedConnector, ...walletDetails };
          })
      : getWalletConnectConnector({ projectId: params.projectId }),
  };
};

/**
 * wagmi connectors for the wagmi context
 */
export const wagmiConnectors = () => {
  // Only create connectors on client-side to avoid SSR issues
  // TODO: update when https://github.com/rainbow-me/rainbowkit/issues/2476 is resolved
  if (typeof window === "undefined") {
    return [];
  }

  const onMobile = isMobileUserAgent();

  const wallets = [
    metaMaskWallet,
    (params: { projectId: string }) => phantomWallet({ projectId: params.projectId }),
    walletConnectWallet,
    // Ledger Live's mobile flow is broken in the RainbowKit modal — hide it on mobile.
    ...(onMobile ? [] : [ledgerWallet]),
    baseAccount,
    rainbowWallet,
    safeWallet,
    ...(showBurnerWallet ? [rainbowkitBurnerWallet] : []),
  ];

  return connectorsForWallets(
    [
      {
        groupName: "Supported Wallets",
        wallets,
      },
    ],

    {
      appName: "scaffold-eth-2",
      projectId: scaffoldConfig.walletConnectProjectId,
    },
  );
};
