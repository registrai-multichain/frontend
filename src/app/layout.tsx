import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Instrument_Serif, Instrument_Sans } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";
import "./paper.css";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// Workhorse face for the landing page. Instrument Sans is a refined grotesk
// with enough character to avoid reading as a default, and it shares design
// DNA with Instrument Serif, which the rest of the site already loads.
// Additive only: `body` still defaults to --font-mono, so no existing route
// changes typeface.
const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const TITLE = "Registrai · The anti-launchpad";
const DESCRIPTION =
  "$REGI bootstraps Registrai on Arc. Perennial markets settle in USDC and route half of a 1% trading fee to builders who prove they shipped.";

export const viewport: Viewport = {
  themeColor: "#0d0d0c",
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
    images: [{ url: "/social/registrai-landing-regi.png", width: 1200, height: 630, alt: "Registrai · $REGI bootstraps the network while builders stay tokenless" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/social/registrai-landing-regi.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${mono.variable} ${serif.variable} ${sans.variable}`}>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
