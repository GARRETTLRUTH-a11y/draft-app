import type {
  GenesisHistoricalGame,
  GenesisHistory,
  GenesisPostseasonAchievement,
  GenesisPostseasonAchievementType,
  SeasonData,
  SeasonPlayer,
} from "@/lib/season";

export const WEEKLY_RANKINGS_CHANNEL_ID = "1412974513720918188";
export const SEASON_SUMMARY_CHANNEL_ID = "1455943133295542397";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const OPENAI_API_BASE = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

type DiscordMessage = {
  id: string;
  channel_id: string;
  timestamp?: string;
  content?: string;
  embeds?: {
    title?: string;
    description?: string;
    fields?: { name?: string; value?: string }[];
  }[];
};

type ParsedGame = {
  sourceMessageId: string;
  seasonYear: number | null;
  stage: string | null;
  teamA: string;
  scoreA: number;
  teamB: string;
  scoreB: number;
  gameType: "pvp" | "cpu" | "unknown";
  playerA: string | null;
  playerB: string | null;
};

type ParsedPostseasonAchievement = {
  sourceMessageId: string;
  seasonYear: number | null;
  team: string | null;
  player: string | null;
  type:
    | "conference_championship_appearance"
    | "conference_championship"
    | "playoff_appearance"
    | "semifinal_appearance"
    | "championship_appearance"
    | "championship";
  label: string | null;
};

type ParsedHistoryChunk = {
  games: ParsedGame[];
  postseasonAchievements: ParsedPostseasonAchievement[];
};

export type GenesisLineResult = {
  awayTeam: string;
  homeTeam: string;
  neutral: boolean;
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundHalf(value: number) {
  return Math.round(value * 2) / 2;
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function sameHistoricalTeamPair(
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

function genesisModelGames(seasonData: SeasonData) {
  const allGames = seasonData.genesisHistory?.games || [];
  const voidedMatchups =
    seasonData.genesisPicks?.matchups.filter(
      (matchup) => matchup.status === "voided"
    ) || [];

  if (!voidedMatchups.length || !allGames.length) {
    return { games: allGames, excludedVoidResults: 0 };
  }

  const excludedIds = new Set<string>();

  for (const matchup of voidedMatchups) {
    const createdMs = new Date(matchup.createdAt).getTime();

    const matchingGame = allGames
      .filter((game) => {
        if (!sameHistoricalTeamPair(game, matchup.awayTeam, matchup.homeTeam)) {
          return false;
        }

        if (
          typeof game.seasonYear === "number" &&
          game.seasonYear !== matchup.seasonYear
        ) {
          return false;
        }

        if (!game.sourceTimestamp) return false;
        const sourceMs = new Date(game.sourceTimestamp).getTime();
        if (!Number.isFinite(sourceMs) || !Number.isFinite(createdMs)) return false;

        return sourceMs >= createdMs - 5 * 60 * 1000;
      })
      .sort((a, b) =>
        (a.sourceTimestamp || "").localeCompare(b.sourceTimestamp || "")
      )[0];

    if (matchingGame) excludedIds.add(matchingGame.id);
  }

  return {
    games: allGames.filter((game) => !excludedIds.has(game.id)),
    excludedVoidResults: excludedIds.size,
  };
}


function messageText(message: DiscordMessage) {
  const embedText = (message.embeds || [])
    .flatMap((embed) => [
      embed.title || "",
      embed.description || "",
      ...(embed.fields || []).flatMap((field) => [field.name || "", field.value || ""]),
    ])
    .filter(Boolean)
    .join("\n");

  return [message.content || "", embedText].filter(Boolean).join("\n").trim();
}

async function discordApi(path: string) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN is not configured.");

  return fetch(`${DISCORD_API_BASE}${path}`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: "no-store",
  });
}

async function fetchMessagesFromChannel(channelId: string, maxMessages: number) {
  const messages: DiscordMessage[] = [];
  let before: string | undefined;

  while (messages.length < maxMessages) {
    const params = new URLSearchParams({
      limit: String(Math.min(100, maxMessages - messages.length)),
    });
    if (before) params.set("before", before);

    const response = await discordApi(
      `/channels/${channelId}/messages?${params.toString()}`
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Could not read Discord history from channel ${channelId}: ${body || response.statusText}`
      );
    }

    const page = (await response.json()) as DiscordMessage[];
    if (!page.length) break;

    messages.push(...page);
    before = page[page.length - 1]?.id;

    if (page.length < 100) break;
  }

  return messages.slice(0, maxMessages);
}

function compareSnowflakes(a: string, b: string) {
  try {
    const left = BigInt(a);
    const right = BigInt(b);
    return left < right ? -1 : left > right ? 1 : 0;
  } catch {
    return a.localeCompare(b);
  }
}

function latestMessageId(messages: DiscordMessage[]) {
  return messages.reduce<string | undefined>((latest, message) => {
    if (!latest || compareSnowflakes(message.id, latest) > 0) return message.id;
    return latest;
  }, undefined);
}

async function fetchMessagesAfter(
  channelId: string,
  afterId: string,
  maxMessages: number
) {
  const messages: DiscordMessage[] = [];
  let after = afterId;

  while (messages.length < maxMessages) {
    const params = new URLSearchParams({
      limit: String(Math.min(100, maxMessages - messages.length)),
      after,
    });

    const response = await discordApi(
      `/channels/${channelId}/messages?${params.toString()}`
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Could not read new Discord history from channel ${channelId}: ${body || response.statusText}`
      );
    }

    const page = (await response.json()) as DiscordMessage[];
    if (!page.length) break;

    const ordered = [...page].sort((a, b) => compareSnowflakes(a.id, b.id));
    messages.push(...ordered);

    const nextAfter = latestMessageId(page);
    if (!nextAfter || nextAfter === after) break;
    after = nextAfter;

    if (page.length < 100) break;
  }

  return messages.slice(0, maxMessages);
}

async function resolveSourceMessageChannels(sourceChannelId: string) {
  const response = await discordApi(`/channels/${sourceChannelId}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Could not inspect Discord source ${sourceChannelId}: ${body || response.statusText}`
    );
  }

  const channel = (await response.json()) as {
    id: string;
    type?: number;
    guild_id?: string;
    name?: string;
  };

  // Forum and Media parents hold posts as child threads rather than messages.
  if ((channel.type === 15 || channel.type === 16) && channel.guild_id) {
    const threadIds = new Set<string>();

    const activeResponse = await discordApi(
      `/guilds/${channel.guild_id}/threads/active`
    );
    if (activeResponse.ok) {
      const active = (await activeResponse.json()) as {
        threads?: { id: string; parent_id?: string }[];
      };
      for (const thread of active.threads || []) {
        if (thread.parent_id === sourceChannelId) threadIds.add(thread.id);
      }
    }

    let before: string | undefined;
    for (let pageIndex = 0; pageIndex < 5; pageIndex++) {
      const params = new URLSearchParams({ limit: "100" });
      if (before) params.set("before", before);

      const archivedResponse = await discordApi(
        `/channels/${sourceChannelId}/threads/archived/public?${params.toString()}`
      );

      if (!archivedResponse.ok) break;

      const archived = (await archivedResponse.json()) as {
        threads?: {
          id: string;
          parent_id?: string;
          thread_metadata?: { archive_timestamp?: string };
        }[];
        has_more?: boolean;
      };

      const threads = archived.threads || [];
      for (const thread of threads) {
        if (thread.parent_id === sourceChannelId) threadIds.add(thread.id);
      }

      if (!archived.has_more || !threads.length) break;
      before =
        threads[threads.length - 1]?.thread_metadata?.archive_timestamp || undefined;
      if (!before) break;
    }

    return [...threadIds];
  }

  return [sourceChannelId];
}

export type GenesisSyncMode = "full" | "incremental";

async function fetchSourceMessages(
  sourceChannelId: string,
  maxMessagesPerSource: number,
  existingCursors: Record<string, string>,
  mode: GenesisSyncMode
) {
  const messageChannels = await resolveSourceMessageChannels(sourceChannelId);
  const all: DiscordMessage[] = [];
  const cursors: Record<string, string> = {};

  // A full rebuild spreads its message budget across forum threads so one
  // busy thread cannot consume the entire backfill. Incremental sync instead
  // spends the budget only on channels that actually have new messages.
  const fullPerChannelLimit =
    messageChannels.length > 1
      ? Math.max(10, Math.ceil(maxMessagesPerSource / messageChannels.length))
      : maxMessagesPerSource;

  for (const channelId of messageChannels) {
    if (mode === "incremental" && all.length >= maxMessagesPerSource) break;

    const existingCursor = existingCursors[channelId];
    const remaining = Math.max(1, maxMessagesPerSource - all.length);
    const limit =
      mode === "full"
        ? fullPerChannelLimit
        : existingCursor
          ? remaining
          : Math.min(50, remaining);

    const messages =
      mode === "incremental" && existingCursor
        ? await fetchMessagesAfter(channelId, existingCursor, limit)
        : await fetchMessagesFromChannel(channelId, limit);

    all.push(...messages);

    const latest = latestMessageId(messages);
    if (latest) {
      cursors[channelId] = latest;
    } else if (existingCursor) {
      cursors[channelId] = existingCursor;
    }
  }

  const deduped = new Map<string, DiscordMessage>();
  for (const message of all) deduped.set(message.id, message);

  return {
    messages: [...deduped.values()]
      .filter((message) => messageText(message).length > 0)
      .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || "")),
    cursors,
  };
}

function outputTextFromResponse(payload: unknown) {
  const response = payload as {
    output_text?: string;
    output?: {
      content?: { type?: string; text?: string }[];
    }[];
  };

  if (response.output_text) return response.output_text;

  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }

  return "";
}

function buildRosterHint(seasonData: SeasonData) {
  return seasonData.players
    .filter((player) => player.team)
    .map((player) => `${player.team} = ${player.name}`)
    .join("; ");
}

async function parseMessageChunk(
  messages: DiscordMessage[],
  sourceChannelId: string,
  seasonData: SeasonData
): Promise<ParsedHistoryChunk> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const items = messages.map((message) => ({
    sourceMessageId: message.id,
    timestamp: message.timestamp || null,
    text: messageText(message),
  }));

  const instructions = [
    "You extract completed EA Sports College Football dynasty results and postseason accomplishments from Discord history.",
    "For games, return ONLY actual completed games with both teams and both final scores.",
    "Do not treat rankings, records, polls, betting lines, projected scores, schedules, or future matchups as completed games.",
    "One Discord message may contain many completed games.",
    "Preserve the exact sourceMessageId supplied with each extracted game.",
    "Use seasonYear and stage only when they are stated or can be unambiguously inferred from the local message context; otherwise return null.",
    "gameType is pvp only when both sides are human-controlled league teams/users, cpu when exactly one side is human-controlled and the opponent is CPU, otherwise unknown.",
    "Do not invent player names. Use playerA/playerB only when the message identifies them or when the result clearly belongs to the current-season roster mapping and current season year.",
    "Also extract explicit postseason accomplishments when stated: conference championship appearance, conference championship win, playoff appearance, semifinal appearance, national championship appearance, and national championship.",
    "Do not infer a postseason accomplishment merely from rankings or a strong record. It must be explicit in the Discord text or unambiguous from a postseason result.",
    "For a conference champion, emit conference_championship. Do not also emit conference_championship_appearance for the same player/team/season.",
    "For a conference title-game loser, emit conference_championship_appearance.",
    "For a national champion, emit type championship. Do not also emit championship_appearance for the same player/team/season unless the source separately states it.",
    "For a national championship-game loser, emit championship_appearance. For a semifinal participant that did not reach the title game, emit semifinal_appearance. For other playoff qualifiers, emit playoff_appearance.",
    `Current dynasty season year: ${seasonData.seasonYear}.`,
    `Current human team mapping: ${buildRosterHint(seasonData) || "none supplied"}.`,
  ].join(" ");

  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_GENESIS_MODEL || DEFAULT_OPENAI_MODEL,
      instructions,
      input: JSON.stringify({
        sourceChannelId,
        messages: items,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "genesis_history",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              games: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    sourceMessageId: { type: "string" },
                    seasonYear: { type: ["integer", "null"] },
                    stage: { type: ["string", "null"] },
                    teamA: { type: "string" },
                    scoreA: { type: "integer" },
                    teamB: { type: "string" },
                    scoreB: { type: "integer" },
                    gameType: {
                      type: "string",
                      enum: ["pvp", "cpu", "unknown"],
                    },
                    playerA: { type: ["string", "null"] },
                    playerB: { type: ["string", "null"] },
                  },
                  required: [
                    "sourceMessageId",
                    "seasonYear",
                    "stage",
                    "teamA",
                    "scoreA",
                    "teamB",
                    "scoreB",
                    "gameType",
                    "playerA",
                    "playerB",
                  ],
                },
              },
              postseasonAchievements: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    sourceMessageId: { type: "string" },
                    seasonYear: { type: ["integer", "null"] },
                    team: { type: ["string", "null"] },
                    player: { type: ["string", "null"] },
                    type: {
                      type: "string",
                      enum: [
                        "conference_championship_appearance",
                        "conference_championship",
                        "playoff_appearance",
                        "semifinal_appearance",
                        "championship_appearance",
                        "championship"
                      ],
                    },
                    label: { type: ["string", "null"] },
                  },
                  required: [
                    "sourceMessageId",
                    "seasonYear",
                    "team",
                    "player",
                    "type",
                    "label"
                  ],
                },
              },
            },
            required: ["games", "postseasonAchievements"],
          },
        },
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenAI could not parse Genesis history: ${body || response.statusText}`
    );
  }

  const payload = await response.json();
  const outputText = outputTextFromResponse(payload);
  if (!outputText) throw new Error("OpenAI returned no parsed history output.");

  const parsed = JSON.parse(outputText) as Partial<ParsedHistoryChunk>;
  return {
    games: parsed.games || [],
    postseasonAchievements: parsed.postseasonAchievements || [],
  };
}

function gameFingerprint(game: {
  seasonYear?: number | null;
  stage?: string | null;
  teamA: string;
  scoreA: number;
  teamB: string;
  scoreB: number;
}) {
  const sides = [
    `${normalize(game.teamA)}:${game.scoreA}`,
    `${normalize(game.teamB)}:${game.scoreB}`,
  ].sort();

  return [
    game.seasonYear ?? "?",
    normalize(game.stage || "?"),
    sides[0],
    sides[1],
  ].join("|");
}

function mergeGame(
  existing: GenesisHistoricalGame | undefined,
  incoming: GenesisHistoricalGame
) {
  if (!existing) return incoming;

  return {
    ...existing,
    ...incoming,
    gameType:
      incoming.gameType !== "unknown" ? incoming.gameType : existing.gameType,
    playerA: incoming.playerA || existing.playerA,
    playerB: incoming.playerB || existing.playerB,
    stage: incoming.stage || existing.stage,
    seasonYear: incoming.seasonYear || existing.seasonYear,
  };
}

export async function syncGenesisHistory(
  seasonData: SeasonData,
  options: { mode?: GenesisSyncMode } = {}
): Promise<GenesisHistory> {
  const maxMessagesPerSource = clamp(
    Number(process.env.GENESIS_HISTORY_MAX_MESSAGES || 200),
    100,
    2000
  );

  const sources = [
    WEEKLY_RANKINGS_CHANNEL_ID,
    SEASON_SUMMARY_CHANNEL_ID,
  ];

  const requestedMode = options.mode || "full";
  // Existing seasons created before incremental sync have no cursors yet.
  // Their first automatic sync establishes high-water marks with one full
  // pass; every later Generate Line/Create Thread call only reads new posts.
  const mode: GenesisSyncMode =
    requestedMode === "incremental" &&
    !seasonData.genesisHistory?.sourceCursors
      ? "full"
      : requestedMode;

  const existingCursors =
    mode === "incremental"
      ? seasonData.genesisHistory?.sourceCursors || {}
      : {};

  const fetched = await Promise.all(
    sources.map(async (sourceChannelId) => {
      const result = await fetchSourceMessages(
        sourceChannelId,
        maxMessagesPerSource,
        existingCursors,
        mode
      );
      return {
        sourceChannelId,
        messages: result.messages,
        cursors: result.cursors,
      };
    })
  );

  const extracted: GenesisHistoricalGame[] = [];
  const extractedAchievements: GenesisPostseasonAchievement[] = [];

  for (const source of fetched) {
    const chunks: DiscordMessage[][] = [];
    for (let i = 0; i < source.messages.length; i += 60) {
      chunks.push(source.messages.slice(i, i + 60));
    }

    // Parse a few chunks in parallel so a first-time sync stays within
    // serverless request limits while avoiding a large burst of model calls.
    for (let i = 0; i < chunks.length; i += 3) {
      const parsedGroups = await Promise.all(
        chunks
          .slice(i, i + 3)
          .map((chunk) =>
            parseMessageChunk(chunk, source.sourceChannelId, seasonData)
          )
      );

      for (const parsedGroup of parsedGroups) {
        for (const game of parsedGroup.games) {
          const sourceMessage = source.messages.find(
            (message) => message.id === game.sourceMessageId
          );
          if (!sourceMessage) continue;
          if (!game.teamA.trim() || !game.teamB.trim()) continue;
          if (
            !Number.isFinite(game.scoreA) ||
            !Number.isFinite(game.scoreB) ||
            game.scoreA < 0 ||
            game.scoreB < 0
          ) {
            continue;
          }

          const fingerprint = gameFingerprint(game);
          extracted.push({
            id: fingerprint,
            sourceChannelId: source.sourceChannelId,
            sourceMessageId: game.sourceMessageId,
            sourceTimestamp: sourceMessage.timestamp,
            seasonYear: game.seasonYear ?? undefined,
            stage: game.stage?.trim() || undefined,
            teamA: game.teamA.trim(),
            scoreA: game.scoreA,
            teamB: game.teamB.trim(),
            scoreB: game.scoreB,
            gameType: game.gameType,
            playerA: game.playerA?.trim() || undefined,
            playerB: game.playerB?.trim() || undefined,
          });
        }

        for (const achievement of parsedGroup.postseasonAchievements) {
          const sourceMessage = source.messages.find(
            (message) => message.id === achievement.sourceMessageId
          );
          if (!sourceMessage) continue;
          if (!achievement.team?.trim() && !achievement.player?.trim()) continue;

          const seasonPart = achievement.seasonYear ?? "?";
          const identityPart = normalize(
            achievement.player?.trim() || achievement.team?.trim() || "unknown"
          );
          const id = [
            "postseason",
            seasonPart,
            achievement.type,
            identityPart,
          ].join("|");

          extractedAchievements.push({
            id,
            sourceChannelId: source.sourceChannelId,
            sourceMessageId: achievement.sourceMessageId,
            sourceTimestamp: sourceMessage.timestamp,
            seasonYear: achievement.seasonYear ?? undefined,
            team: achievement.team?.trim() || undefined,
            player: achievement.player?.trim() || undefined,
            type: achievement.type,
            label: achievement.label?.trim() || undefined,
          });
        }
      }
    }
  }

  const merged = new Map<string, GenesisHistoricalGame>();

  for (const existing of seasonData.genesisHistory?.games || []) {
    merged.set(existing.id, existing);
  }

  for (const game of extracted) {
    merged.set(game.id, mergeGame(merged.get(game.id), game));
  }

  const games = [...merged.values()].sort((a, b) => {
    const yearDiff = (a.seasonYear || 0) - (b.seasonYear || 0);
    if (yearDiff !== 0) return yearDiff;
    return (a.sourceTimestamp || "").localeCompare(b.sourceTimestamp || "");
  });

  const achievementMap = new Map<string, GenesisPostseasonAchievement>();
  for (const existing of seasonData.genesisHistory?.postseasonAchievements || []) {
    achievementMap.set(existing.id, existing);
  }
  for (const achievement of extractedAchievements) {
    achievementMap.set(achievement.id, achievement);
  }

  const sourceCursors =
    mode === "incremental"
      ? { ...(seasonData.genesisHistory?.sourceCursors || {}) }
      : {};

  for (const source of fetched) {
    Object.assign(sourceCursors, source.cursors);
  }

  return {
    games,
    postseasonAchievements: [...achievementMap.values()].sort((a, b) => {
      const yearDiff = (a.seasonYear || 0) - (b.seasonYear || 0);
      if (yearDiff !== 0) return yearDiff;
      return (a.sourceTimestamp || "").localeCompare(b.sourceTimestamp || "");
    }),
    sourceCursors,
    lastSyncedAt: new Date().toISOString(),
    messagesScanned: fetched.reduce(
      (sum, source) => sum + source.messages.length,
      0
    ),
    sourceCounts: Object.fromEntries(
      fetched.map((source) => [source.sourceChannelId, source.messages.length])
    ),
    lastSyncMode: mode,
  };
}

function playerForTeam(players: SeasonPlayer[], team: string) {
  const target = normalize(team);
  return players.find((player) => player.team && normalize(player.team) === target);
}

function rating(player: SeasonPlayer | undefined, key: "overallRating" | "offenseRating" | "defenseRating") {
  const value = player?.[key];
  return typeof value === "number" ? value : 85;
}

function gameMarginForTeam(game: GenesisHistoricalGame, team: string) {
  const target = normalize(team);
  if (normalize(game.teamA) === target) return game.scoreA - game.scoreB;
  if (normalize(game.teamB) === target) return game.scoreB - game.scoreA;
  return null;
}

function historicalWeight(
  game: GenesisHistoricalGame,
  currentSeasonYear: number,
  margin: number
) {
  const age =
    typeof game.seasonYear === "number"
      ? Math.max(0, currentSeasonYear - game.seasonYear)
      : 2;

  const seasonWeight = Math.pow(0.82, age);
  const gameTypeWeight =
    game.gameType === "pvp"
      ? 1
      : game.gameType === "cpu"
        ? margin < 0
          ? 0.32
          : 0.02
        : 0.2;

  return seasonWeight * gameTypeWeight;
}

function weightedTeamForm(
  games: GenesisHistoricalGame[],
  team: string,
  currentSeasonYear: number
) {
  let numerator = 0;
  let denominator = 0;
  let count = 0;

  for (const game of games) {
    const margin = gameMarginForTeam(game, team);
    if (margin == null) continue;
    const weight = historicalWeight(game, currentSeasonYear, margin);
    numerator += clamp(margin, -35, 35) * weight;
    denominator += weight;
    count++;
  }

  return {
    margin: denominator ? numerator / denominator : 0,
    count,
  };
}

function weightedPlayerPvpForm(
  games: GenesisHistoricalGame[],
  playerName: string | undefined,
  currentSeasonYear: number
) {
  if (!playerName) return { margin: 0, count: 0 };

  const target = normalize(playerName);
  let numerator = 0;
  let denominator = 0;
  let count = 0;

  for (const game of games) {
    if (game.gameType !== "pvp") continue;

    let margin: number | null = null;
    if (game.playerA && normalize(game.playerA) === target) {
      margin = game.scoreA - game.scoreB;
    } else if (game.playerB && normalize(game.playerB) === target) {
      margin = game.scoreB - game.scoreA;
    }

    if (margin == null) continue;

    const age =
      typeof game.seasonYear === "number"
        ? Math.max(0, currentSeasonYear - game.seasonYear)
        : 2;
    const weight = Math.pow(0.75, age);

    numerator += clamp(margin, -30, 30) * weight;
    denominator += weight;
    count++;
  }

  return {
    margin: denominator ? numerator / denominator : 0,
    count,
  };
}

function weightedPvpTeamHeadToHead(
  games: GenesisHistoricalGame[],
  awayTeam: string,
  homeTeam: string,
  currentSeasonYear: number
) {
  const away = normalize(awayTeam);
  const home = normalize(homeTeam);
  let numerator = 0;
  let denominator = 0;
  let count = 0;

  for (const game of games) {
    if (game.gameType !== "pvp") continue;

    const a = normalize(game.teamA);
    const b = normalize(game.teamB);
    const isMatch =
      (a === away && b === home) ||
      (a === home && b === away);
    if (!isMatch) continue;

    const awayMargin =
      a === away ? game.scoreA - game.scoreB : game.scoreB - game.scoreA;

    const age =
      typeof game.seasonYear === "number"
        ? Math.max(0, currentSeasonYear - game.seasonYear)
        : 2;
    const weight = Math.pow(0.84, age);

    numerator += clamp(awayMargin, -35, 35) * weight;
    denominator += weight;
    count++;
  }

  return {
    margin: denominator ? numerator / denominator : 0,
    count,
  };
}

function weightedCoachHeadToHead(
  games: GenesisHistoricalGame[],
  awayPlayerName: string | undefined,
  homePlayerName: string | undefined,
  currentSeasonYear: number
) {
  if (!awayPlayerName || !homePlayerName) {
    return { margin: 0, count: 0 };
  }

  const away = normalize(awayPlayerName);
  const home = normalize(homePlayerName);
  let numerator = 0;
  let denominator = 0;
  let count = 0;

  for (const game of games) {
    if (game.gameType !== "pvp" || !game.playerA || !game.playerB) continue;

    const a = normalize(game.playerA);
    const b = normalize(game.playerB);
    const isMatch =
      (a === away && b === home) ||
      (a === home && b === away);
    if (!isMatch) continue;

    const awayMargin =
      a === away ? game.scoreA - game.scoreB : game.scoreB - game.scoreA;

    const age =
      typeof game.seasonYear === "number"
        ? Math.max(0, currentSeasonYear - game.seasonYear)
        : 2;
    const weight = Math.pow(0.86, age);

    numerator += clamp(awayMargin, -35, 35) * weight;
    denominator += weight;
    count++;
  }

  return {
    margin: denominator ? numerator / denominator : 0,
    count,
  };
}

function weightedCpuLossPenalty(
  games: GenesisHistoricalGame[],
  playerName: string | undefined,
  teamName: string,
  currentSeasonYear: number
) {
  const playerTarget = playerName ? normalize(playerName) : "";
  const teamTarget = normalize(teamName);
  let penalty = 0;
  let count = 0;

  for (const game of games) {
    if (game.gameType !== "cpu") continue;

    let margin: number | null = null;

    if (playerTarget && game.playerA && normalize(game.playerA) === playerTarget) {
      margin = game.scoreA - game.scoreB;
    } else if (
      playerTarget &&
      game.playerB &&
      normalize(game.playerB) === playerTarget
    ) {
      margin = game.scoreB - game.scoreA;
    } else if (normalize(game.teamA) === teamTarget) {
      margin = game.scoreA - game.scoreB;
    } else if (normalize(game.teamB) === teamTarget) {
      margin = game.scoreB - game.scoreA;
    }

    if (margin == null || margin >= 0) continue;

    const age =
      typeof game.seasonYear === "number"
        ? Math.max(0, currentSeasonYear - game.seasonYear)
        : 2;
    const recency = Math.pow(0.78, age);
    const lossSeverity = clamp(Math.abs(margin) / 10, 0.6, 2.5);

    penalty -= lossSeverity * recency;
    count++;
  }

  return {
    adjustment: clamp(penalty, -5, 0),
    count,
  };
}

function postseasonAchievementValue(type: GenesisPostseasonAchievementType) {
  // Hierarchy: CFP/national-title résumé > conference-title résumé > raw team ratings.
  // Direct PvP is still substantially stronger than every résumé signal.
  switch (type) {
    case "championship":
      return 3;
    case "championship_appearance":
      return 2.1;
    case "semifinal_appearance":
      return 1.55;
    case "playoff_appearance":
      return 1.15;
    case "conference_championship":
      return 0.9;
    case "conference_championship_appearance":
      return 0.6;
  }
}

function weightedPostseasonScore(
  achievements: GenesisPostseasonAchievement[],
  playerName: string | undefined,
  teamName: string,
  currentSeasonYear: number
) {
  const playerTarget = playerName ? normalize(playerName) : "";
  const teamTarget = normalize(teamName);
  let score = 0;
  let count = 0;

  for (const achievement of achievements) {
    const playerMatch =
      Boolean(playerTarget) &&
      Boolean(achievement.player) &&
      normalize(achievement.player || "") === playerTarget;
    const teamMatch =
      !achievement.player &&
      Boolean(achievement.team) &&
      normalize(achievement.team || "") === teamTarget;

    if (!playerMatch && !teamMatch) continue;

    const age =
      typeof achievement.seasonYear === "number"
        ? Math.max(0, currentSeasonYear - achievement.seasonYear)
        : 2;
    const recency = Math.pow(0.82, age);

    score += postseasonAchievementValue(achievement.type) * recency;
    count++;
  }

  return {
    score: clamp(score, 0, 5),
    count,
  };
}

function directPvpAdjustment(margin: number, count: number) {
  if (count <= 0) return 0;

  const factor =
    count >= 4 ? 0.6 :
    count === 3 ? 0.55 :
    count === 2 ? 0.45 :
    0.35;

  return clamp(margin * factor, -12, 12);
}

export function buildGenesisLine(
  seasonData: SeasonData,
  awayTeam: string,
  homeTeam: string,
  neutral: boolean
): GenesisLineResult {
  const awayPlayer = playerForTeam(seasonData.players, awayTeam);
  const homePlayer = playerForTeam(seasonData.players, homeTeam);

  if (!awayPlayer || !homePlayer) {
    throw new Error("Both teams must be current league teams.");
  }

  const awayOverall = rating(awayPlayer, "overallRating");
  const awayOffense = rating(awayPlayer, "offenseRating");
  const awayDefense = rating(awayPlayer, "defenseRating");
  const homeOverall = rating(homePlayer, "overallRating");
  const homeOffense = rating(homePlayer, "offenseRating");
  const homeDefense = rating(homePlayer, "defenseRating");

  const completeRatings = [
    awayPlayer.overallRating,
    awayPlayer.offenseRating,
    awayPlayer.defenseRating,
    homePlayer.overallRating,
    homePlayer.offenseRating,
    homePlayer.defenseRating,
  ].filter((value) => typeof value === "number").length;

  const overallComponent = (awayOverall - homeOverall) * 0.45;
  const matchupComponent =
    ((awayOffense - homeDefense) - (homeOffense - awayDefense)) * 0.16;
  const ratingMargin = overallComponent + matchupComponent;

  const modelHistory = genesisModelGames(seasonData);
  const games = modelHistory.games;
  const awayTeamForm = weightedTeamForm(games, awayTeam, seasonData.seasonYear);
  const homeTeamForm = weightedTeamForm(games, homeTeam, seasonData.seasonYear);
  const awayPlayerForm = weightedPlayerPvpForm(
    games,
    awayPlayer.name,
    seasonData.seasonYear
  );
  const homePlayerForm = weightedPlayerPvpForm(
    games,
    homePlayer.name,
    seasonData.seasonYear
  );

  const achievements = seasonData.genesisHistory?.postseasonAchievements || [];
  const awayPostseason = weightedPostseasonScore(
    achievements,
    awayPlayer.name,
    awayTeam,
    seasonData.seasonYear
  );
  const homePostseason = weightedPostseasonScore(
    achievements,
    homePlayer.name,
    homeTeam,
    seasonData.seasonYear
  );
  const postseasonAdjustment = clamp(
    awayPostseason.score - homePostseason.score,
    -4.5,
    4.5
  );

  const awayCpuLosses = weightedCpuLossPenalty(
    games,
    awayPlayer.name,
    awayTeam,
    seasonData.seasonYear
  );
  const homeCpuLosses = weightedCpuLossPenalty(
    games,
    homePlayer.name,
    homeTeam,
    seasonData.seasonYear
  );
  const cpuLossAdjustment = clamp(
    awayCpuLosses.adjustment - homeCpuLosses.adjustment,
    -5,
    5
  );

  const teamHistoryAdjustment =
    (awayTeamForm.margin - homeTeamForm.margin) * 0.025;
  const playerHistoryAdjustment =
    (awayPlayerForm.margin - homePlayerForm.margin) * 0.1;

  const teamPvpHeadToHead = weightedPvpTeamHeadToHead(
    games,
    awayTeam,
    homeTeam,
    seasonData.seasonYear
  );
  const coachHeadToHead = weightedCoachHeadToHead(
    games,
    awayPlayer.name,
    homePlayer.name,
    seasonData.seasonYear
  );

  // Direct human-vs-human history is the strongest historical signal.
  // Prefer coach-vs-coach history (even if the users changed teams); fall
  // back to team-vs-team PvP history when player identities were unavailable.
  const directMatchupSource =
    coachHeadToHead.count > 0 ? coachHeadToHead : teamPvpHeadToHead;
  const directMatchupAdjustment = directPvpAdjustment(
    directMatchupSource.margin,
    directMatchupSource.count
  );

  const historyAdjustment = clamp(
    teamHistoryAdjustment +
      playerHistoryAdjustment +
      postseasonAdjustment +
      cpuLossAdjustment +
      directMatchupAdjustment,
    -16,
    16
  );

  const homeFieldAdjustment = neutral ? 0 : -2.5;
  const awayMargin = roundHalf(
    ratingMargin + historyAdjustment + homeFieldAdjustment
  );

  const averageOffense = (awayOffense + homeOffense) / 2;
  const averageDefense = (awayDefense + homeDefense) / 2;
  const projectedTotal = clamp(
    54 + (averageOffense - 85) * 0.65 - (averageDefense - 85) * 0.45,
    42,
    72
  );

  const projectedAwayScore = Math.max(
    10,
    Math.round((projectedTotal + awayMargin) / 2)
  );
  const projectedHomeScore = Math.max(
    10,
    Math.round(projectedTotal - projectedAwayScore)
  );

  const historyGamesUsed = new Set([
    ...games
      .filter(
        (game) =>
          gameMarginForTeam(game, awayTeam) != null ||
          gameMarginForTeam(game, homeTeam) != null
      )
      .map((game) => game.id),
  ]).size;

  const confidenceScore = Math.round(
    clamp(
      45 +
        completeRatings * 4 +
        Math.min(18, historyGamesUsed * 1.1) +
        Math.min(8, (awayPlayerForm.count + homePlayerForm.count) * 1.1) +
        Math.min(12, directMatchupSource.count * 3) +
        Math.min(6, (awayPostseason.count + homePostseason.count) * 1.2) +
        Math.min(4, (awayCpuLosses.count + homeCpuLosses.count) * 1.5),
      45,
      88
    )
  );

  const confidence =
    confidenceScore >= 75 ? "High" : confidenceScore >= 60 ? "Medium" : "Low";

  const favorite =
    awayMargin > 0 ? awayTeam : awayMargin < 0 ? homeTeam : null;
  const spread = Math.abs(awayMargin);
  const displayLine = favorite
    ? `${favorite} -${spread.toFixed(1)}`
    : "Pick'em";

  const notes: string[] = [];
  if (modelHistory.excludedVoidResults > 0) {
    notes.push(
      `${modelHistory.excludedVoidResults} auto-sim/force-win result${modelHistory.excludedVoidResults === 1 ? " was" : "s were"} excluded from Genesis performance history.`
    );
  }
  notes.push(
    completeRatings === 6
      ? "Uses complete OVR/OFF/DEF ratings for both teams."
      : "One or more team ratings are missing; 85 is used as a neutral fallback."
  );

  if (historyGamesUsed > 0) {
    notes.push(
      `Uses ${historyGamesUsed} relevant historical league game${historyGamesUsed === 1 ? "" : "s"}; PvP results are weighted far more heavily than CPU results.`
    );
  } else {
    notes.push("No relevant parsed league history is available yet.");
  }

  if (directMatchupSource.count > 0) {
    notes.push(
      `Direct PvP history: ${directMatchupSource.count} matchup${directMatchupSource.count === 1 ? "" : "s"}, weighted average margin ${directMatchupSource.margin >= 0 ? "+" : ""}${directMatchupSource.margin.toFixed(1)} from ${awayTeam}'s perspective.`
    );
  }

  if (awayPostseason.count + homePostseason.count > 0) {
    notes.push(
      `Postseason résumé contributes ${postseasonAdjustment >= 0 ? "+" : ""}${postseasonAdjustment.toFixed(1)} points from ${awayTeam}'s perspective; CFP/national-title success ranks above conference-title success, and both remain below direct PvP.`
    );
  }

  if (awayCpuLosses.count + homeCpuLosses.count > 0) {
    notes.push(
      `CPU wins are treated as nearly neutral; CPU losses apply a ${cpuLossAdjustment >= 0 ? "+" : ""}${cpuLossAdjustment.toFixed(1)}-point relative adjustment from ${awayTeam}'s perspective.`
    );
  }

  notes.push(neutral ? "Neutral site: no home-field adjustment." : `${homeTeam} receives a 2.5-point home-field adjustment.`);

  return {
    awayTeam,
    homeTeam,
    neutral,
    favorite,
    spread,
    displayLine,
    projectedAwayScore,
    projectedHomeScore,
    confidence,
    confidenceScore,
    historyGamesUsed,
    ratingMargin: Math.round(ratingMargin * 10) / 10,
    historyAdjustment: Math.round(historyAdjustment * 10) / 10,
    homeFieldAdjustment,
    notes,
  };
}

export function genesisStarterMessage(
  threadName: string,
  line: GenesisLineResult
) {
  return [
    `🏈 **${threadName}**`,
    "",
    "📈 **GENESIS LINE**",
    `**${line.displayLine}**`,
    `Projected: **${line.awayTeam} ${line.projectedAwayScore} – ${line.homeTeam} ${line.projectedHomeScore}**`,
    `Confidence: **${line.confidence} (${line.confidenceScore}%)**`,
    `History: ${line.historyGamesUsed} relevant league game${line.historyGamesUsed === 1 ? "" : "s"} used`,
  ].join("\n");
}
