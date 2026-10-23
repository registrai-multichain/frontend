import type { Metadata } from "next";

const TITLE = "Bridge USDC | Registrai";
const DESCRIPTION =
  "Move native USDC across 11 Circle CCTP networks and 110 routes, including Arc.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/bridge" },
  openGraph: {
    type: "website",
    siteName: "Registrai",
    url: "https://registrai.cc/bridge/",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/social/registrai-bridge.png",
        width: 1200,
        height: 630,
        alt: "Registrai Bridge · One USDC. Every direction.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/social/registrai-bridge.png"],
  },
};

export default function BridgeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
