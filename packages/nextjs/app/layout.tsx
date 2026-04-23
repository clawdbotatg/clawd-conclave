import "@rainbow-me/rainbowkit/styles.css";
import "@scaffold-ui/components/styles.css";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

export const metadata = getMetadata({
  title: "CLAWD Conclave",
  description: "Token-gated live conclave for $CLAWD stakers",
});

/**
 * Root layout intentionally has NO wallet / Header / Footer / Toaster. Those
 * live in the `(chrome)` route group so the `/overlay` route (rendered by
 * OBS as a transparent browser source) doesn't inherit them.
 */
const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html suppressHydrationWarning>
      <body>
        <ThemeProvider enableSystem>{children}</ThemeProvider>
      </body>
    </html>
  );
};

export default RootLayout;
