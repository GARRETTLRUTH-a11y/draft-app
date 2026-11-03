import type {
  GenesisHistoricalGame,
  GenesisPick,
  GenesisPickMatchup,
  GenesisPickSide,
  GenesisPicksState,
  GenesisVoidReason,
  SeasonData,
} from "@/lib/season";
import {
  genesisGameFingerprint,
  type GenesisLineResult,
} from "@/lib/genesisLines";
import { PVP_PARENT_CHANNEL_ID } from "@/lib/discordPvpThreads";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const LEADERBOARD_CHANNEL_NAME = "genesis-picks";
export const GENESIS_STARTING_BANKROLL = 500;

async function discordApi(path: string, init: RequestInit = {}) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN is not configured.");

  return fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sameTeamPair(
  game: GenesisHistoricalGame,
  awayTeam: string,
  homeTeam: string
) {
  const gameTeams = new Set([normalize(game.teamA), normalize(game.teamB)]);
  return (
    gameTeams.has(normalize(awayTeam)) &&
    gameTeams.has(normalize(homeTeam)) &&
    gameTeams.size === 2
  );
}

function playerNameForTeam(seasonData: SeasonData, team: string) {
  const target = normalize(team);
  return seasonData.players.find(
    (player) => player.team && normalize(player.team) === target
  )?.name;
}

function historyGameMatchesPreviousFinal(
  game: GenesisHistoricalGame,
  matchup: GenesisPickMatchup
) {
  if (!sameTeamPair(game, matchup.awayTeam, matchup.homeTeam)) return false;
  if (
    typeof game.seasonYear === "number" &&
    game.seasonYear !== matchup.seasonYear
  ) {
    return false;
  }
  if (
    typeof matchup.finalAwayScore !== "number" ||
    typeof matchup.finalHomeScore !== "number"
  ) {
    return false;
  }

  const awayScore =
    normalize(game.teamA) === normalize(matchup.awayTeam)
      ? game.scoreA
      : game.scoreB;
  const homeScore =
    normalize(game.teamA) === normalize(matchup.homeTeam)
      ? game.scoreA
      : game.scoreB;
  if (
    awayScore !== matchup.finalAwayScore ||
    homeScore !== matchup.finalHomeScore
  ) {
    return false;
  }

  if (!game.sourceTimestamp) return true;
  const sourceMs = new Date(game.sourceTimestamp).getTime();
  const createdMs = new Date(matchup.createdAt).getTime();
  return (
    !Number.isFinite(sourceMs) ||
    !Number.isFinite(createdMs) ||
    sourceMs >= createdMs - 5 * 60 * 1000
  );
}

function recordGenesisFinalInHistory(
  seasonData: SeasonData,
  matchup: GenesisPickMatchup,
  awayScore: number,
  homeScore: number,
  sourceTimestamp: string
) {
  const game: GenesisHistoricalGame = {
    id: genesisGameFingerprint({
      seasonYear: matchup.seasonYear,
      stage: matchup.stage,
      teamA: matchup.awayTeam,
      scoreA: awayScore,
      teamB: matchup.homeTeam,
      scoreB: homeScore,
    }),
    sourceChannelId: matchup.threadId,
    sourceMessageId: `entered-final:${matchup.id}`,
    sourceTimestamp,
    seasonYear: matchup.seasonYear,
    stage: matchup.stage?.trim() || undefined,
    teamA: matchup.awayTeam,
    scoreA: awayScore,
    teamB: matchup.homeTeam,
    scoreB: homeScore,
    gameType: "pvp",
    playerA: playerNameForTeam(seasonData, matchup.awayTeam),
    playerB: playerNameForTeam(seasonData, matchup.homeTeam),
  };

  const existingHistory = seasonData.genesisHistory;
  const games = (existingHistory?.games || []).filter(
    (existing) =>
      existing.id !== game.id &&
      existing.id !== matchup.sourceGameId &&
      !historyGameMatchesPreviousFinal(existing, matchup)
  );
  games.push(game);
  games.sort((a, b) => {
    const yearDiff = (a.seasonYear || 0) - (b.seasonYear || 0);
    if (yearDiff !== 0) return yearDiff;
    return (a.sourceTimestamp || "").localeCompare(b.sourceTimestamp || "");
  });

  return {
    game,
    seasonData: {
      ...seasonData,
      genesisHistory: {
        games,
        postseasonAchievements: existingHistory?.postseasonAchievements || [],
        sourceCursors: existingHistory?.sourceCursors,
        lastSyncedAt: existingHistory?.lastSyncedAt || sourceTimestamp,
        messagesScanned: existingHistory?.messagesScanned || 0,
        sourceCounts: existingHistory?.sourceCounts || {},
        lastSyncMode: existingHistory?.lastSyncMode,
      },
    },
  };
}

function lineLabel(team: string, signedLine: number) {
  const suffix =
    signedLine === 0
      ? "PK"
      : `${signedLine > 0 ? "+" : ""}${signedLine.toFixed(1)}`;

  const maxTeamLength = Math.max(8, 76 - suffix.length);
  const cleanTeam =
    team.length > maxTeamLength
      ? `${team.slice(0, maxTeamLength - 1)}…`
      : team;

  return `${cleanTeam} ${suffix}`;
}

export function signedAwayLine(line: GenesisLineResult) {
  if (!line.favorite || line.spread === 0) return 0;
  return normalize(line.favorite) === normalize(line.awayTeam)
    ? -line.spread
    : line.spread;
}

export function buildGenesisPickComponents(
  seasonId: string,
  matchupId: string,
  line: GenesisLineResult
) {
  const awayLine = signedAwayLine(line);
  const homeLine = -awayLine;

  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: lineLabel(line.awayTeam, awayLine),
          custom_id: `genesis_pick:${seasonId}:${matchupId}:away`,
        },
        {
          type: 2,
          style: 1,
          label: lineLabel(line.homeTeam, homeLine),
          custom_id: `genesis_pick:${seasonId}:${matchupId}:home`,
        },
        {
          type: 2,
          style: 2,
          label: "📺 Post Stream / Start Game",
          custom_id: `genesis_stream:${seasonId}:${matchupId}`,
        },
      ],
    },
  ];
}

function genesisPickSummaryContent(matchup: GenesisPickMatchup) {
  const picks = Object.values(matchup.picks || {}).sort((a, b) =>
    a.pickedAt.localeCompare(b.pickedAt)
  );

  const statusLine =
    matchup.status === "open"
      ? `🟢 **Picks open** · ${picks.length} submitted`
      : matchup.status === "locked"
        ? `🔒 **Picks closed** · ${picks.length} locked in`
        : matchup.status === "voided"
          ? "🚫 **VOID — picks canceled**"
          : `🏁 **Final** · ${picks.length} picks`;

  const stageLine = matchup.stage?.trim()
    ? `Stage: **${matchup.stage.trim()}, ${matchup.seasonYear}**`
    : `Season: **${matchup.seasonYear}**`;

  const lines = [
    "🎯 **GENESIS PUBLIC PICKS & WAGERS**",
    `**${matchup.awayTeam} ${matchup.neutral ? "vs." : "@"} ${matchup.homeTeam}**`,
    stageLine,
    statusLine,
    "",
  ];

  if (!picks.length) {
    lines.push("No picks yet.");
  } else {
    for (const pick of picks) {
      const team =
        pick.side === "away" ? matchup.awayTeam : matchup.homeTeam;
      const signedLine =
        pick.side === "away" ? matchup.awayLine : -matchup.awayLine;
      const lineText =
        signedLine === 0
          ? "PK"
          : `${signedLine > 0 ? "+" : ""}${signedLine.toFixed(1)}`;
      const username = (pick.discordUsername || "Discord user")
        .replace(/[\`*_~|>]/g, "")
        .slice(0, 40);

      const wagerText =
        typeof pick.wager === "number" && pick.wager > 0
          ? ` · **$${pick.wager}** wager`
          : "";
      lines.push(`• ${username} — **${team} ${lineText}**${wagerText}`);
    }
  }

  lines.push(
    "",
    "_All submitted sides and wager amounts are public to the league. This message updates in place to reduce notifications._"
  );
  return lines.join("\n").slice(0, 2000);
}

export async function syncGenesisPickSummary(
  matchup: GenesisPickMatchup,
  options: { createIfMissing?: boolean } = {}
): Promise<{ matchup: GenesisPickMatchup; warning?: string }> {
  const content = genesisPickSummaryContent(matchup);
  let messageId = matchup.pickSummaryMessageId;

  if (messageId) {
    const editResponse = await discordApi(
      `/channels/${matchup.threadId}/messages/${messageId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          content,
          allowed_mentions: { parse: [] as string[] },
        }),
      }
    );

    if (editResponse.ok) {
      return { matchup };
    }

    if (editResponse.status !== 404) {
      const body = await editResponse.text();
      return {
        matchup,
        warning:
          `Could not update the Genesis picks summary: ${body || editResponse.statusText}`,
      };
    }

    messageId = undefined;
  }

  if (options.createIfMissing === false) {
    return { matchup };
  }

  const postResponse = await discordApi(
    `/channels/${matchup.threadId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [] as string[] },
      }),
    }
  );

  if (!postResponse.ok) {
    const body = await postResponse.text();
    return {
      matchup,
      warning:
        `Could not create the Genesis picks summary: ${body || postResponse.statusText}`,
    };
  }

  const message = (await postResponse.json()) as { id: string };

  return {
    matchup: {
      ...matchup,
      pickSummaryMessageId: message.id,
    },
  };
}

export function buildGenesisMatchupComponents(
  seasonId: string,
  matchup: GenesisPickMatchup
) {
  const awayLabel = lineLabel(matchup.awayTeam, matchup.awayLine);
  const homeLabel = lineLabel(matchup.homeTeam, -matchup.awayLine);
  const isOpen = matchup.status === "open";

  const statusLabel =
    matchup.status === "open"
      ? "📺 Post Stream / Start Game"
      : matchup.status === "locked"
        ? "🔒 PICKS CLOSED"
        : matchup.status === "settled"
          ? "✏️ Edit Final Score"
          : "🚫 VOID";

  const statusCustomId =
    matchup.status === "settled"
      ? `genesis_final_score:${seasonId}:${matchup.id}`
      : `genesis_stream:${seasonId}:${matchup.id}`;
  const statusDisabled =
    matchup.status === "locked" || matchup.status === "voided";

  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: awayLabel,
          custom_id: `genesis_pick:${seasonId}:${matchup.id}:away`,
          disabled: !isOpen,
        },
        {
          type: 2,
          style: 1,
          label: homeLabel,
          custom_id: `genesis_pick:${seasonId}:${matchup.id}:home`,
          disabled: !isOpen,
        },
        {
          type: 2,
          style: 2,
          label: statusLabel,
          custom_id: statusCustomId,
          disabled: statusDisabled,
        },
      ],
    },
  ];
}

export async function syncGenesisStarterButtons(
  seasonId: string,
  matchup: GenesisPickMatchup
) {
  if (!matchup.starterMessageId) return { ok: false, skipped: true };

  const response = await discordApi(
    `/channels/${matchup.threadId}/messages/${matchup.starterMessageId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        components: buildGenesisMatchupComponents(seasonId, matchup),
        allowed_mentions: { parse: [] as string[] },
      }),
    }
  );

  return { ok: response.ok, skipped: false };
}

function genesisKickoffZoneDisplay(matchup: GenesisPickMatchup) {
  if (!matchup.scheduledKickoffAt || !matchup.scheduledKickoffTimeZone) {
    return null;
  }

  const date = new Date(matchup.scheduledKickoffAt);
  if (!Number.isFinite(date.getTime())) return null;

  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: matchup.scheduledKickoffTimeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return matchup.scheduledKickoffTimeZone;
  }
}

export async function syncGenesisKickoffScheduleMessage(
  matchup: GenesisPickMatchup
): Promise<{ matchup: GenesisPickMatchup; warning?: string }> {
  const existingId = matchup.kickoffScheduleMessageId;

  if (!matchup.scheduledKickoffAt) {
    if (!existingId) return { matchup };

    const deleteResponse = await discordApi(
      `/channels/${matchup.threadId}/messages/${existingId}`,
      { method: "DELETE" }
    );

    if (!deleteResponse.ok && deleteResponse.status !== 404) {
      const body = await deleteResponse.text();
      return {
        matchup,
        warning:
          `Kickoff was cleared, but the Discord schedule message could not be removed: ${body || deleteResponse.statusText}`,
      };
    }

    return {
      matchup: {
        ...matchup,
        kickoffScheduleMessageId: undefined,
      },
    };
  }

  const kickoffMs = new Date(matchup.scheduledKickoffAt).getTime();
  if (!Number.isFinite(kickoffMs)) {
    return { matchup, warning: "Kickoff time is invalid." };
  }

  const unix = Math.floor(kickoffMs / 1000);
  const zoneDisplay = genesisKickoffZoneDisplay(matchup);
  const content = [
    "⏰ **GENESIS KICKOFF SCHEDULED**",
    `Kickoff: <t:${unix}:F> (<t:${unix}:R>)`,
    ...(zoneDisplay ? [`Scheduled as: **${zoneDisplay}**`] : []),
    matchup.autoLockAtKickoff === false
      ? "Genesis picks will stay open until /stream or a commissioner lock closes them."
      : "Genesis picks will automatically lock at kickoff if they are still open.",
    "RTA will post a reminder about 30 minutes before kickoff.",
  ].join("\n");

  if (existingId) {
    const editResponse = await discordApi(
      `/channels/${matchup.threadId}/messages/${existingId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          content,
          allowed_mentions: { parse: [] as string[] },
        }),
      }
    );

    if (editResponse.ok) return { matchup };

    if (editResponse.status !== 404) {
      const body = await editResponse.text();
      return {
        matchup,
        warning:
          `Kickoff was saved, but the Discord schedule message could not be updated: ${body || editResponse.statusText}`,
      };
    }
  }

  const postResponse = await discordApi(
    `/channels/${matchup.threadId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [] as string[] },
      }),
    }
  );

  if (!postResponse.ok) {
    const body = await postResponse.text();
    return {
      matchup,
      warning:
        `Kickoff was saved, but the Discord schedule message could not be posted: ${body || postResponse.statusText}`,
    };
  }

  const message = (await postResponse.json()) as { id?: string };
  return {
    matchup: {
      ...matchup,
      kickoffScheduleMessageId: message.id,
    },
  };
}

export async function postGenesisKickoffReminder(
  matchup: GenesisPickMatchup
) {
  if (!matchup.scheduledKickoffAt) return false;
  const kickoffMs = new Date(matchup.scheduledKickoffAt).getTime();
  if (!Number.isFinite(kickoffMs)) return false;
  const unix = Math.floor(kickoffMs / 1000);

  const response = await discordApi(
    `/channels/${matchup.threadId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content: [
          "⏰ **GENESIS KICKOFF REMINDER**",
          `Kickoff: <t:${unix}:F> (<t:${unix}:R>)`,
          ...(genesisKickoffZoneDisplay(matchup)
            ? [`Scheduled as: **${genesisKickoffZoneDisplay(matchup)}**`]
            : []),
          matchup.autoLockAtKickoff === false
            ? "Genesis picks remain open until /stream or a commissioner lock closes them."
            : "Genesis picks will automatically lock at the scheduled kickoff time if they are still open.",
        ].join("\n"),
        allowed_mentions: { parse: [] as string[] },
      }),
    }
  );

  return response.ok;
}

export async function postGenesisScheduledLockNotice(
  matchup: GenesisPickMatchup
) {
  const response = await discordApi(
    `/channels/${matchup.threadId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content: [
          "⏰ **SCHEDULED KICKOFF — GENESIS PICKS CLOSED**",
          `**${Object.keys(matchup.picks || {}).length}** pick${Object.keys(matchup.picks || {}).length === 1 ? "" : "s"} locked in.`,
          "No additional picks will be accepted for this matchup.",
        ].join("\n"),
        allowed_mentions: { parse: [] as string[] },
      }),
    }
  );

  return response.ok;
}

export function createGenesisPickMatchup(input: {
  id: string;
  threadId: string;
  threadName: string;
  createdAt: string;
  seasonYear: number;
  seasonWeek?: number;
  stage?: string;
  line: GenesisLineResult;
  starterMessageId?: string;
  scheduledKickoffAt?: string;
  autoLockAtKickoff?: boolean;
}): GenesisPickMatchup {
  return {
    id: input.id,
    threadId: input.threadId,
    threadName: input.threadName,
    createdAt: input.createdAt,
    seasonYear: input.seasonYear,
    seasonWeek: input.seasonWeek,
    stage: input.stage,
    awayTeam: input.line.awayTeam,
    homeTeam: input.line.homeTeam,
    neutral: input.line.neutral,
    displayLine: input.line.displayLine,
    favorite: input.line.favorite,
    spread: input.line.spread,
    awayLine: signedAwayLine(input.line),
    starterMessageId: input.starterMessageId,
    scheduledKickoffAt: input.scheduledKickoffAt,
    autoLockAtKickoff: input.autoLockAtKickoff,
    status: "open",
    picks: {},
  };
}
export function settleGenesisMatchupByScore(
  seasonData: SeasonData,
  matchupId: string,
  awayScore: number,
  homeScore: number,
  settledAt = new Date().toISOString()
):
  | { error: string }
  | {
      seasonData: SeasonData;
      matchup: GenesisPickMatchup;
      atsWinner: GenesisPickSide | "push";
    } {
  const state = seasonData.genesisPicks;
  const matchup = state?.matchups.find((item) => item.id === matchupId);

  if (!state || !matchup) {
    return { error: "Genesis matchup not found." } as const;
  }

  if (matchup.status === "voided") {
    return { error: "That Genesis matchup was voided and cannot be graded." } as const;
  }

  const atsValue = awayScore - homeScore + matchup.awayLine;
  const atsWinner: GenesisPickSide | "push" =
    Math.abs(atsValue) < 0.001
      ? "push"
      : atsValue > 0
        ? "away"
        : "home";

  const historyTimestamp = matchup.settledAt || settledAt;
  const withHistory = recordGenesisFinalInHistory(
    seasonData,
    matchup,
    awayScore,
    homeScore,
    historyTimestamp
  );

  const matchups: GenesisPickMatchup[] = state.matchups.map((item) =>
    item.id === matchupId
      ? {
          ...item,
          status: "settled" as const,
          finalAwayScore: awayScore,
          finalHomeScore: homeScore,
          atsWinner,
          settledAt: item.settledAt || settledAt,
          sourceGameId: withHistory.game.id,
        }
      : item
  );

  const updatedMatchup = matchups.find((item) => item.id === matchupId)!;

  return {
    seasonData: {
      ...withHistory.seasonData,
      genesisPicks: {
        ...state,
        matchups,
      },
    },
    matchup: updatedMatchup,
    atsWinner,
  } as const;
}

export function voidGenesisMatchup(
  seasonData: SeasonData,
  matchupId: string,
  reason: GenesisVoidReason,
  voidedAt = new Date().toISOString()
):
  | { error: string }
  | { seasonData: SeasonData; matchup: GenesisPickMatchup } {
  const state = seasonData.genesisPicks;
  const matchup = state?.matchups.find((item) => item.id === matchupId);

  if (!state || !matchup) {
    return { error: "Genesis matchup not found." };
  }
  if (matchup.status === "settled") {
    return { error: "That Genesis matchup is already finalized." };
  }
  if (matchup.status === "voided") {
    return { error: "That Genesis matchup is already voided." };
  }

  const matchups: GenesisPickMatchup[] = state.matchups.map((item) =>
    item.id === matchupId
      ? {
          ...item,
          status: "voided",
          voidReason: reason,
          voidedAt,
        }
      : item
  );

  return {
    seasonData: {
      ...seasonData,
      genesisPicks: {
        ...state,
        matchups,
      },
    },
    matchup,
  };
}

export async function postGenesisVoidToThread(input: {
  matchup: GenesisPickMatchup;
  reason: GenesisVoidReason;
}) {
  const reasonLabel =
    input.reason === "auto_sim" ? "Auto Sim" : "Force Win";

  const response = await discordApi(
    `/channels/${input.matchup.threadId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content: [
          "🚫 **GENESIS LINE VOIDED**",
          `Reason: **${reasonLabel}**`,
          "All picks for this matchup are canceled.",
          "This game will not count toward Genesis pick accuracy or future Genesis line performance history.",
        ].join("\n"),
        allowed_mentions: { parse: [] as string[] },
      }),
    }
  );

  return response.ok;
}

export async function postGenesisFinalScorePrompt(
  seasonId: string,
  matchup: GenesisPickMatchup
) {
  const response = await discordApi(
    `/channels/${matchup.threadId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content: [
          "🏁 **Game finished? Submit the final score**",
          `**${matchup.awayTeam} ${matchup.neutral ? "vs." : "@"} ${matchup.homeTeam}**`,
          matchup.stage?.trim()
            ? `Stage: **${matchup.stage.trim()}, ${matchup.seasonYear}**`
            : `Season: **${matchup.seasonYear}**`,
          "If the game is over, submit the score so Genesis can grade the locked picks.",
        ].join("\n"),
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 3,
                label: "🏁 Submit Final Score",
                custom_id: `genesis_final_score:${seasonId}:${matchup.id}`,
              },
            ],
          },
        ],
        allowed_mentions: { parse: [] as string[] },
      }),
    }
  );

  return response.ok;
}

export async function postGenesisFinalToThread(input: {
  matchup: GenesisPickMatchup;
  seasonData: SeasonData;
  awayScore: number;
  homeScore: number;
  atsWinner: GenesisPickSide | "push";
  corrected?: boolean;
}) {
  const winnerText =
    input.atsWinner === "push"
      ? "Push"
      : input.atsWinner === "away"
        ? input.matchup.awayTeam
        : input.matchup.homeTeam;

  const bankrolls = new Map(
    genesisBankrollRows(input.seasonData).map((row) => [
      row.discordUserId,
      row,
    ])
  );
  const wagerResults = Object.values(input.matchup.picks || {})
    .filter(
      (pick) =>
        typeof pick.wager === "number" &&
        Number.isFinite(pick.wager) &&
        pick.wager > 0
    )
    .map((pick) => {
      const wager = Math.floor(pick.wager!);
      const result =
        input.atsWinner === "push"
          ? "push"
          : pick.side === input.atsWinner
            ? "win"
            : "loss";
      const balance = bankrolls.get(pick.discordUserId)?.bankroll;
      const team =
        pick.side === "away"
          ? input.matchup.awayTeam
          : input.matchup.homeTeam;
      const signedLine =
        pick.side === "away"
          ? input.matchup.awayLine
          : -input.matchup.awayLine;
      const spread =
        signedLine === 0
          ? "PK"
          : `${signedLine > 0 ? "+" : ""}${signedLine.toFixed(1)}`;
      const change =
        result === "win" ? `+$${wager}` : result === "loss" ? `-$${wager}` : "$0";

      return {
        pick,
        result,
        line: `<@${pick.discordUserId}> — **${team} ${spread}** · **${change}** · New balance: **$${balance ?? GENESIS_STARTING_BANKROLL}**`,
      };
    });

  const resultEmbeds = [
    {
      result: "win",
      title: "🟢 Winning Wagers",
      color: 0x22c55e,
    },
    {
      result: "loss",
      title: "🔴 Losing Wagers",
      color: 0xef4444,
    },
    {
      result: "push",
      title: "🟡 Pushes — Wager Returned",
      color: 0xfacc15,
    },
  ]
    .map((section) => {
      const lines = wagerResults
        .filter((entry) => entry.result === section.result)
        .map((entry) => entry.line);
      return lines.length
        ? {
            title: section.title,
            color: section.color,
            description: lines.join("\n").slice(0, 4096),
          }
        : null;
    })
    .filter(
      (
        embed
      ): embed is { title: string; color: number; description: string } =>
        embed !== null
    );

  const response = await discordApi(
    `/channels/${input.matchup.threadId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content: [
          input.corrected ? "✏️ **GENESIS FINAL CORRECTED**" : "🏁 **GENESIS FINAL**",
          `**${input.matchup.awayTeam} ${input.awayScore} – ${input.matchup.homeTeam} ${input.homeScore}**`,
          input.matchup.stage?.trim()
            ? `Stage: **${input.matchup.stage.trim()}, ${input.matchup.seasonYear}**`
            : `Season: **${input.matchup.seasonYear}**`,
          `Locked line: **${input.matchup.displayLine}**`,
          `ATS result: **${winnerText}**`,
          input.corrected
            ? "The corrected score has been re-graded and the Genesis Picks leaderboard recalculated."
            : "🔒 Picks are closed. The Genesis Picks leaderboard has been updated.",
          "This final is now included in Genesis performance history for future lines.",
          wagerResults.length
            ? "Wager results and updated balances are shown below."
            : "No fake-money wagers were placed on this matchup.",
        ].join("\n"),
        embeds: resultEmbeds,
        allowed_mentions: { parse: [] as string[] },
      }),
    }
  );

  return response.ok;
}


export function saveGenesisPick(
  seasonData: SeasonData,
  matchupId: string,
  pick: GenesisPick
):
  | { ok: false; error: string }
  | {
      ok: true;
      seasonData: SeasonData;
      previous: GenesisPick | undefined;
      matchup: GenesisPickMatchup;
    } {
  const state: GenesisPicksState = seasonData.genesisPicks || { matchups: [] };
  const matchup = state.matchups.find((item) => item.id === matchupId);

  if (!matchup) {
    return { ok: false, error: "That Genesis matchup could not be found." };
  }

  if (matchup.status === "locked") {
    return { ok: false, error: "Picks are closed because this game has started." };
  }
  if (matchup.status === "settled") {
    return { ok: false, error: "Picks are closed because this matchup is already final." };
  }
  if (matchup.status === "voided") {
    return { ok: false, error: "This Genesis line was voided, so picks no longer count." };
  }

  const previous = matchup.picks[pick.discordUserId];
  if (previous) {
    return { ok: false, error: "Your pick and wager for this matchup are already locked." };
  }

  if (!Number.isInteger(pick.wager) || (pick.wager || 0) <= 0) {
    return { ok: false, error: "Enter a whole-dollar wager of at least $1." };
  }

  const availableBankroll = genesisAvailableBankroll(
    seasonData,
    pick.discordUserId
  );
  if ((pick.wager || 0) > availableBankroll) {
    return {
      ok: false,
      error: `That wager exceeds your available $${availableBankroll} bankroll.`,
    };
  }

  const matchups = state.matchups.map((item) =>
    item.id === matchupId
      ? {
          ...item,
          picks: {
            ...item.picks,
            [pick.discordUserId]: pick,
          },
        }
      : item
  );

  return {
    ok: true,
    seasonData: {
      ...seasonData,
      genesisPicks: {
        ...state,
        bankrollStartedAt: state.bankrollStartedAt || pick.pickedAt,
        matchups,
      },
    },
    previous,
    matchup,
  };
}

function orientFinalScore(game: GenesisHistoricalGame, matchup: GenesisPickMatchup) {
  if (normalize(game.teamA) === normalize(matchup.awayTeam)) {
    return { away: game.scoreA, home: game.scoreB };
  }
  return { away: game.scoreB, home: game.scoreA };
}

function matchingFinalGame(
  games: GenesisHistoricalGame[],
  matchup: GenesisPickMatchup
) {
  const createdMs = new Date(matchup.createdAt).getTime();

  return games
    .filter((game) => {
      if (!sameTeamPair(game, matchup.awayTeam, matchup.homeTeam)) return false;

      if (
        typeof game.seasonYear === "number" &&
        game.seasonYear !== matchup.seasonYear
      ) {
        return false;
      }

      if (
        game.stage?.trim() &&
        matchup.stage?.trim() &&
        normalize(game.stage) !== normalize(matchup.stage)
      ) {
        return false;
      }

      if (!game.sourceTimestamp) return false;
      const sourceMs = new Date(game.sourceTimestamp).getTime();
      if (!Number.isFinite(sourceMs) || !Number.isFinite(createdMs)) return false;

      // The results post should come after the PvP thread was created. A
      // small buffer handles clock skew without allowing old meetings to settle it.
      return sourceMs >= createdMs - 5 * 60 * 1000;
    })
    .sort((a, b) =>
      (a.sourceTimestamp || "").localeCompare(b.sourceTimestamp || "")
    )[0];
}

export function settleGenesisPicksFromHistory(seasonData: SeasonData) {
  const state = seasonData.genesisPicks;
  if (!state?.matchups?.length || !seasonData.genesisHistory?.games?.length) {
    return { seasonData, settledCount: 0, settledMatchupIds: [] as string[] };
  }

  let settledCount = 0;
  const settledMatchupIds: string[] = [];

  const matchups = state.matchups.map((matchup) => {
    if (matchup.status === "settled" || matchup.status === "voided") return matchup;

    const game = matchingFinalGame(seasonData.genesisHistory!.games, matchup);
    if (!game) return matchup;

    const final = orientFinalScore(game, matchup);
    const atsValue = final.away - final.home + matchup.awayLine;
    const atsWinner: GenesisPickSide | "push" =
      Math.abs(atsValue) < 0.001
        ? "push"
        : atsValue > 0
          ? "away"
          : "home";

    settledCount++;
    settledMatchupIds.push(matchup.id);

    return {
      ...matchup,
      status: "settled" as const,
      finalAwayScore: final.away,
      finalHomeScore: final.home,
      atsWinner,
      settledAt: game.sourceTimestamp || new Date().toISOString(),
      sourceGameId: game.id,
    };
  });

  return {
    seasonData: {
      ...seasonData,
      genesisPicks: {
        ...state,
        matchups,
      },
    },
    settledCount,
    settledMatchupIds,
  };
}

type LeaderboardRow = {
  discordUserId: string;
  discordUsername: string;
  wins: number;
  losses: number;
  pushes: number;
  gradedPicks: number;
  decisions: number;
  accuracy: number;
};

export type GenesisBankrollRow = {
  discordUserId: string;
  discordUsername: string;
  bankroll: number;
  profitLoss: number;
  winBonuses: number;
  cpuWins: number;
  pvpWins: number;
  pendingWagers: number;
  availableBankroll: number;
  settledWagers: number;
};

export function genesisBankrollRows(
  seasonData: SeasonData
): GenesisBankrollRow[] {
  const state: GenesisPicksState = seasonData.genesisPicks || { matchups: [] };
  const rows = new Map<string, GenesisBankrollRow>();
  const teamAssignments = new Map<
    string,
    { team: string; pickedAt: string }[]
  >();

  for (const matchup of state.matchups) {
    for (const pick of Object.values(matchup.picks || {})) {
      const row =
        rows.get(pick.discordUserId) ||
        {
          discordUserId: pick.discordUserId,
          discordUsername: pick.discordUsername,
          bankroll: GENESIS_STARTING_BANKROLL,
          profitLoss: 0,
          winBonuses: 0,
          cpuWins: 0,
          pvpWins: 0,
          pendingWagers: 0,
          availableBankroll: GENESIS_STARTING_BANKROLL,
          settledWagers: 0,
        };

      row.discordUsername = pick.discordUsername || row.discordUsername;
      if (pick.team?.trim()) {
        const assignments = teamAssignments.get(pick.discordUserId) || [];
        assignments.push({ team: pick.team.trim(), pickedAt: pick.pickedAt });
        teamAssignments.set(pick.discordUserId, assignments);
      }
      const wager =
        typeof pick.wager === "number" && Number.isFinite(pick.wager)
          ? Math.max(0, Math.floor(pick.wager))
          : 0;

      if (wager > 0 && matchup.status === "settled" && matchup.atsWinner) {
        row.settledWagers++;
        if (matchup.atsWinner !== "push") {
          row.profitLoss += pick.side === matchup.atsWinner ? wager : -wager;
        }
      } else if (
        wager > 0 &&
        (matchup.status === "open" || matchup.status === "locked")
      ) {
        row.pendingWagers += wager;
      }

      rows.set(pick.discordUserId, row);
    }
  }

  for (const assignments of teamAssignments.values()) {
    assignments.sort((a, b) => a.pickedAt.localeCompare(b.pickedAt));
  }

  const bankrollStartedMs = state.bankrollStartedAt
    ? new Date(state.bankrollStartedAt).getTime()
    : Number.NaN;
  const countedGames = new Set<string>();

  if (Number.isFinite(bankrollStartedMs)) {
    for (const game of seasonData.genesisHistory?.games || []) {
      if (countedGames.has(game.id)) continue;
      countedGames.add(game.id);
      if (game.gameType !== "cpu" && game.gameType !== "pvp") continue;
      if (game.scoreA === game.scoreB || !game.sourceTimestamp) continue;

      const gameMs = new Date(game.sourceTimestamp).getTime();
      if (!Number.isFinite(gameMs) || gameMs < bankrollStartedMs) continue;
      const winningTeam = game.scoreA > game.scoreB ? game.teamA : game.teamB;

      for (const row of rows.values()) {
        const assignments = teamAssignments.get(row.discordUserId) || [];
        const activeTeam = [...assignments]
          .reverse()
          .find((assignment) => {
            const assignedMs = new Date(assignment.pickedAt).getTime();
            return Number.isFinite(assignedMs) && assignedMs <= gameMs;
          })?.team;
        if (!activeTeam || normalize(activeTeam) !== normalize(winningTeam)) {
          continue;
        }

        if (game.gameType === "pvp") {
          row.pvpWins++;
          row.winBonuses += 25;
        } else {
          row.cpuWins++;
          row.winBonuses += 5;
        }
      }
    }
  }

  for (const row of rows.values()) {
    row.bankroll =
      GENESIS_STARTING_BANKROLL + row.profitLoss + row.winBonuses;
    row.availableBankroll = Math.max(0, row.bankroll - row.pendingWagers);
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.bankroll - a.bankroll ||
      b.winBonuses - a.winBonuses ||
      b.profitLoss - a.profitLoss ||
      b.settledWagers - a.settledWagers ||
      a.discordUsername.localeCompare(b.discordUsername)
  );
}

export function genesisAvailableBankroll(
  seasonData: SeasonData,
  discordUserId: string
) {
  const state = seasonData.genesisPicks || { matchups: [] };
  return (
    genesisBankrollRows({ ...seasonData, genesisPicks: state }).find(
      (row) => row.discordUserId === discordUserId
    )?.availableBankroll ?? GENESIS_STARTING_BANKROLL
  );
}

function leaderboardRows(state: GenesisPicksState): LeaderboardRow[] {
  const rows = new Map<string, LeaderboardRow>();

  const settled = [...state.matchups]
    .filter((matchup) => matchup.status === "settled" && matchup.atsWinner)
    .sort((a, b) => (a.settledAt || "").localeCompare(b.settledAt || ""));

  for (const matchup of settled) {
    for (const pick of Object.values(matchup.picks)) {
      const row =
        rows.get(pick.discordUserId) ||
        {
          discordUserId: pick.discordUserId,
          discordUsername: pick.discordUsername,
          wins: 0,
          losses: 0,
          pushes: 0,
          gradedPicks: 0,
          decisions: 0,
          accuracy: 0,
        };

      row.discordUsername = pick.discordUsername || row.discordUsername;
      row.gradedPicks++;

      if (matchup.atsWinner === "push") {
        row.pushes++;
      } else if (pick.side === matchup.atsWinner) {
        row.wins++;
        row.decisions++;
      } else {
        row.losses++;
        row.decisions++;
      }

      row.accuracy = row.decisions ? row.wins / row.decisions : 0;
      rows.set(pick.discordUserId, row);
    }
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.accuracy - a.accuracy ||
      b.decisions - a.decisions ||
      b.wins - a.wins ||
      a.discordUsername.localeCompare(b.discordUsername)
  );
}

export function buildGenesisLeaderboardContent(seasonData: SeasonData) {
  const state = seasonData.genesisPicks || { matchups: [] };
  const allRows = leaderboardRows(state);
  const gradedMatchupCount = state.matchups.filter(
    (matchup) => matchup.status === "settled" && matchup.atsWinner
  ).length;
  const minimumPicks =
    gradedMatchupCount > 0 ? Math.ceil(gradedMatchupCount / 3) : 0;
  const rows = allRows.filter((row) => row.gradedPicks >= minimumPicks);
  const settledCount = state.matchups.filter(
    (matchup) => matchup.status === "settled"
  ).length;
  const openCount = state.matchups.filter(
    (matchup) => matchup.status === "open"
  ).length;
  const lockedCount = state.matchups.filter(
    (matchup) => matchup.status === "locked"
  ).length;
  const voidedCount = state.matchups.filter(
    (matchup) => matchup.status === "voided"
  ).length;

  const lines = [
    "🏆 **GENESIS PICKS LEADERBOARD**",
    "*Accuracy using the locked Genesis Line*",
    "",
  ];

  if (!allRows.length) {
    lines.push("No graded picks yet.");
  } else if (!rows.length) {
    lines.push(
      `No players have reached the minimum of **${minimumPicks}** graded pick${minimumPicks === 1 ? "" : "s"} yet.`
    );
  } else {
    rows.slice(0, 25).forEach((row, index) => {
      const pct = (row.accuracy * 100).toFixed(1);
      lines.push(
        `**${index + 1}.** <@${row.discordUserId}> — **${row.wins}-${row.losses}-${row.pushes}** · **${pct}%**`
      );
    });
  }

  lines.push(
    "",
    `Settled: **${settledCount}** · Voided: **${voidedCount}** · Locked/in progress: **${lockedCount}** · Open picks: **${openCount}**`,
    gradedMatchupCount > 0
      ? `Leaderboard minimum: **${minimumPicks}** graded pick${minimumPicks === 1 ? "" : "s"} — at least one-third of ${gradedMatchupCount} completed pick opportunit${gradedMatchupCount === 1 ? "y" : "ies"}, rounded up.`
      : "Leaderboard minimum begins once a matchup is graded.",
    "Pushes do not count toward accuracy. Voided matchups do not count at all."
  );

  return lines.join("\n").slice(0, 2000);
}

export function buildGenesisBankrollLeaderboardContent(
  seasonData: SeasonData
) {
  const state = seasonData.genesisPicks || { matchups: [] };
  const rows = genesisBankrollRows({ ...seasonData, genesisPicks: state });
  const lines = [
    "💰 **GENESIS BANKROLL LEADERBOARD**",
    `*Fake money — every player starts with $${GENESIS_STARTING_BANKROLL}*`,
    "",
  ];

  if (!rows.length) {
    lines.push("No wagers yet.");
  } else {
    rows.slice(0, 25).forEach((row, index) => {
      const profitText =
        row.profitLoss === 0
          ? "$0"
          : `${row.profitLoss > 0 ? "+" : "-"}$${Math.abs(row.profitLoss)}`;
      const pendingText =
        row.pendingWagers > 0
          ? ` · **$${row.availableBankroll} available** · $${row.pendingWagers} pending`
          : "";
      const bonusText =
        row.winBonuses > 0
          ? ` · $${row.winBonuses} win bonus (${row.pvpWins} PvP, ${row.cpuWins} CPU)`
          : "";
      lines.push(
        `**${index + 1}.** <@${row.discordUserId}> — **$${row.bankroll}** (${profitText} wagers)${bonusText}${pendingText}`
      );
    });
  }

  lines.push(
    "",
    "ATS wagers pay even money. Wins add the wager, losses subtract it, and pushes or voided games return it.",
    "Bankroll recovery: +$25 for a PvP win and +$5 for a CPU win after bankroll play begins.",
    "Open wagers reserve bankroll until the game is settled or voided."
  );

  return lines.join("\n").slice(0, 2000);
}

type DiscordChannel = {
  id: string;
  name?: string;
  type?: number;
  parent_id?: string | null;
  guild_id?: string;
  permission_overwrites?: unknown[];
};

async function findOrCreateLeaderboardChannel(
  existingChannelId?: string
): Promise<{ channel?: DiscordChannel; warning?: string }> {
  if (existingChannelId) {
    const existingResponse = await discordApi(`/channels/${existingChannelId}`);
    if (existingResponse.ok) {
      const existing = (await existingResponse.json()) as DiscordChannel;
      return { channel: existing };
    }
  }

  const parentResponse = await discordApi(`/channels/${PVP_PARENT_CHANNEL_ID}`);
  if (!parentResponse.ok) {
    const body = await parentResponse.text();
    return {
      warning: `Could not inspect the PvP parent while creating #${LEADERBOARD_CHANNEL_NAME}: ${body || parentResponse.statusText}`,
    };
  }

  const parent = (await parentResponse.json()) as DiscordChannel;
  if (!parent.guild_id) {
    return { warning: "The PvP parent channel is not inside a Discord server." };
  }

  const channelsResponse = await discordApi(`/guilds/${parent.guild_id}/channels`);
  if (channelsResponse.ok) {
    const channels = (await channelsResponse.json()) as DiscordChannel[];
    const matching = channels.find(
      (channel) =>
        channel.type === 0 &&
        normalize(channel.name || "") === normalize(LEADERBOARD_CHANNEL_NAME)
    );
    if (matching) return { channel: matching };
  }

  const createResponse = await discordApi(`/guilds/${parent.guild_id}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name: LEADERBOARD_CHANNEL_NAME,
      type: 0,
      topic: "Genesis Lines social ATS pick accuracy and standings",
      ...(parent.parent_id ? { parent_id: parent.parent_id } : {}),
      ...(Array.isArray(parent.permission_overwrites)
        ? { permission_overwrites: parent.permission_overwrites }
        : {}),
    }),
  });

  if (!createResponse.ok) {
    const body = await createResponse.text();
    return {
      warning:
        `Could not create #${LEADERBOARD_CHANNEL_NAME}. RTA likely needs Manage Channels permission. ` +
        (body || createResponse.statusText),
    };
  }

  return { channel: (await createResponse.json()) as DiscordChannel };
}

export async function syncGenesisLeaderboard(
  seasonData: SeasonData
): Promise<{ seasonData: SeasonData; warning?: string }> {
  const state: GenesisPicksState = seasonData.genesisPicks || { matchups: [] };
  const channelResult = await findOrCreateLeaderboardChannel(
    state.leaderboardChannelId
  );

  if (!channelResult.channel) {
    return { seasonData, warning: channelResult.warning };
  }

  const channelId = channelResult.channel.id;
  const leaderboardSeasonData = {
    ...seasonData,
    genesisPicks: {
      ...state,
      leaderboardChannelId: channelId,
    },
  } satisfies SeasonData;

  async function upsertMessage(
    existingMessageId: string | undefined,
    content: string,
    label: string
  ): Promise<{ messageId?: string; warning?: string }> {
    let messageId = existingMessageId;

    if (messageId) {
      const editResponse = await discordApi(
        `/channels/${channelId}/messages/${messageId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            content,
            allowed_mentions: { parse: [] as string[] },
          }),
        }
      );

      if (!editResponse.ok) messageId = undefined;
    }

    if (!messageId) {
      const postResponse = await discordApi(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content,
          allowed_mentions: { parse: [] as string[] },
        }),
      });

      if (!postResponse.ok) {
        const body = await postResponse.text();
        return {
          warning:
            `Could not post the Genesis ${label} leaderboard in <#${channelId}>: ` +
            (body || postResponse.statusText),
        };
      }

      const message = (await postResponse.json()) as { id: string };
      messageId = message.id;
    }

    return { messageId };
  }

  const accuracyResult = await upsertMessage(
    state.leaderboardMessageId,
    buildGenesisLeaderboardContent(leaderboardSeasonData),
    "accuracy"
  );
  const bankrollResult = await upsertMessage(
    state.bankrollLeaderboardMessageId,
    buildGenesisBankrollLeaderboardContent(leaderboardSeasonData),
    "bankroll"
  );
  const warnings = [accuracyResult.warning, bankrollResult.warning].filter(
    (warning): warning is string => Boolean(warning)
  );

  return {
    seasonData: {
      ...seasonData,
      genesisPicks: {
        ...state,
        leaderboardChannelId: channelId,
        leaderboardMessageId:
          accuracyResult.messageId || state.leaderboardMessageId,
        bankrollLeaderboardMessageId:
          bankrollResult.messageId || state.bankrollLeaderboardMessageId,
      },
    },
    warning: warnings.length ? warnings.join(" ") : undefined,
  };
}
