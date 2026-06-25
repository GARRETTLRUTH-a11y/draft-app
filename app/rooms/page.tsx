"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type CloudDraft = {
  id: string;
  title: string;
  updated_at: string;
};

export default function RoomsPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<CloudDraft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadUserAndDrafts() {
      setIsLoading(true);
      setMessage("");

      const { data: userData } = await supabase.auth.getUser();

      setUserEmail(userData.user?.email ?? null);

      if (!userData.user) {
        setDrafts([]);
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("drafts")
        .select("id, title, updated_at")
        .eq("user_id", userData.user.id)
        .order("updated_at", { ascending: false });

      if (error) {
        setMessage(error.message);
      } else {
        setDrafts((data || []) as CloudDraft[]);
      }

      setIsLoading(false);
    }

    loadUserAndDrafts();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
      loadUserAndDrafts();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            CFB Draft Tool
          </p>

          <div className="mt-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-tight md:text-6xl">
                Live Draft Rooms
              </h1>

              <p className="mt-4 max-w-3xl text-lg text-slate-300">
                Open one of your saved account drafts in a dedicated room page.
                This is the foundation for live multiplayer drafting.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/create"
                className="rounded-2xl bg-cyan-400 px-5 py-3 text-center font-bold text-slate-950 transition hover:bg-cyan-300"
              >
                Create Draft
              </Link>

              <Link
                href="/"
                className="rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15"
              >
                Home
              </Link>
            </div>
          </div>

          {userEmail && (
            <div className="mt-5 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm font-semibold text-cyan-100">
              Signed in as {userEmail}
            </div>
          )}

          {message && (
            <div className="mt-5 rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-sm font-semibold text-yellow-100">
              {message}
            </div>
          )}
        </header>

        {!userEmail && !isLoading && (
          <section className="rounded-3xl border border-yellow-400/30 bg-yellow-400/10 p-6">
            <h2 className="text-2xl font-black">Sign in required</h2>
            <p className="mt-2 text-yellow-100">
              You need to sign in to view your saved draft rooms.
            </p>

            <Link
              href="/login"
              className="mt-5 inline-flex rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
            >
              Login
            </Link>
          </section>
        )}

        {isLoading && (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <p className="text-slate-300">Loading your rooms...</p>
          </section>
        )}

        {userEmail && !isLoading && drafts.length === 0 && (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-2xl font-black">No saved drafts yet</h2>
            <p className="mt-2 text-slate-400">
              Go create a draft and click Save New Draft first.
            </p>

            <Link
              href="/create"
              className="mt-5 inline-flex rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
            >
              Create Draft
            </Link>
          </section>
        )}

        {userEmail && !isLoading && drafts.length > 0 && (
          <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="rounded-3xl border border-white/10 bg-white/5 p-6"
              >
                <div>
                  <h2 className="text-xl font-black">{draft.title}</h2>
                  <p className="mt-2 text-xs text-slate-400">
                    Updated {new Date(draft.updated_at).toLocaleString()}
                  </p>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Link
                    href={`/room/${draft.id}`}
                    className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-300"
                  >
                    Enter Live Draft
                  </Link>
                </div>
              </div>
            ))}
          </section>
        )}
      </section>
    </main>
  );
}