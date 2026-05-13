"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { type Address, isAddress } from "viem";
import { Shell } from "@/components/Shell";
import { useWallet } from "@/components/WalletProvider";
import { PositionsTab } from "@/components/profile/PositionsTab";
import { CreatorTab } from "@/components/profile/CreatorTab";
import { DeployerTab } from "@/components/profile/DeployerTab";
import { addrUrl } from "@/lib/chain";
import { shortAddr } from "@/lib/format";

type Tab = "trader" | "creator" | "deployer";

function ProfilePage() {
  const params = useSearchParams();
  const overrideAddr = params?.get("addr");
  const { address: connected, connect } = useWallet();
  const [tab, setTab] = useState<Tab>("trader");

  const subjectAddr: Address | undefined =
    overrideAddr && isAddress(overrideAddr)
      ? (overrideAddr as Address)
      : connected;
  const isSelf = !overrideAddr && !!connected;

  if (!subjectAddr) {
    return (
      <Shell>
        <article className="pt-16 sm:pt-24 fade-up text-center">
          <div className="caption mb-4">profile</div>
          <h1 className="font-serif text-[34px] sm:text-[44px] tracking-tightest leading-[1.05] mb-6">
            Connect a wallet to see <span className="italic text-accent">your dashboard</span>.
          </h1>
          <p className="text-fg-mute text-[14px] max-w-[52ch] mx-auto mb-8">
            Your profile shows the positions you hold, the markets you&apos;ve
            created, and the agents you operate — plus every fee dollar you&apos;ve
            earned along the way.
          </p>
          <button
            onClick={connect}
            className="px-5 py-3 border border-accent/60 text-accent text-[12.5px] tracking-wide hover:bg-accent hover:text-bg transition-colors"
          >
            connect wallet →
          </button>
        </article>
      </Shell>
    );
  }

  return (
    <Shell>
      <article className="pt-10 sm:pt-14 fade-up">
        {/* Header */}
        <div className="mb-8">
          <div className="caption mb-3">profile {isSelf && "· you"}</div>
          <h1 className="font-serif text-[28px] sm:text-[36px] tracking-tightest leading-[1.1]">
            {isSelf ? "Your dashboard" : `Profile · ${shortAddr(subjectAddr)}`}
          </h1>
          <div className="mt-3 flex items-center gap-3 text-2xs text-fg-mute">
            <a
              href={addrUrl(subjectAddr)}
              target="_blank"
              rel="noreferrer"
              className="border border-line px-2 py-1 hover:border-accent hover:text-accent transition-colors tnum"
            >
              {shortAddr(subjectAddr)} ↗
            </a>
            {!isSelf && connected && (
              <a href="/profile/" className="hover:text-accent transition-colors">
                view your own →
              </a>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-3 gap-px bg-line mb-10">
          <TabButton
            label="trader"
            description="positions"
            active={tab === "trader"}
            onClick={() => setTab("trader")}
          />
          <TabButton
            label="creator"
            description="your markets"
            active={tab === "creator"}
            onClick={() => setTab("creator")}
          />
          <TabButton
            label="deployer"
            description="your agents"
            active={tab === "deployer"}
            onClick={() => setTab("deployer")}
          />
        </div>

        {tab === "trader" && <PositionsTab address={subjectAddr} />}
        {tab === "creator" && <CreatorTab address={subjectAddr} />}
        {tab === "deployer" && <DeployerTab address={subjectAddr} />}
      </article>
    </Shell>
  );
}

function TabButton({
  label,
  description,
  active,
  onClick,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`bg-bg px-4 py-4 text-left transition-colors ${
        active
          ? "border-l border-r border-t border-accent text-accent"
          : "text-fg-mute hover:text-fg"
      }`}
    >
      <div className="caption mb-1">{label}</div>
      <div className="text-[13px] text-fg">{description}</div>
    </button>
  );
}

export default function ProfilePageWrapper() {
  return (
    <Suspense fallback={null}>
      <ProfilePage />
    </Suspense>
  );
}
