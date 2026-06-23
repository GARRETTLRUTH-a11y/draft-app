"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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

type RoomDraft = {
  id: string;
  title: string;
  draft_data: SavedDraftState;
  updated_at: string;
  is_public: boolean;
  is_joinable: boolean;
  share_id: string;
};

type Participant = {
  id: string;
  user_id: string;
  drafter_name: string;
  role: "host" | "participant";
};

export default function RoomPage() {
  const params = useParams();
  const rawDraftId = params.draftId;
  const draftId = Array.isArray(rawDraftId) ? rawDraftId[0] : rawDraftId;

  const [draft, setDraft] = useState<RoomDraft | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [liveMessage, setLiveMessage] = useState("Connecting to live room...");

  useEffect(() => {
    if (!draftId) return;

    const roomDraftId = draftId;

    loadRoomDraft(roomDraftId);

    const draftChannel = supabase
      .channel(`host-room-draft-${roomDraftId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "drafts",
          filter: `id=eq.${roomDraftId}`,
        },
        (payload) => {
          const updatedDraft = payload.new as RoomDraft;
          setDraft(updatedDraft);
          setLiveMessage("Live room updated.");
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setLiveMessage("Live room connected.");
        }

        if (status === "CHANNEL_ERROR") {
          setLiveMessage("Live room disconnected. Refresh if needed.");
        }

        if (status === "TIMED_OUT") {
          setLiveMessage("Live room timed out. Refresh if needed.");
        }
      });

    const participantsChannel = supabase
      .channel(`host-room-participants-${roomDraftId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "draft_participants",
          filter: `draft_id=eq.${roomDraftId}`,
        },
        () => {
          loadParticipants(roomDraftId);
          setLiveMessage("Participant list updated.");
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(draftChannel);
      supabase.removeChannel(participantsChannel);
    };
  }, [draftId]);

  async function loadRoomDraft(roomDraftId = draftId) {
    if (!roomDraftId) return;

    setIsLoading(true);
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();
    setUserEmail(userData.user?.email ?? null);

    if (!userData.user) {
      setDraft(null);
      setParticipants([]);
      setMessage("Sign in to access this draft room.");
      setIsLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("drafts")
      .select("id, title, draft_data, updated_at, is_public, is_joinable, share_id")
      .eq("id", roomDraftId)
      .maybeSingle();

    if (error) {
      setMessage(error.message);
      setDraft(null);
    } else if (!data) {
      setMessage("Draft room not found, or you do not have access.");
      setDraft(null);
    } else {
      setDraft(data as RoomDraft);
      await loadParticipants(roomDraftId);
    }

    setIsLoading(false);
  }

  async function loadParticipants(roomDraftId = draftId) {
    if (!roomDraftId) return;

    const { data, error } = await supabase
      .from("draft_participants")
      .select("id, user_id, drafter_name, role")
      .eq("draft_id", roomDraftId);

    if (error) {
      setMessage(error.message);
      return;
    }

    setParticipants((data || []) as Participant[]);
  }

  const draftData = draft?.draft_data;
  const drafters = draftData?.drafters ?? [];
  const picks = draftData?.picks ?? [];
  const availableItems = draftData?.availableItems ?? [];

  const currentPickNumber = picks.length + 1;

  const currentDrafter = useMemo(() => {
    if (picks.length >= drafters.length) return undefined;

    return drafters[picks.length];
  }, [drafters, picks.length]);

  const draftStatus = useMemo(() => {
    if (picks.length === 0) return "Draft Not Started";
    if (availableItems.length === 0) return "Draft Complete";
    return "Draft In Progress";
  }, [picks.length, availableItems.length]);

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

  const searchedGroups = useMemo(() => {
    const searchText = search.toLowerCase();

    return itemGroups
      .map((group) => ({
        category: group.category,
        items: group.items.filter((item) =>
          `${item.name} ${item.category} ${item.description}`
            .toLowerCase()
            .includes(searchText)
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [itemGroups, search]);

  const tiers = useMemo(
    () =>
      buildTiers(
        searchedGroups,
        draftData?.selectedTemplateId === "cfb" ? CONFERENCE_TIERS : undefined,
        TIER_ORDER
      ),
    [searchedGroups, draftData?.selectedTemplateId]
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

  function getJoinLink() {
    if (!draft) return "";

    if (typeof window === "undefined") {
      return `/join/${draft.id}`;
    }

    return `${window.location.origin}/join/${draft.id}`;
  }

  async function copyJoinLink() {
    const url = getJoinLink();

    try {
      await navigator.clipboard.writeText(url);
      setMessage("Player join link copied to clipboard.");
    } catch {
      setMessage(`Copy this join link: ${url}`);
    }
  }

  async function togglePlayerPicks(nextValue: boolean) {
    if (!draft) return;

    setIsSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("drafts")
      .update({
        is_joinable: nextValue,
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
      is_joinable: nextValue,
      updated_at: new Date().toISOString(),
    });

    setMessage(
      nextValue
        ? "Player self-picking is now enabled."
        : "Player self-picking is now disabled."
    );

    setIsSaving(false);
  }

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
    if (!availableItems.some((availableItem) => availableItem.id === item.id))
      return;

    const newPick: Pick = {
      pickNumber: currentPickNumber,
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

            {draft.is_joinable ? (
              <span className="rounded-full border border-purple-400/30 bg-purple-400/10 px-4 py-1.5 text-xs font-bold text-purple-200">
                Player Picks On
              </span>
            ) : (
              <span className="rounded-full border border-slate-400/30 bg-slate-400/10 px-4 py-1.5 text-xs font-bold text-slate-200">
                Player Picks Off
              </span>
            )}

            <span className="rounded-full border border-green-400/30 bg-green-400/10 px-4 py-1.5 text-xs font-bold text-green-200">
              Live
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
                Dedicated host-controlled room. Player picks now update this page
                live.
              </p>

              <p className="mt-3 text-sm text-slate-500">
                Last updated {new Date(draft.updated_at).toLocaleString()}
              </p>

              <p className="mt-2 text-sm font-semibold text-green-200">
                {liveMessage}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              {draft.is_joinable ? (
                <button
                  onClick={() => togglePlayerPicks(false)}
                  disabled={isSaving}
                  className="rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Disable Player Picks
                </button>
              ) : (
                <button
                  onClick={() => togglePlayerPicks(true)}
                  disabled={isSaving}
                  className="rounded-2xl bg-purple-400 px-5 py-3 text-center font-bold text-slate-950 transition hover:bg-purple-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Enable Player Picks
                </button>
              )}

              <button
                onClick={copyJoinLink}
                disabled={!draft.is_joinable}
                className="rounded-2xl bg-white px-5 py-3 text-center font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Copy Player Join Link
              </button>

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

          {draft.is_joinable && (
            <div className="mt-5 rounded-2xl border border-purple-400/30 bg-purple-400/10 p-4 text-sm font-semibold text-purple-100">
              Player self-picking is enabled. Join link: {getJoinLink()}
            </div>
          )}

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
              {Math.max(drafters.length - picks.length, 0)}
            </div>
            <div className="mt-1 text-sm text-slate-400">Drafters Remaining</div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-black">Joined Players</h2>
              <p className="mt-2 text-sm text-slate-400">
                This updates live when someone claims a drafter slot.
              </p>
            </div>

            <button
              onClick={() => loadParticipants()}
              className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15"
            >
              Refresh Players
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {drafters.map((drafter) => {
              const participant = participantByName.get(
                drafter.name.toLowerCase()
              );

              return (
                <div
                  key={drafter.id}
                  className={`rounded-2xl border p-4 ${
                    participant
                      ? "border-green-400/30 bg-green-400/10"
                      : "border-white/10 bg-slate-900"
                  }`}
                >
                  <div className="text-lg font-black">{drafter.name}</div>
                  <div
                    className={`mt-1 text-sm ${
                      participant ? "text-green-200" : "text-slate-500"
                    }`}
                  >
                    {participant ? "Claimed by player" : "Not claimed yet"}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-6">
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
                  Pick {currentPickNumber} of {drafters.length}
                </p>
              </div>

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search available items..."
                className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
              />
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
                onSelect={makePick}
                isClickable={() => Boolean(currentDrafter) && !isSaving}
                emptyMessage="No available items."
                legend={[
                  { label: "Drafted", swatchClassName: "bg-green-400/20" },
                  { label: "Available", swatchClassName: "bg-white/10" },
                ]}
              />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-2xl font-black">Draft Board</h2>
                <p className="mt-2 text-sm text-slate-400">
                  Host and player picks both update here live.
                </p>
              </div>

              <button
                onClick={undoLastPick}
                disabled={picks.length === 0 || isSaving}
                className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Host Undo
              </button>
            </div>

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
                emptyMessage="No picks yet."
              />
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}