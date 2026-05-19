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

// Custom Phantom wallet entry.
//
// Phantom does NOT support WalletConnect v2 for EVM on mobile — per Phantom's
// docs, deeplinks are Solana-only, and EVM mobile support is exclusively via
// their in-app browser's injected provider. A `phantom://wc?uri=...` handoff
// is silently dropped, which is why earlier attempts opened Phantom but
// showed no connect prompt.
//
// Strategy:
//   - Inside Phantom's in-app browser (or with the desktop extension):
//     `window.phantom.ethereum` is injected → use wagmi's `injected` connector.
//   - On regular mobile browsers (Safari/Chrome): deeplink to
//     `https://phantom.app/ul/browse/<dapp>?ref=<origin>`, which opens our
//     dApp inside Phantom's in-app browser where the injected path takes over.
//   - On desktop without the extension: show install instructions (no QR,
//     since Phantom mobile cannot complete a WC EVM session).
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
      // Ignore the WC URI input; Phantom can't consume it for EVM. Hand the
      // user off to Phantom's in-app browser at our dApp URL instead.
      getUri: useInjected
        ? undefined
        : () => {
            const dapp = typeof window !== "undefined" ? window.location.href : "https://conclave.larv.ai";
            const ref = typeof window !== "undefined" ? window.location.origin : "https://conclave.larv.ai";
            return `https://phantom.app/ul/browse/${encodeURIComponent(dapp)}?ref=${encodeURIComponent(ref)}`;
          },
    },
    extension: {
      instructions: {
        learnMoreUrl: "https://phantom.app/learn",
        steps: [
          {
            description: "Install the Phantom browser extension for Chrome, Brave, Firefox, or Edge.",
            step: "install",
            title: "Install the Phantom extension",
          },
          {
            description: "Create a new wallet or import an existing one.",
            step: "create",
            title: "Create or import a wallet",
          },
          {
            description: "Once the extension is set up, refresh this page and tap Phantom again.",
            step: "refresh",
            title: "Refresh this page",
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
      : // Non-injected path: the user will be deeplinked into Phantom's in-app
        // browser before this connector is ever exercised. We still need a
        // valid factory for RainbowKit's wiring — WC is the lightest option.
        getWalletConnectConnector({ projectId: params.projectId }),
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
