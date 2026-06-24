"use client";

import Link from "next/link";

const STEPS = [
  { slug: "drafters", label: "1. Drafters" },
  { slug: "odds", label: "2. Odds" },
  { slug: "lottery", label: "3. Lottery" },
  { slug: "teams", label: "4. Teams" },
  { slug: "summary", label: "5. Summary" },
];

export function WizardSteps({
  draftId,
  current,
}: {
  draftId: string;
  current: string;
}) {
  return (
    <nav className="grid gap-2 rounded-3xl border border-white/10 bg-white/5 p-3 sm:grid-cols-5">
      {STEPS.map((step) => (
        <Link
          key={step.slug}
          href={`/create/${draftId}/${step.slug}`}
          className={`rounded-2xl px-4 py-3 text-center text-sm font-black transition ${
            current === step.slug
              ? "bg-cyan-400 text-slate-950"
              : "bg-white/10 text-white hover:bg-white/15"
          }`}
        >
          {step.label}
        </Link>
      ))}
    </nav>
  );
}
