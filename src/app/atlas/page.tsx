import { Shell } from "@/components/Shell";
import { Atlas } from "@/components/Atlas";

export const metadata = {
  title: "Builder Atlas · Registrai",
  description:
    "Builder density by country. Progress and volume read from chain; country self-declared.",
};

export default function AtlasPage() {
  return (
    <Shell>
      <div className="pt-12">
        <Atlas />
      </div>
    </Shell>
  );
}
