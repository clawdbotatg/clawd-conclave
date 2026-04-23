import { ScaffoldEthAppWithProviders } from "~~/components/ScaffoldEthAppWithProviders";

/**
 * Wraps all conclave pages that should get the full SE-2 chrome
 * (Header, Footer, wagmi, RainbowKit, toasts, progress bar). The `/overlay`
 * route is deliberately OUTSIDE this group — it runs with a transparent
 * background inside OBS, so we want none of this.
 */
export default function ChromeLayout({ children }: { children: React.ReactNode }) {
  return <ScaffoldEthAppWithProviders>{children}</ScaffoldEthAppWithProviders>;
}
