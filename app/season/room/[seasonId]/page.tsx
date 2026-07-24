"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { teamColor } from "@/lib/cfbTeams";
import {
  advanceWindowStart,
  buildWeekSummary,
  DAY_LABELS,
  formatAdvanceWindow,
  formatHourLabel,
  formatReminderDays,
  formatReminderTime,
  formatWeekLabel,
  pendingExtensionRequests,
  periodHeading,
  readyPlayerIdsForWeek,
  PRESEASON_WEEK,
  type AdvanceWindow,
  type ExtensionRequest,
  type ReminderSchedule,
  type SeasonData,
  type SeasonPlayer,
} from "@/lib/season";
import type { DiscordNotifyPayload } from "@/lib/discord";

function formatClock(totalSeconds: number) {
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

type RoomSeason = {
  id: string;
  user_id: string;
  title: string;
  season_data: SeasonData;
  updated_at: string;
  is_joinable: boolean;
};

type Participant = {
  id: string;
  user_id: string;
  player_name: string;
  role: "host" | "participant";
  is_co_admin: boolean;
};

export default function SeasonRoomPage() {
  const params = useParams();
  const router = useRouter();
  const rawSeasonId = params.seasonId;
  const seasonId = Array.isArray(rawSeasonId) ? rawSeasonId[0] : rawSeasonId;

  const [season, setSeason] = useState<RoomSeason | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const [advanceDateInput, setAdvanceDateInput] = useState("");
  const [advanceStartHourInput, setAdvanceStartHourInput] = useState(19);
  const [advanceEndHourInput, setAdvanceEndHourInput] = useState(22);
  const [extensionDate, setExtensionDate] = useState("");
  const [extensionReason, setExtensionReason] = useState("");
  const [isPostingToDiscord, setIsPostingToDiscord] = useState(false);
  const [isPostingNudge, setIsPostingNudge] = useState(false);
  const [isResyncingClaims, setIsResyncingClaims] = useState(false);
  const [grantDateInputs, setGrantDateInputs] = useState<Record<string, string>>({});
  const [grantHourInputs, setGrantHourInputs] = useState<Record<string, number>>({});
  const [newReminderTime, setNewReminderTime] = useState("20:00");
  const [newReminderDays, setNewReminderDays] = useState<Set<number>>(new Set());
  const [newReminderPingEveryone, setNewReminderPingEveryone] = useState(false);
  const [discordUsername, setDiscordUsername] = useState<string | null>(null);
  // Only meaningful for the host: which side of the room they're currently
  // looking at. Lets a host who's also a player flip over and see exactly
  // what everyone else sees, then flip straight back.
  const [adminView, setAdminView] = useState<"commissioner" | "player">("commissioner");

  async function loadParticipants(roomSeasonId = seasonId) {
    if (!roomSeasonId) return;

    const { data, error } = await supabase
      .from("season_participants")
      .select("id, user_id, player_name, role, is_co_admin")
      .eq("season_id", roomSeasonId);

    if (error) {
      setMessage(error.message);
      return;
    }

    setParticipants((data || []) as Participant[]);
  }

  async function loadDiscordLink(userId: string) {
    const { data } = await supabase
      .from("discord_links")
      .select("discord_username")
      .eq("user_id", userId)
      .maybeSingle();

    setDiscordUsername(data?.discord_username ?? null);
  }

  async function loadRoomSeason(roomSeasonId = seasonId) {
    if (!roomSeasonId) return;

    setIsLoading(true);
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();
    setUserEmail(userData.user?.email ?? null);
    setCurrentUserId(userData.user?.id ?? null);

    if (!userData.user) {
      setSeason(null);
      setParticipants([]);
      setIsLoading(false);
      return;
    }

    await loadDiscordLink(userData.user.id);

    const { data, error } = await supabase
      .from("seasons")
      .select("id, user_id, title, season_data, updated_at, is_joinable")
      .eq("id", roomSeasonId)
      .maybeSingle();

    if (error) {
      setMessage(error.message);
      setSeason(null);
    } else if (!data) {
      setMessage("This season was not found, or you do not have access.");
      setSeason(null);
    } else {
      setSeason(data as RoomSeason);
      await loadParticipants(roomSeasonId);
    }

    setIsLoading(false);
  }

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!seasonId) return;
    // Deliberate one-shot load on mount/navigation, not a live subscription.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRoomSeason(seasonId);
  }, [seasonId]);

  useEffect(() => {
    if (!isLoading && !userEmail && seasonId) {
      router.replace(`/login?redirect=/season/room/${seasonId}`);
    }
  }, [isLoading, userEmail, seasonId, router]);

  const isOwner = Boolean(
    season && currentUserId && season.user_id === currentUserId
  );

  const seasonData = season?.season_data;
  const players = seasonData?.players ?? [];
  const currentWeek = seasonData?.currentWeek ?? PRESEASON_WEEK;

  const readyPlayerIds = useMemo(
    () => new Set(seasonData ? readyPlayerIdsForWeek(seasonData, currentWeek) : []),
    [seasonData, currentWeek]
  );

  const pendingRequests = useMemo(
    () => (seasonData ? pendingExtensionRequests(seasonData) : []),
    [seasonData]
  );

  const reminders = seasonData?.reminders ?? [];

  const advanceStart = advanceWindowStart(seasonData?.advanceWindow);
  const advanceStartMs = advanceStart ? advanceStart.getTime() : null;
  const remainingSeconds =
    advanceStartMs != null ? Math.ceil((advanceStartMs - now) / 1000) : null;
  const isAdvanceWindowPassed = remainingSeconds != null && remainingSeconds <= 0;

  const participantByName = useMemo(() => {
    const map = new Map<string, Participant>();
    participants.forEach((participant) =>
      map.set(participant.player_name.toLowerCase(), participant)
    );
    return map;
  }, [participants]);

  const myParticipant = useMemo(() => {
    if (!currentUserId) return undefined;
    return participants.find(
      (participant) => participant.user_id === currentUserId
    );
  }, [participants, currentUserId]);

  const myPlayer = useMemo(() => {
    if (!myParticipant) return undefined;
    return players.find(
      (player) =>
        player.name.toLowerCase() === myParticipant.player_name.toLowerCase()
    );
  }, [players, myParticipant]);

  // Non-owners are always in "player" mode. The host toggles between the two.
  const showCommissionerControls = isOwner && adminView === "commissioner";
  const showPlayerStatus =
    Boolean(myParticipant && myPlayer) && (!isOwner || adminView === "player");

  // A co-admin can toggle ready status for anyone, but gets none of the
  // rest of Commissioner Controls. The host doesn't need this separate
  // view -- the ready/unready toggle is already in Manage Players.
  const isCoAdmin = Boolean(myParticipant?.is_co_admin);
  const showCoAdminControls = isCoAdmin && !isOwner;

  const myPendingOrGrantedRequest = useMemo(() => {
    if (!myPlayer || !seasonData) return undefined;
    return seasonData.extensionRequests.find(
      (request) =>
        request.playerId === myPlayer.id &&
        request.week === currentWeek &&
        (request.status === "pending" || request.status === "granted")
    );
  }, [myPlayer, seasonData, currentWeek]);

  function getRoomLink() {
    if (!season) return "";
    return `${typeof window !== "undefined" ? window.location.origin : ""}/season/room/${season.id}`;
  }

  async function copyRoomLink() {
    const url = getRoomLink();
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Room link copied to clipboard.");
    } catch {
      setMessage(`Copy this link: ${url}`);
    }
  }

  async function saveRoomSeason(nextSeasonData: SeasonData): Promise<boolean> {
    if (!season) return false;

    setIsSaving(true);
    setMessage("");

    // .select("id") is deliberate: if RLS silently blocks the write (the
    // row just doesn't match the policy), Supabase returns no error at
    // all -- 0 rows updated looks identical to success unless we check
    // what actually came back. Without this, a blocked write would look
    // like it saved in this tab while the database never changed.
    const { data, error } = await supabase
      .from("seasons")
      .update({
        title: nextSeasonData.seasonTitle,
        season_data: nextSeasonData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", season.id)
      .select("id");

    if (error) {
      setMessage(error.message);
      setIsSaving(false);
      return false;
    }

    if (!data || data.length === 0) {
      setMessage(
        "Your change didn't save. You may not have permission to edit this season, or your session may have expired -- try refreshing and signing in again."
      );
      setIsSaving(false);
      return false;
    }

    setSeason({
      ...season,
      title: nextSeasonData.seasonTitle,
      season_data: nextSeasonData,
      updated_at: new Date().toISOString(),
    });

    setIsSaving(false);
    return true;
  }

  // This page deliberately has no realtime subscription (load-on-mount +
  // manual Refresh only), so a tab can sit open for a long time while other
  // people change the season. Reading season_data straight from the DB
  // right before a write — instead of trusting whatever this tab loaded at
  // mount — keeps a stale tab from silently clobbering someone else's more
  // recent change (e.g. a player's "ready" getting wiped out by another
  // save that was based on an older snapshot).
  async function fetchFreshSeasonData(): Promise<SeasonData | null> {
    if (!season) return null;

    const { data, error } = await supabase
      .from("seasons")
      .select("season_data")
      .eq("id", season.id)
      .maybeSingle();

    if (error || !data) return null;
    return data.season_data as SeasonData;
  }

  // Safe read-modify-write: fetches the freshest season_data, applies
  // `mutate` to it, and saves the result. Returns the saved data (or null
  // if nothing was saved) so callers can use it for things like Discord
  // notifications instead of a possibly-stale local value.
  async function updateSeasonData(
    mutate: (fresh: SeasonData) => SeasonData
  ): Promise<SeasonData | null> {
    if (!seasonData) return null;

    const fresh = (await fetchFreshSeasonData()) ?? seasonData;
    const nextSeasonData = mutate(fresh);
    const saved = await saveRoomSeason(nextSeasonData);
    return saved ? nextSeasonData : null;
  }

  async function notifyDiscord(payload: DiscordNotifyPayload): Promise<boolean> {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return false;

      const response = await fetch("/api/discord/notify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  async function postSummaryToDiscord() {
    if (!seasonData || !season) return;

    setIsPostingToDiscord(true);

    // Always post from the DB's current state, not whatever this tab
    // happened to load at mount — otherwise a stale tab posts last week's
    // status even though the season has already moved on.
    const fresh = (await fetchFreshSeasonData()) ?? seasonData;
    const freshWeek = fresh.currentWeek;

    const ok = await notifyDiscord({
      type: "summary",
      seasonId: season.id,
      periodHeading: periodHeading(fresh.periodLabel, freshWeek, fresh.seasonYear),
      summary: buildWeekSummary(fresh, freshWeek),
      plannedAdvanceTime: formatAdvanceWindow(fresh.advanceWindow),
    });

    setSeason((current) => (current ? { ...current, season_data: fresh } : current));

    setMessage(
      ok
        ? "Posted status to Discord."
        : "Couldn't post to Discord — make sure DISCORD_WEBHOOK_URL is set on the server."
    );
    setIsPostingToDiscord(false);
  }

  // Same buttons, no ready/pending/granted/denied breakdown -- for a quick
  // "check in" nudge without re-posting the full status list every time.
  async function postNudgeToDiscord() {
    if (!seasonData || !season) return;

    setIsPostingNudge(true);

    const fresh = (await fetchFreshSeasonData()) ?? seasonData;

    const ok = await notifyDiscord({
      type: "nudge",
      seasonId: season.id,
      periodHeading: periodHeading(fresh.periodLabel, fresh.currentWeek, fresh.seasonYear),
      plannedAdvanceTime: formatAdvanceWindow(fresh.advanceWindow),
    });

    setSeason((current) => (current ? { ...current, season_data: fresh } : current));

    setMessage(
      ok
        ? "Posted a quick reminder link to Discord."
        : "Couldn't post to Discord — make sure the bot is configured on the server."
    );
    setIsPostingNudge(false);
  }

  async function saveTitle(value: string) {
    if (!seasonData) return;
    const cleanTitle = value.trim() || "Untitled Season";
    await updateSeasonData((fresh) => ({ ...fresh, seasonTitle: cleanTitle }));
  }

  async function savePeriodLabel(value: string) {
    if (!seasonData) return;
    await updateSeasonData((fresh) => ({ ...fresh, periodLabel: value.trim() || null }));
  }

  async function saveSeasonYear(value: number) {
    if (!seasonData || !Number.isFinite(value)) return;
    await updateSeasonData((fresh) => ({ ...fresh, seasonYear: value }));
  }

  async function removePlayer(player: SeasonPlayer) {
    if (!seasonData || !season) return;

    const participant = participantByName.get(player.name.toLowerCase());

    const confirmed = window.confirm(
      `Remove ${player.name} from the season? This releases their claimed slot (if any) and clears their ready/extension history. This can't be undone.`
    );
    if (!confirmed) return;

    setIsSaving(true);
    setMessage("");

    if (participant) {
      const { error } = await supabase
        .from("season_participants")
        .delete()
        .eq("id", participant.id);

      if (error) {
        setMessage(error.message);
        setIsSaving(false);
        return;
      }
    }

    await updateSeasonData((fresh) => ({
      ...fresh,
      players: fresh.players.filter((p) => p.id !== player.id),
      readyPlayerIdsByWeek: Object.fromEntries(
        Object.entries(fresh.readyPlayerIdsByWeek).map(([week, ids]) => [
          week,
          ids.filter((id) => id !== player.id),
        ])
      ),
      extensionRequests: fresh.extensionRequests.filter(
        (request) => request.playerId !== player.id
      ),
    }));
    await loadParticipants(season.id);
    setMessage(`Removed ${player.name} from the season.`);
    setIsSaving(false);
  }

  async function renamePlayer(player: SeasonPlayer, rawNewName: string) {
    if (!seasonData || !season) return;

    const newName = rawNewName.trim();
    if (!newName || newName === player.name) return;

    const nameCollision = players.some(
      (p) => p.id !== player.id && p.name.toLowerCase() === newName.toLowerCase()
    );
    if (nameCollision) {
      setMessage(`Another player is already named "${newName}".`);
      return;
    }

    setIsSaving(true);
    setMessage("");

    const participant = participantByName.get(player.name.toLowerCase());
    if (participant) {
      const { error } = await supabase
        .from("season_participants")
        .update({ player_name: newName })
        .eq("id", participant.id);

      if (error) {
        setMessage(error.message);
        setIsSaving(false);
        return;
      }
    }

    await updateSeasonData((fresh) => ({
      ...fresh,
      players: fresh.players.map((p) => (p.id === player.id ? { ...p, name: newName } : p)),
    }));
    await loadParticipants(season.id);
    setMessage(`Renamed to ${newName}.`);
    setIsSaving(false);
  }

  // Admin/co-admin override: unlike a player's own one-way "mark ready"
  // lock-in, this can be toggled back and forth freely.
  async function hostSetPlayerReady(player: SeasonPlayer, ready: boolean) {
    if (!seasonData) return;

    await updateSeasonData((fresh) => {
      const week = fresh.currentWeek;
      const current = new Set(readyPlayerIdsForWeek(fresh, week));
      if (ready) {
        current.add(player.id);
      } else {
        current.delete(player.id);
      }
      return {
        ...fresh,
        readyPlayerIdsByWeek: { ...fresh.readyPlayerIdsByWeek, [week]: Array.from(current) },
      };
    });

    setMessage(ready ? `Marked ${player.name} ready.` : `Marked ${player.name} not ready.`);
  }

  async function toggleCoAdmin(participant: Participant) {
    if (!season) return;

    setIsSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("season_participants")
      .update({ is_co_admin: !participant.is_co_admin })
      .eq("id", participant.id);

    if (error) {
      setMessage(error.message);
    } else {
      setMessage(
        participant.is_co_admin
          ? `Removed co-admin access from ${participant.player_name}.`
          : `Made ${participant.player_name} a co-admin (can only mark players ready/not ready).`
      );
      await loadParticipants(season.id);
    }

    setIsSaving(false);
  }

  async function markReady() {
    if (!seasonData || !myPlayer) return;

    // Fetch fresh before deciding anything — if this tab has been open a
    // while, the season may have already advanced, or another tab may have
    // already marked this player ready, since there's no realtime sync.
    const fresh = (await fetchFreshSeasonData()) ?? seasonData;
    const week = fresh.currentWeek;

    if (readyPlayerIdsForWeek(fresh, week).includes(myPlayer.id)) {
      setSeason((current) => (current ? { ...current, season_data: fresh } : current));
      return;
    }

    const confirmed = window.confirm(
      `Mark yourself ready to advance for ${formatWeekLabel(week)}? This locks in your status and can't be undone.`
    );
    if (!confirmed) return;

    const readyIdsForWeek = new Set(readyPlayerIdsForWeek(fresh, week));
    readyIdsForWeek.add(myPlayer.id);

    const nextSeasonData: SeasonData = {
      ...fresh,
      readyPlayerIdsByWeek: {
        ...fresh.readyPlayerIdsByWeek,
        [week]: Array.from(readyIdsForWeek),
      },
    };

    const saved = await saveRoomSeason(nextSeasonData);
    if (!saved) return;

    notifyDiscord({
      type: "ready",
      seasonTitle: nextSeasonData.seasonTitle,
      week,
      playerName: myPlayer.name,
      team: myPlayer.team,
    });
  }

  async function requestExtension() {
    if (!seasonData || !myPlayer) return;
    if (!extensionDate) return;

    const requestedUntilDate = extensionDate;
    const reason = extensionReason.trim() || undefined;

    setExtensionDate("");
    setExtensionReason("");

    let postedWeek = currentWeek;

    const updated = await updateSeasonData((fresh) => {
      postedWeek = fresh.currentWeek;
      const request: ExtensionRequest = {
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}`,
        playerId: myPlayer.id,
        week: fresh.currentWeek,
        requestedUntilDate,
        reason,
        status: "pending",
        requestedAt: new Date().toISOString(),
      };
      return { ...fresh, extensionRequests: [...fresh.extensionRequests, request] };
    });

    if (!updated) return;

    setMessage("Extension request sent to the commissioner.");

    notifyDiscord({
      type: "extension_requested",
      seasonTitle: updated.seasonTitle,
      week: postedWeek,
      playerName: myPlayer.name,
      team: myPlayer.team,
      requestedUntilDate,
      reason,
    });
  }

  // On grant, the host picks the actual date + hour the extension runs
  // until (defaulting to what the player asked for); deny needs no input.
  async function resolveExtension(
    requestId: string,
    approve: boolean,
    grantedUntilDate?: string,
    grantedUntilHour?: number
  ) {
    if (!seasonData) return;

    await updateSeasonData((fresh) => ({
      ...fresh,
      extensionRequests: fresh.extensionRequests.map((request) => {
        if (request.id !== requestId) return request;

        let grantedUntil: string | undefined;
        if (approve && grantedUntilDate) {
          const [year, month, day] = grantedUntilDate.split("-").map(Number);
          grantedUntil = new Date(
            year,
            month - 1,
            day,
            grantedUntilHour ?? 20,
            0,
            0,
            0
          ).toISOString();
        }

        return {
          ...request,
          status: approve ? ("granted" as const) : ("denied" as const),
          resolvedAt: new Date().toISOString(),
          grantedUntil,
        };
      }),
    }));
    setMessage(approve ? "Extension granted." : "Extension denied.");
  }

  async function setAdvanceWindow(nextWindow: AdvanceWindow | null) {
    if (!seasonData) return;
    await updateSeasonData((fresh) => ({ ...fresh, advanceWindow: nextWindow }));
    setMessage(
      nextWindow ? "Anticipated advance time set." : "Anticipated advance time removed."
    );
  }

  function toggleNewReminderDay(day: number) {
    setNewReminderDays((current) => {
      const next = new Set(current);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }

  async function addReminder() {
    if (!seasonData || !newReminderTime || newReminderDays.size === 0) return;

    const reminder: ReminderSchedule = {
      id:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}`,
      time: newReminderTime,
      daysOfWeek: Array.from(newReminderDays),
      pingEveryone: newReminderPingEveryone,
      enabled: true,
      lastSentDate: null,
    };

    await updateSeasonData((fresh) => ({
      ...fresh,
      reminders: [...(fresh.reminders || []), reminder],
    }));

    setNewReminderDays(new Set());
    setNewReminderPingEveryone(false);
    setMessage("Reminder added.");
  }

  async function toggleReminderEnabled(reminderId: string) {
    if (!seasonData) return;
    await updateSeasonData((fresh) => ({
      ...fresh,
      reminders: (fresh.reminders || []).map((reminder) =>
        reminder.id === reminderId ? { ...reminder, enabled: !reminder.enabled } : reminder
      ),
    }));
  }

  async function removeReminder(reminderId: string) {
    if (!seasonData) return;
    await updateSeasonData((fresh) => ({
      ...fresh,
      reminders: (fresh.reminders || []).filter((reminder) => reminder.id !== reminderId),
    }));
    setMessage("Reminder removed.");
  }

  async function advanceWeek() {
    if (!seasonData || !season) return;

    const readyCount = readyPlayerIdsForWeek(seasonData, currentWeek).length;
    const outstanding = players.length - readyCount;

    if (outstanding > 0) {
      const confirmed = window.confirm(
        `${outstanding} player(s) haven't marked ready yet for ${formatWeekLabel(currentWeek)}. Advance anyway?`
      );
      if (!confirmed) return;
    }

    const updated = await updateSeasonData((fresh) => {
      const freshNextWeek = fresh.currentWeek + 1;
      return {
        ...fresh,
        currentWeek: freshNextWeek,
        readyPlayerIdsByWeek: {
          ...fresh.readyPlayerIdsByWeek,
          [freshNextWeek]: fresh.readyPlayerIdsByWeek[freshNextWeek] ?? [],
        },
        periodLabel: null,
        advanceWindow: null,
      };
    });

    if (!updated) {
      setMessage("Something went wrong advancing the week. Try again.");
      return;
    }

    setMessage(`Advanced to ${formatWeekLabel(updated.currentWeek)}. Posting to Discord...`);

    // Auto-post so everyone gets a fresh "I'm Ready" prompt for the new
    // week immediately, instead of waiting on the next scheduled reminder.
    const posted = await notifyDiscord({
      type: "summary",
      seasonId: season.id,
      periodHeading: periodHeading(updated.periodLabel, updated.currentWeek, updated.seasonYear),
      summary: buildWeekSummary(updated, updated.currentWeek),
      plannedAdvanceTime: formatAdvanceWindow(updated.advanceWindow),
    });

    setMessage(
      posted
        ? `Advanced to ${formatWeekLabel(updated.currentWeek)} and posted to Discord.`
        : `Advanced to ${formatWeekLabel(updated.currentWeek)}, but couldn't post to Discord.`
    );
  }

  // Dev-only helper: seeds a realistic mix of ready/pending/granted/denied
  // statuses on the current week so the different card states can be seen
  // without needing separate real accounts for every player.
  async function loadExampleStatuses() {
    if (!seasonData || players.length === 0) return;

    const ids = players.map((p) => p.id);
    const readyIds = ids.slice(0, 6);
    const pendingIds = ids.slice(6, 9);
    const grantedIds = ids.slice(9, 11);
    const deniedIds = ids.slice(11, 13);

    const now = new Date();
    const demoDate = (daysAhead: number) =>
      new Date(now.getTime() + daysAhead * 86400000).toISOString().slice(0, 10);

    const demoRequests: ExtensionRequest[] = [
      ...pendingIds.map((id) => ({
        id: `demo-pending-${id}`,
        playerId: id,
        week: currentWeek,
        requestedUntilDate: demoDate(2),
        reason: "Out of town this week",
        status: "pending" as const,
        requestedAt: now.toISOString(),
      })),
      ...grantedIds.map((id) => ({
        id: `demo-granted-${id}`,
        playerId: id,
        week: currentWeek,
        requestedUntilDate: demoDate(1),
        status: "granted" as const,
        requestedAt: now.toISOString(),
        resolvedAt: now.toISOString(),
        grantedUntil: new Date(now.getTime() + 12 * 3600 * 1000).toISOString(),
      })),
      ...deniedIds.map((id) => ({
        id: `demo-denied-${id}`,
        playerId: id,
        week: currentWeek,
        requestedUntilDate: demoDate(3),
        status: "denied" as const,
        requestedAt: now.toISOString(),
        resolvedAt: now.toISOString(),
      })),
    ];

    await saveRoomSeason({
      ...seasonData,
      readyPlayerIdsByWeek: {
        ...seasonData.readyPlayerIdsByWeek,
        [currentWeek]: readyIds,
      },
      extensionRequests: [
        ...seasonData.extensionRequests.filter(
          (request) => !request.id.startsWith("demo-")
        ),
        ...demoRequests,
      ],
    });
    setMessage("Loaded example statuses for this week (dev only).");
  }

  // Pulls in anyone who claimed their drafter slot in the original draft but
  // hasn't landed as a season_participants row yet — covers both drafts
  // imported before the host-bulk-insert RLS policy existed, and anyone who
  // claimed their draft slot after the season was already created.
  async function resyncClaimsFromDraft() {
    if (!season || !seasonData?.sourceDraftId) return;

    setIsResyncingClaims(true);
    setMessage("");

    const { data: draftParticipants, error: fetchError } = await supabase
      .from("draft_participants")
      .select("user_id, drafter_name, role")
      .eq("draft_id", seasonData.sourceDraftId);

    if (fetchError) {
      setMessage(fetchError.message);
      setIsResyncingClaims(false);
      return;
    }

    const claimedNames = new Set(participants.map((p) => p.player_name.toLowerCase()));
    const claimedUserIds = new Set(participants.map((p) => p.user_id));

    const rows = (draftParticipants || [])
      .filter(
        (p) =>
          !claimedNames.has(p.drafter_name.toLowerCase()) && !claimedUserIds.has(p.user_id)
      )
      .map((p) => ({
        season_id: season.id,
        user_id: p.user_id,
        player_name: p.drafter_name,
        role: p.role,
      }));

    if (rows.length === 0) {
      setMessage("Nothing to sync — everyone who claimed a slot in the draft is already carried over.");
      setIsResyncingClaims(false);
      return;
    }

    const { error: insertError } = await supabase.from("season_participants").insert(rows);

    if (insertError) {
      setMessage(insertError.message);
    } else {
      setMessage(`Synced ${rows.length} claim(s) from the source draft.`);
      await loadParticipants(season.id);
    }

    setIsResyncingClaims(false);
  }

  async function claimPlayer(player: SeasonPlayer) {
    if (!season || !currentUserId) return;

    const confirmed = window.confirm(
      `Are you sure this is your team: ${player.team ? `${player.team} (${player.name})` : player.name}?`
    );
    if (!confirmed) return;

    setIsSaving(true);
    setMessage("");

    const { error } = await supabase.from("season_participants").insert({
      season_id: season.id,
      user_id: currentUserId,
      player_name: player.name,
      role: "participant",
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage(`You selected ${player.team || player.name}.`);
      await loadParticipants(season.id);
    }

    setIsSaving(false);
  }

  async function unlinkDiscord() {
    if (!currentUserId) return;

    const confirmed = window.confirm(
      "Unlink your Discord account? The \"I'm Ready\" button in Discord won't work for you until you /link again."
    );
    if (!confirmed) return;

    setIsSaving(true);
    setMessage("");

    const { error } = await supabase.from("discord_links").delete().eq("user_id", currentUserId);

    if (error) {
      setMessage(error.message);
    } else {
      setDiscordUsername(null);
      setMessage("Discord account unlinked.");
    }

    setIsSaving(false);
  }

  async function leaveSlot() {
    if (!myParticipant || !season) return;

    setIsSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("season_participants")
      .delete()
      .eq("id", myParticipant.id);

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("You left your team.");
      await loadParticipants(season.id);
    }

    setIsSaving(false);
  }

  async function removeClaim(participant: Participant) {
    if (!season) return;

    const confirmed = window.confirm(
      `Remove the claim on ${participant.player_name}? They will need to claim a slot again.`
    );
    if (!confirmed) return;

    setIsSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("season_participants")
      .delete()
      .eq("id", participant.id);

    if (error) {
      setMessage(error.message);
    } else {
      setMessage(`Removed ${participant.player_name}'s claim.`);
      await loadParticipants(season.id);
    }

    setIsSaving(false);
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            Season Check-In
          </p>
          <h1 className="mt-4 text-4xl font-black">Loading room...</h1>
        </section>
      </main>
    );
  }

  if (!userEmail) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            Season Check-In
          </p>
          <h1 className="mt-4 text-4xl font-black">Redirecting to login...</h1>
        </section>
      </main>
    );
  }

  if (!season || !seasonData) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            Season Check-In
          </p>
          <h1 className="mt-4 text-4xl font-black">Room Unavailable</h1>
          <p className="mt-4 text-slate-300">
            {message || "This room could not be loaded."}
          </p>
          <Link
            href="/season"
            className="mt-6 inline-flex rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
          >
            Back to Seasons
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
              Season Check-In
            </p>

            {isOwner && (
              <span className="rounded-full border border-purple-400/30 bg-purple-400/10 px-4 py-1.5 text-xs font-bold text-purple-200">
                🛠️ Commissioner
              </span>
            )}

            {showCoAdminControls && (
              <span className="rounded-full border border-purple-400/30 bg-purple-400/10 px-4 py-1.5 text-xs font-bold text-purple-200">
                🛡️ Co-Admin
              </span>
            )}

            {myPlayer && (
              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1.5 text-xs font-bold text-cyan-200">
                🏈 Playing as {myPlayer.team || myPlayer.name}
              </span>
            )}

            <span className="rounded-full border border-white/10 bg-white/10 px-4 py-1.5 text-xs font-bold text-white">
              {formatWeekLabel(currentWeek)}
            </span>

            {isSaving && (
              <span className="rounded-full border border-yellow-400/30 bg-yellow-400/10 px-4 py-1.5 text-xs font-bold text-yellow-200">
                Saving...
              </span>
            )}
          </div>

          {isOwner && (
            <div className="mb-6 inline-flex rounded-2xl border border-white/10 bg-slate-900 p-1">
              <button
                onClick={() => setAdminView("commissioner")}
                className={`rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                  showCommissionerControls
                    ? "bg-purple-400 text-slate-950"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                🛠️ Commissioner View
              </button>
              <button
                onClick={() => setAdminView("player")}
                className={`rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                  !showCommissionerControls
                    ? "bg-cyan-400 text-slate-950"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                🏈 Player View
              </button>
            </div>
          )}

          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-tight md:text-6xl">
                {seasonData.seasonTitle || season.title}
              </h1>

              <p className="mt-4 max-w-3xl text-lg text-slate-300">
                {showCommissionerControls
                  ? "Track who's ready to advance and manage extension requests."
                  : isOwner
                    ? "This is exactly what everyone else sees — flip back to Commissioner View above when you're done."
                    : "Mark yourself ready to advance, or request an extension if you need more time."}
              </p>

              <p className="mt-3 text-sm text-slate-500">
                Last updated {new Date(season.updated_at).toLocaleString()}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <button
                onClick={() => loadRoomSeason()}
                className="rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15"
              >
                Refresh
              </button>

              {showCommissionerControls && (
                <>
                  <button
                    onClick={copyRoomLink}
                    className="rounded-2xl bg-white px-5 py-3 text-center font-bold text-slate-950 transition hover:bg-slate-200"
                  >
                    Copy Room Link
                  </button>

                  {seasonData.sourceDraftId && (
                    <button
                      onClick={resyncClaimsFromDraft}
                      disabled={isResyncingClaims}
                      title="Pulls in anyone who claimed their team in the original draft but isn't showing as claimed here yet"
                      className="rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isResyncingClaims ? "Syncing..." : "Sync Claims from Draft"}
                    </button>
                  )}

                  <Link
                    href="/season"
                    className="rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15"
                  >
                    All Seasons
                  </Link>
                </>
              )}
            </div>
          </div>

          {message && (
            <div className="mt-5 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm font-semibold text-cyan-100">
              {message}
            </div>
          )}
        </header>

        {showCoAdminControls && (
          <section className="rounded-3xl border-2 border-purple-400/30 bg-purple-500/[0.06] p-6">
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-purple-300">
              🛡️ Co-Admin: Set Ready Status
              <span className="rounded-full border border-purple-400/20 bg-purple-400/10 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-purple-200">
                Only you can see this
              </span>
            </div>

            <p className="mt-2 text-sm text-slate-400">
              You can mark players ready or not ready for {formatWeekLabel(currentWeek)} --
              that&apos;s the only admin control you have.
            </p>

            <div className="mt-4 flex flex-col gap-2">
              {players.map((player) => {
                const color = teamColor(player.team);
                const isReady = readyPlayerIds.has(player.id);

                return (
                  <div
                    key={player.id}
                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-slate-900 p-3"
                  >
                    <span
                      className="h-3 w-3 flex-shrink-0 rounded-full ring-1 ring-white/20"
                      style={{ backgroundColor: color || "#64748b" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <span className="font-bold">{player.team || player.name}</span>
                      <span className="ml-2 text-xs text-slate-400">{player.name}</span>
                    </span>

                    <button
                      onClick={() => hostSetPlayerReady(player, !isReady)}
                      disabled={isSaving}
                      className={`flex-shrink-0 rounded-xl border px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        isReady
                          ? "border-green-400/40 bg-green-400/20 text-green-200 hover:bg-green-400/30"
                          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/15"
                      }`}
                    >
                      {isReady ? "✓ Ready" : "Mark Ready"}
                    </button>
                  </div>
                );
              })}

              {players.length === 0 && (
                <p className="text-sm text-slate-500">No players in this season yet.</p>
              )}
            </div>
          </section>
        )}

        {showCommissionerControls && (
          <section className="rounded-3xl border-2 border-purple-400/30 bg-purple-500/[0.06] p-6">
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-purple-300">
              🛠️ Commissioner Controls
              <span className="rounded-full border border-purple-400/20 bg-purple-400/10 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-purple-200">
                Only you can see this
              </span>
            </div>

            <h2 className="text-xl font-black">Season Title</h2>
            <input
              key={season.id}
              defaultValue={seasonData.seasonTitle}
              onBlur={(event) => saveTitle(event.target.value)}
              className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-cyan-300"
            />

            <div className="mt-6 border-t border-white/10 pt-6">
              <h3 className="text-lg font-black">Current Week</h3>
              <p className="mt-2 text-sm text-slate-400">
                Advance once everyone&apos;s ready (or override if you
                don&apos;t want to wait).
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="text-3xl font-black text-cyan-300">
                  {formatWeekLabel(currentWeek)}
                </span>
                <span className="text-sm font-semibold text-slate-400">
                  {readyPlayerIds.size}/{players.length} ready
                </span>
                <button
                  onClick={advanceWeek}
                  disabled={isSaving || players.length === 0}
                  className="rounded-2xl bg-green-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-green-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Advance to {formatWeekLabel(currentWeek + 1)}
                </button>

                <button
                  onClick={postSummaryToDiscord}
                  disabled={isPostingToDiscord || players.length === 0}
                  title="Posts the full ready / pending / granted / denied / not-ready breakdown to Discord, with the Ready / Request Extension / Link / Open Season Page buttons"
                  className="rounded-2xl bg-indigo-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-indigo-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isPostingToDiscord ? "Posting..." : "Post Full Status to Discord"}
                </button>

                <button
                  onClick={postNudgeToDiscord}
                  disabled={isPostingNudge || players.length === 0}
                  title="Posts just the header and buttons, no ready/not-ready list -- a lighter-weight nudge to check in"
                  className="rounded-2xl bg-indigo-400/20 border border-indigo-400/40 px-5 py-3 font-bold text-indigo-200 transition hover:bg-indigo-400/30 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isPostingNudge ? "Posting..." : "Post Quick Reminder Link"}
                </button>

                {process.env.NODE_ENV !== "production" && (
                  <button
                    onClick={loadExampleStatuses}
                    disabled={isSaving || players.length === 0}
                    title="Seeds a mix of ready/pending/granted/denied statuses so you can preview the card colors. Dev only."
                    className="rounded-2xl border border-dashed border-white/20 bg-white/5 px-5 py-3 font-bold text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Load Example Statuses (dev only)
                  </button>
                )}
              </div>

            </div>

            <div className="mt-6 border-t border-white/10 pt-6">
              <h3 className="text-lg font-black">Season Header</h3>
              <p className="mt-2 text-sm text-slate-400">
                What shows as the big header when you post to Discord — e.g.
                &quot;Preseason 2026&quot;. The label resets to the default
                each time you advance the week, but you can always rename it.
              </p>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  Period Label
                  <input
                    key={`period-${season.id}-${currentWeek}`}
                    defaultValue={seasonData.periodLabel ?? formatWeekLabel(currentWeek)}
                    onBlur={(event) => savePeriodLabel(event.target.value)}
                    className="w-48 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-300"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  Year
                  <input
                    key={season.id}
                    type="number"
                    defaultValue={seasonData.seasonYear}
                    onBlur={(event) => saveSeasonYear(Number(event.target.value))}
                    className="w-28 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-300"
                  />
                </label>

                <span className="text-sm font-semibold text-slate-400">
                  Preview: {periodHeading(seasonData.periodLabel, currentWeek, seasonData.seasonYear)}
                </span>
              </div>
            </div>

            <div className="mt-6 border-t border-white/10 pt-6">
              <h3 className="text-lg font-black">Anticipated Advance Time</h3>
              <p className="mt-2 text-sm text-slate-400">
                A rough window for when you plan to advance — hour precision
                only, e.g. 7:00 PM – 10:00 PM.
              </p>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  Date
                  <input
                    type="date"
                    value={advanceDateInput}
                    onChange={(event) => setAdvanceDateInput(event.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-300"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  From
                  <select
                    value={advanceStartHourInput}
                    onChange={(event) => setAdvanceStartHourInput(Number(event.target.value))}
                    className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-300"
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={hour}>
                        {formatHourLabel(hour)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  To
                  <select
                    value={advanceEndHourInput}
                    onChange={(event) => setAdvanceEndHourInput(Number(event.target.value))}
                    className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-300"
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={hour}>
                        {formatHourLabel(hour)}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  onClick={() =>
                    setAdvanceWindow({
                      date: advanceDateInput,
                      startHour: advanceStartHourInput,
                      endHour: advanceEndHourInput,
                    })
                  }
                  disabled={isSaving || !advanceDateInput}
                  className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Set Advance Time
                </button>

                <button
                  onClick={() => setAdvanceWindow(null)}
                  disabled={isSaving || !seasonData.advanceWindow}
                  className="rounded-2xl bg-white/10 px-5 py-3 font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Remove
                </button>

                <span className="text-sm font-semibold text-slate-400">
                  {formatAdvanceWindow(seasonData.advanceWindow)}
                </span>
              </div>
            </div>

            <div className="mt-6 border-t border-white/10 pt-6">
              <h3 className="text-lg font-black">
                Extension Requests
                {pendingRequests.length > 0 && (
                  <span className="ml-2 rounded-full border border-yellow-400/30 bg-yellow-400/10 px-2.5 py-1 text-xs font-bold text-yellow-200">
                    {pendingRequests.length} pending
                  </span>
                )}
              </h3>

              {pendingRequests.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">
                  No pending extension requests.
                </p>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  {pendingRequests.map((request) => {
                    const player = players.find((p) => p.id === request.playerId);
                    const grantDate = grantDateInputs[request.id] ?? request.requestedUntilDate;
                    const grantHour = grantHourInputs[request.id] ?? 20;

                    return (
                      <div
                        key={request.id}
                        className="rounded-2xl border border-yellow-400/20 bg-slate-900 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-black">
                              {player?.team || player?.name || "Unknown player"}{" "}
                              <span className="font-normal text-slate-400">
                                — {formatWeekLabel(request.week)}
                              </span>
                            </p>
                            <p className="mt-1 text-sm text-slate-400">
                              Requested until{" "}
                              {new Date(
                                `${request.requestedUntilDate}T00:00:00`
                              ).toLocaleDateString()}
                              {request.reason ? ` — "${request.reason}"` : ""}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap items-end gap-3">
                          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                            Grant until
                            <input
                              type="date"
                              value={grantDate}
                              onChange={(event) =>
                                setGrantDateInputs((current) => ({
                                  ...current,
                                  [request.id]: event.target.value,
                                }))
                              }
                              className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white outline-none focus:border-cyan-300"
                            />
                          </label>

                          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                            At
                            <select
                              value={grantHour}
                              onChange={(event) =>
                                setGrantHourInputs((current) => ({
                                  ...current,
                                  [request.id]: Number(event.target.value),
                                }))
                              }
                              className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white outline-none focus:border-cyan-300"
                            >
                              {Array.from({ length: 24 }, (_, hour) => (
                                <option key={hour} value={hour}>
                                  {formatHourLabel(hour)}
                                </option>
                              ))}
                            </select>
                          </label>

                          <button
                            onClick={() => resolveExtension(request.id, true, grantDate, grantHour)}
                            disabled={isSaving || !grantDate}
                            className="rounded-2xl bg-green-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-green-300 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Grant
                          </button>
                          <button
                            onClick={() => resolveExtension(request.id, false)}
                            disabled={isSaving}
                            className="rounded-2xl bg-red-400/80 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Deny
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-6 border-t border-white/10 pt-6">
              <h3 className="text-lg font-black">Automatic Reminders</h3>
              <p className="mt-2 text-sm text-slate-400">
                Sent automatically by a background job, even if nobody has
                this page open. Times are Eastern.
              </p>

              {reminders.length > 0 && (
                <div className="mt-4 flex flex-col gap-2">
                  {reminders.map((reminder) => (
                    <div
                      key={reminder.id}
                      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3 ${
                        reminder.enabled
                          ? "border-white/10 bg-slate-900"
                          : "border-white/5 bg-slate-900/40 opacity-60"
                      }`}
                    >
                      <div className="text-sm">
                        <span className="font-black">{formatReminderTime(reminder.time)}</span>
                        <span className="ml-2 text-slate-400">
                          {formatReminderDays(reminder.daysOfWeek)}
                        </span>
                        {reminder.pingEveryone && (
                          <span className="ml-2 rounded-full border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-xs font-bold text-red-300">
                            @everyone
                          </span>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => toggleReminderEnabled(reminder.id)}
                          disabled={isSaving}
                          className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {reminder.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          onClick={() => removeReminder(reminder.id)}
                          disabled={isSaving}
                          className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  Time
                  <input
                    type="time"
                    value={newReminderTime}
                    onChange={(event) => setNewReminderTime(event.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-300"
                  />
                </label>

                <div className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  Days
                  <div className="flex gap-1">
                    {DAY_LABELS.map((label, day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleNewReminderDay(day)}
                        className={`h-8 w-8 rounded-lg text-xs font-bold transition ${
                          newReminderDays.has(day)
                            ? "bg-cyan-400 text-slate-950"
                            : "bg-slate-900 text-slate-400 hover:bg-slate-800"
                        }`}
                      >
                        {label[0]}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                  <input
                    type="checkbox"
                    checked={newReminderPingEveryone}
                    onChange={(event) => setNewReminderPingEveryone(event.target.checked)}
                    className="h-4 w-4 accent-red-400"
                  />
                  Ping @everyone
                </label>

                <button
                  onClick={addReminder}
                  disabled={isSaving || !newReminderTime || newReminderDays.size === 0}
                  className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Add Reminder
                </button>
              </div>
            </div>

            <div className="mt-6 border-t border-white/10 pt-6">
              <h3 className="text-lg font-black">Manage Players</h3>
              <p className="mt-2 text-sm text-slate-400">
                Rename a player (their claimed slot moves with them), remove
                someone who&apos;s dropped out mid-season, override their
                ready status, or make a claimed player a co-admin (they can
                only mark players ready/not ready -- nothing else).
              </p>

              <div className="mt-4 flex flex-col gap-2">
                {players.map((player) => {
                  const participant = participantByName.get(player.name.toLowerCase());
                  const color = teamColor(player.team);

                  return (
                    <div
                      key={player.id}
                      className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-slate-900 p-3"
                    >
                      <span
                        className="h-3 w-3 flex-shrink-0 rounded-full ring-1 ring-white/20"
                        style={{ backgroundColor: color || "#64748b" }}
                      />

                      <span className="w-32 flex-shrink-0 truncate text-sm text-slate-400">
                        {player.team || "—"}
                      </span>

                      <input
                        key={`${player.id}-${player.name}`}
                        defaultValue={player.name}
                        onBlur={(event) => renamePlayer(player, event.target.value)}
                        disabled={isSaving}
                        className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300 disabled:opacity-50"
                      />

                      <span
                        className={`flex-shrink-0 text-xs font-bold ${
                          participant ? "text-cyan-300" : "text-slate-500"
                        }`}
                      >
                        {participant ? "Claimed" : "Unclaimed"}
                      </span>

                      <button
                        onClick={() => hostSetPlayerReady(player, !readyPlayerIds.has(player.id))}
                        disabled={isSaving}
                        title="Toggle this player's ready status for the current week"
                        className={`flex-shrink-0 rounded-xl border px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          readyPlayerIds.has(player.id)
                            ? "border-green-400/40 bg-green-400/20 text-green-200 hover:bg-green-400/30"
                            : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/15"
                        }`}
                      >
                        {readyPlayerIds.has(player.id) ? "✓ Ready" : "Mark Ready"}
                      </button>

                      {participant && (
                        <button
                          onClick={() => toggleCoAdmin(participant)}
                          disabled={isSaving}
                          title="Co-admins can only mark players ready/not ready -- no other admin controls"
                          className={`flex-shrink-0 rounded-xl border px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                            participant.is_co_admin
                              ? "border-purple-400/40 bg-purple-400/20 text-purple-200 hover:bg-purple-400/30"
                              : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/15"
                          }`}
                        >
                          {participant.is_co_admin ? "🛡️ Co-Admin" : "Make Co-Admin"}
                        </button>
                      )}

                      {participant && (
                        <button
                          onClick={() => removeClaim(participant)}
                          disabled={isSaving}
                          title="Release this claim so someone can select this team again, without removing the player"
                          className="flex-shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Release Claim
                        </button>
                      )}

                      <button
                        onClick={() => removePlayer(player)}
                        disabled={isSaving}
                        className="flex-shrink-0 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}

                {players.length === 0 && (
                  <p className="text-sm text-slate-500">No players in this season yet.</p>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-3xl font-black">{players.length}</div>
            <div className="mt-1 text-sm text-slate-400">Players</div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-3xl font-black">{readyPlayerIds.size}</div>
            <div className="mt-1 text-sm text-slate-400">Ready This Week</div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-3xl font-black">{pendingRequests.length}</div>
            <div className="mt-1 text-sm text-slate-400">Pending Extensions</div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-3xl font-black">{formatWeekLabel(currentWeek)}</div>
            <div className="mt-1 text-sm text-slate-400">Current Week</div>
          </div>
        </section>

        {showPlayerStatus && myPlayer && (
          <section className="flex flex-col gap-6">
            <div className="rounded-3xl border-2 border-cyan-400/30 bg-cyan-500/[0.06] p-6">
              <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
                🏈 Your Status
                <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-cyan-200">
                  Visible only to you
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
                    {myPlayer.team || myPlayer.name}
                    {myPlayer.team ? ` — ${myPlayer.name}` : ""}
                  </p>
                  <h2 className="mt-2 text-3xl font-black">
                    {periodHeading(seasonData.periodLabel, currentWeek, seasonData.seasonYear)}
                  </h2>
                </div>

                  <button
                    onClick={leaveSlot}
                    disabled={isSaving}
                    className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Leave Team
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  {discordUsername ? (
                    <>
                      <span className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 font-bold text-indigo-200">
                        🔗 Discord linked as @{discordUsername}
                      </span>
                      <button
                        onClick={unlinkDiscord}
                        disabled={isSaving}
                        className="text-xs font-bold text-slate-500 transition hover:text-white disabled:cursor-not-allowed"
                      >
                        Unlink
                      </button>
                    </>
                  ) : (
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-400">
                      Not linked to Discord — run <code className="text-slate-200">/link</code> in
                      Discord to use the &quot;I&apos;m Ready&quot; button there
                    </span>
                  )}
                </div>

                {seasonData.advanceWindow && (
                  <p
                    className={`mt-3 text-lg font-black ${
                      isAdvanceWindowPassed
                        ? "text-red-400"
                        : remainingSeconds != null && remainingSeconds <= 3600
                          ? "text-yellow-300"
                          : "text-cyan-300"
                    }`}
                  >
                    {isAdvanceWindowPassed
                      ? "Advance window has started"
                      : remainingSeconds != null
                        ? `${formatClock(remainingSeconds)} until advance window`
                        : null}
                  </p>
                )}

                <p className="mt-1 text-sm text-slate-400">
                  Anticipated advance: {formatAdvanceWindow(seasonData.advanceWindow)}
                </p>

                <button
                  onClick={markReady}
                  disabled={isSaving || readyPlayerIds.has(myPlayer.id)}
                  className={`mt-5 w-full rounded-2xl px-5 py-4 text-center text-lg font-black transition disabled:cursor-not-allowed ${
                    readyPlayerIds.has(myPlayer.id)
                      ? "bg-green-400/20 text-green-300 disabled:opacity-100"
                      : "bg-green-400 text-slate-950 hover:bg-green-300 disabled:opacity-40"
                  }`}
                >
                  {readyPlayerIds.has(myPlayer.id)
                    ? "✓ Ready to Advance (locked in)"
                    : "Mark Ready to Advance"}
                </button>

                {!readyPlayerIds.has(myPlayer.id) && (
                  <div className="mt-6 border-t border-white/10 pt-6">
                    <h3 className="text-lg font-black">Request an Extension</h3>

                    {!myPendingOrGrantedRequest ? (
                      <>
                        <p className="mt-2 text-sm text-slate-400">
                          Need more time this week? Pick the date you need
                          until and ask the commissioner to grant it.
                        </p>

                        <div className="mt-4 flex flex-wrap items-end gap-3">
                          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                            Need until
                            <input
                              type="date"
                              value={extensionDate}
                              onChange={(event) => setExtensionDate(event.target.value)}
                              className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-300"
                            />
                          </label>

                          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-slate-400">
                            Reason (optional)
                            <input
                              value={extensionReason}
                              onChange={(event) => setExtensionReason(event.target.value)}
                              placeholder="Traveling this week..."
                              className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                            />
                          </label>

                          <button
                            onClick={requestExtension}
                            disabled={isSaving || !extensionDate}
                            className="rounded-2xl bg-yellow-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Request Extension
                          </button>
                        </div>
                      </>
                    ) : (
                      <p
                        className={`mt-3 text-sm font-semibold ${
                          myPendingOrGrantedRequest.status === "granted"
                            ? "text-cyan-300"
                            : "text-yellow-300"
                        }`}
                      >
                        {myPendingOrGrantedRequest.status === "granted"
                          ? `Extension granted${
                              myPendingOrGrantedRequest.grantedUntil
                                ? ` until ${new Date(
                                    myPendingOrGrantedRequest.grantedUntil
                                  ).toLocaleString()}`
                                : ""
                            }.`
                          : `Extension requested (until ${new Date(
                              `${myPendingOrGrantedRequest.requestedUntilDate}T00:00:00`
                            ).toLocaleDateString()}) — waiting on the commissioner.`}
                      </p>
                    )}
                  </div>
                )}
              </div>
          </section>
        )}

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-black">Teams — {formatWeekLabel(currentWeek)}</h2>
              <p className="mt-2 text-sm text-slate-400">
                {!myParticipant
                  ? "Click the team you drafted to select it."
                  : "Every team, publicly visible, with ready and extension status."}
              </p>
            </div>
            <button
              onClick={() => loadParticipants()}
              className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15"
            >
              Refresh
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2 md:grid-cols-3">
            {players.map((player) => {
              const participant = participantByName.get(player.name.toLowerCase());
              const isClaimed = Boolean(participant);
              const isReady = readyPlayerIds.has(player.id);
              const isMe = myParticipant?.player_name === player.name;
              const canClaim = !myParticipant && !isClaimed;
              const extensionForWeek = seasonData.extensionRequests.find(
                (request) =>
                  request.playerId === player.id && request.week === currentWeek
              );

              // Ready (locked in) always wins. Otherwise an extension
              // request colors the card: red while pending or denied, blue
              // once granted.
              const cardState = isReady
                ? "ready"
                : extensionForWeek?.status === "granted"
                  ? "granted"
                  : extensionForWeek?.status === "denied"
                    ? "denied"
                    : extensionForWeek?.status === "pending"
                      ? "pending"
                      : isClaimed
                        ? "claimed"
                        : "unclaimed";

              const cardClasses: Record<string, string> = {
                ready: "border-green-400/40 bg-green-400/20",
                granted: "border-blue-400/40 bg-blue-400/15",
                denied: "border-red-400/40 bg-red-400/10",
                pending: "border-red-400/40 bg-red-400/15",
                claimed: "border-white/10 bg-slate-900",
                unclaimed: "border-white/10 bg-slate-900/60",
              };

              const color = teamColor(player.team);

              return (
                <div
                  key={player.id}
                  role={canClaim ? "button" : undefined}
                  tabIndex={canClaim ? 0 : undefined}
                  onClick={() => canClaim && claimPlayer(player)}
                  onKeyDown={(event) => {
                    if (canClaim && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      claimPlayer(player);
                    }
                  }}
                  title={
                    canClaim
                      ? `Click to select ${player.team || player.name}`
                      : isClaimed
                        ? "Already selected"
                        : undefined
                  }
                  className={`relative flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition ${
                    cardClasses[cardState]
                  } ${isMe ? "ring-2 ring-cyan-300/60" : ""} ${
                    canClaim ? "cursor-pointer hover:brightness-125" : ""
                  }`}
                >
                  {cardState === "denied" && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-xl">
                      <span className="text-5xl font-black text-red-500/80">✕</span>
                    </div>
                  )}

                  <span
                    className="relative mt-1.5 h-3 w-3 flex-shrink-0 rounded-full ring-1 ring-white/20"
                    style={{ backgroundColor: color || "#64748b" }}
                  />

                  <div className="relative min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        <span
                          className={`font-bold ${isReady ? "text-green-200" : ""}`}
                        >
                          {player.team || player.name}
                          {isMe && (
                            <span className="ml-1 text-xs font-normal text-slate-400">(you)</span>
                          )}
                        </span>
                        <span className="block truncate text-xs font-normal text-slate-400">
                          {player.name}
                        </span>
                      </span>
                    </div>

                    <span
                      className={`text-[10px] font-bold ${
                        isReady
                          ? "text-green-300"
                          : isClaimed
                            ? "text-slate-400"
                            : "text-slate-500"
                      }`}
                    >
                      {isReady ? "Ready" : isClaimed ? "Not ready yet" : "Unclaimed"}
                    </span>

                    {extensionForWeek && !isReady && (
                      <span
                        className={`block text-[10px] font-bold ${
                          extensionForWeek.status === "granted"
                            ? "text-blue-300"
                            : extensionForWeek.status === "denied"
                              ? "text-red-300"
                              : "text-red-300"
                        }`}
                      >
                        {extensionForWeek.status === "granted" &&
                          `Extension granted${
                            extensionForWeek.grantedUntil
                              ? ` until ${new Date(extensionForWeek.grantedUntil).toLocaleString()}`
                              : ""
                          }`}
                        {extensionForWeek.status === "denied" && "Extension denied"}
                        {extensionForWeek.status === "pending" &&
                          `Extension requested (until ${new Date(
                            `${extensionForWeek.requestedUntilDate}T00:00:00`
                          ).toLocaleDateString()})`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {players.length === 0 && (
              <p className="text-sm text-slate-500">
                No teams yet — import a draft or load a CSV from the Seasons
                page.
              </p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
