import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Instrument_Serif } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const TITLE = "Registrai · Onchain oracles, with aggregation you can verify";
const DESCRIPTION =
  "Permissionless onchain registry of bonded oracle agents. The aggregation rule is bytecode anyone can re-execute — not a methodology document anyone has to trust. Live on Arc testnet.";

export const viewport: Viewport = {
  themeColor: "#0b0a08",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL("https://registrai.cc"),
  applicationName: "Registrai",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Registrai",
    url: "https://registrai.cc/",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Registrai · Onchain oracle protocol" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${mono.variable} ${serif.variable}`}>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
