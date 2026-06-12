"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Drafter = {
  id: number;
  name: string;
  lotteryTickets: number;
};

type DraftItem = {
  id: number;
  name: string;
  category: string;
  description: string;
};

type Pick = {
  pickNumber: number;
  round: number;
  drafter: string;
  item: DraftItem;
};

type SavedDraftState = {
  selectedTemplateId: string;
  draftTitle: string;
  drafters: Drafter[];
  availableItems: DraftItem[];
  picks: Pick[];
  snakeDraft: boolean;
  lotteryHasRun: boolean;
};

type SharedDraftRecord = {
  title: string;
  draft_data: SavedDraftState;
  updated_at: string;
};

type SharedDraftRealtimeRecord = {
  title: string;
  draft_data: SavedDraftState;
  updated_at: string;
  is_public: boolean;
};

export default function SharedDraftPage() {
  const params = useParams();
  const rawShareId = params.shareId;
  const shareId = Array.isArray(rawShareId) ? rawShareId[0] : rawShareId;

  const [draft, setDraft] = useState<SharedDraftRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [liveMessage, setLiveMessage] = useState("Connecting to live updates...");

  useEffect(() => {
    if (!shareId) return;

    let isMounted = true;

    async function loadSharedDraft() {
      setIsLoading(true);
      setErrorMessage("");
      setLiveMessage("Connecting to live updates...");

      const { data, error } = await supabase
        .from("drafts")
        .select("title, draft_data, updated_at")
        .eq("share_id", shareId)
        .eq("is_public", true)
        .maybeSingle();

      if (!isMounted) return;

      if (error) {
        setErrorMessage(error.message);
        setDraft(null);
      } else if (!data) {
        setErrorMessage("This draft was not found or is not publicly shared.");
        setDraft(null);
      } else {
        setDraft(data as SharedDraftRecord);
      }

      setIsLoading(false);
    }

    loadSharedDraft();

    const channel = supabase
      .channel(`public-shared-draft-${shareId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "drafts",
          filter: `share_id=eq.${shareId}`,
        },
        (payload) => {
          const updatedDraft = payload.new as SharedDraftRealtimeRecord;

          if (!updatedDraft.is_public) {
            setDraft(null);
            setErrorMessage("This draft is no longer publicly shared.");
            setLiveMessage("Sharing is off.");
            return;
          }

          setDraft({
            title: updatedDraft.title,
            draft_data: updatedDraft.draft_data,
            updated_at: updatedDraft.updated_at,
          });

          setErrorMessage("");
          setLiveMessage("Live update received.");
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setLiveMessage("Live updates connected.");
        }

        if (status === "CHANNEL_ERROR") {
          setLiveMessage("Live updates disconnected. Refresh if needed.");
        }

        if (status === "TIMED_OUT") {
          setLiveMessage("Live updates timed out. Refresh if needed.");
        }
      });

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [shareId]);

  const draftData = draft?.draft_data;
  const drafters = draftData?.drafters ?? [];
  const picks = draftData?.picks ?? [];
  const availableItems = draftData?.availableItems ?? [];

  const draftStatus = useMemo(() => {
    if (picks.length === 0) return "Draft Not Started";
    if (availableItems.length === 0) return "Draft Complete";
    return "Draft In Progress";
  }, [picks.length, availableItems.length]);

  const groupedPicks = useMemo(() => {
    const grouped: Record<string, Pick[]> = {};

    picks.forEach((pick) => {
      if (!grouped[pick.drafter]) {
        grouped[pick.drafter] = [];
      }

      grouped[pick.drafter].push(pick);
    });

    return grouped;
  }, [picks]);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            Draft Anything
          </p>
          <h1 className="mt-4 text-4xl font-black">Loading shared draft...</h1>
        </section>
      </main>
    );
  }

  if (!draft || errorMessage) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            Draft Anything
          </p>

          <h1 className="mt-4 text-4xl font-black">Shared Draft Unavailable</h1>

          <p className="mt-4 text-slate-300">
            {errorMessage ||
              "This draft was not found or is not publicly shared."}
          </p>

          <Link
            href="/"
            className="mt-6 inline-flex rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
          >
            Back to Home
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-8">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
              Draft Anything
            </p>

            <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1.5 text-xs font-bold text-cyan-200">
              Shared Draft
            </span>

            <span className="rounded-full border border-white/10 bg-white/10 px-4 py-1.5 text-xs font-bold text-white">
              {draftStatus}
            </span>

            <span className="rounded-full border border-green-400/30 bg-green-400/10 px-4 py-1.5 text-xs font-bold text-green-200">
              Live
            </span>
          </div>

          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-tight md:text-6xl">
                {draft.draft_data.draftTitle || draft.title}
              </h1>

              <p className="mt-4 max-w-3xl text-lg text-slate-300">
                Public read-only live draft board. Keep this page open and picks
                should update automatically.
              </p>

              <p className="mt-3 text-sm text-slate-500">
                Last updated {new Date(draft.updated_at).toLocaleString()}
              </p>

              <p className="mt-2 text-sm font-semibold text-green-200">
                {liveMessage}
              </p>
            </div>

            <Link
              href="/create"
              className="rounded-2xl bg-cyan-400 px-5 py-3 text-center font-bold text-slate-950 transition hover:bg-cyan-300"
            >
              Create Your Own Draft
            </Link>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-3xl font-black">{drafters.length}</div>
            <div className="mt-1 text-sm text-slate-400">Drafters</div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-3xl font-black">{picks.length}</div>
            <div className="mt-1 text-sm text-slate-400">Picks Made</div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-3xl font-black">{availableItems.length}</div>
            <div className="mt-1 text-sm text-slate-400">Items Remaining</div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-3xl font-black">
              {draft.draft_data.snakeDraft ? "Yes" : "No"}
            </div>
            <div className="mt-1 text-sm text-slate-400">Snake Draft</div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-2xl font-black">Rosters by Drafter</h2>

            <div className="mt-6 space-y-4">
              {drafters.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/15 p-5 text-slate-500">
                  No drafters in this draft.
                </div>
              )}

              {drafters.map((drafter) => {
                const drafterPicks = groupedPicks[drafter.name] || [];

                return (
                  <div
                    key={drafter.id}
                    className="rounded-2xl border border-white/10 bg-slate-900 p-5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-xl font-black">{drafter.name}</h3>
                      <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-slate-300">
                        {drafterPicks.length} picks
                      </span>
                    </div>

                    <div className="mt-4 space-y-2">
                      {drafterPicks.length === 0 && (
                        <p className="text-sm text-slate-500">No picks yet.</p>
                      )}

                      {drafterPicks.map((pick) => (
                        <div
                          key={pick.pickNumber}
                          className="rounded-xl bg-white/5 p-3"
                        >
                          <div className="text-xs text-slate-500">
                            Pick {pick.pickNumber} · Round {pick.round}
                          </div>
                          <div className="mt-1 font-bold">{pick.item.name}</div>
                          <div className="text-xs text-cyan-300">
                            {pick.item.category}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-2xl font-black">Full Pick Board</h2>

            <div className="mt-6 space-y-3">
              {picks.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/15 p-5 text-slate-500">
                  No picks have been made yet.
                </div>
              )}

              {picks.map((pick) => (
                <div
                  key={pick.pickNumber}
                  className="rounded-2xl border border-white/10 bg-slate-900 p-5"
                >
                  <div className="text-sm text-slate-400">
                    Pick {pick.pickNumber} · Round {pick.round} · {pick.drafter}
                  </div>

                  <div className="mt-2 text-2xl font-black">
                    {pick.item.name}
                  </div>

                  <div className="mt-1 text-sm font-semibold text-cyan-300">
                    {pick.item.category}
                  </div>

                  <p className="mt-3 text-sm text-slate-400">
                    {pick.item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-black">Remaining Items</h2>

          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {availableItems.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/15 p-5 text-slate-500">
                No remaining items.
              </div>
            )}

            {availableItems.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-white/10 bg-slate-900 p-5"
              >
                <h3 className="text-xl font-black">{item.name}</h3>
                <p className="mt-1 text-sm font-semibold text-cyan-300">
                  {item.category}
                </p>
                <p className="mt-3 text-sm text-slate-400">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}