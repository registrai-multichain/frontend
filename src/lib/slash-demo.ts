import type { Address } from "viem";

// Feeds surfaced in the Slash Lab. The first is a real, completed slash (an
// agent that attested a nonsense value, got challenged, and lost its bond
// permanently) read live from chain as proof. The second is the live keeper
// feed whose fresh attestations anyone can challenge.
export interface SlashFeed {
  feedId: `0x${string}`;
  agent: Address;
  label: string;
  blurb: string;
}

export const SLASH_FEEDS: SlashFeed[] = [
  {
    feedId: "0x08bcb3e1c467883ceb1fe37e70fadf09a7a4bb53ca575deb49d9628c7f3c06c5",
    agent: "0x84C799941C6B69AbB296EC46a02E4e0772Ad2E5e",
    label: "Slashed agent (real)",
    blurb:
      "This agent attested a nonsense value, was challenged, and the neutral resolver ruled it invalid. Its bond was slashed to the challenger and the agent is permanently disabled. Read live from chain.",
  },
  {
    feedId: "0x4f655dfefcda88cfbd911d709fa740038b5d7e9e4d74e0f3aa280ccf8d98152c",
    agent: "0x84C799941C6B69AbB296EC46a02E4e0772Ad2E5e",
    label: "BTC/USD (live keeper)",
    blurb:
      "Fresh attestations posted by the autonomous keeper. Anyone can challenge one with a matching stake; if the resolver rules it invalid, the agent's bond is slashed to the challenger.",
  },
];
