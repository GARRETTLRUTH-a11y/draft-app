"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { CONFERENCE_ORDER, CONFERENCE_TIERS, TIER_ORDER } from "@/lib/cfbTeams";
import { buildTiers, groupItemsByConference } from "@/lib/draftBoard";
import { CompactDraftBoard } from "@/components/CompactDraftBoard";

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
  color?: string;
};

type Pick = {
  pickNumber: number;
  drafter: string;
  item: DraftItem;
};

type SavedDraftState = {
  selectedTemplateId: string;
  draftTitle: string;
  drafters: Drafter[];
  availableItems: DraftItem[];
  picks: Pick[];
  lotteryHasRun: boolean;
};

type SharedDraftRecord = {
  id: string;
  title: string;
  draft_data: SavedDraftState;
  updated_at: string;
};

type SharedDraftRealtimeRecord = {
  id: string;
  title: string;
  draft_data: SavedDraftState;
  updated_at: string;
  is_public: boolean;
};

type Participant = {
  id: string;
  user_id: string;
  drafter_name: string;
  role: "host" | "participant";
};

export default function SharedDraftPage() {
  const params = useParams();
  const rawShareId = params.shareId;
  const shareId = Array.isArray(rawShareId) ? rawShareId[0] : rawShareId;

  const [draft, setDraft] = useState<SharedDraftRecord | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
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
        .select("id, title, draft_data, updated_at")
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
        const record = data as SharedDraftRecord;
        setDraft(record);
        loadParticipants(record.id);
      }

      setIsLoading(false);
    }

    async function loadParticipants(draftId: string) {
      const { data, error } = await supabase
        .from("draft_participants")
        .select("id, user_id, drafter_name, role")
        .eq("draft_id", draftId);

      if (!error && isMounted) {
        setParticipants((data || []) as Participant[]);
      }
    }

    loadSharedDraft();

    const draftChannel = supabase
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
            id: updatedDraft.id,
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
      supabase.removeChannel(draftChannel);
    };
  }, [shareId]);

  const draftData = draft?.draft_data;
  const drafters = draftData?.drafters ?? [];
  const picks = draftData?.picks ?? [];
  const availableItems = draftData?.availableItems ?? [];

  const currentDrafter = useMemo(() => {
    if (picks.length >= drafters.length) return undefined;

    return drafters[picks.length];
  }, [drafters, picks.length]);

  const isDraftComplete =
    drafters.length > 0 &&
    (picks.length >= drafters.length || availableItems.length === 0);

  const draftStatus = useMemo(() => {
    if (picks.length === 0) return "Draft Not Started";
    if (isDraftComplete) return "Draft Complete";
    return "Draft In Progress";
  }, [picks.length, isDraftComplete]);

  const participantByName = useMemo(() => {
    const map = new Map<string, Participant>();

    participants.forEach((participant) => {
      map.set(participant.drafter_name.toLowerCase(), participant);
    });

    return map;
  }, [participants]);

  const { pickByItemId, groups: itemGroups } = useMemo(
    () =>
      groupItemsByConference(
        availableItems,
        picks,
        draftData?.selectedTemplateId === "cfb" ? CONFERENCE_ORDER : undefined
      ),
    [availableItems, picks, draftData?.selectedTemplateId]
  );

  const tiers = useMemo(
    () =>
      buildTiers(
        itemGroups,
        draftData?.selectedTemplateId === "cfb" ? CONFERENCE_TIERS : undefined,
        TIER_ORDER
      ),
    [itemGroups, draftData?.selectedTemplateId]
  );

  const { pickByItemId: pickedById, groups: pickedGroups } = useMemo(
    () =>
      groupItemsByConference(
        [],
        picks,
        draftData?.selectedTemplateId === "cfb" ? CONFERENCE_ORDER : undefined
      ),
    [picks, draftData?.selectedTemplateId]
  );

  const pickedTiers = useMemo(
    () =>
      buildTiers(
        pickedGroups,
        draftData?.selectedTemplateId === "cfb" ? CONFERENCE_TIERS : undefined,
        TIER_ORDER
      ),
    [pickedGroups, draftData?.selectedTemplateId]
  );

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            CFB Draft Tool
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
            CFB Draft Tool
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
              CFB Draft Tool
            </p>

            <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1.5 text-xs font-bold text-cyan-200">
              Public Spectator View
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
                Read-only view. Keep this page open and picks will update
                automatically.
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
              {Math.max(drafters.length - picks.length, 0)}
            </div>
            <div className="mt-1 text-sm text-slate-400">Drafters Remaining</div>
          </div>
        </section>

        {isDraftComplete && (
          <section className="rounded-3xl border border-green-400/30 bg-green-400/10 p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-green-300">
              Draft Complete
            </p>
            <h2 className="mt-2 text-3xl font-black">Final Results</h2>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {drafters.map((drafter) => {
                const pick = picks.find((p) => p.drafter === drafter.name);

                return (
                  <div
                    key={drafter.id}
                    className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900 p-4"
                  >
                    {pick?.item.color && (
                      <span
                        className="h-3 w-3 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: pick.item.color }}
                      />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-400">
                        {drafter.name}
                      </div>
                      <div className="truncate text-lg font-black">
                        {pick?.item.name ?? "—"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-black">Draft Order &amp; Players</h2>
          <p className="mt-2 text-sm text-slate-400">
            Updates live as players claim slots and make picks.
          </p>

          <div className="mt-5 grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {drafters.map((drafter, index) => {
              const participant = participantByName.get(
                drafter.name.toLowerCase()
              );
              const pick = picks.find((p) => p.drafter === drafter.name);
              const isOnClock = drafter.id === currentDrafter?.id;

              return (
                <div
                  key={drafter.id}
                  className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-sm ${
                    isOnClock
                      ? "border-cyan-300/30 bg-cyan-300/10"
                      : participant
                        ? "border-green-400/20 bg-green-400/5"
                        : "border-white/10 bg-slate-900"
                  }`}
                >
                  <span className="w-5 flex-shrink-0 text-xs text-slate-500">
                    {index + 1}
                  </span>

                  <span className="min-w-0 flex-1 truncate font-bold">
                    {drafter.name}
                  </span>

                  {pick ? (
                    <span className="flex flex-shrink-0 items-center gap-1.5 truncate text-[10px] font-bold text-white">
                      {pick.item.color && (
                        <span
                          className="h-2 w-2 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: pick.item.color }}
                        />
                      )}
                      <span className="truncate">{pick.item.name}</span>
                    </span>
                  ) : (
                    <span
                      className={`flex-shrink-0 truncate text-[10px] font-bold ${
                        isOnClock
                          ? "text-cyan-200"
                          : participant
                            ? "text-green-300"
                            : "text-slate-500"
                      }`}
                    >
                      {isOnClock
                        ? "On the Clock"
                        : participant
                          ? "Claimed"
                          : "Open"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
                Current Pick
              </p>

              <h2 className="mt-2 text-4xl font-black">
                {currentDrafter?.name || "No drafter available"}
              </h2>

              <p className="mt-2 text-slate-400">
                Pick {picks.length + 1} of {drafters.length}
              </p>
            </div>

            <div className="mt-6">
              <CompactDraftBoard
                tiers={tiers}
                getStatus={(item) => {
                  const pick = pickByItemId.get(item.id);
                  return pick
                    ? { variant: "taken", badge: pick.drafter }
                    : { variant: "available" };
                }}
                emptyMessage="No available items."
                legend={[
                  { label: "Drafted", swatchClassName: "bg-green-400/20" },
                  { label: "Available", swatchClassName: "bg-white/10" },
                ]}
              />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-2xl font-black">Draft Board</h2>
            <p className="mt-2 text-sm text-slate-400">
              Every selection, organized by conference.
            </p>

            <div className="mt-6">
              <CompactDraftBoard
                tiers={pickedTiers}
                getStatus={(item) => {
                  const pick = pickedById.get(item.id);
                  return pick
                    ? { variant: "taken", badge: pick.drafter }
                    : { variant: "available" };
                }}
                strikethroughOnTaken={false}
                takenStyle="plain"
                emptyMessage="No picks yet."
              />
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
