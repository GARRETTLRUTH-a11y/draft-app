"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  CFB_TEAMS,
  CONFERENCE_ORDER,
  CONFERENCE_TIERS,
  TIER_ORDER,
  teamColor,
  teamConference,
} from "@/lib/cfbTeams";
import { groupItemsByConference, buildTiers, type DraftItemLike } from "@/lib/draftBoard";
import { CompactDraftBoard } from "@/components/CompactDraftBoard";
import {
  advanceWindowEnd,
  advanceWindowStart,
  buildWeekSummary,
  DAY_LABELS,
  formatAdvanceWindow,
  formatHourLabel,
  formatReminderDate,
  formatReminderDays,
  formatReminderTime,
  formatWeekLabel,
  isPlayerAccountedFor,
  pendingExtensionRequests,
  periodHeading,
  readyPlayerIdsForWeek,
  PRESEASON_WEEK,
  SEASON_STAGE_LABELS,
  type AdvanceWindow,
  type ExtensionRequest,
  type ReminderSchedule,
  type SeasonData,
  type SeasonPlayer,
} from "@/lib/season";
import type { DiscordNotifyPayload } from "@/lib/discord";

// Host-requested custom ordering for the Manage Players list, in place of
// alphabetical. Teams not on this list (or players with no team yet) sort
// after all of these, alphabetically among themselves.
const MANAGE_PLAYERS_TEAM_ORDER = [
  "Colorado",
  "NC State",
  "Rutgers",
  "Missouri",
  "Boise State",
  "South Carolina",
  "Virginia Tech",
  "SMU",
  "Maryland",
  "Baylor",
  "Houston",
  "Arizona State",
  "Mississippi State",
  "Vanderbilt",
  "Kentucky",
  "Northwestern",
  "Louisville",
  "Oklahoma State",
  "Pittsburgh",
  "Cincinnati",
  "North Carolina",
  "Wisconsin",
];

const DEFAULT_KICKOFF_TIME_ZONE = "America/New_York";

const KICKOFF_TIME_ZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Phoenix", label: "Arizona (MST)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HST)" },
] as const;

function kickoffTimeZoneLabel(timeZone: string) {
  return (
    KICKOFF_TIME_ZONES.find((option) => option.value === timeZone)?.label ||
    timeZone
  );
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

function toLocalDateTimeInputValue(
  iso?: string,
  timeZone = DEFAULT_KICKOFF_TIME_ZONE
) {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values: Record<string, string> = {};
  for (const part of parts) {
    if (["year", "month", "day", "hour", "minute"].includes(part.type)) {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function formatKickoffInTimeZone(
  iso: string,
  timeZone = DEFAULT_KICKOFF_TIME_ZONE
) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
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

type GenesisLinePreview = {
  awayTeam: string;
  homeTeam: string;
  neutral: boolean;
  stage?: string;
  seasonYear?: number;
  favorite: string | null;
  spread: number;
  displayLine: string;
  projectedAwayScore: number;
  projectedHomeScore: number;
  confidence: "Low" | "Medium" | "High";
  confidenceScore: number;
  historyGamesUsed: number;
  ratingMargin: number;
  historyAdjustment: number;
  homeFieldAdjustment: number;
  notes: string[];
};

type PvpBatchGame = {
  id: string;
  awayTeam: string;
  homeTeam: string;
  separator: "@" | "vs.";
  stageLabel: string;
};

type DiscordRoleOption = {
  id: string;
  name: string;
  color: number;
  position: number;
};

function normalizeDiscordRoleLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

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
  const [advanceCustomText, setAdvanceCustomText] = useState("");
  const [manualWeekInput, setManualWeekInput] = useState("");
  const [showAdvanceTimeModal, setShowAdvanceTimeModal] = useState(false);
  const [advanceModalDate, setAdvanceModalDate] = useState("");
  const [advanceModalStartHour, setAdvanceModalStartHour] = useState(19);
  const [advanceModalEndHour, setAdvanceModalEndHour] = useState(22);
  const [advanceModalCustomText, setAdvanceModalCustomText] = useState("");
  const [extensionDate, setExtensionDate] = useState("");
  const [extensionReason, setExtensionReason] = useState("");
  const [isPostingToDiscord, setIsPostingToDiscord] = useState(false);
  const [isPostingNudge, setIsPostingNudge] = useState(false);
  const [postPingEveryone, setPostPingEveryone] = useState(false);
  const [isResyncingClaims, setIsResyncingClaims] = useState(false);
  const [grantModalRequest, setGrantModalRequest] = useState<ExtensionRequest | null>(null);
  const [showPendingExtensionAlert, setShowPendingExtensionAlert] = useState(false);
  const hasShownPendingExtensionAlertRef = useRef(false);
  const hasRegisteredStreamCommandRef = useRef(false);
  const [grantModalDate, setGrantModalDate] = useState("");
  const [grantModalStartHour, setGrantModalStartHour] = useState(19);
  const [grantModalEndHour, setGrantModalEndHour] = useState(22);
  const [grantModalCustomText, setGrantModalCustomText] = useState("");
  const [manualExtensionPlayerId, setManualExtensionPlayerId] = useState("");
  const [manualExtensionDate, setManualExtensionDate] = useState("");
  const [manualExtensionReason, setManualExtensionReason] = useState("");
  const [newReminderTime, setNewReminderTime] = useState("20:00");
  const [newReminderDays, setNewReminderDays] = useState<Set<number>>(new Set());
  const [newReminderPingEveryone, setNewReminderPingEveryone] = useState(false);
  const [newReminderMessageStyle, setNewReminderMessageStyle] = useState<"full" | "limited">(
    "full"
  );
  const [newReminderOneTime, setNewReminderOneTime] = useState(false);
  const [newReminderDate, setNewReminderDate] = useState("");
  const [discordUsername, setDiscordUsername] = useState<string | null>(null);
  // Only meaningful for the host: which side of the room they're currently
  // looking at. Lets a host who's also a player flip over and see exactly
  // what everyone else sees, then flip straight back.
  const [adminView, setAdminView] = useState<"commissioner" | "player">("commissioner");
  const [manageListOrder, setManageListOrder] = useState<"genesis" | "alphabetical">("genesis");
  const [teamPoolView, setTeamPoolView] = useState<"claimed" | "manage">("claimed");
  const [jobMovePlayerId, setJobMovePlayerId] = useState("");
  const [jobMoveTeam, setJobMoveTeam] = useState("");
  const [jobMoveStatus, setJobMoveStatus] = useState("");
  const [isMovingJob, setIsMovingJob] = useState(false);
  const [pvpAwayTeam, setPvpAwayTeam] = useState("");
  const [pvpHomeTeam, setPvpHomeTeam] = useState("");
  const [pvpSeparator, setPvpSeparator] = useState<"@" | "vs.">("@");
  const [pvpStageLabel, setPvpStageLabel] = useState("");
  const [pvpStageOverride, setPvpStageOverride] = useState("");
  const [pvpYear, setPvpYear] = useState("");
  const [additionalPvpGames, setAdditionalPvpGames] = useState<PvpBatchGame[]>([]);
  const [postPvpStreamInstructions, setPostPvpStreamInstructions] = useState(false);
  const [isCreatingPvpThread, setIsCreatingPvpThread] = useState(false);
  const [pvpCreateStatus, setPvpCreateStatus] = useState("");
  const [genesisLine, setGenesisLine] = useState<GenesisLinePreview | null>(null);
  const [isGeneratingGenesisLine, setIsGeneratingGenesisLine] = useState(false);
  const [isSyncingGenesisHistory, setIsSyncingGenesisHistory] = useState(false);
  const [genesisHistorySyncMode, setGenesisHistorySyncMode] = useState<"full" | "incremental" | null>(null);
  const [genesisHistoryStatus, setGenesisHistoryStatus] = useState("");
  const [genesisFinalScoreInputs, setGenesisFinalScoreInputs] = useState<
    Record<string, { away: string; home: string }>
  >({});
  const [finalizingGenesisMatchupId, setFinalizingGenesisMatchupId] = useState<string | null>(null);
  const [lockingGenesisMatchupId, setLockingGenesisMatchupId] = useState<string | null>(null);
  const [voidingGenesisMatchupId, setVoidingGenesisMatchupId] = useState<string | null>(null);
  const [deletingGenesisMatchupId, setDeletingGenesisMatchupId] = useState<string | null>(null);
  const [genesisKickoffInputs, setGenesisKickoffInputs] = useState<
    Record<string, { local: string; timeZone: string; autoLock: boolean }>
  >({});
  const [savingGenesisKickoffId, setSavingGenesisKickoffId] = useState<string | null>(null);
  const [genesisFinalizeStatus, setGenesisFinalizeStatus] = useState("");
  const [ratingEditorPlayerId, setRatingEditorPlayerId] = useState<number | null>(null);
  const [ratingOverallInput, setRatingOverallInput] = useState("");
  const [ratingOffenseInput, setRatingOffenseInput] = useState("");
  const [ratingDefenseInput, setRatingDefenseInput] = useState("");
  const [ratingEditorError, setRatingEditorError] = useState("");
  const [discordTeamRoles, setDiscordTeamRoles] = useState<DiscordRoleOption[]>([]);
  const [isLoadingDiscordTeamRoles, setIsLoadingDiscordTeamRoles] = useState(false);
  const [discordTeamRolesStatus, setDiscordTeamRolesStatus] = useState("");
  const [savingDiscordTeamRoleTeam, setSavingDiscordTeamRoleTeam] = useState<string | null>(null);

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

  useEffect(() => {
    if (!isOwner || !season || hasRegisteredStreamCommandRef.current) return;
    hasRegisteredStreamCommandRef.current = true;

    void (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;

      try {
        const response = await fetch("/api/discord/register-stream-command", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ seasonId: season.id }),
        });

        if (!response.ok) {
          hasRegisteredStreamCommandRef.current = false;
        }
      } catch {
        hasRegisteredStreamCommandRef.current = false;
      }
    })();
  }, [isOwner, season]);

  const seasonData = season?.season_data;
  const players = seasonData?.players ?? [];
  const currentWeek = seasonData?.currentWeek ?? PRESEASON_WEEK;
  const currentGenesisStageLabel =
    seasonData?.periodLabel?.trim() || formatWeekLabel(currentWeek);
  const activeGenesisMatchups = useMemo(
    () =>
      [...(seasonData?.genesisPicks?.matchups ?? [])]
        .filter((matchup) => {
          if (matchup.status === "open" || matchup.status === "locked") {
            return true;
          }

          if (matchup.status !== "settled" || !seasonData) {
            return false;
          }

          if (matchup.seasonYear !== seasonData.seasonYear) {
            return false;
          }

          if (matchup.seasonWeek != null) {
            return matchup.seasonWeek === currentWeek;
          }

          if (matchup.stage?.trim()) {
            return matchup.stage.trim() === currentGenesisStageLabel;
          }

          // Backward compatibility for matchups created before seasonWeek/stage
          // were stored. Weekly thread names include "(Week X, YEAR)".
          return matchup.threadName.includes(
            `(${currentGenesisStageLabel}, ${seasonData.seasonYear})`
          );
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [
      currentGenesisStageLabel,
      currentWeek,
      seasonData,
      seasonData?.genesisPicks?.matchups,
    ]
  );

  const leagueTeamNames = useMemo(
    () =>
      Array.from(
        new Set(
          players
            .map((player) => player.team)
            .filter((team): team is string => Boolean(team))
        )
      ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [players]
  );

  const mappedTeamRoleCount = leagueTeamNames.filter(
    (team) => Boolean(seasonData?.discordTeamRoleIds?.[team])
  ).length;

  useEffect(() => {
    if (!seasonData) return;
    setPvpStageLabel(seasonData.periodLabel?.trim() || formatWeekLabel(currentWeek));
    setPvpYear(String(seasonData.seasonYear));
  }, [currentWeek, seasonData?.periodLabel, seasonData?.seasonYear]);

  useEffect(() => {
    setGenesisLine(null);
  }, [pvpAwayTeam, pvpHomeTeam, pvpSeparator]);

  function pvpThreadTitleFor(
    awayTeam: string,
    separator: "@" | "vs.",
    homeTeam: string,
    stageOverride = ""
  ) {
    const away = awayTeam || "X Team";
    const home = homeTeam || "Y Team";
    const stage =
      stageOverride.trim() ||
      pvpStageLabel.trim() ||
      formatWeekLabel(currentWeek);
    const year =
      pvpYear.trim() ||
      String(seasonData?.seasonYear ?? new Date().getFullYear());
    return `${away} ${separator} ${home} (${stage}, ${year})`;
  }

  function resolvedPvpStage(stageOverride = "") {
    return (
      stageOverride.trim() ||
      pvpStageLabel.trim() ||
      formatWeekLabel(currentWeek)
    );
  }

  const pvpThreadTitle = useMemo(
    () =>
      pvpThreadTitleFor(
        pvpAwayTeam,
        pvpSeparator,
        pvpHomeTeam,
        pvpStageOverride
      ),
    [
      pvpAwayTeam,
      pvpHomeTeam,
      pvpSeparator,
      pvpStageOverride,
      pvpStageLabel,
      pvpYear,
      currentWeek,
      seasonData?.seasonYear,
    ]
  );

  const pvpGamesToCreate = useMemo(
    () => [
      {
        id: "primary",
        awayTeam: pvpAwayTeam,
        homeTeam: pvpHomeTeam,
        separator: pvpSeparator,
        stageLabel: pvpStageOverride,
      } satisfies PvpBatchGame,
      ...additionalPvpGames,
    ],
    [
      pvpAwayTeam,
      pvpHomeTeam,
      pvpSeparator,
      pvpStageOverride,
      additionalPvpGames,
    ]
  );

  const allPvpGamesReady =
    pvpGamesToCreate.length > 0 &&
    pvpGamesToCreate.every(
      (game) =>
        Boolean(game.awayTeam) &&
        Boolean(game.homeTeam) &&
        game.awayTeam !== game.homeTeam &&
        pvpThreadTitleFor(
          game.awayTeam,
          game.separator,
          game.homeTeam,
          game.stageLabel
        ).length <= 100
    );

  // Host-toggleable sort for the Manage Players list specifically -- other
  // views (Teams board, claim grid) keep the original draft order.
  // "genesis" is the custom team order; unlisted teams (or players with no
  // team yet) fall back to alphabetical-by-team among themselves either way.
  const playersByManageOrder = useMemo(
    () =>
      [...players].sort((a, b) => {
        const aTeam = a.team || a.name;
        const bTeam = b.team || b.name;
        if (manageListOrder === "genesis") {
          const aIndex = a.team ? MANAGE_PLAYERS_TEAM_ORDER.indexOf(a.team) : -1;
          const bIndex = b.team ? MANAGE_PLAYERS_TEAM_ORDER.indexOf(b.team) : -1;
          const aRank = aIndex === -1 ? MANAGE_PLAYERS_TEAM_ORDER.length : aIndex;
          const bRank = bIndex === -1 ? MANAGE_PLAYERS_TEAM_ORDER.length : bIndex;
          if (aRank !== bRank) return aRank - bRank;
        }
        return aTeam.localeCompare(bTeam, undefined, { sensitivity: "base" });
      }),
    [players, manageListOrder]
  );

  // The full CFB_TEAMS universe grouped by conference, each team paired
  // with its season player-slot (if any) -- backs the separate "Team Pool
  // by Conference" section the host uses to add teams to, or remove
  // unclaimed teams from, the season.
  const fullUniverseByConference = useMemo(() => {
    const playerByTeam = new Map(
      players.filter((p) => p.team).map((p) => [p.team!.toLowerCase(), p])
    );
    const byConference = new Map<string, { team: (typeof CFB_TEAMS)[number]; player?: SeasonPlayer }[]>();
    for (const team of CFB_TEAMS) {
      const entry = { team, player: playerByTeam.get(team.name.toLowerCase()) };
      const group = byConference.get(team.conference) ?? [];
      group.push(entry);
      byConference.set(team.conference, group);
    }
    return CONFERENCE_ORDER.map((conference) => ({
      conference,
      teams: byConference.get(conference) ?? [],
    })).filter((group) => group.teams.length > 0);
  }, [players]);

  const readyPlayerIds = useMemo(
    () => new Set(seasonData ? readyPlayerIdsForWeek(seasonData, currentWeek) : []),
    [seasonData, currentWeek]
  );

  // Ready count for display/gating purposes -- vacation and no-response
  // flags count as accounted-for even though the player never clicked
  // ready, so the badge/advance gate don't wait on them.
  const effectiveReadyCount = useMemo(
    () => players.filter((player) => isPlayerAccountedFor(player, readyPlayerIds)).length,
    [players, readyPlayerIds]
  );

  const pendingRequests = useMemo(
    () => (seasonData ? pendingExtensionRequests(seasonData) : []),
    [seasonData]
  );

  // Surface pending extension requests the moment the host lands on the
  // page, instead of relying on them to notice the badge/list further
  // down -- fires once per page load, not on every subsequent update
  // (e.g. after they resolve one but others remain).
  useEffect(() => {
    if (isLoading || !isOwner || hasShownPendingExtensionAlertRef.current) return;
    if (pendingRequests.length > 0) {
      // One-shot reveal on page load, not a sync loop (guarded by the ref above).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowPendingExtensionAlert(true);
      hasShownPendingExtensionAlertRef.current = true;
    }
  }, [isLoading, isOwner, pendingRequests.length]);

  // Every extension request (pending, granted, or denied) for the current
  // week -- unlike pendingRequests, this includes resolved ones so the host
  // has something to manage/remove instead of them just disappearing.
  const currentWeekExtensionRequests = useMemo(() => {
    if (!seasonData) return [];
    const statusRank: Record<ExtensionRequest["status"], number> = {
      pending: 0,
      granted: 1,
      denied: 2,
    };
    return seasonData.extensionRequests
      .filter((request) => request.week === currentWeek)
      .sort((a, b) => statusRank[a.status] - statusRank[b.status]);
  }, [seasonData, currentWeek]);

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

  const claimedPlayersForJobMoves = useMemo(
    () =>
      players
        .filter((player) =>
          participantByName.has(player.name.toLowerCase())
        )
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        ),
    [players, participantByName]
  );

  // Same tier/conference-column board the draft's own "Draft Board" uses --
  // claimed teams only (unclaimed ones are omitted entirely, not just
  // grayed out), grouped exactly the same way (Power Conferences / Group
  // of Five / Independents), all conferences visible at once, no tabbing.
  const seasonBoardTiers = useMemo(() => {
    const picks = players
      .filter((player) => player.team && participantByName.has(player.name.toLowerCase()))
      .map((player) => ({
        pickNumber: player.id,
        drafter: player.name,
        item: {
          id: player.id,
          name: player.team!,
          category: teamConference(player.team) ?? "Other",
          description: "",
          color: teamColor(player.team),
        } satisfies DraftItemLike,
      }));
    const { groups } = groupItemsByConference([], picks, CONFERENCE_ORDER);
    return buildTiers(groups, CONFERENCE_TIERS, TIER_ORDER);
  }, [players, participantByName]);

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

  useEffect(() => {
    if (
      !showCommissionerControls ||
      !season ||
      discordTeamRoles.length > 0 ||
      isLoadingDiscordTeamRoles
    ) {
      return;
    }

    void loadDiscordTeamRoles();
    // Role loading is intentionally one-shot per commissioner page visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCommissionerControls, season?.id]);

  const showPlayerStatus =
    Boolean(myParticipant && myPlayer) && (!isOwner || adminView === "player");

  // A co-admin can toggle ready status for anyone, but gets none of the
  // rest of Commissioner Controls. The host doesn't need this separate
  // view -- the ready/unready toggle is already in Manage Players.
  const isCoAdmin = Boolean(myParticipant?.is_co_admin);
  const showCoAdminControls = isCoAdmin && !isOwner;

  const ratingEditorPlayer = useMemo(
    () =>
      ratingEditorPlayerId == null
        ? undefined
        : players.find((player) => player.id === ratingEditorPlayerId),
    [players, ratingEditorPlayerId]
  );

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

  async function loadDiscordTeamRoles() {
    if (!season || isLoadingDiscordTeamRoles) return;

    setIsLoadingDiscordTeamRoles(true);
    setDiscordTeamRolesStatus("");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setDiscordTeamRolesStatus("Your session expired. Refresh and sign in again.");
        return;
      }

      const response = await fetch(
        `/api/discord/team-roles?seasonId=${encodeURIComponent(season.id)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const result = (await response.json()) as {
        roles?: DiscordRoleOption[];
        error?: string;
      };

      if (!response.ok) {
        setDiscordTeamRolesStatus(
          result.error || "Could not load Discord roles."
        );
        return;
      }

      setDiscordTeamRoles(result.roles || []);
      setDiscordTeamRolesStatus(
        `Loaded ${result.roles?.length || 0} assignable Discord roles.`
      );
    } catch (error) {
      setDiscordTeamRolesStatus(
        error instanceof Error
          ? `Could not load Discord roles: ${error.message}`
          : "Could not load Discord roles."
      );
    } finally {
      setIsLoadingDiscordTeamRoles(false);
    }
  }

  async function saveDiscordTeamRole(team: string, roleId: string) {
    setSavingDiscordTeamRoleTeam(team);

    const saved = await updateSeasonData((fresh) => {
      const nextRoleMap = { ...(fresh.discordTeamRoleIds || {}) };
      if (roleId) {
        nextRoleMap[team] = roleId;
      } else {
        delete nextRoleMap[team];
      }

      return {
        ...fresh,
        discordTeamRoleIds: nextRoleMap,
      };
    });

    if (saved) {
      const roleName = discordTeamRoles.find((role) => role.id === roleId)?.name;
      setMessage(
        roleId
          ? `Mapped ${team} → @${roleName || roleId}.`
          : `Cleared the Discord role mapping for ${team}.`
      );
    }

    setSavingDiscordTeamRoleTeam(null);
  }

  async function autoMapExactDiscordRoles() {
    if (!discordTeamRoles.length) {
      await loadDiscordTeamRoles();
      return;
    }

    let added = 0;
    const saved = await updateSeasonData((fresh) => {
      const nextRoleMap = { ...(fresh.discordTeamRoleIds || {}) };

      for (const team of leagueTeamNames) {
        if (nextRoleMap[team]) continue;
        const normalizedTeam = normalizeDiscordRoleLabel(team);
        const match = discordTeamRoles.find(
          (role) => normalizeDiscordRoleLabel(role.name) === normalizedTeam
        );
        if (!match) continue;
        nextRoleMap[team] = match.id;
        added++;
      }

      return {
        ...fresh,
        discordTeamRoleIds: nextRoleMap,
      };
    });

    if (saved) {
      setMessage(
        added > 0
          ? `Auto-mapped ${added} team role${added === 1 ? "" : "s"}. Use the dropdowns for the remaining teams.`
          : "No additional exact-name role matches were found. Use the dropdowns for the remaining teams."
      );
    }
  }

  function openTeamRatings(player: SeasonPlayer) {
    setRatingEditorPlayerId(player.id);
    setRatingOverallInput(
      typeof player.overallRating === "number" ? String(player.overallRating) : ""
    );
    setRatingOffenseInput(
      typeof player.offenseRating === "number" ? String(player.offenseRating) : ""
    );
    setRatingDefenseInput(
      typeof player.defenseRating === "number" ? String(player.defenseRating) : ""
    );
    setRatingEditorError("");
  }

  function parseTeamRating(raw: string): number | undefined | null {
    if (!raw.trim()) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 99) return null;
    return value;
  }

  async function saveTeamRatings() {
    if (ratingEditorPlayerId == null) return;

    const overallRating = parseTeamRating(ratingOverallInput);
    const offenseRating = parseTeamRating(ratingOffenseInput);
    const defenseRating = parseTeamRating(ratingDefenseInput);

    if (
      overallRating === null ||
      offenseRating === null ||
      defenseRating === null
    ) {
      setRatingEditorError("Ratings must be whole numbers from 0 to 99.");
      return;
    }

    const saved = await updateSeasonData((fresh) => ({
      ...fresh,
      players: fresh.players.map((player) =>
        player.id === ratingEditorPlayerId
          ? {
              ...player,
              overallRating,
              offenseRating,
              defenseRating,
            }
          : player
      ),
    }));

    if (!saved) {
      setRatingEditorError("Could not save the ratings. Try again.");
      return;
    }

    setRatingEditorPlayerId(null);
    setRatingEditorError("");
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

  async function syncGenesisHistory(mode: "full" | "incremental" = "full") {
    if (!season) return;

    setIsSyncingGenesisHistory(true);
    setGenesisHistorySyncMode(mode);
    setGenesisHistoryStatus(
      mode === "incremental"
        ? "Checking Discord for new Genesis history since the last sync..."
        : "Rebuilding Discord history from the configured sources..."
    );
    setGenesisLine(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setGenesisHistoryStatus("Your session expired. Refresh and sign in again.");
        return;
      }

      const response = await fetch("/api/genesis/history-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ seasonId: season.id, mode }),
      });

      const responseText = await response.text();
      let result: {
        error?: string;
        games?: number;
        messagesScanned?: number;
        lastSyncedAt?: string;
        achievements?: number;
        syncMode?: "full" | "incremental";
      } = {};

      if (responseText) {
        try {
          result = JSON.parse(responseText);
        } catch {
          result = {
            error: `Server returned HTTP ${response.status}: ${responseText.slice(0, 500)}`,
          };
        }
      }

      if (!response.ok) {
        setGenesisHistoryStatus(
          result.error || `Could not sync Genesis history (HTTP ${response.status}).`
        );
        return;
      }

      await loadRoomSeason(season.id);

      if (result.syncMode === "incremental") {
        setGenesisHistoryStatus(
          `✅ Checked for new history: scanned ${result.messagesScanned ?? 0} new Discord message${(result.messagesScanned ?? 0) === 1 ? "" : "s"} · ${result.games ?? 0} total games and ${result.achievements ?? 0} postseason achievements stored.`
        );
      } else {
        setGenesisHistoryStatus(
          `✅ Full history sync complete: ${result.games ?? 0} games and ${result.achievements ?? 0} postseason achievements stored from ${result.messagesScanned ?? 0} Discord messages.`
        );
      }
    } catch (error) {
      setGenesisHistoryStatus(
        error instanceof Error
          ? `Could not sync Genesis history: ${error.message}`
          : "Could not sync Genesis history. Try again."
      );
    } finally {
      setIsSyncingGenesisHistory(false);
      setGenesisHistorySyncMode(null);
    }
  }

  async function generateGenesisLine() {
    if (!season || !pvpAwayTeam || !pvpHomeTeam) return null;

    setIsGeneratingGenesisLine(true);
    setPvpCreateStatus("");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setPvpCreateStatus("Your session expired. Refresh and sign in again.");
        return null;
      }

      const response = await fetch("/api/genesis/line", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          seasonId: season.id,
          awayTeam: pvpAwayTeam,
          homeTeam: pvpHomeTeam,
          neutral: pvpSeparator === "vs.",
          stage: resolvedPvpStage(pvpStageOverride),
          seasonYear: Number(pvpYear) || seasonData?.seasonYear,
        }),
      });

      const result = (await response.json()) as {
        error?: string;
        line?: GenesisLinePreview;
        sync?: {
          messagesScanned: number;
          mode?: "full" | "incremental";
          totalGames: number;
          achievements: number;
          lastSyncedAt: string;
          settledPicks?: number;
        };
        leaderboardWarning?: string;
      };

      if (!response.ok || !result.line) {
        setPvpCreateStatus(result.error || "Could not generate Genesis line.");
        return null;
      }

      setGenesisLine(result.line);

      if (result.sync) {
        const firstCursorSetup =
          result.sync.mode === "full" &&
          !seasonData?.genesisHistory?.sourceCursors;

        let syncStatus =
          firstCursorSetup
            ? `✅ Automatic history setup complete: scanned ${result.sync.messagesScanned} messages and established incremental sync.`
            : result.sync.messagesScanned > 0
              ? `✅ Auto-synced ${result.sync.messagesScanned} new Discord message${result.sync.messagesScanned === 1 ? "" : "s"} before generating the line.`
              : "✅ Discord history already current — no new messages to parse.";

        if (result.sync.settledPicks) {
          syncStatus += ` Auto-graded ${result.sync.settledPicks} completed Genesis pick matchup${result.sync.settledPicks === 1 ? "" : "s"}.`;
        }
        if (result.leaderboardWarning) {
          syncStatus += ` Leaderboard warning: ${result.leaderboardWarning}`;
        }

        setGenesisHistoryStatus(syncStatus);

        await loadRoomSeason(season.id);
      }

      return result.line;
    } catch {
      setPvpCreateStatus("Could not generate Genesis line. Try again.");
      return null;
    } finally {
      setIsGeneratingGenesisLine(false);
    }
  }

  async function createPvpThread() {
    if (!season) return;

    const stage = pvpStageLabel.trim();
    const year = pvpYear.trim();
    if (!stage || !year) {
      setPvpCreateStatus("Stage/bowl and year are required.");
      return;
    }

    const seasonYear = Number(year);
    if (!Number.isInteger(seasonYear) || seasonYear < 1900 || seasonYear > 3000) {
      setPvpCreateStatus("Enter a valid four-digit season year.");
      return;
    }

    const games = pvpGamesToCreate;
    const invalidGame = games.find(
      (game) =>
        !game.awayTeam ||
        !game.homeTeam ||
        game.awayTeam === game.homeTeam ||
        pvpThreadTitleFor(
          game.awayTeam,
          game.separator,
          game.homeTeam,
          game.stageLabel
        ).length > 100
    );

    if (invalidGame) {
      setPvpCreateStatus(
        "Complete every matchup with two different teams before creating the weekly threads."
      );
      return;
    }

    setIsCreatingPvpThread(true);
    setPvpCreateStatus(
      `Preparing ${games.length} PvP matchup${games.length === 1 ? "" : "s"}...`
    );

    const failures: string[] = [];
    const warnings: string[] = [];
    let createdCount = 0;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setPvpCreateStatus("Your session expired. Refresh and sign in again.");
        return;
      }

      for (let index = 0; index < games.length; index++) {
        const game = games[index];
        const gameStage = resolvedPvpStage(game.stageLabel);
        const threadName = pvpThreadTitleFor(
          game.awayTeam,
          game.separator,
          game.homeTeam,
          game.stageLabel
        );

        setPvpCreateStatus(
          `Creating ${index + 1} of ${games.length}: ${game.awayTeam} ${game.separator} ${game.homeTeam}...`
        );

        try {
          const lineResponse = await fetch("/api/genesis/line", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              seasonId: season.id,
              awayTeam: game.awayTeam,
              homeTeam: game.homeTeam,
              neutral: game.separator === "vs.",
              stage: gameStage,
              seasonYear,
            }),
          });

          const lineResult = (await lineResponse.json()) as {
            error?: string;
            line?: GenesisLinePreview;
            sync?: {
              messagesScanned: number;
              mode?: "full" | "incremental";
              totalGames: number;
              achievements: number;
              lastSyncedAt: string;
              settledPicks?: number;
            };
            leaderboardWarning?: string;
          };

          if (!lineResponse.ok || !lineResult.line) {
            throw new Error(
              lineResult.error ||
                "Could not refresh Genesis history before creating the thread."
            );
          }

          if (index === 0) setGenesisLine(lineResult.line);

          const response = await fetch("/api/discord/pvp-thread", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              seasonId: season.id,
              threadName,
              awayTeam: game.awayTeam,
              homeTeam: game.homeTeam,
              neutral: game.separator === "vs.",
              stage: gameStage,
              seasonYear,
              postStreamInstructions: postPvpStreamInstructions,
            }),
          });

          const result = (await response.json()) as {
            error?: string;
            threadName?: string;
            genesisRoleTagged?: boolean;
            taggedPlayers?: number;
            line?: GenesisLinePreview;
            leaderboardChannelId?: string;
            leaderboardWarning?: string;
            streamInstructionsPosted?: boolean;
            streamInstructionsWarning?: string;
            matchupHistoryWarning?: string;
          };

          if (!response.ok) {
            throw new Error(result.error || "Could not create the PvP thread.");
          }

          createdCount++;

          if (result.leaderboardWarning) {
            warnings.push(
              `${game.awayTeam} ${game.separator} ${game.homeTeam}: ${result.leaderboardWarning}`
            );
          }
          if (result.streamInstructionsWarning) {
            warnings.push(
              `${game.awayTeam} ${game.separator} ${game.homeTeam}: ${result.streamInstructionsWarning}`
            );
          }
          if (result.matchupHistoryWarning) {
            warnings.push(
              `${game.awayTeam} ${game.separator} ${game.homeTeam}: ${result.matchupHistoryWarning}`
            );
          }

          // Remove successful rows immediately so a partial batch failure can
          // be retried without accidentally recreating threads that succeeded.
          if (game.id === "primary") {
            setPvpAwayTeam("");
            setPvpHomeTeam("");
            setPvpSeparator("@");
            setPvpStageOverride("");
          } else {
            setAdditionalPvpGames((current) =>
              current.filter((row) => row.id !== game.id)
            );
          }
        } catch (error) {
          failures.push(
            `${game.awayTeam} ${game.separator} ${game.homeTeam}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }

      await loadRoomSeason(season.id);

      if (createdCount > 0) {
        let status = `✅ Created ${createdCount} of ${games.length} PvP thread${
          games.length === 1 ? "" : "s"
        }.`;
        if (postPvpStreamInstructions) {
          status += " /stream instructions were requested for each created game.";
        }
        if (failures.length) {
          status += ` Failed: ${failures.join(" | ")}`;
        }
        if (warnings.length) {
          status += ` Warnings: ${warnings.join(" | ")}`;
        }
        setPvpCreateStatus(status);
      } else {
        setPvpCreateStatus(
          failures.length
            ? `Could not create the weekly PvP threads: ${failures.join(" | ")}`
            : "Could not create the weekly PvP threads."
        );
      }
    } catch (error) {
      setPvpCreateStatus(
        error instanceof Error
          ? `Could not create the PvP threads: ${error.message}`
          : "Could not create the PvP threads. Try again."
      );
    } finally {
      setIsCreatingPvpThread(false);
    }
  }

  async function saveGenesisKickoff(
    matchupId: string,
    clearSchedule = false
  ) {
    if (!season) return;

    const matchup = season.season_data.genesisPicks?.matchups.find(
      (item) => item.id === matchupId
    );
    if (!matchup) {
      setGenesisFinalizeStatus("Genesis matchup not found.");
      return;
    }

    const draft = genesisKickoffInputs[matchupId] || {
      local: toLocalDateTimeInputValue(
        matchup.scheduledKickoffAt,
        matchup.scheduledKickoffTimeZone || DEFAULT_KICKOFF_TIME_ZONE
      ),
      timeZone:
        matchup.scheduledKickoffTimeZone || DEFAULT_KICKOFF_TIME_ZONE,
      autoLock: matchup.autoLockAtKickoff !== false,
    };
    const local = clearSchedule ? "" : draft.local;

    if (!clearSchedule && !local) {
      setGenesisFinalizeStatus("Choose a scheduled kickoff time first.");
      return;
    }

    setSavingGenesisKickoffId(matchupId);
    setGenesisFinalizeStatus(
      clearSchedule ? "Clearing scheduled kickoff..." : "Saving scheduled kickoff..."
    );

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setGenesisFinalizeStatus("Your session expired. Refresh and sign in again.");
        return;
      }

      const response = await fetch("/api/genesis/kickoff", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          seasonId: season.id,
          matchupId,
          scheduledKickoffLocal: local || null,
          scheduledKickoffTimeZone: local ? draft.timeZone : null,
          autoLockAtKickoff: draft.autoLock,
        }),
      });

      const result = (await response.json()) as {
        error?: string;
        scheduledKickoffAt?: string;
        scheduledKickoffTimeZone?: string;
        autoLockAtKickoff?: boolean;
        discordWarning?: string;
      };

      if (!response.ok) {
        setGenesisFinalizeStatus(
          result.error || "Could not save the scheduled kickoff."
        );
        return;
      }

      await loadRoomSeason(season.id);
      setGenesisKickoffInputs((current) => {
        const next = { ...current };
        delete next[matchupId];
        return next;
      });

      let status = clearSchedule
        ? "✅ Scheduled kickoff cleared."
        : `✅ Kickoff scheduled for ${
            result.scheduledKickoffAt
              ? formatKickoffInTimeZone(
                  result.scheduledKickoffAt,
                  result.scheduledKickoffTimeZone || draft.timeZone
                )
              : local
          } (${kickoffTimeZoneLabel(
            result.scheduledKickoffTimeZone || draft.timeZone
          )}).${
            draft.autoLock
              ? " Genesis will auto-lock at kickoff."
              : " Genesis will wait for /stream or a commissioner lock."
          }`;

      if (result.discordWarning) {
        status += ` Discord warning: ${result.discordWarning}`;
      }

      setGenesisFinalizeStatus(status);
    } catch (error) {
      setGenesisFinalizeStatus(
        error instanceof Error
          ? `Could not save kickoff: ${error.message}`
          : "Could not save the scheduled kickoff."
      );
    } finally {
      setSavingGenesisKickoffId(null);
    }
  }

  async function deleteGenesisMatchup(
    matchupId: string,
    matchupLabel: string
  ) {
    if (!season) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete ${matchupLabel}? This removes the Genesis matchup and its Discord game thread so you can remake it.`
    );
    if (!confirmed) return;

    setDeletingGenesisMatchupId(matchupId);
    setGenesisFinalizeStatus(`Deleting ${matchupLabel}...`);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setGenesisFinalizeStatus("Your session expired. Refresh and sign in again.");
        return;
      }

      const response = await fetch("/api/genesis/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          seasonId: season.id,
          matchupId,
        }),
      });

      const result = (await response.json()) as {
        error?: string;
        leaderboardWarning?: string;
      };

      if (!response.ok) {
        setGenesisFinalizeStatus(
          result.error || "Could not delete the Genesis matchup."
        );
        return;
      }

      await loadRoomSeason(season.id);
      setGenesisFinalScoreInputs((current) => {
        const next = { ...current };
        delete next[matchupId];
        return next;
      });

      setGenesisFinalizeStatus(
        `✅ Deleted ${matchupLabel} and its Discord thread.${
          result.leaderboardWarning
            ? ` Leaderboard warning: ${result.leaderboardWarning}`
            : ""
        }`
      );
    } catch (error) {
      setGenesisFinalizeStatus(
        error instanceof Error
          ? `Could not delete Genesis matchup: ${error.message}`
          : "Could not delete Genesis matchup."
      );
    } finally {
      setDeletingGenesisMatchupId(null);
    }
  }

  async function lockGenesisPicks(matchupId: string) {
    if (!season) return;

    const confirmed = window.confirm(
      "Lock Genesis picks for this game? No additional picks will be accepted after this."
    );
    if (!confirmed) return;

    setLockingGenesisMatchupId(matchupId);
    setGenesisFinalizeStatus("Locking Genesis picks and announcing game start in Discord...");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setGenesisFinalizeStatus("Your session expired. Refresh and sign in again.");
        return;
      }

      const response = await fetch("/api/genesis/lock-picks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          seasonId: season.id,
          matchupId,
        }),
      });

      const result = (await response.json()) as {
        error?: string;
        pickCount?: number;
        discordPosted?: boolean;
        leaderboardWarning?: string;
      };

      if (!response.ok) {
        setGenesisFinalizeStatus(result.error || "Could not lock Genesis picks.");
        return;
      }

      await loadRoomSeason(season.id);

      let status = `✅ Picks locked at game start. ${result.pickCount ?? 0} pick${(result.pickCount ?? 0) === 1 ? "" : "s"} preserved.`;
      if (result.discordPosted === false) {
        status += " The matchup was locked, but the Discord notice could not be posted.";
      }
      if (result.leaderboardWarning) {
        status += ` Leaderboard warning: ${result.leaderboardWarning}`;
      }
      setGenesisFinalizeStatus(status);
    } catch (error) {
      setGenesisFinalizeStatus(
        error instanceof Error
          ? `Could not lock Genesis picks: ${error.message}`
          : "Could not lock Genesis picks."
      );
    } finally {
      setLockingGenesisMatchupId(null);
    }
  }

  async function voidGenesisMatchup(
    matchupId: string,
    reason: "auto_sim" | "force_win"
  ) {
    if (!season) return;

    const reasonLabel = reason === "auto_sim" ? "Auto Sim" : "Force Win";
    const confirmed = window.confirm(
      `Void this Genesis line as ${reasonLabel}? All submitted picks will be canceled and this result will not count toward pick accuracy or future Genesis performance history.`
    );
    if (!confirmed) return;

    setVoidingGenesisMatchupId(matchupId);
    setGenesisFinalizeStatus(`Voiding Genesis line — ${reasonLabel}...`);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setGenesisFinalizeStatus("Your session expired. Refresh and sign in again.");
        return;
      }

      const response = await fetch("/api/genesis/void", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          seasonId: season.id,
          matchupId,
          reason,
        }),
      });

      const result = (await response.json()) as {
        error?: string;
        discordPosted?: boolean;
        leaderboardWarning?: string;
      };

      if (!response.ok) {
        setGenesisFinalizeStatus(result.error || "Could not void Genesis matchup.");
        return;
      }

      await loadRoomSeason(season.id);
      setGenesisFinalScoreInputs((current) => {
        const next = { ...current };
        delete next[matchupId];
        return next;
      });

      let status = `✅ Genesis line voided — ${reasonLabel}. Picks canceled with no effect on standings or future line history.`;
      if (result.discordPosted === false) {
        status += " The matchup was voided, but the Discord notice could not be posted.";
      }
      if (result.leaderboardWarning) {
        status += ` Leaderboard warning: ${result.leaderboardWarning}`;
      }
      setGenesisFinalizeStatus(status);
    } catch (error) {
      setGenesisFinalizeStatus(
        error instanceof Error
          ? `Could not void Genesis matchup: ${error.message}`
          : "Could not void Genesis matchup."
      );
    } finally {
      setVoidingGenesisMatchupId(null);
    }
  }

  async function finalizeGenesisMatchup(matchupId: string) {
    if (!season) return;

    const scores = genesisFinalScoreInputs[matchupId];
    const awayScore = Number(scores?.away);
    const homeScore = Number(scores?.home);

    if (
      !scores ||
      scores.away.trim() === "" ||
      scores.home.trim() === "" ||
      !Number.isInteger(awayScore) ||
      !Number.isInteger(homeScore) ||
      awayScore < 0 ||
      homeScore < 0
    ) {
      setGenesisFinalizeStatus("Enter both final scores as whole numbers.");
      return;
    }

    if (awayScore === homeScore) {
      setGenesisFinalizeStatus("College football games cannot end in a tie.");
      return;
    }

    setFinalizingGenesisMatchupId(matchupId);
    const matchup = activeGenesisMatchups.find((item) => item.id === matchupId);
    const isCorrection = matchup?.status === "settled";

    setGenesisFinalizeStatus(
      isCorrection
        ? "Saving corrected final score, re-grading ATS picks, and recalculating the leaderboard..."
        : "Finalizing game, grading ATS picks, and updating Discord..."
    );

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setGenesisFinalizeStatus("Your session expired. Refresh and sign in again.");
        return;
      }

      const response = await fetch("/api/genesis/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          seasonId: season.id,
          matchupId,
          awayScore,
          homeScore,
        }),
      });

      const result = (await response.json()) as {
        error?: string;
        atsWinner?: "away" | "home" | "push";
        corrected?: boolean;
        leaderboardWarning?: string;
      };

      if (!response.ok) {
        setGenesisFinalizeStatus(result.error || "Could not finalize Genesis matchup.");
        return;
      }

      await loadRoomSeason(season.id);
      setGenesisFinalScoreInputs((current) => {
        const next = { ...current };
        delete next[matchupId];
        return next;
      });

      setGenesisFinalizeStatus(
        result.corrected
          ? `✅ Final score corrected. Picks re-graded and #genesis-picks recalculated${result.leaderboardWarning ? `. Leaderboard warning: ${result.leaderboardWarning}` : "."}`
          : `✅ Game finalized. Picks locked and graded${result.leaderboardWarning ? `. Leaderboard warning: ${result.leaderboardWarning}` : ", and #genesis-picks updated."}`
      );
    } catch (error) {
      setGenesisFinalizeStatus(
        error instanceof Error
          ? `Could not finalize Genesis matchup: ${error.message}`
          : "Could not finalize Genesis matchup."
      );
    } finally {
      setFinalizingGenesisMatchupId(null);
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
      pingEveryone: postPingEveryone,
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
      pingEveryone: postPingEveryone,
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

  // Adds a brand-new team slot -- unclaimed, name defaulted to the team's
  // own name since nobody's attached to it yet. The host can rename it via
  // Manage Players once someone's expected to claim it, or a participant
  // can just claim the row as-is.
  async function addTeamToSeason(teamName: string) {
    if (!seasonData) return;

    const updated = await updateSeasonData((fresh) => {
      const nextId = fresh.players.reduce((max, p) => Math.max(max, p.id), 0) + 1;
      return { ...fresh, players: [...fresh.players, { id: nextId, name: teamName, team: teamName }] };
    });

    if (updated) setMessage(`Added ${teamName} to the season.`);
  }

  async function moveClaimedPlayerToTeam() {
    if (!season || !seasonData || !jobMovePlayerId || !jobMoveTeam) return;

    const playerId = Number(jobMovePlayerId);
    const selectedPlayer = players.find((player) => player.id === playerId);
    if (!selectedPlayer) {
      setJobMoveStatus("Select a valid claimed player.");
      return;
    }

    const participant = participantByName.get(selectedPlayer.name.toLowerCase());
    if (!participant) {
      setJobMoveStatus("That player does not currently have a claimed slot.");
      return;
    }

    if (
      selectedPlayer.team?.localeCompare(jobMoveTeam, undefined, {
        sensitivity: "base",
      }) === 0
    ) {
      setJobMoveStatus(`${selectedPlayer.name} is already at ${jobMoveTeam}.`);
      return;
    }

    const destinationSlot = players.find(
      (player) =>
        player.id !== selectedPlayer.id &&
        player.team?.localeCompare(jobMoveTeam, undefined, {
          sensitivity: "base",
        }) === 0
    );
    const destinationParticipant = destinationSlot
      ? participantByName.get(destinationSlot.name.toLowerCase())
      : undefined;

    if (destinationParticipant) {
      setJobMoveStatus(
        `${jobMoveTeam} is already claimed by ${destinationSlot?.name || "another player"}. Move or release that claim first.`
      );
      return;
    }

    const oldTeam = selectedPlayer.team || "Unassigned";
    const confirmed = window.confirm(
      `Move ${selectedPlayer.name} from ${oldTeam} to ${jobMoveTeam}? Their login/claim and player history stay attached to them. ${selectedPlayer.team ? `${selectedPlayer.team} will become unclaimed.` : ""}`
    );
    if (!confirmed) return;

    setIsMovingJob(true);
    setJobMoveStatus("");

    const fresh = (await fetchFreshSeasonData()) ?? seasonData;
    const freshPlayer = fresh.players.find((player) => player.id === playerId);

    if (!freshPlayer) {
      setJobMoveStatus("That player is no longer in the season. Refresh and try again.");
      setIsMovingJob(false);
      return;
    }

    if (
      freshPlayer.team?.localeCompare(jobMoveTeam, undefined, {
        sensitivity: "base",
      }) === 0
    ) {
      setJobMoveStatus(
        `${freshPlayer.name} is already at ${jobMoveTeam}. Refresh if another commissioner changed the assignment.`
      );
      setIsMovingJob(false);
      return;
    }

    const freshDestination = fresh.players.find(
      (player) =>
        player.id !== freshPlayer.id &&
        player.team?.localeCompare(jobMoveTeam, undefined, {
          sensitivity: "base",
        }) === 0
    );

    const { data: freshClaims, error: freshClaimsError } = await supabase
      .from("season_participants")
      .select("player_name")
      .eq("season_id", season.id);

    if (freshClaimsError) {
      setJobMoveStatus(
        "Could not verify current team claims. Refresh and try the move again."
      );
      setIsMovingJob(false);
      return;
    }

    const freshClaimedNames = new Set(
      (freshClaims || []).map((claim) => claim.player_name.toLowerCase())
    );

    if (
      freshDestination &&
      freshClaimedNames.has(freshDestination.name.toLowerCase())
    ) {
      setJobMoveStatus(
        `${jobMoveTeam} was claimed by another player before this move could save. Move or release that claim first.`
      );
      setIsMovingJob(false);
      return;
    }

    const oldTeamName = freshPlayer.team;
    const destinationRatings = freshDestination
      ? {
          overallRating: freshDestination.overallRating,
          offenseRating: freshDestination.offenseRating,
          defenseRating: freshDestination.defenseRating,
        }
      : {
          overallRating: undefined,
          offenseRating: undefined,
          defenseRating: undefined,
        };

    let nextId =
      fresh.players.reduce((max, player) => Math.max(max, player.id), 0) + 1;

    const usedNames = new Set(
      fresh.players
        .filter(
          (player) =>
            player.id !== freshPlayer.id &&
            player.id !== freshDestination?.id
        )
        .map((player) => player.name.toLowerCase())
    );

    function uniqueReleasedSlotName(teamName: string) {
      if (!usedNames.has(teamName.toLowerCase())) return teamName;
      let suffix = 2;
      let candidate = `${teamName} Open`;
      while (usedNames.has(candidate.toLowerCase())) {
        candidate = `${teamName} Open ${suffix}`;
        suffix++;
      }
      return candidate;
    }

    const nextPlayers = fresh.players
      .filter((player) => player.id !== freshDestination?.id)
      .map((player) =>
        player.id === freshPlayer.id
          ? {
              ...player,
              team: jobMoveTeam,
              ...destinationRatings,
            }
          : player
      );

    if (oldTeamName) {
      nextPlayers.push({
        id: nextId++,
        name: uniqueReleasedSlotName(oldTeamName),
        team: oldTeamName,
        overallRating: freshPlayer.overallRating,
        offenseRating: freshPlayer.offenseRating,
        defenseRating: freshPlayer.defenseRating,
      });
    }

    const removedDestinationId = freshDestination?.id;
    const nextSeasonData: SeasonData = {
      ...fresh,
      players: nextPlayers,
      readyPlayerIdsByWeek: removedDestinationId
        ? Object.fromEntries(
            Object.entries(fresh.readyPlayerIdsByWeek).map(([week, ids]) => [
              week,
              ids.filter((id) => id !== removedDestinationId),
            ])
          )
        : fresh.readyPlayerIdsByWeek,
      extensionRequests: removedDestinationId
        ? fresh.extensionRequests.filter(
            (request) => request.playerId !== removedDestinationId
          )
        : fresh.extensionRequests,
    };

    const saved = await saveRoomSeason(nextSeasonData);
    if (saved) {
      setJobMoveStatus(
        `✅ Moved ${selectedPlayer.name}: ${oldTeam} → ${jobMoveTeam}. ${oldTeamName ? `${oldTeamName} is now unclaimed.` : ""}`
      );
      setJobMoveTeam("");
      await loadParticipants(season.id);
    } else {
      setJobMoveStatus("The coaching-job change did not save. Refresh and try again.");
    }

    setIsMovingJob(false);
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

  // Toggles a purely informational status flag on a player -- doesn't
  // affect ready/advance/extension logic, just flags them for the host.
  async function togglePlayerFlag(player: SeasonPlayer, flag: "noResponse24h" | "onVacation") {
    if (!seasonData) return;

    const next = !player[flag];

    await updateSeasonData((fresh) => ({
      ...fresh,
      players: fresh.players.map((p) => (p.id === player.id ? { ...p, [flag]: next } : p)),
    }));

    const label = flag === "noResponse24h" ? "No Response >24H" : "Vacation";
    setMessage(
      next ? `Flagged ${player.name} as ${label}.` : `Cleared ${label} flag for ${player.name}.`
    );
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

  // Opens the grant popup, prefilled from the current Anticipated Advance
  // Time (or a sensible default if none is set yet) -- the commissioner
  // adjusts it there rather than typing a date/hour inline on every row.
  function beginGrantExtension(request: ExtensionRequest) {
    const window = seasonData?.advanceWindow;
    setGrantModalRequest(request);
    setGrantModalDate(window?.date || request.requestedUntilDate);
    setGrantModalStartHour(window?.startHour ?? 19);
    setGrantModalEndHour(window?.endHour ?? 22);
    setGrantModalCustomText(window?.customText || "");
  }

  // Grants a request and, in the same step, sets the season's general
  // Anticipated Advance Time to whatever the commissioner picked in the
  // grant popup -- that's now the real time everyone's expected to advance,
  // since a player's extension was just built around it.
  async function grantExtension(requestId: string, advanceWindow: AdvanceWindow) {
    if (!seasonData) return;

    setGrantModalRequest(null);
    const grantedUntil = advanceWindowEnd(advanceWindow)?.toISOString();

    const updated = await updateSeasonData((fresh) => ({
      ...fresh,
      extensionRequests: fresh.extensionRequests.map((request) =>
        request.id === requestId
          ? {
              ...request,
              status: "granted" as const,
              resolvedAt: new Date().toISOString(),
              grantedUntil,
            }
          : request
      ),
      advanceWindow,
    }));

    setMessage("Extension granted and advance time updated.");

    if (!updated) return;

    const grantedRequest = updated.extensionRequests.find((request) => request.id === requestId);
    const player = grantedRequest && updated.players.find((p) => p.id === grantedRequest.playerId);
    if (!player) return;

    notifyDiscord({
      type: "extension_granted",
      seasonTitle: updated.seasonTitle,
      week: grantedRequest.week,
      playerName: player.name,
      team: player.team,
      newTime: formatAdvanceWindow(advanceWindow),
    });
  }

  async function denyExtension(requestId: string) {
    if (!seasonData) return;

    await updateSeasonData((fresh) => ({
      ...fresh,
      extensionRequests: fresh.extensionRequests.map((request) =>
        request.id === requestId
          ? { ...request, status: "denied" as const, resolvedAt: new Date().toISOString() }
          : request
      ),
    }));

    setMessage("Extension denied.");
  }

  // Fully deletes a request (pending, granted, or denied) instead of just
  // changing its status -- for correcting a mistake, e.g. one added
  // manually for the wrong player/week.
  async function removeExtensionRequest(requestId: string) {
    if (!seasonData) return;
    await updateSeasonData((fresh) => ({
      ...fresh,
      extensionRequests: fresh.extensionRequests.filter((request) => request.id !== requestId),
    }));
    setMessage("Extension request removed.");
  }

  // Host-initiated request on a player's behalf (e.g. they asked over
  // text/in person instead of using the button) -- lands as "pending" so it
  // goes through the same Grant/Deny flow as a self-service request.
  async function addExtensionRequestManually() {
    if (!seasonData || !manualExtensionPlayerId || !manualExtensionDate) return;

    const playerId = Number(manualExtensionPlayerId);
    const player = players.find((p) => p.id === playerId);
    if (!player) return;

    const hasActiveRequest = seasonData.extensionRequests.some(
      (request) =>
        request.playerId === playerId &&
        request.week === currentWeek &&
        (request.status === "pending" || request.status === "granted")
    );
    if (hasActiveRequest) {
      setMessage(
        `${player.name} already has an active extension request for ${formatWeekLabel(currentWeek)} -- remove it first.`
      );
      return;
    }

    const requestedUntilDate = manualExtensionDate;
    const reason = manualExtensionReason.trim() || undefined;

    const updated = await updateSeasonData((fresh) => {
      const request: ExtensionRequest = {
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}`,
        playerId,
        week: fresh.currentWeek,
        requestedUntilDate,
        reason,
        status: "pending",
        requestedAt: new Date().toISOString(),
      };
      return { ...fresh, extensionRequests: [...fresh.extensionRequests, request] };
    });

    if (!updated) return;

    setManualExtensionPlayerId("");
    setManualExtensionDate("");
    setManualExtensionReason("");
    setMessage(`Extension request added for ${player.name}.`);
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
    if (!seasonData || !newReminderTime) return;
    if (newReminderOneTime ? !newReminderDate : newReminderDays.size === 0) return;

    const reminder: ReminderSchedule = {
      id:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}`,
      time: newReminderTime,
      daysOfWeek: newReminderOneTime ? [] : Array.from(newReminderDays),
      date: newReminderOneTime ? newReminderDate : null,
      oneTime: newReminderOneTime,
      pingEveryone: newReminderPingEveryone,
      messageStyle: newReminderMessageStyle,
      enabled: true,
      lastSentDate: null,
    };

    await updateSeasonData((fresh) => ({
      ...fresh,
      reminders: [...(fresh.reminders || []), reminder],
    }));

    setNewReminderDays(new Set());
    setNewReminderDate("");
    setNewReminderOneTime(false);
    setNewReminderPingEveryone(false);
    setNewReminderMessageStyle("full");
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

  // Step 1: the existing "are you sure" check for outstanding players. If
  // that's cleared, open the estimated-advance-time popup instead of
  // advancing immediately -- the answer feeds directly into the Discord
  // post announcing the new week, so it doesn't say "Not set" right after
  // an advance.
  function beginAdvanceWeek() {
    if (!seasonData || !season) return;

    // Hard stop, not a confirm-and-override -- a pending extension means
    // someone's explicitly asked for more time, so advancing out from
    // under them isn't a call the "advance anyway?" confirm below should
    // be able to make.
    if (pendingRequests.length > 0) {
      setShowPendingExtensionAlert(true);
      window.alert(
        `${pendingRequests.length} extension request(s) still need a Grant or Deny before you can advance.`
      );
      return;
    }

    const outstanding = players.length - effectiveReadyCount;

    if (outstanding > 0) {
      const confirmed = window.confirm(
        `${outstanding} player(s) haven't marked ready yet for ${formatWeekLabel(currentWeek)}. Advance anyway?`
      );
      if (!confirmed) return;
    }

    setAdvanceModalDate("");
    setAdvanceModalStartHour(19);
    setAdvanceModalEndHour(22);
    setAdvanceModalCustomText("");
    setShowAdvanceTimeModal(true);
  }

  // Step 2: actually advances the week, using whatever estimated advance
  // time (or none, if skipped) came out of the popup.
  async function confirmAdvanceWeek(nextAdvanceWindow: AdvanceWindow | null) {
    if (!seasonData || !season) return;

    setShowAdvanceTimeModal(false);

    const updated = await updateSeasonData((fresh) => {
      const freshNextWeek = fresh.currentWeek + 1;
      return {
        ...fresh,
        currentWeek: freshNextWeek,
        readyPlayerIdsByWeek: {
          ...fresh.readyPlayerIdsByWeek,
          [freshNextWeek]: fresh.readyPlayerIdsByWeek[freshNextWeek] ?? [],
        },
        // Every extension request -- pending, granted, or denied -- was
        // for the week we're leaving, so none of it carries forward.
        // Each week starts fresh.
        extensionRequests: [],
        periodLabel: null,
        advanceWindow: nextAdvanceWindow,
      };
    });

    if (!updated) {
      setMessage("Something went wrong advancing the week. Try again.");
      return;
    }

    setMessage(`Advanced to ${formatWeekLabel(updated.currentWeek)}. Posting to Discord...`);

    // Auto-post so everyone gets a fresh "I'm Ready" prompt for the new
    // week immediately, instead of waiting on the next scheduled reminder.
    // Just the header + buttons -- nobody's had a chance to be not-ready
    // yet for a week that just started, so there's no list worth posting.
    const posted = await notifyDiscord({
      type: "nudge",
      seasonId: season.id,
      periodHeading: periodHeading(updated.periodLabel, updated.currentWeek, updated.seasonYear),
      plannedAdvanceTime: formatAdvanceWindow(updated.advanceWindow),
      pingEveryone: true,
    });

    setMessage(
      posted
        ? `Advanced to ${formatWeekLabel(updated.currentWeek)} and posted to Discord.`
        : `Advanced to ${formatWeekLabel(updated.currentWeek)}, but couldn't post to Discord.`
    );
  }

  // Manual override for the current week -- e.g. correcting a mistake or
  // skipping ahead -- without the confirm/notify/reset choreography of a
  // normal advance.
  async function setCurrentWeekManually() {
    if (!seasonData) return;

    const week = Number(manualWeekInput);
    if (!Number.isFinite(week) || !Number.isInteger(week) || week < PRESEASON_WEEK) return;

    const updated = await updateSeasonData((fresh) => ({
      ...fresh,
      currentWeek: week,
      readyPlayerIdsByWeek: {
        ...fresh.readyPlayerIdsByWeek,
        [week]: fresh.readyPlayerIdsByWeek[week] ?? [],
      },
    }));

    if (updated) {
      setManualWeekInput("");
      setMessage(`Current week set to ${formatWeekLabel(updated.currentWeek)}.`);
    }
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
          <section className="rounded-3xl border-2 border-cyan-400/30 bg-cyan-500/[0.05] p-6">
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
              🏈 PvP Channels
              <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-cyan-200">
                Only you can see this
              </span>
            </div>

            <h2 className="text-xl font-black">Create Weekly Matchup Threads</h2>
            <p className="mt-2 text-sm text-slate-400">
              Add one or more PvP games for the week. The shared stage/year remains the default,
              and any game can override the stage for championships or bowls. RTA generates a
              separate Genesis line and Discord thread for every matchup.
            </p>

            <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
              <p className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">
                Game 1
              </p>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)]">
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  X Team
                  <select
                    value={pvpAwayTeam}
                    onChange={(event) => setPvpAwayTeam(event.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-cyan-300"
                  >
                    <option value="">Select X team...</option>
                    {leagueTeamNames.map((team) => (
                      <option key={team} value={team} disabled={team === pvpHomeTeam}>
                        {team}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  Site
                  <select
                    value={pvpSeparator}
                    onChange={(event) => setPvpSeparator(event.target.value as "@" | "vs.")}
                    className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-center text-white outline-none focus:border-cyan-300"
                  >
                    <option value="@">@</option>
                    <option value="vs.">vs.</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  Y Team
                  <select
                    value={pvpHomeTeam}
                    onChange={(event) => setPvpHomeTeam(event.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-cyan-300"
                  >
                    <option value="">Select Y team...</option>
                    {leagueTeamNames.map((team) => (
                      <option key={team} value={team} disabled={team === pvpAwayTeam}>
                        {team}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-slate-400">
                Stage / Bowl Name <span className="font-normal text-slate-500">(optional override)</span>
                <input
                  value={pvpStageOverride}
                  onChange={(event) => setPvpStageOverride(event.target.value)}
                  maxLength={80}
                  placeholder={`Uses shared “${pvpStageLabel || formatWeekLabel(currentWeek)}”`}
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                />
              </label>

              <p className="mt-3 text-xs text-slate-500">{pvpThreadTitle}</p>
            </div>

            {additionalPvpGames.map((game, index) => (
              <div
                key={game.id}
                className="relative mt-3 rounded-2xl border border-white/10 bg-slate-950/50 p-4 pr-12"
              >
                <button
                  type="button"
                  onClick={() =>
                    setAdditionalPvpGames((current) =>
                      current.filter((row) => row.id !== game.id)
                    )
                  }
                  title="Remove this matchup from the batch"
                  className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-black text-slate-400 transition hover:border-red-300/40 hover:bg-red-300/10 hover:text-red-200"
                >
                  ×
                </button>

                <p className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">
                  Game {index + 2}
                </p>

                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)]">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                    X Team
                    <select
                      value={game.awayTeam}
                      onChange={(event) =>
                        setAdditionalPvpGames((current) =>
                          current.map((row) =>
                            row.id === game.id
                              ? { ...row, awayTeam: event.target.value }
                              : row
                          )
                        )
                      }
                      className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-cyan-300"
                    >
                      <option value="">Select X team...</option>
                      {leagueTeamNames.map((team) => (
                        <option
                          key={team}
                          value={team}
                          disabled={team === game.homeTeam}
                        >
                          {team}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                    Site
                    <select
                      value={game.separator}
                      onChange={(event) =>
                        setAdditionalPvpGames((current) =>
                          current.map((row) =>
                            row.id === game.id
                              ? {
                                  ...row,
                                  separator: event.target.value as "@" | "vs.",
                                }
                              : row
                          )
                        )
                      }
                      className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-center text-white outline-none focus:border-cyan-300"
                    >
                      <option value="@">@</option>
                      <option value="vs.">vs.</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                    Y Team
                    <select
                      value={game.homeTeam}
                      onChange={(event) =>
                        setAdditionalPvpGames((current) =>
                          current.map((row) =>
                            row.id === game.id
                              ? { ...row, homeTeam: event.target.value }
                              : row
                          )
                        )
                      }
                      className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-cyan-300"
                    >
                      <option value="">Select Y team...</option>
                      {leagueTeamNames.map((team) => (
                        <option
                          key={team}
                          value={team}
                          disabled={team === game.awayTeam}
                        >
                          {team}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  Stage / Bowl Name <span className="font-normal text-slate-500">(optional override)</span>
                  <input
                    value={game.stageLabel}
                    onChange={(event) =>
                      setAdditionalPvpGames((current) =>
                        current.map((row) =>
                          row.id === game.id
                            ? { ...row, stageLabel: event.target.value }
                            : row
                        )
                      )
                    }
                    maxLength={80}
                    placeholder={`Uses shared “${pvpStageLabel || formatWeekLabel(currentWeek)}”`}
                    className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                  />
                </label>

                <p className="mt-3 text-xs text-slate-500">
                  {pvpThreadTitleFor(
                    game.awayTeam,
                    game.separator,
                    game.homeTeam,
                    game.stageLabel
                  )}
                </p>
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                setAdditionalPvpGames((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    awayTeam: "",
                    homeTeam: "",
                    separator: "@",
                    stageLabel: "",
                  },
                ])
              }
              className="mt-3 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-200 transition hover:bg-cyan-400/20"
            >
              + Add Another Game
            </button>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-semibold text-slate-400">
                Default Week / Stage / Bowl
                <input
                  value={pvpStageLabel}
                  onChange={(event) => setPvpStageLabel(event.target.value)}
                  maxLength={80}
                  placeholder="Week 11 or Cotton Bowl"
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                />
                <span className="font-normal text-slate-500">
                  Used by every game whose optional override is blank.
                </span>
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                Year
                <input
                  type="number"
                  value={pvpYear}
                  onChange={(event) => setPvpYear(event.target.value)}
                  className="w-28 rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-cyan-300"
                />
              </label>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">Batch preview</p>
              <div className="mt-2 space-y-2">
                {pvpGamesToCreate.map((game, index) => {
                  const title = pvpThreadTitleFor(
                    game.awayTeam,
                    game.separator,
                    game.homeTeam,
                    game.stageLabel
                  );

                  return (
                    <div key={game.id} className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="break-words font-black text-white">
                        <span className="mr-2 text-xs uppercase tracking-wide text-slate-500">
                          Game {index + 1}
                        </span>
                        {title}
                      </p>
                      <p className={`text-xs ${title.length > 100 ? "text-red-300" : "text-slate-500"}`}>
                        {title.length}/100 characters
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/[0.05] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-300">
                    📈 Genesis Lines
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {seasonData.genesisHistory
                      ? `${seasonData.genesisHistory.games.length} historical games stored · auto-sync enabled · last checked ${new Date(
                          seasonData.genesisHistory.lastSyncedAt
                        ).toLocaleString()}`
                      : "No Discord history synced yet. The first generated line will initialize automatic sync."}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => syncGenesisHistory("incremental")}
                    disabled={isSyncingGenesisHistory}
                    className="rounded-xl bg-fuchsia-300 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-fuchsia-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isSyncingGenesisHistory && genesisHistorySyncMode === "incremental"
                      ? "Checking for New History..."
                      : "Check for New History"}
                  </button>
                  <button
                    onClick={() => syncGenesisHistory("full")}
                    disabled={isSyncingGenesisHistory}
                    className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-400/10 px-3 py-2 text-xs font-bold text-fuchsia-200 transition hover:bg-fuchsia-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isSyncingGenesisHistory && genesisHistorySyncMode === "full"
                      ? "Rebuilding History..."
                      : "Rebuild Full History"}
                  </button>
                  <button
                    onClick={generateGenesisLine}
                    disabled={
                      isGeneratingGenesisLine ||
                      !pvpAwayTeam ||
                      !pvpHomeTeam ||
                      pvpAwayTeam === pvpHomeTeam
                    }
                    className="rounded-xl bg-fuchsia-300 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-fuchsia-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isGeneratingGenesisLine ? "Generating..." : "Generate Line"}
                  </button>
                </div>
              </div>

              {genesisHistoryStatus && (
                <p
                  className={`mt-3 text-xs font-semibold ${
                    genesisHistoryStatus.startsWith("✅")
                      ? "text-green-300"
                      : "text-slate-300"
                  }`}
                >
                  {genesisHistoryStatus}
                </p>
              )}

              {genesisLine && (
                <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/70 p-4">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-slate-500">
                        Genesis Line
                      </p>
                      <p className="mt-1 text-xs font-semibold text-fuchsia-200">
                        {resolvedPvpStage(pvpStageOverride)}, {pvpYear}
                      </p>
                      <p className="mt-1 text-2xl font-black text-white">
                        {genesisLine.displayLine}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-300">
                        Projected: {genesisLine.awayTeam} {genesisLine.projectedAwayScore} –{" "}
                        {genesisLine.homeTeam} {genesisLine.projectedHomeScore}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black uppercase tracking-wide text-slate-500">
                        Confidence
                      </p>
                      <p className="text-lg font-black text-fuchsia-200">
                        {genesisLine.confidence} · {genesisLine.confidenceScore}%
                      </p>
                      <p className="text-xs text-slate-500">
                        {genesisLine.historyGamesUsed} relevant history games
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-400">
                    Rating edge {genesisLine.ratingMargin >= 0 ? "+" : ""}
                    {genesisLine.ratingMargin.toFixed(1)} to {genesisLine.awayTeam}; history adjustment{" "}
                    {genesisLine.historyAdjustment >= 0 ? "+" : ""}
                    {genesisLine.historyAdjustment.toFixed(1)}; home field{" "}
                    {genesisLine.homeFieldAdjustment.toFixed(1)} from the away-team perspective.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-start gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={postPvpStreamInstructions}
                  onChange={(event) =>
                    setPostPvpStreamInstructions(event.target.checked)
                  }
                  className="mt-0.5 h-4 w-4 accent-cyan-400"
                />
                <span>
                  <span className="font-bold text-white">
                    Post /stream instructions in the game thread
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    RTA will remind the matchup players to use /stream with their YouTube/Twitch link when the game starts, which closes Genesis voting at the locked line.
                  </span>
                </span>
              </label>

              <button
                onClick={createPvpThread}
                disabled={
                  isCreatingPvpThread ||
                  !allPvpGamesReady ||
                  !pvpStageLabel.trim() ||
                  !pvpYear.trim()
                }
                className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isCreatingPvpThread
                  ? "Creating..."
                  : pvpGamesToCreate.length > 1
                    ? `Create All PvP Threads (${pvpGamesToCreate.length})`
                    : "Create PvP Thread"}
              </button>

              {pvpCreateStatus && (
                <span
                  className={`text-sm font-semibold ${
                    pvpCreateStatus.startsWith("✅") ? "text-green-300" : "text-red-300"
                  }`}
                >
                  {pvpCreateStatus}
                </span>
              )}
            </div>

            {activeGenesisMatchups.length > 0 && (
              <div className="mt-6 border-t border-white/10 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-black text-white">🏈 This Week's Genesis Games</h3>
                    <p className="mt-1 text-xs text-slate-400">
                      Finalized games stay here until you advance the week so scores can be corrected if needed. Open games can still be scheduled, locked, voided, or remade.
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold text-slate-300">
                    {activeGenesisMatchups.length} this week
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {activeGenesisMatchups.map((matchup) => {
                    const score = genesisFinalScoreInputs[matchup.id] || {
                      away:
                        matchup.status === "settled" &&
                        matchup.finalAwayScore != null
                          ? String(matchup.finalAwayScore)
                          : "",
                      home:
                        matchup.status === "settled" &&
                        matchup.finalHomeScore != null
                          ? String(matchup.finalHomeScore)
                          : "",
                    };
                    const pickCount = Object.keys(matchup.picks || {}).length;
                    const kickoffDraft = genesisKickoffInputs[matchup.id] || {
                      local: toLocalDateTimeInputValue(
                        matchup.scheduledKickoffAt,
                        matchup.scheduledKickoffTimeZone ||
                          DEFAULT_KICKOFF_TIME_ZONE
                      ),
                      timeZone:
                        matchup.scheduledKickoffTimeZone ||
                        DEFAULT_KICKOFF_TIME_ZONE,
                      autoLock: matchup.autoLockAtKickoff !== false,
                    };

                    return (
                      <div
                        key={matchup.id}
                        className="relative rounded-2xl border border-white/10 bg-slate-950/60 p-4 pr-12"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            deleteGenesisMatchup(
                              matchup.id,
                              `${matchup.awayTeam} ${matchup.neutral ? "vs." : "@"} ${matchup.homeTeam}`
                            )
                          }
                          disabled={deletingGenesisMatchupId === matchup.id}
                          title="Delete this game and Discord thread"
                          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-red-300/20 bg-red-300/5 text-base font-black text-red-300 transition hover:bg-red-300/15 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {deletingGenesisMatchupId === matchup.id ? "…" : "×"}
                        </button>

                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-black text-white">
                              {matchup.awayTeam} {matchup.neutral ? "vs." : "@"} {matchup.homeTeam}
                            </p>
                            <p className="mt-1 text-xs font-semibold text-cyan-200">
                              {matchup.stage?.trim() || formatWeekLabel(matchup.seasonWeek ?? currentWeek)}, {matchup.seasonYear}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                              Locked line: {matchup.displayLine} · {pickCount} pick{pickCount === 1 ? "" : "s"} submitted
                            </p>
                            {matchup.scheduledKickoffAt && (
                              <p className="mt-1 text-xs font-semibold text-cyan-200">
                                ⏰ Kickoff: {formatKickoffInTimeZone(
                                  matchup.scheduledKickoffAt,
                                  matchup.scheduledKickoffTimeZone ||
                                    DEFAULT_KICKOFF_TIME_ZONE
                                )} · {kickoffTimeZoneLabel(
                                  matchup.scheduledKickoffTimeZone ||
                                    DEFAULT_KICKOFF_TIME_ZONE
                                )}
                                {matchup.autoLockAtKickoff === false
                                  ? " · manual lock"
                                  : " · auto-lock enabled"}
                              </p>
                            )}
                            <p
                              className={`mt-1 text-xs font-black uppercase tracking-wide ${
                                matchup.status === "settled"
                                  ? "text-fuchsia-300"
                                  : matchup.status === "locked"
                                    ? "text-amber-300"
                                    : "text-green-300"
                              }`}
                            >
                              {matchup.status === "settled"
                                ? `🏁 Final · ${matchup.finalAwayScore ?? "?"}–${matchup.finalHomeScore ?? "?"}`
                                : matchup.status === "locked"
                                  ? "🔒 Picks closed · game started"
                                  : "🟢 Picks open"}
                            </p>
                          </div>

                          {matchup.status === "open" && (
                            <div className="w-full rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] p-3">
                              <div className="flex flex-wrap items-end gap-3">
                                <label className="flex min-w-[15rem] flex-1 flex-col gap-1 text-[11px] font-bold text-slate-400">
                                  Scheduled kickoff
                                  <input
                                    type="datetime-local"
                                    value={kickoffDraft.local}
                                    onChange={(event) =>
                                      setGenesisKickoffInputs((current) => ({
                                        ...current,
                                        [matchup.id]: {
                                          local: event.target.value,
                                          timeZone: kickoffDraft.timeZone,
                                          autoLock: kickoffDraft.autoLock,
                                        },
                                      }))
                                    }
                                    className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-300"
                                  />
                                </label>

                                <label className="flex min-w-[10rem] flex-col gap-1 text-[11px] font-bold text-slate-400">
                                  Time zone
                                  <select
                                    value={kickoffDraft.timeZone}
                                    onChange={(event) =>
                                      setGenesisKickoffInputs((current) => ({
                                        ...current,
                                        [matchup.id]: {
                                          local: kickoffDraft.local,
                                          timeZone: event.target.value,
                                          autoLock: kickoffDraft.autoLock,
                                        },
                                      }))
                                    }
                                    className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-300"
                                  >
                                    {KICKOFF_TIME_ZONES.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="flex cursor-pointer items-center gap-2 pb-2 text-xs font-semibold text-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={kickoffDraft.autoLock}
                                    onChange={(event) =>
                                      setGenesisKickoffInputs((current) => ({
                                        ...current,
                                        [matchup.id]: {
                                          local: kickoffDraft.local,
                                          timeZone: kickoffDraft.timeZone,
                                          autoLock: event.target.checked,
                                        },
                                      }))
                                    }
                                    className="h-4 w-4 accent-cyan-400"
                                  />
                                  Auto-lock picks at kickoff
                                </label>

                                <button
                                  type="button"
                                  onClick={() => saveGenesisKickoff(matchup.id)}
                                  disabled={savingGenesisKickoffId === matchup.id}
                                  className="rounded-xl bg-cyan-300 px-4 py-2 font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {savingGenesisKickoffId === matchup.id
                                    ? "Saving..."
                                    : matchup.scheduledKickoffAt
                                      ? "Update Kickoff"
                                      : "Save Kickoff"}
                                </button>

                                {matchup.scheduledKickoffAt && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      saveGenesisKickoff(matchup.id, true)
                                    }
                                    disabled={savingGenesisKickoffId === matchup.id}
                                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                              <p className="mt-2 text-[11px] text-slate-500">
                                Enter the time in the selected zone. Discord will display the equivalent local time for each user. RTA will update one kickoff notice, remind the players about 30 minutes before kickoff, and auto-lock only if that option is checked.
                              </p>
                            </div>
                          )}

                          <div className="flex flex-wrap items-end gap-2">
                            {matchup.status === "open" && (
                              <button
                                onClick={() => lockGenesisPicks(matchup.id)}
                                disabled={lockingGenesisMatchupId === matchup.id}
                                className="rounded-xl border border-amber-300/40 bg-amber-300/10 px-4 py-2 font-black text-amber-200 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {lockingGenesisMatchupId === matchup.id
                                  ? "Locking..."
                                  : "🔒 Lock Picks / Game Started"}
                              </button>
                            )}

                            {matchup.status !== "settled" && (
                              <>
                                <button
                                  onClick={() => voidGenesisMatchup(matchup.id, "auto_sim")}
                                  disabled={voidingGenesisMatchupId === matchup.id}
                                  className="rounded-xl border border-red-300/30 bg-red-300/10 px-3 py-2 text-xs font-black text-red-200 transition hover:bg-red-300/20 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {voidingGenesisMatchupId === matchup.id
                                    ? "Voiding..."
                                    : "🚫 Auto Sim"}
                                </button>

                                <button
                                  onClick={() => voidGenesisMatchup(matchup.id, "force_win")}
                                  disabled={voidingGenesisMatchupId === matchup.id}
                                  className="rounded-xl border border-red-300/30 bg-red-300/10 px-3 py-2 text-xs font-black text-red-200 transition hover:bg-red-300/20 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {voidingGenesisMatchupId === matchup.id
                                    ? "Voiding..."
                                    : "🚫 Force Win"}
                                </button>
                              </>
                            )}
                            <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-400">
                              {matchup.awayTeam}
                              <input
                                type="number"
                                min={0}
                                inputMode="numeric"
                                value={score.away}
                                onChange={(event) =>
                                  setGenesisFinalScoreInputs((current) => ({
                                    ...current,
                                    [matchup.id]: {
                                      away: event.target.value,
                                      home: current[matchup.id]?.home ?? score.home,
                                    },
                                  }))
                                }
                                className="w-20 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-center font-black text-white outline-none focus:border-fuchsia-300"
                              />
                            </label>

                            <span className="pb-2 text-sm font-black text-slate-500">–</span>

                            <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-400">
                              {matchup.homeTeam}
                              <input
                                type="number"
                                min={0}
                                inputMode="numeric"
                                value={score.home}
                                onChange={(event) =>
                                  setGenesisFinalScoreInputs((current) => ({
                                    ...current,
                                    [matchup.id]: {
                                      away: current[matchup.id]?.away ?? score.away,
                                      home: event.target.value,
                                    },
                                  }))
                                }
                                className="w-20 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-center font-black text-white outline-none focus:border-fuchsia-300"
                              />
                            </label>

                            <button
                              onClick={() => finalizeGenesisMatchup(matchup.id)}
                              disabled={finalizingGenesisMatchupId === matchup.id}
                              className="rounded-xl bg-green-300 px-4 py-2 font-black text-slate-950 transition hover:bg-green-200 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {finalizingGenesisMatchupId === matchup.id
                                ? matchup.status === "settled"
                                  ? "Saving Correction..."
                                  : "Finalizing..."
                                : matchup.status === "settled"
                                  ? "✏️ Save Corrected Score"
                                  : "Finalize Game"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {genesisFinalizeStatus && (
                  <p
                    className={`mt-3 text-sm font-semibold ${
                      genesisFinalizeStatus.startsWith("✅")
                        ? "text-green-300"
                        : "text-slate-300"
                    }`}
                  >
                    {genesisFinalizeStatus}
                  </p>
                )}
              </div>
            )}
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
                  {effectiveReadyCount}/{players.length} ready
                </span>
                <button
                  onClick={beginAdvanceWeek}
                  disabled={isSaving || players.length === 0}
                  className="rounded-2xl bg-green-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-green-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Advance to {formatWeekLabel(currentWeek + 1)}
                </button>

                <div className="flex items-center gap-2">
                  <select
                    value={manualWeekInput}
                    onChange={(event) => setManualWeekInput(event.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-cyan-300"
                  >
                    <option value="">Jump to stage…</option>
                    {SEASON_STAGE_LABELS.map((label, week) => (
                      <option key={week} value={week}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={setCurrentWeekManually}
                    disabled={isSaving || manualWeekInput === ""}
                    title="Manually set the current week to any value -- no confirmation prompt, no Discord post, no ready-list reset"
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Set Stage
                  </button>
                </div>

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

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                  <input
                    type="checkbox"
                    checked={postPingEveryone}
                    onChange={(event) => setPostPingEveryone(event.target.checked)}
                    className="h-4 w-4 accent-red-400"
                  />
                  Ping @everyone
                </label>

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
                only, e.g. 7:00 PM – 10:00 PM. Or skip the date/time below and
                type a custom message instead, e.g. &quot;After the Colorado
                game completes&quot;.
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

                <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-slate-400">
                  Or a custom message
                  <input
                    type="text"
                    value={advanceCustomText}
                    onChange={(event) => setAdvanceCustomText(event.target.value)}
                    placeholder='e.g. "After the Colorado game completes"'
                    className="min-w-[16rem] rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-300"
                  />
                </label>

                <button
                  onClick={() =>
                    setAdvanceWindow({
                      date: advanceDateInput,
                      startHour: advanceStartHourInput,
                      endHour: advanceEndHourInput,
                      customText: advanceCustomText.trim() || null,
                    })
                  }
                  disabled={isSaving || (!advanceDateInput && !advanceCustomText.trim())}
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
              <p className="mt-2 text-sm text-slate-400">
                Grant, deny, remove, or manually add a request on behalf of
                any player for {formatWeekLabel(currentWeek)}. Granting later
                than the Anticipated Advance Time below pushes that window
                out to match, so it never claims advancing before a granted
                extension.
              </p>

              <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-white/10 bg-slate-900 p-4">
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  Player
                  <select
                    value={manualExtensionPlayerId}
                    onChange={(event) => setManualExtensionPlayerId(event.target.value)}
                    className="min-w-[10rem] rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white outline-none focus:border-cyan-300"
                  >
                    <option value="">Select a player...</option>
                    {playersByManageOrder.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.team ? `${player.team} — ${player.name}` : player.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  Requested until
                  <input
                    type="date"
                    value={manualExtensionDate}
                    onChange={(event) => setManualExtensionDate(event.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white outline-none focus:border-cyan-300"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  Reason (optional)
                  <input
                    type="text"
                    value={manualExtensionReason}
                    onChange={(event) => setManualExtensionReason(event.target.value)}
                    placeholder="e.g. traveling this week"
                    className="min-w-[10rem] rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                  />
                </label>

                <button
                  onClick={addExtensionRequestManually}
                  disabled={isSaving || !manualExtensionPlayerId || !manualExtensionDate}
                  className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Add Extension Request
                </button>
              </div>

              {currentWeekExtensionRequests.length === 0 ? (
                <p className="mt-4 text-sm text-slate-400">
                  No extension requests for {formatWeekLabel(currentWeek)}.
                </p>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  {currentWeekExtensionRequests.map((request) => {
                    const player = players.find((p) => p.id === request.playerId);

                    const statusBorder =
                      request.status === "granted"
                        ? "border-blue-400/20"
                        : request.status === "denied"
                          ? "border-red-400/20"
                          : "border-yellow-400/20";

                    return (
                      <div
                        key={request.id}
                        className={`rounded-2xl border bg-slate-900 p-4 ${statusBorder}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-black">
                              {player?.team || player?.name || "Unknown player"}{" "}
                              <span className="font-normal text-slate-400">
                                — {formatWeekLabel(request.week)}
                              </span>
                              {request.status !== "pending" && (
                                <span
                                  className={`ml-2 rounded-full border px-2 py-0.5 text-xs font-bold ${
                                    request.status === "granted"
                                      ? "border-blue-400/30 bg-blue-400/10 text-blue-200"
                                      : "border-red-400/30 bg-red-400/10 text-red-200"
                                  }`}
                                >
                                  {request.status === "granted" ? "Granted" : "Denied"}
                                </span>
                              )}
                            </p>
                            <p className="mt-1 text-sm text-slate-400">
                              Requested until{" "}
                              {new Date(
                                `${request.requestedUntilDate}T00:00:00`
                              ).toLocaleDateString()}
                              {request.reason ? ` — "${request.reason}"` : ""}
                              {request.status === "granted" && request.grantedUntil
                                ? ` — granted until ${new Date(request.grantedUntil).toLocaleString()}`
                                : ""}
                            </p>
                          </div>

                          <button
                            onClick={() => removeExtensionRequest(request.id)}
                            disabled={isSaving}
                            title="Delete this extension request entirely"
                            className="flex-shrink-0 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Remove
                          </button>
                        </div>

                        {request.status === "pending" && (
                          <div className="mt-4 flex flex-wrap gap-3">
                            <button
                              onClick={() => beginGrantExtension(request)}
                              disabled={isSaving}
                              className="rounded-2xl bg-green-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-green-300 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Grant
                            </button>
                            <button
                              onClick={() => denyExtension(request.id)}
                              disabled={isSaving}
                              className="rounded-2xl bg-red-400/80 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Deny
                            </button>
                          </div>
                        )}
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
                          {reminder.oneTime
                            ? formatReminderDate(reminder.date || "")
                            : formatReminderDays(reminder.daysOfWeek)}
                        </span>
                        {reminder.oneTime && (
                          <span className="ml-2 rounded-full border border-indigo-400/30 bg-indigo-400/10 px-2 py-0.5 text-xs font-bold text-indigo-300">
                            One-time
                          </span>
                        )}
                        {reminder.pingEveryone && (
                          <span className="ml-2 rounded-full border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-xs font-bold text-red-300">
                            @everyone
                          </span>
                        )}
                        {reminder.messageStyle === "limited" && (
                          <span className="ml-2 rounded-full border border-slate-400/30 bg-slate-400/10 px-2 py-0.5 text-xs font-bold text-slate-300">
                            Limited
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

                {newReminderOneTime ? (
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                    Date
                    <input
                      type="date"
                      value={newReminderDate}
                      onChange={(event) => setNewReminderDate(event.target.value)}
                      className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-300"
                    />
                  </label>
                ) : (
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
                )}

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                  <input
                    type="checkbox"
                    checked={newReminderOneTime}
                    onChange={(event) => setNewReminderOneTime(event.target.checked)}
                    className="h-4 w-4 accent-indigo-400"
                  />
                  One-time (fires once, then removes itself)
                </label>

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                  <input
                    type="checkbox"
                    checked={newReminderPingEveryone}
                    onChange={(event) => setNewReminderPingEveryone(event.target.checked)}
                    className="h-4 w-4 accent-red-400"
                  />
                  Ping @everyone
                </label>

                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                  Post
                  <select
                    value={newReminderMessageStyle}
                    onChange={(event) =>
                      setNewReminderMessageStyle(event.target.value as "full" | "limited")
                    }
                    className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-300"
                  >
                    <option value="full">Full status (ready/pending/etc. list)</option>
                    <option value="limited">Limited (header + buttons only)</option>
                  </select>
                </label>

                <button
                  onClick={addReminder}
                  disabled={
                    isSaving ||
                    !newReminderTime ||
                    (newReminderOneTime ? !newReminderDate : newReminderDays.size === 0)
                  }
                  className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Add Reminder
                </button>
              </div>
            </div>

            <div className="mt-6 border-t border-white/10 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-black">Manage Players</h3>
                <div className="inline-flex rounded-xl border border-white/10 bg-slate-900 p-1">
                  <button
                    onClick={() => setManageListOrder("alphabetical")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                      manageListOrder === "alphabetical"
                        ? "bg-cyan-400 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    List Alphabetically
                  </button>
                  <button
                    onClick={() => setManageListOrder("genesis")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                      manageListOrder === "genesis"
                        ? "bg-cyan-400 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    List By Genesis
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-400">
                Rename a player (their claimed slot moves with them), remove
                someone who&apos;s dropped out mid-season, override their
                ready status, or make a claimed player a co-admin (they can
                only mark players ready/not ready -- nothing else).
              </p>

              <div className="mt-4 flex flex-col gap-1.5">
                {playersByManageOrder.map((player) => {
                  const participant = participantByName.get(player.name.toLowerCase());
                  const color = teamColor(player.team);

                  return (
                    <div
                      key={player.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5"
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

                      <button
                        onClick={() => hostSetPlayerReady(player, !readyPlayerIds.has(player.id))}
                        disabled={isSaving}
                        title="Toggle this player's ready status for the current week"
                        className={`w-24 flex-shrink-0 rounded-xl border px-3 py-1.5 text-center text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          readyPlayerIds.has(player.id)
                            ? "border-green-400/40 bg-green-400/20 text-green-200 hover:bg-green-400/30"
                            : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/15"
                        }`}
                      >
                        {readyPlayerIds.has(player.id) ? "✓ Ready" : "Mark Ready"}
                      </button>

                      <button
                        onClick={() => togglePlayerFlag(player, "noResponse24h")}
                        disabled={isSaving}
                        title="Flag this player as unresponsive for 24+ hours"
                        className={`w-36 flex-shrink-0 rounded-xl border px-3 py-1.5 text-center text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          player.noResponse24h
                            ? "border-red-400/40 bg-red-400/20 text-red-200 hover:bg-red-400/30"
                            : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/15"
                        }`}
                      >
                        No Response &gt;24H
                      </button>

                      <button
                        onClick={() => togglePlayerFlag(player, "onVacation")}
                        disabled={isSaving}
                        title="Flag this player as on vacation"
                        className={`w-24 flex-shrink-0 rounded-xl border px-3 py-1.5 text-center text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          player.onVacation
                            ? "border-blue-400/40 bg-blue-400/20 text-blue-200 hover:bg-blue-400/30"
                            : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/15"
                        }`}
                      >
                        Vacation
                      </button>

                      <button
                        onClick={() => participant && toggleCoAdmin(participant)}
                        disabled={isSaving || !participant}
                        title={
                          participant
                            ? "Co-admins can only mark players ready/not ready -- no other admin controls"
                            : "Only a claimed player can be made a co-admin"
                        }
                        className={`w-32 flex-shrink-0 rounded-xl border px-3 py-1.5 text-center text-xs font-bold transition disabled:cursor-not-allowed ${
                          !participant
                            ? "invisible"
                            : participant.is_co_admin
                              ? "border-purple-400/40 bg-purple-400/20 text-purple-200 hover:bg-purple-400/30"
                              : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/15"
                        }`}
                      >
                        {participant?.is_co_admin ? "🛡️ Co-Admin" : "Make Co-Admin"}
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
            <div className="text-3xl font-black">{effectiveReadyCount}</div>
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

                {seasonData.advanceWindow && remainingSeconds != null && (
                  <p
                    className={`mt-3 text-lg font-black ${
                      isAdvanceWindowPassed
                        ? "text-red-400"
                        : remainingSeconds <= 3600
                          ? "text-yellow-300"
                          : "text-cyan-300"
                    }`}
                  >
                    {isAdvanceWindowPassed
                      ? "Advance window has started"
                      : `${formatClock(remainingSeconds)} until advance window`}
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
                {showCommissionerControls
                  ? "Click any team to quickly edit its OVR / OFF / DEF ratings."
                  : !myParticipant
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
              const canEditRatings = showCommissionerControls;
              const hasRatings =
                typeof player.overallRating === "number" ||
                typeof player.offenseRating === "number" ||
                typeof player.defenseRating === "number";
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
                  role={canClaim || canEditRatings ? "button" : undefined}
                  tabIndex={canClaim || canEditRatings ? 0 : undefined}
                  onClick={() => {
                    if (canEditRatings) openTeamRatings(player);
                    else if (canClaim) claimPlayer(player);
                  }}
                  onKeyDown={(event) => {
                    if (
                      (canClaim || canEditRatings) &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      if (canEditRatings) openTeamRatings(player);
                      else if (canClaim) claimPlayer(player);
                    }
                  }}
                  title={
                    canEditRatings
                      ? `Edit ratings for ${player.team || player.name}`
                      : canClaim
                        ? `Click to select ${player.team || player.name}`
                        : isClaimed
                          ? "Already selected"
                          : undefined
                  }
                  className={`relative flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition ${
                    cardClasses[cardState]
                  } ${isMe ? "ring-2 ring-cyan-300/60" : ""} ${
                    canClaim || canEditRatings ? "cursor-pointer hover:brightness-125" : ""
                  }`}
                >
                  {cardState === "denied" && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-xl">
                      <span className="text-5xl font-black text-red-500/80">✕</span>
                    </div>
                  )}

                  {(hasRatings || canEditRatings) && (
                    <div className="absolute right-2 top-2 z-10">
                      {hasRatings ? (
                        <div className="flex gap-1 rounded-lg border border-white/10 bg-slate-950/80 px-1.5 py-1 text-[9px] font-black leading-none text-slate-300 shadow-sm backdrop-blur">
                          <span>
                            OVR <span className="text-white">{player.overallRating ?? "—"}</span>
                          </span>
                          <span>
                            OFF <span className="text-white">{player.offenseRating ?? "—"}</span>
                          </span>
                          <span>
                            DEF <span className="text-white">{player.defenseRating ?? "—"}</span>
                          </span>
                        </div>
                      ) : (
                        <span className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[9px] font-bold text-cyan-200">
                          + Ratings
                        </span>
                      )}
                    </div>
                  )}

                  <span
                    className="relative mt-1.5 h-3 w-3 flex-shrink-0 rounded-full ring-1 ring-white/20"
                    style={{ backgroundColor: color || "#64748b" }}
                  />

                  <div className={`relative min-w-0 flex-1 ${hasRatings || canEditRatings ? "pr-28" : ""}`}>
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

        {showCommissionerControls && (
          <section className="rounded-3xl border-2 border-amber-400/30 bg-amber-400/[0.04] p-6">
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-amber-300">
              🧳 Coaching Job Changes
              <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-amber-200">
                Commissioner only
              </span>
            </div>
            <h2 className="text-xl font-black">Move a Claimed Player to Another Team</h2>
            <p className="mt-2 text-sm text-slate-400">
              Use this when a user changes coaching jobs in-game. Their account claim, player identity, ready history, extensions, and Genesis player history stay attached to them. Their old school becomes an unclaimed slot.
            </p>

            <div className="mt-5 grid gap-3 rounded-2xl border border-amber-400/20 bg-slate-950/50 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                Player / Current Team
                <select
                  value={jobMovePlayerId}
                  onChange={(event) => {
                    setJobMovePlayerId(event.target.value);
                    setJobMoveTeam("");
                    setJobMoveStatus("");
                  }}
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-amber-300"
                >
                  <option value="">Select a claimed player...</option>
                  {claimedPlayersForJobMoves.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}{player.team ? ` — ${player.team}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                New Team
                <select
                  value={jobMoveTeam}
                  onChange={(event) => {
                    setJobMoveTeam(event.target.value);
                    setJobMoveStatus("");
                  }}
                  disabled={!jobMovePlayerId}
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-white outline-none focus:border-amber-300 disabled:opacity-50"
                >
                  <option value="">Select destination team...</option>
                  {[...CFB_TEAMS]
                    .sort((a, b) =>
                      a.name.localeCompare(b.name, undefined, {
                        sensitivity: "base",
                      })
                    )
                    .map((team) => {
                      const selectedPlayerId = Number(jobMovePlayerId);
                      const selectedPlayer = players.find(
                        (player) => player.id === selectedPlayerId
                      );
                      const slot = players.find(
                        (player) =>
                          player.team?.localeCompare(team.name, undefined, {
                            sensitivity: "base",
                          }) === 0
                      );
                      const claimedByOther =
                        slot &&
                        slot.id !== selectedPlayerId &&
                        participantByName.has(slot.name.toLowerCase());
                      const isCurrent =
                        selectedPlayer?.team?.localeCompare(
                          team.name,
                          undefined,
                          { sensitivity: "base" }
                        ) === 0;

                      return (
                        <option
                          key={team.name}
                          value={team.name}
                          disabled={Boolean(claimedByOther || isCurrent)}
                        >
                          {team.name}
                          {isCurrent
                            ? " — current"
                            : claimedByOther
                              ? ` — claimed by ${slot?.name}`
                              : slot
                                ? " — unclaimed"
                                : ""}
                        </option>
                      );
                    })}
                </select>
              </label>

              <button
                type="button"
                onClick={moveClaimedPlayerToTeam}
                disabled={
                  isMovingJob ||
                  isSaving ||
                  !jobMovePlayerId ||
                  !jobMoveTeam
                }
                className="rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-black text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isMovingJob ? "Moving..." : "Move Team"}
              </button>
            </div>

            {jobMoveStatus && (
              <p
                className={`mt-3 text-sm font-semibold ${
                  jobMoveStatus.startsWith("✅")
                    ? "text-green-300"
                    : "text-amber-200"
                }`}
              >
                {jobMoveStatus}
              </p>
            )}

            <p className="mt-3 text-xs text-slate-500">
              If the destination already exists as an unclaimed season slot, RTA reuses that team and preserves its team ratings. A team already claimed by another user cannot be selected until that claim is moved or released.
            </p>
          </section>
        )}

        {showCommissionerControls && (
          <section className="rounded-3xl border-2 border-cyan-400/30 bg-cyan-500/[0.05] p-6">
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
              🏷️ Discord Team Roles
              <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-cyan-200">
                Only you can see this
              </span>
            </div>
            <h2 className="text-xl font-black">Team → Discord Role Mapping</h2>
            <p className="mt-2 text-sm text-slate-400">
              Assign each dynasty team to its real Discord role. RTA uses these role IDs for game-thread tags and player-only Genesis controls even when the Discord role name differs from the team name.
            </p>

            <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-slate-950/50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-xs font-black text-cyan-200">
                    {mappedTeamRoleCount}/{leagueTeamNames.length} mapped
                  </span>
                  <button
                    type="button"
                    onClick={loadDiscordTeamRoles}
                    disabled={isLoadingDiscordTeamRoles}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isLoadingDiscordTeamRoles ? "Loading Roles..." : "Refresh Discord Roles"}
                  </button>
                  <button
                    type="button"
                    onClick={autoMapExactDiscordRoles}
                    disabled={isLoadingDiscordTeamRoles || discordTeamRoles.length === 0 || isSaving}
                    className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-200 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Auto-map Exact Matches
                  </button>
                  {discordTeamRolesStatus && (
                    <span className="text-xs font-semibold text-slate-400">
                      {discordTeamRolesStatus}
                    </span>
                  )}
                </div>
  
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {leagueTeamNames.map((team) => {
                    const selectedRoleId =
                      seasonData.discordTeamRoleIds?.[team] || "";
                    const selectedRole = discordTeamRoles.find(
                      (role) => role.id === selectedRoleId
                    );
  
                    return (
                      <label
                        key={team}
                        className="rounded-xl border border-white/10 bg-slate-900/70 p-3"
                      >
                        <span className="block text-xs font-black text-white">
                          {team}
                        </span>
                        <select
                          value={selectedRoleId}
                          onChange={(event) =>
                            saveDiscordTeamRole(team, event.target.value)
                          }
                          disabled={
                            isLoadingDiscordTeamRoles ||
                            savingDiscordTeamRoleTeam === team
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300 disabled:opacity-50"
                        >
                          <option value="">Not mapped — exact-name fallback</option>
                          {[...discordTeamRoles]
                            .sort((a, b) =>
                              a.name.localeCompare(b.name, undefined, {
                                sensitivity: "base",
                              })
                            )
                            .map((role) => (
                              <option key={role.id} value={role.id}>
                                @{role.name}
                              </option>
                            ))}
                        </select>
                        <span className="mt-1 block text-[11px] text-slate-500">
                          {savingDiscordTeamRoleTeam === team
                            ? "Saving..."
                            : selectedRole
                              ? `Using @${selectedRole.name}`
                              : selectedRoleId
                                ? "Saved role is no longer in the current Discord role list."
                                : "Choose the role held by the user who controls this team."}
                        </span>
                      </label>
                    );
                  })}
                </div>
  
            </div>
          </section>
        )}

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-black">Team Pool by Conference</h2>
              <p className="mt-2 text-sm text-slate-400">
                {teamPoolView === "claimed"
                  ? "Who's got which team, by conference."
                  : isOwner
                    ? "Add a team to the season, or remove one nobody's claimed yet."
                    : "Every CFB team, grouped by conference, whether or not it's in this season."}
              </p>
            </div>
            <div className="inline-flex rounded-xl border border-white/10 bg-slate-900 p-1">
              <button
                onClick={() => setTeamPoolView("claimed")}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  teamPoolView === "claimed"
                    ? "bg-cyan-400 text-slate-950"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                By Conference
              </button>
              <button
                onClick={() => setTeamPoolView("manage")}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  teamPoolView === "manage"
                    ? "bg-cyan-400 text-slate-950"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Unclaimed / Add / Remove
              </button>
            </div>
          </div>

          {teamPoolView === "claimed" ? (
            <div className="mt-4">
              <CompactDraftBoard
                tiers={seasonBoardTiers}
                getStatus={(item) => {
                  const player = players.find((p) => p.id === item.id);
                  return { variant: "taken", badge: player?.name };
                }}
                strikethroughOnTaken={false}
                takenStyle="plain"
                emptyMessage="No teams claimed yet."
              />
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs font-black uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-4">Conference</th>
                    <th className="py-2 pr-4">Team</th>
                    <th className="py-2 pr-4">Status</th>
                    {isOwner && <th className="py-2 pr-4">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {fullUniverseByConference.flatMap((group) =>
                    group.teams.map(({ team, player }) => {
                      const participant = player
                        ? participantByName.get(player.name.toLowerCase())
                        : undefined;
                      const isClaimed = Boolean(participant);
                      const inSeason = Boolean(player);

                      return (
                        <tr key={team.name} className="border-b border-white/5">
                          <td className="py-2 pr-4 text-slate-400">{group.conference}</td>
                          <td className="py-2 pr-4 font-bold">
                            <span
                              className="mr-2 inline-block h-2.5 w-2.5 rounded-full ring-1 ring-white/20 align-middle"
                              style={{ backgroundColor: team.color }}
                            />
                            {team.name}
                          </td>
                          <td
                            className={`py-2 pr-4 ${
                              !inSeason
                                ? "text-slate-500"
                                : isClaimed
                                  ? "text-slate-300"
                                  : "text-cyan-300"
                            }`}
                          >
                            {!inSeason
                              ? "Not in season"
                              : isClaimed
                                ? `Claimed by ${player!.name}`
                                : "Unclaimed"}
                          </td>
                          {isOwner && (
                            <td className="py-2 pr-4">
                              <div className="flex flex-wrap gap-2">
                                {!inSeason && (
                                  <button
                                    onClick={() => addTeamToSeason(team.name)}
                                    disabled={isSaving}
                                    className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold text-cyan-200 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    + Add
                                  </button>
                                )}
                                {isClaimed && participant && (
                                  <button
                                    onClick={() => removeClaim(participant)}
                                    disabled={isSaving}
                                    title="Release this claim so someone can select this team again, without removing the player"
                                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-slate-300 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    Release Claim
                                  </button>
                                )}
                                {inSeason && (
                                  <button
                                    onClick={() => removePlayer(player!)}
                                    disabled={isSaving}
                                    title="Remove this player/team from the season"
                                    className="rounded-lg border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[10px] font-bold text-red-300 transition hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>

      {ratingEditorPlayer && showCommissionerControls && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-3xl border-2 border-cyan-400/30 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
                  Team Ratings
                </p>
                <h3 className="mt-1 text-2xl font-black">
                  {ratingEditorPlayer.team || ratingEditorPlayer.name}
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  Enter the current EA team ratings. Leave a field blank to clear it.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRatingEditorPlayerId(null)}
                className="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/15"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                OVR
                <input
                  autoFocus
                  type="number"
                  min={0}
                  max={99}
                  inputMode="numeric"
                  value={ratingOverallInput}
                  onChange={(event) => setRatingOverallInput(event.target.value)}
                  className="rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-center text-xl font-black text-white outline-none focus:border-cyan-300"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                OFF
                <input
                  type="number"
                  min={0}
                  max={99}
                  inputMode="numeric"
                  value={ratingOffenseInput}
                  onChange={(event) => setRatingOffenseInput(event.target.value)}
                  className="rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-center text-xl font-black text-white outline-none focus:border-cyan-300"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                DEF
                <input
                  type="number"
                  min={0}
                  max={99}
                  inputMode="numeric"
                  value={ratingDefenseInput}
                  onChange={(event) => setRatingDefenseInput(event.target.value)}
                  className="rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-center text-xl font-black text-white outline-none focus:border-cyan-300"
                />
              </label>
            </div>

            {ratingEditorError && (
              <p className="mt-3 text-sm font-semibold text-red-300">{ratingEditorError}</p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRatingEditorPlayerId(null)}
                disabled={isSaving}
                className="rounded-2xl bg-white/10 px-5 py-3 font-bold text-white transition hover:bg-white/15 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveTeamRatings}
                disabled={isSaving}
                className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-40"
              >
                {isSaving ? "Saving..." : "Save Ratings"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPendingExtensionAlert && pendingRequests.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-3xl border-2 border-red-400/40 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-black text-red-300">
              🚨 {pendingRequests.length} Extension Request
              {pendingRequests.length === 1 ? "" : "s"} Waiting
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              You can&apos;t advance the week until every request below is
              granted or denied.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              {pendingRequests.map((request) => {
                const player = players.find((p) => p.id === request.playerId);
                return (
                  <div
                    key={request.id}
                    className="rounded-2xl border border-red-400/20 bg-slate-950 p-4"
                  >
                    <p className="font-black">
                      {player?.team || player?.name || "Unknown player"}{" "}
                      <span className="font-normal text-slate-400">
                        — {formatWeekLabel(request.week)}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      Requested until{" "}
                      {new Date(`${request.requestedUntilDate}T00:00:00`).toLocaleDateString()}
                      {request.reason ? ` — "${request.reason}"` : ""}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button
                        onClick={() => {
                          setShowPendingExtensionAlert(false);
                          beginGrantExtension(request);
                        }}
                        disabled={isSaving}
                        className="rounded-2xl bg-green-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-green-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Grant
                      </button>
                      <button
                        onClick={() => denyExtension(request.id)}
                        disabled={isSaving}
                        className="rounded-2xl bg-red-400/80 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Deny
                      </button>
                      <button
                        onClick={() => removeExtensionRequest(request.id)}
                        disabled={isSaving}
                        title="Deletes the request with no grant/deny action taken"
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-300 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowPendingExtensionAlert(false)}
                className="rounded-2xl bg-white/10 px-5 py-3 font-bold text-white transition hover:bg-white/15"
              >
                Review Later
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdvanceTimeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-black">Estimated Advance Time</h3>
            <p className="mt-2 text-sm text-slate-400">
              Optional — set the anticipated advance window for{" "}
              {formatWeekLabel(currentWeek + 1)} so it&apos;s included in the
              Discord post announcing the new week.
            </p>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                Date
                <input
                  type="date"
                  value={advanceModalDate}
                  onChange={(event) => setAdvanceModalDate(event.target.value)}
                  className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white outline-none focus:border-cyan-300"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                From
                <select
                  value={advanceModalStartHour}
                  onChange={(event) => setAdvanceModalStartHour(Number(event.target.value))}
                  className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white outline-none focus:border-cyan-300"
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
                  value={advanceModalEndHour}
                  onChange={(event) => setAdvanceModalEndHour(Number(event.target.value))}
                  className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white outline-none focus:border-cyan-300"
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {formatHourLabel(hour)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-slate-400">
              Or a custom message (overrides the date/time above)
              <input
                type="text"
                value={advanceModalCustomText}
                onChange={(event) => setAdvanceModalCustomText(event.target.value)}
                placeholder='e.g. "After the Colorado game completes"'
                className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white outline-none focus:border-cyan-300"
              />
            </label>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                onClick={() => setShowAdvanceTimeModal(false)}
                disabled={isSaving}
                className="rounded-2xl bg-white/10 px-5 py-3 font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmAdvanceWeek(null)}
                disabled={isSaving}
                title="Advance without setting an estimated time"
                className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 font-bold text-slate-300 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Skip
              </button>
              <button
                onClick={() =>
                  confirmAdvanceWeek({
                    date: advanceModalDate,
                    startHour: advanceModalStartHour,
                    endHour: advanceModalEndHour,
                    customText: advanceModalCustomText.trim() || null,
                  })
                }
                disabled={isSaving || (!advanceModalDate && !advanceModalCustomText.trim())}
                className="rounded-2xl bg-green-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-green-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Set &amp; Advance
              </button>
            </div>
          </div>
        </div>
      )}

      {grantModalRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-black">Grant Extension</h3>
            <p className="mt-2 text-sm text-slate-400">
              {players.find((p) => p.id === grantModalRequest.playerId)?.name || "This player"}{" "}
              asked for until{" "}
              {new Date(`${grantModalRequest.requestedUntilDate}T00:00:00`).toLocaleDateString()}.
              Pick when advance should actually happen -- this becomes the
              season&apos;s Anticipated Advance Time.
            </p>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                Date
                <input
                  type="date"
                  value={grantModalDate}
                  onChange={(event) => setGrantModalDate(event.target.value)}
                  className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white outline-none focus:border-cyan-300"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-400">
                From
                <select
                  value={grantModalStartHour}
                  onChange={(event) => setGrantModalStartHour(Number(event.target.value))}
                  className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white outline-none focus:border-cyan-300"
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
                  value={grantModalEndHour}
                  onChange={(event) => setGrantModalEndHour(Number(event.target.value))}
                  className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white outline-none focus:border-cyan-300"
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {formatHourLabel(hour)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-slate-400">
              Or a custom message (overrides the date/time above)
              <input
                type="text"
                value={grantModalCustomText}
                onChange={(event) => setGrantModalCustomText(event.target.value)}
                placeholder='e.g. "After the Colorado game completes"'
                className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white outline-none focus:border-cyan-300"
              />
            </label>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                onClick={() => setGrantModalRequest(null)}
                disabled={isSaving}
                className="rounded-2xl bg-white/10 px-5 py-3 font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  grantExtension(grantModalRequest.id, {
                    date: grantModalDate,
                    startHour: grantModalStartHour,
                    endHour: grantModalEndHour,
                    customText: grantModalCustomText.trim() || null,
                  })
                }
                disabled={isSaving || (!grantModalDate && !grantModalCustomText.trim())}
                className="rounded-2xl bg-green-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-green-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Grant &amp; Update Advance Time
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
