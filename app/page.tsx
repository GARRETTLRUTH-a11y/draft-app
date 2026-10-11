import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { HomeDraftPreview } from "@/components/HomeDraftPreview";

export const metadata: Metadata = {
  title: "CFB League Commissioner Hub",
  description:
    "A home for college football leagues to run live drafts and manage every week of the season.",
};

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.17),transparent_45%),radial-gradient(circle_at_80%_10%,rgba(245,158,11,0.12),transparent_42%)]" />

      <section className="relative mx-auto flex max-w-7xl flex-col px-5 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-col gap-5 rounded-3xl border border-white/10 bg-slate-900/75 px-5 py-5 shadow-2xl backdrop-blur sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <Link href="/" className="flex items-center gap-4">
            <Image
              src="/logo-icon.png"
              alt="CFB League Hub"
              width={48}
              height={48}
              className="rounded-xl"
              priority
            />
            <div>
              <p className="text-sm font-black uppercase tracking-[0.26em] text-cyan-300">
                CFB League Hub
              </p>
              <p className="mt-1 text-sm text-slate-400">
                League commissioner assistant
              </p>
            </div>
          </Link>

          <nav className="flex flex-wrap gap-2 text-sm font-bold">
            <Link
              href="/league#new-league"
              className="rounded-xl px-4 py-2.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              Create a League
            </Link>
            <Link
              href="/league#your-leagues"
              className="rounded-xl bg-cyan-400 px-4 py-2.5 text-slate-950 transition hover:bg-cyan-300"
            >
              Enter League Hub
            </Link>
          </nav>
        </header>

        <div className="grid items-center gap-10 py-16 lg:grid-cols-[1.04fr_0.96fr] lg:py-24">
          <section>
            <div className="inline-flex rounded-full border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-sm font-black text-amber-200">
              From draft night through every weekly advance
            </div>

            <h1 className="mt-6 max-w-4xl text-5xl font-black tracking-[-0.04em] sm:text-6xl lg:text-7xl">
              One home for your entire college football league.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Organize each league in its own hub. Run the live team
              draft, then move directly into weekly commissioner management,
              player readiness, extensions, reminders, and Discord updates.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/league#new-league"
                className="rounded-2xl bg-cyan-400 px-6 py-4 text-center font-black text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-300"
              >
                Create a League →
              </Link>
              <Link
                href="/league#your-leagues"
                className="rounded-2xl border border-white/15 bg-white/5 px-6 py-4 text-center font-black text-white transition hover:bg-white/10"
              >
                Enter Existing League Hub
              </Link>
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-4 shadow-2xl backdrop-blur sm:p-6">
            <div className="rounded-[1.6rem] border border-white/10 bg-slate-900/90 p-6 sm:p-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">
                    League Operations
                  </p>
                  <h2 className="mt-2 text-2xl font-black">A full-season workspace</h2>
                </div>
                <span className="rounded-full border border-green-400/25 bg-green-400/10 px-3 py-1 text-xs font-bold text-green-200">
                  Active
                </span>
              </div>

              <div className="mt-7 space-y-3">
                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.08] p-5">
                  <div className="flex items-center gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-400 font-black text-slate-950">01</span>
                    <div>
                      <p className="font-black">Live Draft</p>
                      <p className="mt-1 text-sm text-slate-400">Lottery, team pool, draft order, and live picks.</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center text-xl text-slate-600">↓</div>

                <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] p-5">
                  <div className="flex items-center gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-300 font-black text-slate-950">02</span>
                    <div>
                      <p className="font-black">In-Season Management</p>
                      <p className="mt-1 text-sm text-slate-400">Weekly check-ins, extensions, reminders, and Discord.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <section id="league-hub" className="scroll-mt-6 border-t border-white/10 py-16">
          <div className="max-w-3xl">
            <p className="text-sm font-black uppercase tracking-[0.26em] text-amber-300">League Hub</p>
            <h2 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
              Start with your league—not with a tool
            </h2>
            <p className="mt-4 text-lg leading-8 text-slate-400">
              Create a league once or select one that already exists. After
              entering that league, choose its Live Draft or In-Season
              Management workspace.
            </p>
          </div>

          <div className="mt-8 grid max-w-4xl gap-4 md:grid-cols-2">
            <Link
              href="/league#new-league"
              className="group rounded-[2rem] border border-cyan-400/25 bg-cyan-400/[0.07] p-6 transition hover:-translate-y-0.5 hover:border-cyan-300/50 sm:p-8"
            >
              <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-300">New League</p>
              <h3 className="mt-3 text-3xl font-black">Create a League</h3>
              <p className="mt-3 leading-7 text-slate-400">
                Name a new league and become its commissioner.
              </p>
              <div className="mt-7 font-black text-cyan-200 group-hover:text-cyan-100">Create League →</div>
            </Link>

            <Link
              href="/league#your-leagues"
              className="group rounded-[2rem] border border-amber-300/25 bg-amber-300/[0.07] p-6 transition hover:-translate-y-0.5 hover:border-amber-200/50 sm:p-8"
            >
              <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">Existing League</p>
              <h3 className="mt-3 text-3xl font-black">Enter League Hub</h3>
              <p className="mt-3 leading-7 text-slate-400">
                Select a created league, then choose the tool you need.
              </p>
              <div className="mt-7 font-black text-amber-200 group-hover:text-amber-100">Select League →</div>
            </Link>
          </div>
        </section>

        <section className="grid gap-8 border-t border-white/10 py-16 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.26em] text-cyan-300">
              Still built for draft night
            </p>
            <h2 className="mt-3 text-4xl font-black tracking-tight">
              The original draft board is now one part of the league hub.
            </h2>
            <p className="mt-5 leading-7 text-slate-400">
              Build the eligible team pool, organize programs by conference,
              run the order, and let every player make their own live pick.
              When the draft ends, the same group can move into the in-season
              commissioner workspace.
            </p>
            <Link
              href="/league#your-leagues"
              className="mt-7 inline-flex rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-5 py-3 font-black text-cyan-200 transition hover:bg-cyan-400/20"
            >
              Enter Through League Hub →
            </Link>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-2xl sm:p-6">
            <div className="rounded-3xl border border-cyan-400/20 bg-slate-900 p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">
                    Draft Module
                  </p>
                  <h3 className="mt-2 text-2xl font-black">Live Team Board</h3>
                </div>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-slate-300">
                  Example
                </span>
              </div>

              <div className="mt-5">
                <HomeDraftPreview />
              </div>
            </div>
          </div>
        </section>

        <footer className="flex flex-col gap-3 border-t border-white/10 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>CFB League Hub</span>
          <span>Draft tools + in-season commissioner management</span>
        </footer>
      </section>
    </main>
  );
}
