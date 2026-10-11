"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type LeagueHub = {
  id: string;
  name: string;
  user_id: string;
  updated_at: string;
};

export default function LeagueDirectoryPage() {
  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<LeagueHub[]>([]);
  const [leagueName, setLeagueName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadLeagues() {
      setIsLoading(true);
      setMessage("");

      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      setCurrentUserId(user?.id ?? null);
      setUserEmail(user?.email ?? null);

      if (!user) {
        setLeagues([]);
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("league_hubs")
        .select("id, name, user_id, updated_at")
        .order("name", { ascending: true });

      if (error) {
        setMessage(
          error.message.includes("league_hubs")
            ? "League Hub setup is not installed yet. Run supabase/league_hubs_schema.sql in Supabase SQL Editor."
            : error.message
        );
      } else {
        setLeagues((data || []) as LeagueHub[]);
      }

      setIsLoading(false);
    }

    loadLeagues();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadLeagues();
    });

    return () => subscription.unsubscribe();
  }, []);

  async function createLeague() {
    const cleanName = leagueName.trim();

    if (!currentUserId) {
      setMessage("Sign in before creating a league.");
      return;
    }

    if (cleanName.length < 2) {
      setMessage("Enter a league name.");
      return;
    }

    setIsCreating(true);
    setMessage("");

    const { data, error } = await supabase
      .from("league_hubs")
      .insert({ user_id: currentUserId, name: cleanName })
      .select("id")
      .single();

    if (error) {
      setMessage(
        error.message.includes("league_hubs")
          ? "League Hub setup is not installed yet. Run supabase/league_hubs_schema.sql in Supabase SQL Editor."
          : error.message
      );
      setIsCreating(false);
      return;
    }

    router.push(`/league/${data.id}`);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.15),transparent_45%),radial-gradient(circle_at_82%_8%,rgba(245,158,11,0.13),transparent_42%)]" />

      <section className="relative mx-auto flex max-w-6xl flex-col gap-8 px-5 py-6 sm:px-6 sm:py-8">
        <header className="rounded-3xl border border-white/10 bg-slate-900/75 p-6 shadow-2xl backdrop-blur sm:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.26em] text-cyan-300">
                CFB League Hub
              </p>
              <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-6xl">
                Select your league
              </h1>
              <p className="mt-4 max-w-2xl text-slate-300">
                Create a new league workspace or open an existing league. Once
                inside, choose Live Draft or In-Season Management.
              </p>
            </div>

            <Link
              href="/"
              className="self-start rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              ← League Home
            </Link>
          </div>

          {userEmail ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 p-4 text-sm font-semibold text-cyan-100">
              <span>Signed in as {userEmail}</span>
              <button
                type="button"
                onClick={signOut}
                className="rounded-xl bg-white/10 px-4 py-2 font-bold text-white transition hover:bg-white/15"
              >
                Sign Out
              </button>
            </div>
          ) : null}

          {message ? (
            <div className="mt-5 rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-sm font-semibold text-yellow-100">
              {message}
            </div>
          ) : null}
        </header>

        {!userEmail && !isLoading ? (
          <section className="rounded-3xl border border-yellow-400/30 bg-yellow-400/10 p-7">
            <h2 className="text-2xl font-black">Sign in to use League Hub</h2>
            <p className="mt-2 text-yellow-100">
              Your account keeps league entries available across devices.
            </p>
            <Link
              href="/login?redirect=/league"
              className="mt-5 inline-flex rounded-2xl bg-cyan-400 px-5 py-3 font-black text-slate-950"
            >
              Sign In or Create Account
            </Link>
          </section>
        ) : null}

        {userEmail ? (
          <section
            id="new-league"
            className="scroll-mt-6 rounded-3xl border border-cyan-400/25 bg-cyan-400/[0.07] p-6 sm:p-8"
          >
            <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-300">
              New League
            </p>
            <h2 className="mt-2 text-3xl font-black">Create a League</h2>
            <p className="mt-3 max-w-2xl text-slate-400">
              Give the league its public name. You will be marked as its commissioner.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <label className="sr-only" htmlFor="league-name">League name</label>
              <input
                id="league-name"
                value={leagueName}
                onChange={(event) => setLeagueName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") createLeague();
                }}
                maxLength={80}
                placeholder="Example: Saturday Dynasty League"
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950 px-4 py-3.5 text-white outline-none placeholder:text-slate-600 focus:border-cyan-300"
              />
              <button
                type="button"
                onClick={createLeague}
                disabled={isCreating || leagueName.trim().length < 2}
                className="rounded-2xl bg-cyan-400 px-6 py-3.5 font-black text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreating ? "Creating..." : "Create League"}
              </button>
            </div>
          </section>
        ) : null}

        {userEmail ? (
          <section id="your-leagues" className="scroll-mt-6">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">
                Existing League Hubs
              </p>
              <h2 className="mt-2 text-3xl font-black">Enter a League Hub</h2>
            </div>

            {isLoading ? (
              <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6 text-slate-300">
                Loading leagues...
              </div>
            ) : leagues.length === 0 ? (
              <div className="mt-6 rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-slate-400">
                No leagues have been created yet. Create the first league above.
              </div>
            ) : (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {leagues.map((league) => (
                  <Link
                    key={league.id}
                    href={`/league/${league.id}`}
                    className="group rounded-3xl border border-white/10 bg-white/5 p-6 transition hover:-translate-y-0.5 hover:border-amber-300/40 hover:bg-amber-300/[0.07]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-2xl font-black">{league.name}</h3>
                        <p className="mt-2 text-xs text-slate-500">
                          Updated {new Date(league.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                      {league.user_id === currentUserId ? (
                        <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs font-bold text-cyan-200">
                          Commissioner
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-6 font-black text-amber-200 transition group-hover:text-amber-100">
                      Open League Hub →
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </section>
    </main>
  );
}
