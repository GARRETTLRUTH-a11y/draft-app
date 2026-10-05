import type {
  GenesisHistoricalGame,
  GenesisPick,
  GenesisPickMatchup,
  GenesisPickSide,
  GenesisPicksState,
  GenesisVoidReason,
  SeasonData,
} from "@/lib/season";
import type { GenesisLineResult } from "@/lib/genesisLines";
import { PVP_PARENT_CHANNEL_ID } from "@/lib/discordPvpThreads";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const LEADERBOARD_CHANNEL_NAME = "genesis-picks";

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

  const lines = [
    "🎯 **GENESIS PICKS**",
    `**${matchup.awayTeam} ${matchup.neutral ? "vs." : "@"} ${matchup.homeTeam}**`,
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

      lines.push(`• ${username} — **${team} ${lineText}**`);
    }
  }

  lines.push("", "_This message updates in place to reduce notifications._");
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
          ? "🏁 FINAL"
          : "🚫 VOID";

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
          custom_id: `genesis_stream:${seasonId}:${matchup.id}`,
          disabled: !isOpen,
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

  if (matchup.status === "settled") {
    return { error: "That Genesis matchup is already finalized." } as const;
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

  const matchups: GenesisPickMatchup[] = state.matchups.map((item) =>
    item.id === matchupId
      ? {
          ...item,
          status: "settled" as const,
          finalAwayScore: awayScore,
          finalHomeScore: homeScore,
          atsWinner,
          settledAt,
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
          `**${matchup.awayTeam} @ ${matchup.homeTeam}**`,
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
  awayScore: number;
  homeScore: number;
  atsWinner: GenesisPickSide | "push";
}) {
  const winnerText =
    input.atsWinner === "push"
      ? "Push"
      : input.atsWinner === "away"
        ? input.matchup.awayTeam
        : input.matchup.homeTeam;

  const response = await discordApi(
    `/channels/${input.matchup.threadId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content: [
          "🏁 **GENESIS FINAL**",
          `**${input.matchup.awayTeam} ${input.awayScore} – ${input.matchup.homeTeam} ${input.homeScore}**`,
          `Locked line: **${input.matchup.displayLine}**`,
          `ATS result: **${winnerText}**`,
          "🔒 Picks are closed. The Genesis Picks leaderboard has been updated.",
        ].join("\n"),
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
) {
  const state: GenesisPicksState = seasonData.genesisPicks || { matchups: [] };
  const matchup = state.matchups.find((item) => item.id === matchupId);

  if (!matchup) {
    return { error: "That Genesis matchup could not be found." } as const;
  }

  if (matchup.status === "locked") {
    return { error: "Picks are closed because this game has started." } as const;
  }
  if (matchup.status === "settled") {
    return { error: "Picks are closed because this matchup is already final." } as const;
  }
  if (matchup.status === "voided") {
    return { error: "This Genesis line was voided, so picks no longer count." } as const;
  }

  const previous = matchup.picks[pick.discordUserId];

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
    seasonData: {
      ...seasonData,
      genesisPicks: {
        ...state,
        matchups,
      },
    },
    previous,
    matchup,
  } as const;
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
  decisions: number;
  accuracy: number;
};

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
          decisions: 0,
          accuracy: 0,
        };

      row.discordUsername = pick.discordUsername || row.discordUsername;

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
  const rows = leaderboardRows(state);
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
    "*Against-the-spread accuracy using the locked Genesis Line*",
    "",
  ];

  if (!rows.length) {
    lines.push("No graded picks yet.");
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
    "Pushes do not count toward accuracy. Voided matchups do not count at all."
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
  const content = buildGenesisLeaderboardContent({
    ...seasonData,
    genesisPicks: {
      ...state,
      leaderboardChannelId: channelId,
    },
  });

  let messageId = state.leaderboardMessageId;

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

    if (!editResponse.ok) {
      messageId = undefined;
    }
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
        seasonData,
        warning:
          `Could not post the Genesis picks leaderboard in <#${channelId}>: ` +
          (body || postResponse.statusText),
      };
    }

    const message = (await postResponse.json()) as { id: string };
    messageId = message.id;
  }

  return {
    seasonData: {
      ...seasonData,
      genesisPicks: {
        ...state,
        leaderboardChannelId: channelId,
        leaderboardMessageId: messageId,
      },
    },
  };
}
