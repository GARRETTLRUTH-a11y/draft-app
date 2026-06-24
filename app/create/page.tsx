"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { CFB_ITEMS } from "@/lib/cfbTeams";
import type { Drafter, SavedDraftState } from "@/lib/useDraftSetup";

const DEFAULT_TITLE = "College Football Team Draft";

const DEFAULT_DRAFTERS: Drafter[] = [
  { id: 1, name: "Garrett", lotteryTickets: 30 },
  { id: 2, name: "Chris", lotteryTickets: 24 },
  { id: 3, name: "Tyler", lotteryTickets: 18 },
  { id: 4, name: "John", lotteryTickets: 14 },
  { id: 5, name: "Mike", lotteryTickets: 10 },
  { id: 6, name: "Brandon", lotteryTickets: 6 },
];

type CloudDraft = {
  id: string;
  title: string;
  updated_at: string;
};

function createShareId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replaceAll("-", "");
  }

  return `${Date.now()}${Math.random().toString(36).slice(2)}`;
}

export default function CreateGatheringPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [cloudDrafts, setCloudDrafts] = useState<CloudDraft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadDrafts();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);

      if (session?.user) {
        loadDrafts();
      } else {
        setCloudDrafts([]);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function loadDrafts() {
    setIsLoading(true);
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();
    setUserEmail(userData.user?.email ?? null);

    if (!userData.user) {
      setCloudDrafts([]);
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
      setCloudDrafts((data || []) as CloudDraft[]);
    }

    setIsLoading(false);
  }

  async function createNewDraft() {
    setIsCreating(true);
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setMessage("Sign in before creating a draft.");
      setIsCreating(false);
      return;
    }

    const draftData: SavedDraftState = {
      selectedTemplateId: "cfb",
      draftTitle: DEFAULT_TITLE,
      drafters: DEFAULT_DRAFTERS.map((drafter) => ({ ...drafter })),
      availableItems: CFB_ITEMS.map((item) => ({ ...item })),
      picks: [],
      lotteryHasRun: false,
    };

    const { data, error } = await supabase
      .from("drafts")
      .insert({
        user_id: userData.user.id,
        title: DEFAULT_TITLE,
        draft_data: draftData,
        share_id: createShareId(),
        is_public: false,
        is_joinable: false,
      })
      .select("id")
      .single();

    if (error) {
      setMessage(error.message);
      setIsCreating(false);
      return;
    }

    router.push(`/create/${data.id}/drafters`);
  }

  async function deleteDraft(draftId: string) {
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setMessage("Sign in before deleting drafts.");
      return;
    }

    const { error } = await supabase
      .from("drafts")
      .delete()
      .eq("id", draftId)
      .eq("user_id", userData.user.id);

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Draft deleted.");
      await loadDrafts();
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-8">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            CFB Draft Tool
          </p>

          <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-tight md:text-5xl">
                Your Drafts
              </h1>
              <p className="mt-3 max-w-xl text-slate-300">
                Pick up an existing draft or start a new one. Setup walks you
                through Drafters, Odds, Lottery, and Teams one step at a time.
              </p>
            </div>

            <button
              onClick={createNewDraft}
              disabled={isCreating || !userEmail}
              className="rounded-2xl bg-cyan-400 px-6 py-4 text-center font-black text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating ? "Creating..." : "New Draft"}
            </button>
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
              You need to sign in to create or manage drafts.
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
            <p className="text-slate-300">Loading your drafts...</p>
          </section>
        )}

        {userEmail && !isLoading && cloudDrafts.length === 0 && (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-2xl font-black">No drafts yet</h2>
            <p className="mt-2 text-slate-400">
              Click New Draft to start setting up your first college football
              team draft.
            </p>
          </section>
        )}

        {userEmail && !isLoading && cloudDrafts.length > 0 && (
          <section className="grid gap-4 md:grid-cols-2">
            {cloudDrafts.map((draft) => (
              <div
                key={draft.id}
                className="rounded-3xl border border-white/10 bg-white/5 p-6"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black">{draft.title}</h3>
                    <p className="mt-2 text-xs text-slate-400">
                      Updated {new Date(draft.updated_at).toLocaleString()}
                    </p>
                  </div>

                  <button
                    onClick={() => deleteDraft(draft.id)}
                    title="Delete draft"
                    className="text-xs font-bold text-slate-500 transition hover:text-red-300"
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/create/${draft.id}/drafters`}
                    className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-300"
                  >
                    Continue Setup
                  </Link>

                  <Link
                    href={`/room/${draft.id}`}
                    className="rounded-2xl bg-green-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-green-300"
                  >
                    Open Room
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
