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

type JoinDraft = {
  id: string;
  title: string;
  draft_data: SavedDraftState;
  updated_at: string;
  is_joinable: boolean;
  is_public: boolean;
  share_id: string;
};

type Participant = {
  id: string;
  user_id: string;
  drafter_name: string;
  role: "host" | "participant";
};

export default function JoinDraftPage() {
  const params = useParams();
  const rawDraftId = params.draftId;
  const draftId = Array.isArray(rawDraftId) ? rawDraftId[0] : rawDraftId;

  const [draft, setDraft] = useState<JoinDraft | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!draftId) return;

    loadJoinRoom();

    const draftChannel = supabase
      .channel(`join-draft-${draftId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "drafts",
          filter: `id=eq.${draftId}`,
        },
        (payload) => {
          const updatedDraft = payload.new as JoinDraft;
          setDraft(updatedDraft);
        }
      )
      .subscribe();

    const participantsChannel = supabase
      .channel(`join-participants-${draftId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "draft_participants",
          filter: `draft_id=eq.${draftId}`,
        },
        () => {
          loadParticipants(draftId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(draftChannel);
      supabase.removeChannel(participantsChannel);
    };
  }, [draftId]);

  async function loadJoinRoom() {
    if (!draftId) return;

    setIsLoading(true);
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();

    setCurrentUserId(userData.user?.id ?? null);
    setUserEmail(userData.user?.email ?? null);

    if (!userData.user) {
      setDraft(null);
      setParticipants([]);
      setMessage("Sign in to join this draft room.");
      setIsLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("drafts")
      .select("id, title, draft_data, updated_at, is_joinable, is_public, share_id")
      .eq("id", draftId)
      .maybeSingle();

    if (error) {
      setDraft(null);
      setMessage(error.message);
      setIsLoading(false);
      return;
    }

    if (!data) {
      setDraft(null);
      setMessage("This join room was not found or player picks are not enabled.");
      setIsLoading(false);
      return;
    }

    setDraft(data as JoinDraft);
    await loadParticipants(draftId);

    setIsLoading(false);
  }

  async function loadParticipants(roomDraftId: string) {
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

  const myParticipant = useMemo(() => {
    if (!currentUserId) return undefined;

    return participants.find(
      (participant) => participant.user_id === currentUserId
    );
  }, [participants, currentUserId]);

  const claimedNames = useMemo(() => {
    return new Set(
      participants.map((participant) => participant.drafter_name.toLowerCase())
    );
  }, [participants]);

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

  const canPick =
    Boolean(myParticipant) &&
    Boolean(currentDrafter) &&
    myParticipant?.drafter_name === currentDrafter?.name &&
    availableItems.length > 0;

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

  async function claimDrafter(drafterName: string) {
    if (!draft || !currentUserId) return;

    setIsSaving(true);
    setMessage("");

    const { error } = await supabase.from("draft_participants").insert({
      draft_id: draft.id,
      user_id: currentUserId,
      drafter_name: drafterName,
      role: "participant",
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage(`You claimed ${drafterName}.`);
      await loadParticipants(draft.id);
    }

    setIsSaving(false);
  }

  async function leaveSlot() {
    if (!myParticipant || !draft) return;

    setIsSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("draft_participants")
      .delete()
      .eq("id", myParticipant.id);

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("You left your drafter slot.");
      await loadParticipants(draft.id);
    }

    setIsSaving(false);
  }

  async function makePick(item: DraftItem) {
    if (!draft || !draftData || !currentDrafter) return;

    if (!canPick) {
      setMessage("It is not your turn yet.");
      return;
    }

    if (!availableItems.some((availableItem) => availableItem.id === item.id)) {
      setMessage("That team has already been drafted.");
      return;
    }

    setIsSaving(true);
    setMessage("");

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

    const { error } = await supabase
      .from("drafts")
      .update({
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
      draft_data: nextDraftData,
      updated_at: new Date().toISOString(),
    });

    setMessage(`You drafted ${item.name}.`);
    setIsSaving(false);
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            CFB Draft Tool
          </p>
          <h1 className="mt-4 text-4xl font-black">Loading join room...</h1>
        </section>
      </main>
    );
  }

  if (!userEmail) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            CFB Draft Tool
          </p>

          <h1 className="mt-4 text-4xl font-black">Sign In to Join</h1>

          <p className="mt-4 text-slate-300">
            You need to sign in before claiming a drafter slot.
          </p>

          {message && (
            <div className="mt-5 rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-sm font-semibold text-yellow-100">
              {message}
            </div>
          )}

          <Link
            href={`/login?redirect=/join/${draftId}`}
            className="mt-6 inline-flex rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
          >
            Login
          </Link>
        </section>
      </main>
    );
  }

  if (!draft || !draftData) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            CFB Draft Tool
          </p>

          <h1 className="mt-4 text-4xl font-black">Join Room Unavailable</h1>

          <p className="mt-4 text-slate-300">
            {message || "This room could not be loaded."}
          </p>

          <Link
            href="/rooms"
            className="mt-6 inline-flex rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
          >
            Back to Rooms
          </Link>
        </section>
      </main>
    );
  }

  if (!draft.is_joinable) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            CFB Draft Tool
          </p>

          <h1 className="mt-4 text-4xl font-black">Player Picks Are Off</h1>

          <p className="mt-4 text-slate-300">
            The host has not enabled player self-picking for this draft.
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

            <span className="rounded-full border border-purple-400/30 bg-purple-400/10 px-4 py-1.5 text-xs font-bold text-purple-200">
              Player Join Room
            </span>

            <span className="rounded-full border border-white/10 bg-white/10 px-4 py-1.5 text-xs font-bold text-white">
              {draftStatus}
            </span>

            <span className="rounded-full border border-green-400/30 bg-green-400/10 px-4 py-1.5 text-xs font-bold text-green-200">
              Signed in
            </span>

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
                Claim your drafter slot. When it is your turn, you can make your
                own pick.
              </p>

              <p className="mt-3 text-sm text-slate-500">
                Signed in as {userEmail}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              {draft.is_public && (
                <Link
                  href={`/draft/${draft.share_id}`}
                  target="_blank"
                  className="rounded-2xl bg-purple-400 px-5 py-3 text-center font-bold text-slate-950 transition hover:bg-purple-300"
                >
                  Watch Board
                </Link>
              )}

              <button
                onClick={() => loadJoinRoom()}
                className="rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15"
              >
                Refresh
              </button>
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
              {Math.max(drafters.length - picks.length, 0)}
            </div>
            <div className="mt-1 text-sm text-slate-400">Drafters Remaining</div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-black">Draft Order</h2>
          <p className="mt-2 text-sm text-slate-400">
            The full pick order for this draft.
          </p>

          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
            {drafters.map((drafter, index) => {
              const pick = picks[index];
              const isOnClock = drafter.id === currentDrafter?.id;
              const isMe = myParticipant?.drafter_name === drafter.name;

              return (
                <div
                  key={drafter.id}
                  className={`flex items-center gap-3 border-b border-white/5 px-3 py-2 text-sm last:border-b-0 ${
                    isOnClock
                      ? "bg-cyan-300/10"
                      : pick
                        ? "bg-green-400/10"
                        : "bg-slate-900"
                  }`}
                >
                  <span className="w-6 flex-shrink-0 text-xs text-slate-500">
                    {index + 1}
                  </span>

                  <span className="min-w-0 flex-1 truncate font-bold">
                    {drafter.name}
                    {isMe && (
                      <span className="ml-1 text-xs font-normal text-slate-400">
                        (you)
                      </span>
                    )}
                  </span>

                  {pick ? (
                    <span className="flex-shrink-0 rounded-full border border-green-400/30 bg-green-400/10 px-2 py-0.5 text-[10px] font-bold text-green-200">
                      {pick.item.name}
                    </span>
                  ) : isOnClock ? (
                    <span className="flex-shrink-0 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold text-cyan-200">
                      On the Clock
                    </span>
                  ) : (
                    <span className="flex-shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                      Waiting
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-2xl font-black">Your Drafter Slot</h2>

            {myParticipant ? (
              <div className="mt-5 rounded-2xl border border-green-400/30 bg-green-400/10 p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-green-200">
                  Claimed
                </p>

                <h3 className="mt-2 text-3xl font-black">
                  {myParticipant.drafter_name}
                </h3>

                <button
                  onClick={leaveSlot}
                  disabled={isSaving || picks.length > 0}
                  className="mt-5 rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Leave Slot
                </button>

                {picks.length > 0 && (
                  <p className="mt-3 text-xs text-yellow-200">
                    Slots lock once picks have started.
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <p className="text-sm text-slate-400">
                  Pick the drafter name that belongs to you.
                </p>

                {drafters.map((drafter) => {
                  const isClaimed = claimedNames.has(drafter.name.toLowerCase());

                  return (
                    <button
                      key={drafter.id}
                      onClick={() => claimDrafter(drafter.name)}
                      disabled={isClaimed || isSaving}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        isClaimed
                          ? "cursor-not-allowed border-white/10 bg-slate-900 text-slate-500"
                          : "border-cyan-300 bg-cyan-300/10 text-white hover:bg-cyan-300/20"
                      }`}
                    >
                      <div className="font-black">{drafter.name}</div>
                      <div className="mt-1 text-xs">
                        {isClaimed ? "Already claimed" : "Available to claim"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900 p-4">
              <p className="text-sm font-semibold text-slate-300">
                Current turn:
              </p>

              <p className="mt-1 text-2xl font-black">
                {currentDrafter?.name || "No current drafter"}
              </p>

              {canPick ? (
                <p className="mt-2 text-sm font-semibold text-green-200">
                  It is your turn. Pick below.
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-400">
                  {myParticipant
                    ? "Wait for your turn."
                    : "Claim a drafter slot first."}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
                  Make a Pick
                </p>

                <h2 className="mt-2 text-4xl font-black">
                  {canPick ? "You are on the clock" : "Waiting"}
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
                isClickable={() => canPick && !isSaving}
                emptyMessage="No available items."
                legend={[
                  { label: "Drafted", swatchClassName: "bg-green-400/20" },
                  { label: "Available", swatchClassName: "bg-white/10" },
                ]}
              />
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-black">Draft Board</h2>

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
        </section>
      </section>
    </main>
  );
}