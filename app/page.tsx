"use client";

import Image from "next/image";
import Link from "next/link";
import { CompactDraftBoard } from "@/components/CompactDraftBoard";
import type { ItemTier } from "@/lib/draftBoard";

type ExampleTeam = {
  id: number;
  name: string;
  category: string;
  description: string;
  color: string;
  drafter?: string;
};

const EXAMPLE_TIERS: ItemTier<ExampleTeam>[] = [
  {
    tier: "Power Conferences",
    groups: [
      {
        category: "SEC",
        items: [
          { id: 1, name: "Alabama", category: "SEC", description: "", color: "#9E1B32", drafter: "Garrett" },
          { id: 2, name: "Georgia", category: "SEC", description: "", color: "#BA0C2F" },
          { id: 3, name: "LSU", category: "SEC", description: "", color: "#461D7C" },
        ],
      },
      {
        category: "Big Ten",
        items: [
          { id: 4, name: "Ohio State", category: "Big Ten", description: "", color: "#BB0000", drafter: "Chris" },
          { id: 5, name: "Michigan", category: "Big Ten", description: "", color: "#00274C" },
          { id: 6, name: "Oregon", category: "Big Ten", description: "", color: "#154733" },
        ],
      },
      {
        category: "Big 12",
        items: [
          { id: 7, name: "Texas Tech", category: "Big 12", description: "", color: "#CC0000", drafter: "Tyler" },
          { id: 8, name: "Kansas State", category: "Big 12", description: "", color: "#512888" },
          { id: 9, name: "BYU", category: "Big 12", description: "", color: "#002E5D" },
        ],
      },
    ],
  },
  {
    tier: "Group of Five",
    groups: [
      {
        category: "American",
        items: [
          { id: 10, name: "Tulane", category: "American", description: "", color: "#006747" },
          { id: 11, name: "Memphis", category: "American", description: "", color: "#003087", drafter: "John" },
        ],
      },
      {
        category: "Sun Belt",
        items: [
          { id: 12, name: "James Madison", category: "Sun Belt", description: "", color: "#450084" },
          { id: 13, name: "Coastal Carolina", category: "Sun Belt", description: "", color: "#006A65" },
        ],
      },
    ],
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8">
        <header className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/5 px-6 py-5">
          <div className="flex items-center gap-4">
            <Image
              src="/logo-icon.png"
              alt="CFB Draft"
              width={48}
              height={48}
              className="rounded-xl"
            />
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
                CFB Draft Tool
              </p>
              <p className="mt-1 text-sm text-slate-400">
                Live college football team drafts for your group.
              </p>
            </div>
          </div>

          <Link
            href="/create"
            className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
          >
            Create Draft
          </Link>
        </header>

        <div className="grid flex-1 items-center gap-10 py-16 lg:grid-cols-[1.1fr_0.9fr]">
          <section>
            <div className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-200">
              Every FBS team, drafted live
            </div>

            <h1 className="mt-6 text-5xl font-black tracking-tight md:text-7xl">
              Run a live college football team draft with your group.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Set lottery odds, choose which teams are eligible across every
              conference, then invite players to log in, claim a name, and
              make their own picks on a live, conference-organized draft
              board.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/create"
                className="rounded-2xl bg-cyan-400 px-6 py-4 text-center font-black text-slate-950 transition hover:bg-cyan-300"
              >
                Start a Draft
              </Link>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl">
            <div className="rounded-3xl border border-cyan-400/20 bg-slate-900 p-6">
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-300">
                Example Draft Board
              </p>

              <h2 className="mt-4 text-3xl font-black">
                College Football Team Draft
              </h2>

              <div className="mt-6">
                <CompactDraftBoard
                  tiers={EXAMPLE_TIERS}
                  getStatus={(item) =>
                    item.drafter
                      ? { variant: "taken", badge: item.drafter }
                      : { variant: "available" }
                  }
                  legend={[
                    { label: "Drafted", swatchClassName: "bg-green-400/20" },
                    { label: "Available", swatchClassName: "bg-white/10" },
                  ]}
                />
              </div>
            </div>
          </section>
        </div>

        <section className="grid gap-4 pb-10 md:grid-cols-4">
          {[
            [
              "Full FBS Coverage",
              "Every FBS team across all conferences, including the Pac-12.",
            ],
            [
              "Team Eligibility",
              "Exclude any team or whole conference before the draft starts.",
            ],
            [
              "Live Player Picks",
              "Invite players to log in, claim a name, and pick on their turn.",
            ],
            [
              "Conference-Organized Board",
              "A condensed, color-coded board grouped by conference.",
            ],
          ].map(([title, text]) => (
            <div
              key={title}
              className="rounded-3xl border border-white/10 bg-white/5 p-6"
            >
              <h3 className="text-xl font-black">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-400">{text}</p>
            </div>
          ))}
        </section>
      </section>
    </main>
  );
}
