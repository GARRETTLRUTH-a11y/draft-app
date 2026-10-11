"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type LeagueHub = {
  id: string;
  name: string;
  user_id: string;
};

export function LeagueWorkspace({ leagueId }: { leagueId: string }) {
  const [league, setLeague] = useState<LeagueHub | null>(null);
  const [linkedSeasonId, setLinkedSeasonId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadLeague() {
      setIsLoading(true);
      setMessage("");

      const { data: userData } = await supabase.auth.getUser();
      setCurrentUserId(userData.user?.id ?? null);

      if (!userData.user) {
        setIsLoading(false);
        return;
      }

      const [leagueResult, linkedSeasonResult] = await Promise.all([
        supabase
          .from("league_hubs")
          .select("id, name, user_id")
          .eq("id", leagueId)
          .single(),
        supabase
          .from("seasons")
          .select("id")
          .eq("season_data->>leagueHubId", leagueId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (leagueResult.error) {
        setMessage(leagueResult.error.message);
      } else {
        setLeague(leagueResult.data as LeagueHub);
        setLinkedSeasonId(linkedSeasonResult.data?.id ?? null);
      }

      setIsLoading(false);
    }

    loadLeague();
  }, [leagueId]);

  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(circle_at_22%_0%,rgba(245,158,11,0.16),transparent_44%),radial-gradient(circle_at_82%_8%,rgba(34,211,238,0.15),transparent_42%)]" />

      <section className="relative mx-auto max-w-7xl px-5 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-col gap-5 rounded-3xl border border-white/10 bg-slate-900/75 px-5 py-5 shadow-2xl backdrop-blur sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.24em] text-cyan-300">
              CFB League Hub
            </p>
            <p className="mt-1 text-xs text-slate-400">League workspace</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/league"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              ← Select League
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              League Home
            </Link>
          </div>
        </header>

        {isLoading ? (
          <section className="py-20 text-slate-300">Loading league...</section>
        ) : !currentUserId ? (
          <section className="my-12 rounded-3xl border border-yellow-400/30 bg-yellow-400/10 p-8">
            <h1 className="text-3xl font-black">Sign in to enter this league</h1>
            <p className="mt-3 text-yellow-100">
              League hubs are available to signed-in league members.
            </p>
            <Link
              href={`/login?redirect=/league/${leagueId}`}
              className="mt-6 inline-flex rounded-2xl bg-cyan-400 px-5 py-3 font-black text-slate-950"
            >
              Sign In
            </Link>
          </section>
        ) : message || !league ? (
          <section className="my-12 rounded-3xl border border-red-400/30 bg-red-400/10 p-8">
            <h1 className="text-3xl font-black">League unavailable</h1>
            <p className="mt-3 text-red-100">{message || "That league could not be found."}</p>
          </section>
        ) : (
          <>
            <section className="py-14 sm:py-20">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-black uppercase tracking-[0.27em] text-amber-300">
                  College Football League
                </p>
                {league.user_id === currentUserId ? (
                  <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs font-bold text-cyan-200">
                    Commissioner
                  </span>
                ) : null}
              </div>
              <h1 className="mt-3 text-5xl font-black tracking-[-0.04em] sm:text-7xl">
                {league.name}
              </h1>
              <p className="mt-4 max-w-3xl text-xl leading-8 text-slate-300">
                Choose the part of the league you need today.
              </p>
            </section>

            <section>
              <div className="grid gap-6 lg:grid-cols-2">
                <article className="relative overflow-hidden rounded-[2rem] border border-cyan-400/25 bg-gradient-to-br from-cyan-400/[0.12] via-slate-900 to-slate-900 p-6 shadow-2xl sm:p-8">
                  <div className="absolute right-5 top-3 text-[7rem] font-black leading-none text-cyan-300/[0.055]" aria-hidden>
                    01
                  </div>
                  <div className="relative">
                    <p className="mt-2 text-xs font-black uppercase tracking-[0.24em] text-cyan-300">
                      Draft Phase
                    </p>
                    <h2 className="mt-2 text-3xl font-black">Live Draft</h2>
                    <p className="mt-4 max-w-xl leading-7 text-slate-300">
                      Open saved draft rooms, create a new draft, and run live
                      team selections with the league.
                    </p>
                    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                      <Link
                        href="/rooms"
                        className="rounded-2xl bg-cyan-400 px-5 py-3.5 text-center font-black text-slate-950 transition hover:bg-cyan-300"
                      >
                        Enter Draft Rooms →
                      </Link>
                      <Link
                        href="/create"
                        className="rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-5 py-3.5 text-center font-black text-cyan-100 transition hover:bg-cyan-300/20"
                      >
                        Create New Draft
                      </Link>
                    </div>
                  </div>
                </article>

                <article className="relative overflow-hidden rounded-[2rem] border border-amber-300/25 bg-gradient-to-br from-amber-300/[0.12] via-slate-900 to-slate-900 p-6 shadow-2xl sm:p-8">
                  <div className="absolute right-5 top-3 text-[7rem] font-black leading-none text-amber-200/[0.055]" aria-hidden>
                    02
                  </div>
                  <div className="relative">
                    <p className="mt-2 text-xs font-black uppercase tracking-[0.24em] text-amber-300">
                      In-Season Phase
                    </p>
                    <h2 className="mt-2 text-3xl font-black">Commissioner Management</h2>
                    <p className="mt-4 max-w-xl leading-7 text-slate-300">
                      Open the active season to manage weekly readiness,
                      extensions, reminders, Discord, and league operations.
                    </p>
                    <div className="mt-8">
                      <Link
                        href={
                          linkedSeasonId
                            ? `/season/room/${linkedSeasonId}`
                            : `/season?league=${leagueId}`
                        }
                        className="block rounded-2xl bg-amber-300 px-5 py-3.5 text-center font-black text-slate-950 transition hover:bg-amber-200 sm:inline-block"
                      >
                        {linkedSeasonId ? "Open League Control →" : "Set Up Commissioner Hub →"}
                      </Link>
                    </div>
                  </div>
                </article>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
