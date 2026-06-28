"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { CFB_ITEMS, CONFERENCE_ORDER, CONFERENCE_TIERS, TIER_ORDER } from "@/lib/cfbTeams";
import { buildTiers, groupItemsByConference } from "@/lib/draftBoard";
import { CompactDraftBoard } from "@/components/CompactDraftBoard";
import { PrestigeStars } from "@/components/PrestigeStars";

type Drafter = {
  id: number;
  name: string;
  lotteryTickets: number;
  missedPicks?: number;
};

type DraftItem = {
  id: number;
  name: string;
  category: string;
  description: string;
  color?: string;
  prestige?: number | null;
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
  pickTimeLimitSeconds?: number | null;
  pickDeadline?: string | null;
};

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours === 0) parts.push(`${minutes}m`);

  return parts.join(" ");
}

function formatClock(totalSeconds: number) {
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

type RoomDraft = {
  id: string;
  user_id: string;
  title: string;
  draft_data: SavedDraftState;
  updated_at: string;
  is_joinable: boolean;
};

type Participant = {
  id: string;
  user_id: string;
  drafter_name: string;
  role: "host" | "participant";
};

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawDraftId = params.draftId;
  const draftId = Array.isArray(rawDraftId) ? rawDraftId[0] : rawDraftId;

  const [draft, setDraft] = useState<RoomDraft | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [liveMessage, setLiveMessage] = useState("Connecting to live room...");
  const [now, setNow] = useState(() => Date.now());
  const [timeLimitHoursInput, setTimeLimitHoursInput] = useState(0);
  const [timeLimitMinutesInput, setTimeLimitMinutesInput] = useState(5);
  const skipInFlightRef = useRef(false);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!draftId) return;

    const roomDraftId = draftId;

    loadRoomDraft(roomDraftId);

    const draftChannel = supabase
      .channel(`room-draft-${roomDraftId}`)
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
      .channel(`room-participants-${roomDraftId}`)
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

  useEffect(() => {
    if (!isLoading && !userEmail && draftId) {
      router.replace(`/login?redirect=/room/${draftId}`);
    }
  }, [isLoading, userEmail, draftId, router]);


  async function loadRoomDraft(roomDraftId = draftId) {
    if (!roomDraftId) return;

    setIsLoading(true);
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();
    setUserEmail(userData.user?.email ?? null);
    setCurrentUserId(userData.user?.id ?? null);

    if (!userData.user) {
      setDraft(null);
      setParticipants([]);
      setIsLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("drafts")
      .select("id, user_id, title, draft_data, updated_at, is_joinable")
      .eq("id", roomDraftId)
      .maybeSingle();

    if (error) {
      setMessage(error.message);
      setDraft(null);
    } else if (!data) {
      setMessage("This draft was not found, or you do not have access.");
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

  const isOwner = Boolean(draft && currentUserId && draft.user_id === currentUserId);
  const playAsParticipant = isOwner && searchParams.get("play") === "1";
  const viewAsPlayer = !isOwner || playAsParticipant;

  const draftData = draft?.draft_data;
  const drafters = draftData?.drafters ?? [];
  const picks = draftData?.picks ?? [];
  const availableItems = draftData?.availableItems ?? [];

  const currentPickNumber = picks.length + 1;

  const currentDrafter = useMemo(() => {
    if (picks.length >= drafters.length) return undefined;

    return drafters[picks.length];
  }, [drafters, picks.length]);

  const isDraftComplete =
    drafters.length > 0 &&
    (picks.length >= drafters.length || availableItems.length === 0);

  const pickTimeLimitSeconds = draftData?.pickTimeLimitSeconds ?? null;
  const pickDeadlineMs = draftData?.pickDeadline
    ? new Date(draftData.pickDeadline).getTime()
    : null;
  const remainingSeconds =
    pickDeadlineMs != null ? Math.ceil((pickDeadlineMs - now) / 1000) : null;
  const isTimeExpired = remainingSeconds != null && remainingSeconds <= 0;

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

  const canPick =
    Boolean(myParticipant) &&
    Boolean(currentDrafter) &&
    myParticipant?.drafter_name === currentDrafter?.name &&
    availableItems.length > 0;

  useEffect(() => {
    if (viewAsPlayer) return;
    if (!draftData || !currentDrafter || isDraftComplete) return;
    if (!isTimeExpired) return;
    if (skipInFlightRef.current) return;

    skipInFlightRef.current = true;
    handleMissedPick().finally(() => {
      skipInFlightRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTimeExpired, viewAsPlayer, draftData, currentDrafter, isDraftComplete]);

  function exportResultsCsv() {
    if (picks.length === 0) return;

    const csvHeader = "Pick,Drafter,Item,Category,Description\n";

    const csvRows = picks
      .map((pick) =>
        [
          pick.pickNumber,
          pick.drafter,
          pick.item.name,
          pick.item.category,
          pick.item.description,
        ]
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(",")
      )
      .join("\n");

    const csvContent = csvHeader + csvRows;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const safeTitle = (draftData?.draftTitle || draft?.title || "draft")
      .trim()
      .replaceAll(" ", "-")
      .toLowerCase();

    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeTitle}-results.csv`;
    link.click();

    URL.revokeObjectURL(url);
  }

  const availableItemIds = useMemo(
    () => new Set(availableItems.map((item) => item.id)),
    [availableItems]
  );

  const pickByItemId = useMemo(() => {
    const map = new Map<number, Pick>();
    picks.forEach((pick) => map.set(pick.item.id, pick));
    return map;
  }, [picks]);

  const fullItemGroups = useMemo(
    () => groupItemsByConference(CFB_ITEMS, [], CONFERENCE_ORDER).groups,
    []
  );

  const searchedGroups = useMemo(() => {
    const searchText = search.toLowerCase();

    return fullItemGroups
      .map((group) => ({
        category: group.category,
        items: group.items.filter((item) =>
          `${item.name} ${item.category} ${item.description}`
            .toLowerCase()
            .includes(searchText)
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [fullItemGroups, search]);

  const tiers = useMemo(
    () => buildTiers(searchedGroups, CONFERENCE_TIERS, TIER_ORDER),
    [searchedGroups]
  );

  const { pickByItemId: pickedById, groups: pickedGroups } = useMemo(
    () => groupItemsByConference([], picks, CONFERENCE_ORDER),
    [picks]
  );

  const pickedTiers = useMemo(
    () => buildTiers(pickedGroups, CONFERENCE_TIERS, TIER_ORDER),
    [pickedGroups]
  );

  function getRoomLink() {
    if (!draft) return "";

    return `https://cfb-draft.vercel.app/room/${draft.id}`;
  }

  async function copyRoomLink() {
    const url = getRoomLink();

    try {
      await navigator.clipboard.writeText(url);
      setMessage("Draft link copied to clipboard.");
    } catch {
      setMessage(`Copy this link: ${url}`);
    }
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

    setIsSaving(false);
  }

  function deadlineForIndex(limitSeconds: number | null | undefined, index: number) {
    if (!limitSeconds || index >= drafters.length) return null;
    return new Date(Date.now() + limitSeconds * 1000).toISOString();
  }

  async function makePick(item: DraftItem) {
    if (!draftData || !currentDrafter) return;

    if (viewAsPlayer && !canPick) {
      setMessage("It is not your turn yet.");
      return;
    }

    if (!availableItems.some((availableItem) => availableItem.id === item.id)) {
      setMessage("That team has already been drafted.");
      return;
    }

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
      pickDeadline: deadlineForIndex(draftData.pickTimeLimitSeconds, picks.length + 1),
    };

    await saveRoomDraft(nextDraftData);
    setMessage(`Drafted ${item.name}.`);
  }

  async function undoLastPick() {
    if (!draftData || picks.length === 0) return;

    const lastPick = picks[picks.length - 1];

    const nextDraftData: SavedDraftState = {
      ...draftData,
      picks: picks.slice(0, -1),
      availableItems: [...availableItems, lastPick.item],
      pickDeadline: deadlineForIndex(draftData.pickTimeLimitSeconds, picks.length - 1),
    };

    await saveRoomDraft(nextDraftData);
  }

  async function handleMissedPick() {
    if (!draftData || !currentDrafter) return;

    const onClockIndex = picks.length;
    const missCount = (currentDrafter.missedPicks ?? 0) + 1;
    const updatedDrafter: Drafter = { ...currentDrafter, missedPicks: missCount };
    const nextDrafters = [...drafters];
    const bumpedToEnd = missCount >= 3;

    if (bumpedToEnd) {
      nextDrafters.splice(onClockIndex, 1);
      nextDrafters.push(updatedDrafter);
    } else if (onClockIndex + 1 < nextDrafters.length) {
      nextDrafters[onClockIndex] = nextDrafters[onClockIndex + 1];
      nextDrafters[onClockIndex + 1] = updatedDrafter;
    } else {
      nextDrafters[onClockIndex] = updatedDrafter;
    }

    const nextDraftData: SavedDraftState = {
      ...draftData,
      drafters: nextDrafters,
      pickDeadline: deadlineForIndex(draftData.pickTimeLimitSeconds, onClockIndex),
    };

    await saveRoomDraft(nextDraftData);
    setMessage(
      bumpedToEnd
        ? `${currentDrafter.name} missed 3 picks and was moved to the end of the draft order.`
        : `${currentDrafter.name} ran out of time and was pushed back a spot.`
    );
  }

  async function setPickTimeLimit(totalSeconds: number | null) {
    if (!draftData) return;

    const nextDraftData: SavedDraftState = {
      ...draftData,
      pickTimeLimitSeconds: totalSeconds,
      pickDeadline: deadlineForIndex(totalSeconds, picks.length),
    };

    await saveRoomDraft(nextDraftData);
    setMessage(
      totalSeconds
        ? `Pick time limit set to ${formatDuration(totalSeconds)}.`
        : "Pick time limit removed."
    );
  }

  async function claimDrafter(drafterName: string) {
    if (!draft || !currentUserId) return;

    const confirmed = window.confirm(
      "Are you sure this is the draft slot you want to pick?"
    );

    if (!confirmed) {
      return;
    }

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

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            CFB Draft Tool
          </p>
          <h1 className="mt-4 text-4xl font-black">Loading draft room...</h1>
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

          <h1 className="mt-4 text-4xl font-black">Redirecting to login...</h1>
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

          <h1 className="mt-4 text-4xl font-black">Room Unavailable</h1>

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

  if (!isOwner && !draft.is_joinable) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            CFB Draft Tool
          </p>

          <h1 className="mt-4 text-4xl font-black">Player Picks Are Off</h1>

          <p className="mt-4 text-slate-300">
            The host has not enabled player self-picking for this draft yet.
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
              {!viewAsPlayer ? "Host Room" : playAsParticipant ? "Player Room (Host)" : "Player Room"}
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
                {!viewAsPlayer
                  ? "Dedicated host-controlled room. Player picks update this page live."
                  : "Claim your drafter slot. When it is your turn, you can make your own pick."}
              </p>

              <p className="mt-3 text-sm text-slate-500">
                Last updated {new Date(draft.updated_at).toLocaleString()}
              </p>

              <p className="mt-2 text-sm font-semibold text-green-200">
                {liveMessage}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              {!viewAsPlayer ? (
                <>
                  <button
                    onClick={() =>
                      window.open(`${getRoomLink()}?play=1`, "_blank")
                    }
                    className="rounded-2xl bg-green-400 px-5 py-3 text-center font-bold text-slate-950 transition hover:bg-green-300"
                  >
                    Enter Live Draft
                  </button>

                  <button
                    onClick={copyRoomLink}
                    className="rounded-2xl bg-white px-5 py-3 text-center font-bold text-slate-950 transition hover:bg-slate-200"
                  >
                    Copy Draft Link
                  </button>

                  <Link
                    href="/rooms"
                    className="rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15"
                  >
                    All Rooms
                  </Link>

                  <Link
                    href="/"
                    className="rounded-2xl bg-cyan-400 px-5 py-3 text-center font-bold text-slate-950 transition hover:bg-cyan-300"
                  >
                    Home
                  </Link>
                </>
              ) : (
                <button
                  onClick={() => loadRoomDraft()}
                  className="rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15"
                >
                  Refresh
                </button>
              )}
            </div>
          </div>

          {!viewAsPlayer && draft.is_joinable && (
            <div className="mt-5 rounded-2xl border border-purple-400/30 bg-purple-400/10 p-4 text-sm font-semibold text-purple-100">
              Player self-picking is enabled. Draft link: {getRoomLink()}
            </div>
          )}

          {message && (
            <div className="mt-5 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm font-semibold text-cyan-100">
              {message}
            </div>
          )}
        </header>

        {!viewAsPlayer && (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-black">Pick Timer</h2>
            <p className="mt-2 text-sm text-slate-400">
              Set a per-pick time limit. If a drafter&apos;s timer runs out,
              they&apos;re pushed back one spot. Miss 3 picks and they&apos;re
              moved to the very end of the draft order.
            </p>

            <div className="mt-5 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                Hours
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={timeLimitHoursInput}
                  onChange={(event) =>
                    setTimeLimitHoursInput(
                      Math.max(0, Number(event.target.value) || 0)
                    )
                  }
                  className="w-20 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-300"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                Minutes
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={timeLimitMinutesInput}
                  onChange={(event) =>
                    setTimeLimitMinutesInput(
                      Math.max(0, Math.min(59, Number(event.target.value) || 0))
                    )
                  }
                  className="w-20 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-300"
                />
              </label>

              <button
                onClick={() =>
                  setPickTimeLimit(
                    timeLimitHoursInput * 3600 + timeLimitMinutesInput * 60
                  )
                }
                disabled={
                  isSaving ||
                  timeLimitHoursInput * 3600 + timeLimitMinutesInput * 60 <= 0
                }
                className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Set Time Limit
              </button>

              <button
                onClick={() => setPickTimeLimit(null)}
                disabled={isSaving || !pickTimeLimitSeconds}
                className="rounded-2xl bg-white/10 px-5 py-3 font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove Limit
              </button>

              <span className="text-sm font-semibold text-slate-400">
                {pickTimeLimitSeconds
                  ? `Current limit: ${formatDuration(pickTimeLimitSeconds)} per pick`
                  : "No time limit set"}
              </span>
            </div>
          </section>
        )}

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
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-green-300">
                  Draft Complete
                </p>
                <h2 className="mt-2 text-3xl font-black">Final Results</h2>
              </div>

              <button
                onClick={exportResultsCsv}
                className="rounded-2xl bg-white px-5 py-3 font-bold text-slate-950 transition hover:bg-slate-200"
              >
                Export Results CSV
              </button>
            </div>

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
                      <div className="flex items-center gap-2">
                        <div className="truncate text-lg font-black">
                          {pick?.item.name ?? "—"}
                        </div>
                        {pick && (
                          <PrestigeStars
                            value={pick.item.prestige}
                            className="flex-shrink-0"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-black">Draft Order &amp; Players</h2>
              <p className="mt-2 text-sm text-slate-400">
                Updates live as players claim slots and make picks.
              </p>
            </div>

            <button
              onClick={() => loadParticipants()}
              className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15"
            >
              Refresh Players
            </button>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {drafters.map((drafter, index) => {
              const participant = participantByName.get(
                drafter.name.toLowerCase()
              );
              const pick = picks.find((p) => p.drafter === drafter.name);
              const isOnClock = drafter.id === currentDrafter?.id;
              const isMe =
                viewAsPlayer && myParticipant?.drafter_name === drafter.name;

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
                    {isMe && (
                      <span className="ml-1 text-xs font-normal text-slate-400">
                        (you)
                      </span>
                    )}
                    {Boolean(drafter.missedPicks) && (
                      <span className="ml-1.5 rounded-full border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 text-[9px] font-bold text-red-300">
                        Missed {drafter.missedPicks}
                      </span>
                    )}
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
                      <PrestigeStars
                        value={pick.item.prestige}
                        className="flex-shrink-0"
                      />
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
          {viewAsPlayer && !myParticipant && (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <h2 className="text-2xl font-black">Your Drafter Slot</h2>

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
                    Claim a drafter slot first.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
                  {!viewAsPlayer ? "Current Pick" : "Make a Pick"}
                </p>

                <h2 className="mt-2 text-4xl font-black">
                  {!viewAsPlayer
                    ? currentDrafter?.name || "No drafter available"
                    : canPick
                      ? "You are on the clock"
                      : "Waiting"}
                </h2>

                <p className="mt-2 text-slate-400">
                  Pick {currentPickNumber} of {drafters.length}
                </p>

                {remainingSeconds != null && currentDrafter && !isDraftComplete && (
                  <p
                    className={`mt-2 text-2xl font-black ${
                      remainingSeconds <= 30 ? "text-red-400" : "text-cyan-300"
                    }`}
                  >
                    {formatClock(remainingSeconds)}
                  </p>
                )}
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
                  if (pick) return { variant: "taken", badge: pick.drafter };
                  if (availableItemIds.has(item.id)) return { variant: "available" };
                  return { variant: "disabled", badge: "Excluded" };
                }}
                onSelect={makePick}
                isClickable={(item) =>
                  (!viewAsPlayer ? Boolean(currentDrafter) : canPick) &&
                  !isSaving &&
                  availableItemIds.has(item.id)
                }
                emptyMessage="No available items."
                legend={[
                  { label: "Drafted", swatchClassName: "bg-green-400/20" },
                  { label: "Available", swatchClassName: "bg-white/10" },
                  { label: "Excluded", swatchClassName: "bg-slate-800/60" },
                ]}
              />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-2xl font-black">Draft Board</h2>
                <p className="mt-2 text-sm text-slate-400">
                  Every selection, organized by conference.
                </p>
              </div>

              {!viewAsPlayer && (
                <button
                  onClick={undoLastPick}
                  disabled={picks.length === 0 || isSaving}
                  className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Host Undo
                </button>
              )}
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
