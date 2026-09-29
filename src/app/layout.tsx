import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Instrument_Serif, Instrument_Sans } from "next/font/google";
import { Providers } from "@/components/Providers";
import { REGISTRAI_X_HANDLE } from "@/lib/regi";
import "./globals.css";
import "./paper.css";
import "../styles/paper-ui.css";

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
  "Registrai supports project builders on any chain: a verified builder registry on Arc and bonded, public proof of what they ship. No token launch needed.";

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
    images: [{ url: "/social/registrai-landing-builders.png", width: 1200, height: 630, alt: "Registrai: launchpads sell promises, Registrai shows proof. Verified builders on any chain, built on Arc." }],
  },
  twitter: {
    card: "summary_large_image",
    site: `@${REGISTRAI_X_HANDLE}`,
    creator: `@${REGISTRAI_X_HANDLE}`,
    title: TITLE,
    description: DESCRIPTION,
    images: ["/social/registrai-landing-builders.png"],
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
