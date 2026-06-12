"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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

type RoomDraft = {
  id: string;
  title: string;
  draft_data: SavedDraftState;
  updated_at: string;
  is_public: boolean;
  share_id: string;
};

export default function RoomPage() {
  const params = useParams();
  const rawDraftId = params.draftId;
  const draftId = Array.isArray(rawDraftId) ? rawDraftId[0] : rawDraftId;

  const [draft, setDraft] = useState<RoomDraft | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadRoomDraft();
  }, [draftId]);

  async function loadRoomDraft() {
    if (!draftId) return;

    setIsLoading(true);
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();
    setUserEmail(userData.user?.email ?? null);

    if (!userData.user) {
      setDraft(null);
      setMessage("Sign in to access this draft room.");
      setIsLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("drafts")
      .select("id, title, draft_data, updated_at, is_public, share_id")
      .eq("id", draftId)
      .maybeSingle();

    if (error) {
      setMessage(error.message);
      setDraft(null);
    } else if (!data) {
      setMessage("Draft room not found, or you do not have access.");
      setDraft(null);
    } else {
      setDraft(data as RoomDraft);
    }

    setIsLoading(false);
  }

  const draftData = draft?.draft_data;
  const drafters = draftData?.drafters ?? [];
  const picks = draftData?.picks ?? [];
  const availableItems = draftData?.availableItems ?? [];
  const snakeDraft = Boolean(draftData?.snakeDraft);

  const currentPickNumber = picks.length + 1;

  const currentRound =
    drafters.length > 0 ? Math.floor(picks.length / drafters.length) + 1 : 1;

  const currentDrafter = useMemo(() => {
    if (drafters.length === 0) return undefined;

    const pickIndex = picks.length;
    const roundIndex = Math.floor(pickIndex / drafters.length);
    const pickInRound = pickIndex % drafters.length;

    if (snakeDraft && roundIndex % 2 === 1) {
      return drafters[drafters.length - 1 - pickInRound];
    }

    return drafters[pickInRound];
  }, [drafters, picks.length, snakeDraft]);

  const draftStatus = useMemo(() => {
    if (picks.length === 0) return "Draft Not Started";
    if (availableItems.length === 0) return "Draft Complete";
    return "Draft In Progress";
  }, [picks.length, availableItems.length]);

  const filteredItems = availableItems.filter((item) => {
    const searchText =
      `${item.name} ${item.category} ${item.description}`.toLowerCase();

    return searchText.includes(search.toLowerCase());
  });

  async function saveRoomDraft(nextDraftData: SavedDraftState) {
    if (!draft) return;

    setIsSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("drafts")
      .update({
        title: nextDraftData.draftTitle,
        draft_data: nextDraftData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id);

    if (error) {
      setMessage(error.message);
      setIsSaving(false);
      return;
    }

    setDraft({
      ...draft,
      title: nextDraftData.draftTitle,
      draft_data: nextDraftData,
      updated_at: new Date().toISOString(),
    });

    setMessage("Room updated.");
    setIsSaving(false);
  }

  async function makePick(item: DraftItem) {
    if (!draftData || !currentDrafter) return;

    const newPick: Pick = {
      pickNumber: currentPickNumber,
      round: currentRound,
      drafter: currentDrafter.name,
      item,
    };

    const nextDraftData: SavedDraftState = {
      ...draftData,
      picks: [...picks, newPick],
      availableItems: availableItems.filter(
        (availableItem) => availableItem.id !== item.id
      ),
    };

    await saveRoomDraft(nextDraftData);
  }

  async function undoLastPick() {
    if (!draftData || picks.length === 0) return;

    const lastPick = picks[picks.length - 1];

    const nextDraftData: SavedDraftState = {
      ...draftData,
      picks: picks.slice(0, -1),
      availableItems: [...availableItems, lastPick.item],
    };

    await saveRoomDraft(nextDraftData);
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            Draft Anything
          </p>
          <h1 className="mt-4 text-4xl font-black">Loading draft room...</h1>
        </section>
      </main>
    );
  }

  if (!draft || !draftData) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            Draft Anything
          </p>

          <h1 className="mt-4 text-4xl font-black">Room Unavailable</h1>

          <p className="mt-4 text-slate-300">
            {message || "This room could not be loaded."}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
            >
              Login
            </Link>

            <Link
              href="/rooms"
              className="rounded-2xl bg-white/10 px-5 py-3 font-bold text-white transition hover:bg-white/15"
            >
              Rooms
            </Link>
          </div>
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
              Host Room
            </span>

            <span className="rounded-full border border-white/10 bg-white/10 px-4 py-1.5 text-xs font-bold text-white">
              {draftStatus}
            </span>

            {userEmail && (
              <span className="rounded-full border border-green-400/30 bg-green-400/10 px-4 py-1.5 text-xs font-bold text-green-200">
                Signed in
              </span>
            )}

            {isSaving && (
              <span className="rounded-full border border-yellow-400/30 bg-yellow-400/10 px-4 py-1.5 text-xs font-bold text-yellow-200">
                Saving...
              </span>
            )}
          </div>

          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-tight md:text-6xl">
                {draftData.draftTitle || draft.title}
              </h1>

              <p className="mt-4 max-w-3xl text-lg text-slate-300">
                Dedicated host-controlled room. Make picks here and the saved
                account draft updates in Supabase.
              </p>

              <p className="mt-3 text-sm text-slate-500">
                Last updated {new Date(draft.updated_at).toLocaleString()}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Link
                href="/rooms"
                className="rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15"
              >
                All Rooms
              </Link>

              <Link
                href="/create"
                className="rounded-2xl bg-cyan-400 px-5 py-3 text-center font-bold text-slate-950 transition hover:bg-cyan-300"
              >
                Builder
              </Link>

              {draft.is_public && (
                <Link
                  href={`/draft/${draft.share_id}`}
                  target="_blank"
                  className="rounded-2xl bg-purple-400 px-5 py-3 text-center font-bold text-slate-950 transition hover:bg-purple-300"
                >
                  Public View
                </Link>
              )}
            </div>
          </div>

          {message && (
            <div className="mt-5 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm font-semibold text-cyan-100">
              {message}
            </div>
          )}
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
              {draftData.snakeDraft ? "Yes" : "No"}
            </div>
            <div className="mt-1 text-sm text-slate-400">Snake Draft</div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
                  Current Pick
                </p>

                <h2 className="mt-2 text-4xl font-black">
                  {currentDrafter?.name || "No drafter available"}
                </h2>

                <p className="mt-2 text-slate-400">
                  Pick {currentPickNumber} · Round {currentRound}
                </p>
              </div>

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search available items..."
                className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
              />
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {filteredItems.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/15 p-5 text-slate-500 md:col-span-2">
                  No available items.
                </div>
              )}

              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-white/10 bg-slate-900 p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-black">{item.name}</h3>
                      <p className="mt-1 text-sm font-semibold text-cyan-300">
                        {item.category}
                      </p>
                    </div>

                    <button
                      onClick={() => makePick(item)}
                      disabled={!currentDrafter || isSaving}
                      className="rounded-full bg-cyan-400 px-3 py-1 text-xs font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Draft
                    </button>
                  </div>

                  <p className="mt-4 text-sm text-slate-400">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-2xl font-black">Draft Board</h2>
                <p className="mt-2 text-sm text-slate-400">
                  Picks update the saved account draft.
                </p>
              </div>

              <button
                onClick={undoLastPick}
                disabled={picks.length === 0 || isSaving}
                className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Undo
              </button>
            </div>

            <div className="mt-6 space-y-3">
              {picks.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/15 p-5 text-slate-500">
                  No picks yet.
                </div>
              )}

              {picks.map((pick) => (
                <div
                  key={pick.pickNumber}
                  className="rounded-2xl border border-white/10 bg-slate-900 p-4"
                >
                  <div className="text-sm text-slate-400">
                    Pick {pick.pickNumber} · Round {pick.round} · {pick.drafter}
                  </div>

                  <div className="mt-1 text-lg font-black">{pick.item.name}</div>

                  <div className="text-sm text-cyan-300">
                    {pick.item.category}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}