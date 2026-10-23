import { Newsreader } from "next/font/google";

/** The proposals pages' display face (the approved mockup's Newsreader), loaded
 *  only where these components render. Body text is the site's Instrument Sans
 *  (--font-sans, src/app/layout.tsx), the mockup's body face. */
export const newsreader = Newsreader({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-newsreader",
  display: "swap",
});
