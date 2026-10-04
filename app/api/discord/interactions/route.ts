import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  periodHeading,
  withPlayerMarkedReady,
  type ExtensionRequest,
  type SeasonData,
  type SeasonPlayer,
} from "@/lib/season";
import { buildDiscordMessage } from "@/lib/discordMessages";
import { sendDiscordMessage } from "@/lib/discordSend";
import { createGenesisPvpThread, PVP_PARENT_CHANNEL_ID } from "@/lib/discordPvpThreads";

// Standard 12-byte ASN.1 SPKI prefix for raw Ed25519 public keys -- wraps
// Discord's raw 32-byte hex public key into a format Node's crypto module
// can import, without pulling in an extra dependency just for this.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const PERMISSION_ADMINISTRATOR = BigInt("8");
const PERMISSION_MANAGE_THREADS = BigInt("17179869184");

function hasThreadManagementPermission(permissions: string | undefined) {
  if (!permissions) return false;
  try {
    const value = BigInt(permissions);
    return Boolean(value & PERMISSION_ADMINISTRATOR) || Boolean(value & PERMISSION_MANAGE_THREADS);
  } catch {
    return false;
  }
}
function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  rawBody: string
): boolean {
  try {
    const publicKeyDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]);
    const publicKey = crypto.createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
    const signature = Buffer.from(signatureHex, "hex");
    const message = Buffer.from(timestamp + rawBody, "utf8");
    return crypto.verify(null, message, publicKey, signature);
  } catch {
    return false;
  }
}

function ephemeral(content: string) {
  return NextResponse.json({ type: 4, data: { content, flags: 64 } });
}

const LINK_BUTTON_ROW = {
  type: 1,
  components: [
    { type: 2, style: 1, label: "🔗 Link Discord Account", custom_id: "link_account" },
  ],
};

// Same as ephemeral(), but with the Link button attached so someone who
// isn't linked yet can fix that in one click instead of having to type
// /link separately.
function ephemeralNeedsLink(content: string) {
  return NextResponse.json({
    type: 4,
    data: { content, flags: 64, components: [LINK_BUTTON_ROW] },
  });
}

function randomToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

async function createLinkToken(
  admin: SupabaseClient,
  discordUserId: string | undefined,
  discordUsername: string | undefined
) {
  if (!discordUserId) return ephemeral("Couldn't identify your Discord account. Try again.");

  const token = randomToken();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error } = await admin.from("discord_link_tokens").insert({
    token,
    discord_user_id: discordUserId,
    discord_username: discordUsername,
    expires_at: expiresAt,
  });

  if (error) {
    return ephemeral("Something went wrong generating your link. Try again in a moment.");
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://cfb-draft.vercel.app";
  return ephemeral(
    `Click this link while signed into the site to connect your Discord account (expires in 10 minutes):\n${siteUrl}/link-discord?token=${token}`
  );
}

// Accepts YYYY-MM-DD or M/D/YYYY (with or without leading zeros) and
// normalizes to YYYY-MM-DD, matching what the site's date input produces.
function parseModalDate(raw: string): string | null {
  const trimmed = raw.trim();

  let match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return null;
}

type DiscordInteraction = {
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: {
    user?: { id?: string; username?: string; global_name?: string | null };
    permissions?: string;
    nick?: string | null;
  };
  user?: { id?: string; username?: string; global_name?: string | null };
  data?: {
    name?: string;
    custom_id?: string;
    options?: { name?: string; type?: number; value?: string | number | boolean }[];
    components?: { components?: { custom_id?: string; value?: string }[] }[];
  };
};

type ResolvedPlayer = { seasonId: string; seasonData: SeasonData; player: SeasonPlayer };
type ResolveError = { error: string; needsLink?: boolean };

async function resolvePlayer(
  admin: SupabaseClient,
  discordUserId: string,
  seasonId: string
): Promise<ResolvedPlayer | ResolveError> {
  const { data: link } = await admin
    .from("discord_links")
    .select("user_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (!link) {
    return {
      error: "Your Discord account isn't linked yet. Click the button below to connect it, then try again.",
      needsLink: true,
    };
  }

  const { data: participant } = await admin
    .from("season_participants")
    .select("player_name")
    .eq("season_id", seasonId)
    .eq("user_id", link.user_id)
    .maybeSingle();

  if (!participant) {
    return { error: "You haven't claimed a team in this season yet -- do that on the site first." };
  }

  const { data: seasonRow, error: seasonError } = await admin
    .from("seasons")
    .select("season_data")
    .eq("id", seasonId)
    .maybeSingle();

  if (seasonError || !seasonRow) {
    return { error: "Couldn't find that season." };
  }

  const seasonData = seasonRow.season_data as SeasonData;
  const player = seasonData.players.find(
    (p) => p.name.toLowerCase() === participant.player_name.toLowerCase()
  );

  if (!player) {
    return { error: "Couldn't match your claimed team to a player in this season." };
  }

  return { seasonId, seasonData, player };
}

// Used by commands that aren't tied to a specific message/button (like
// /rta), so there's no seasonId to read from a custom_id. Instead, finds
// every season this Discord account's linked player has claimed a team in
// and uses whichever one was updated most recently -- in practice this app
// is run as one channel per active league, so that's the season currently
// being checked into.
async function resolveActiveSeasonForUser(
  admin: SupabaseClient,
  discordUserId: string
): Promise<ResolvedPlayer | ResolveError> {
  const { data: link } = await admin
    .from("discord_links")
    .select("user_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (!link) {
    return {
      error: "Your Discord account isn't linked yet. Click the button below to connect it, then try again.",
      needsLink: true,
    };
  }

  const { data: participants } = await admin
    .from("season_participants")
    .select("season_id, player_name")
    .eq("user_id", link.user_id);

  if (!participants || participants.length === 0) {
    return { error: "You haven't claimed a team in any season yet -- do that on the site first." };
  }

  const { data: seasonRows, error: seasonError } = await admin
    .from("seasons")
    .select("id, season_data")
    .in(
      "id",
      participants.map((p) => p.season_id)
    )
    .order("updated_at", { ascending: false })
    .limit(1);

  const seasonRow = seasonRows?.[0];
  if (seasonError || !seasonRow) {
    return { error: "Couldn't find your season." };
  }

  const participant = participants.find((p) => p.season_id === seasonRow.id);
  const seasonData = seasonRow.season_data as SeasonData;
  const player = seasonData.players.find(
    (p) => p.name.toLowerCase() === participant?.player_name.toLowerCase()
  );

  if (!player) {
    return { error: "Couldn't match your claimed team to a player in this season." };
  }

  return { seasonId: seasonRow.id, seasonData, player };
}

async function resolveGenesisMatchupForUserInThread(
  admin: SupabaseClient,
  discordUserId: string,
  threadId: string
): Promise<
  | {
      seasonId: string;
      seasonData: SeasonData;
      player: SeasonPlayer;
      matchup: NonNullable<SeasonData["genesisPicks"]>["matchups"][number];
    }
  | ResolveError
> {
  const { data: link } = await admin
    .from("discord_links")
    .select("user_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (!link) {
    return {
      error: "Your Discord account isn't linked yet. Click the button below to connect it, then try again.",
      needsLink: true,
    };
  }

  const { data: participants } = await admin
    .from("season_participants")
    .select("season_id, player_name")
    .eq("user_id", link.user_id);

  if (!participants?.length) {
    return { error: "You haven't claimed a team in a Genesis season yet." };
  }

  const { data: seasons, error: seasonError } = await admin
    .from("seasons")
    .select("id, season_data")
    .in(
      "id",
      participants.map((participant) => participant.season_id)
    );

  if (seasonError || !seasons?.length) {
    return { error: "Couldn't find your Genesis season." };
  }

  for (const row of seasons) {
    const seasonData = row.season_data as SeasonData;
    const matchup = seasonData.genesisPicks?.matchups.find(
      (item) => item.threadId === threadId
    );
    if (!matchup) continue;

    const participant = participants.find(
      (item) => item.season_id === row.id
    );
    const player = seasonData.players.find(
      (item) =>
        item.name.toLowerCase() === participant?.player_name.toLowerCase()
    );
    if (!player) continue;

    const playerTeam = normalizeGenesisTeam(player.team);
    const isMatchupPlayer =
      playerTeam === normalizeGenesisTeam(matchup.awayTeam) ||
      playerTeam === normalizeGenesisTeam(matchup.homeTeam);

    if (!isMatchupPlayer) {
      return {
        error:
          "Only one of the two players in this matchup can post the game stream and start it.",
      };
    }

    return {
      seasonId: row.id,
      seasonData,
      player,
      matchup,
    };
  }

  return {
    error:
      "Use /stream inside your Genesis PvP game thread. I couldn't match this channel to one of your active matchups.",
  };
}

function respondToResolveError(resolved: ResolveError) {
  return resolved.needsLink ? ephemeralNeedsLink(resolved.error) : ephemeral(resolved.error);
}

// Shared by the "I'm Ready" button and the /rta slash command.
async function markPlayerReady(
  admin: SupabaseClient,
  seasonId: string,
  seasonData: SeasonData,
  player: SeasonPlayer
) {
  const week = seasonData.currentWeek;
  const alreadyReady = (seasonData.readyPlayerIdsByWeek[week] ?? []).includes(player.id);

  if (alreadyReady) {
    return ephemeral(
      `You're already marked ready for ${periodHeading(seasonData.periodLabel, week, seasonData.seasonYear)}.`
    );
  }

  const nextSeasonData = withPlayerMarkedReady(seasonData, player.id, week);

  const { error: updateError } = await admin
    .from("seasons")
    .update({ season_data: nextSeasonData, updated_at: new Date().toISOString() })
    .eq("id", seasonId);

  if (updateError) {
    return ephemeral("Something went wrong saving your ready status. Try again.");
  }

  return ephemeral(
    `✅ You're marked ready to advance for ${periodHeading(nextSeasonData.periodLabel, week, nextSeasonData.seasonYear)}.`
  );
}

async function postGenesisPickAnnouncement(
  threadId: string,
  discordUserId: string,
  team: string,
  signedLine: number
) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return false;

  const lineText =
    signedLine === 0
      ? "PK"
      : `${signedLine > 0 ? "+" : ""}${signedLine.toFixed(1)}`;

  const response = await fetch(
    `https://discord.com/api/v10/channels/${threadId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: `🎯 <@${discordUserId}> picked **${team} ${lineText}**`,
        allowed_mentions: { users: [discordUserId], parse: [] },
      }),
    }
  );

  return response.ok;
}

function normalizeGenesisTeam(value: string | undefined) {
  return (value || "").trim().toLowerCase();
}

function validGenesisStreamUrl(raw: string) {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const allowed =
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be" ||
      host === "twitch.tv" ||
      host.endsWith(".twitch.tv");

    return allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

async function postGenesisStreamStartAnnouncement(input: {
  threadId: string;
  discordUserId: string;
  streamUrl: string;
  pickCount: number;
}) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return false;

  const response = await fetch(
    `https://discord.com/api/v10/channels/${input.threadId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: [
          `📺 <@${input.discordUserId}> posted the game stream: ${input.streamUrl}`,
          "🔒 **GENESIS PICKS CLOSED — GAME STARTED**",
          `**${input.pickCount}** pick${input.pickCount === 1 ? "" : "s"} locked in. No additional picks will be accepted.`,
        ].join("\n"),
        allowed_mentions: { users: [input.discordUserId], parse: [] },
      }),
    }
  );

  return response.ok;
}

export async function POST(request: Request) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json({ error: "DISCORD_PUBLIC_KEY not configured" }, { status: 501 });
  }

  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const rawBody = await request.text();

  if (!signature || !timestamp || !verifyDiscordSignature(publicKey, signature, timestamp, rawBody)) {
    return NextResponse.json({ error: "Invalid request signature" }, { status: 401 });
  }

  const interaction: DiscordInteraction = JSON.parse(rawBody);

  // Discord PINGs this endpoint to verify it before letting it be saved
  // as the Interactions Endpoint URL in the Developer Portal.
  if (interaction.type === 1) {
    return NextResponse.json({ type: 1 });
  }

  const discordUser = interaction.member?.user ?? interaction.user;
  const discordUserId = discordUser?.id;
  const discordUsername = discordUser?.username;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 501 });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Slash command: /link
  if (interaction.type === 2 && interaction.data?.name === "link") {
    return createLinkToken(admin, discordUserId, discordUsername);
  }

  // Slash command: /rta -- same effect as clicking "I'm Ready", but doesn't
  // require the message with the button to still be visible/scrolled to.
  if (interaction.type === 2 && interaction.data?.name === "rta") {
    if (!discordUserId) return ephemeral("Couldn't identify your Discord account.");

    const resolved = await resolveActiveSeasonForUser(admin, discordUserId);
    if ("error" in resolved) return respondToResolveError(resolved);

    return markPlayerReady(admin, resolved.seasonId, resolved.seasonData, resolved.player);
  }

  // Slash command: /stream <YouTube/Twitch URL>
  // Must be run by one of the two matchup players inside that game's thread.
  if (interaction.type === 2 && interaction.data?.name === "stream") {
    if (!discordUserId) {
      return ephemeral("Couldn't identify your Discord account.");
    }
    if (!interaction.channel_id) {
      return ephemeral("Use /stream inside the Genesis PvP game thread.");
    }

    const rawLink = interaction.data.options?.find(
      (option) => option.name === "link"
    )?.value;
    const streamUrl =
      typeof rawLink === "string" ? validGenesisStreamUrl(rawLink) : null;

    if (!streamUrl) {
      return ephemeral("Use a valid YouTube or Twitch stream link.");
    }

    const resolved = await resolveGenesisMatchupForUserInThread(
      admin,
      discordUserId,
      interaction.channel_id
    );
    if ("error" in resolved) return respondToResolveError(resolved);

    const { seasonId, seasonData, matchup } = resolved;
    const picksState = seasonData.genesisPicks;
    if (!picksState) {
      return ephemeral("That Genesis matchup could not be found.");
    }

    if (matchup.status === "locked") {
      return ephemeral("🔒 Genesis picks are already closed for this game.");
    }
    if (matchup.status === "settled") {
      return ephemeral("This Genesis matchup is already final.");
    }

    const lockedAt = new Date().toISOString();
    const nextMatchups = picksState.matchups.map((item) =>
      item.id === matchup.id
        ? {
            ...item,
            status: "locked" as const,
            lockedAt,
          }
        : item
    );

    const nextSeasonData: SeasonData = {
      ...seasonData,
      genesisPicks: {
        ...picksState,
        matchups: nextMatchups,
      },
    };

    const { error: updateError } = await admin
      .from("seasons")
      .update({
        season_data: nextSeasonData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", seasonId);

    if (updateError) {
      return ephemeral("Couldn't lock Genesis picks. Try again.");
    }

    const pickCount = Object.keys(matchup.picks || {}).length;
    await postGenesisStreamStartAnnouncement({
      threadId: matchup.threadId,
      discordUserId,
      streamUrl,
      pickCount,
    });

    return ephemeral(
      `📺 Stream posted. 🔒 Genesis picks are now closed with ${pickCount} pick${pickCount === 1 ? "" : "s"} locked in.`
    );
  }

  // Button click
  if (interaction.type === 3 && typeof interaction.data?.custom_id === "string") {
    const customId = interaction.data.custom_id;

    if (customId === "link_account") {
      return createLinkToken(admin, discordUserId, discordUsername);
    }

    if (customId.startsWith("genesis_stream:")) {
      if (!discordUserId) {
        return ephemeral("Couldn't identify your Discord account.");
      }

      const parts = customId.split(":");
      const seasonId = parts[1];
      const matchupId = parts[2];
      if (!seasonId || !matchupId) {
        return ephemeral("That Genesis stream button is invalid.");
      }

      const resolved = await resolvePlayer(admin, discordUserId, seasonId);
      if ("error" in resolved) return respondToResolveError(resolved);

      const matchup = resolved.seasonData.genesisPicks?.matchups.find(
        (item) => item.id === matchupId
      );
      if (!matchup) {
        return ephemeral("That Genesis matchup could not be found.");
      }

      const playerTeam = normalizeGenesisTeam(resolved.player.team);
      const isMatchupPlayer =
        playerTeam === normalizeGenesisTeam(matchup.awayTeam) ||
        playerTeam === normalizeGenesisTeam(matchup.homeTeam);

      if (!isMatchupPlayer) {
        return ephemeral("Only one of the two players in this matchup can post the game stream and start it.");
      }

      if (matchup.status === "locked") {
        return ephemeral("🔒 Genesis picks are already closed for this game.");
      }
      if (matchup.status === "settled") {
        return ephemeral("This Genesis matchup is already final.");
      }

      return NextResponse.json({
        type: 9,
        data: {
          custom_id: `genesis_stream_modal:${seasonId}:${matchupId}`,
          title: "Post Stream & Start Game",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: "stream_url",
                  label: "YouTube or Twitch stream URL",
                  style: 1,
                  required: true,
                  min_length: 8,
                  max_length: 400,
                  placeholder: "https://youtube.com/... or https://twitch.tv/...",
                },
              ],
            },
          ],
        },
      });
    }

    if (customId.startsWith("genesis_pick:")) {
      if (!discordUserId) {
        return ephemeral("Couldn't identify your Discord account.");
      }

      const parts = customId.split(":");
      const seasonId = parts[1];
      const matchupId = parts[2];
      const rawSide = parts[3];

      if (
        !seasonId ||
        !matchupId ||
        (rawSide !== "away" && rawSide !== "home")
      ) {
        return ephemeral("That Genesis pick button is invalid.");
      }

      const side: "away" | "home" = rawSide;

      const { data: seasonRow, error: seasonError } = await admin
        .from("seasons")
        .select("season_data")
        .eq("id", seasonId)
        .maybeSingle();

      if (seasonError || !seasonRow) {
        return ephemeral("Couldn't find that Genesis season.");
      }

      const seasonData = seasonRow.season_data as SeasonData;
      const picksState = seasonData.genesisPicks;
      const matchup = picksState?.matchups.find((item) => item.id === matchupId);

      if (!picksState || !matchup) {
        return ephemeral("That Genesis matchup could not be found.");
      }

      if (matchup.status === "locked") {
        return ephemeral("🔒 Picks are closed because this game has started.");
      }
      if (matchup.status === "settled") {
        return ephemeral("Picks are closed because this matchup is already final.");
      }

      const previous = matchup.picks[discordUserId];
      if (previous) {
        const previousTeam =
          previous.side === "away" ? matchup.awayTeam : matchup.homeTeam;
        const previousLine =
          previous.side === "away" ? matchup.awayLine : -matchup.awayLine;
        const previousLineText =
          previousLine === 0
            ? "PK"
            : `${previousLine > 0 ? "+" : ""}${previousLine.toFixed(1)}`;

        return ephemeral(
          `🔒 Your Genesis pick is already locked: **${previousTeam} ${previousLineText}**.`
        );
      }

      const nextMatchups = picksState.matchups.map((item) =>
        item.id === matchupId
          ? {
              ...item,
              picks: {
                ...item.picks,
                [discordUserId]: {
                  discordUserId,
                  discordUsername: discordUsername || "Discord user",
                  side,
                  pickedAt: new Date().toISOString(),
                },
              },
            }
          : item
      );

      const nextSeasonData: SeasonData = {
        ...seasonData,
        genesisPicks: {
          ...picksState,
          matchups: nextMatchups,
        },
      };

      const { error: updateError } = await admin
        .from("seasons")
        .update({
          season_data: nextSeasonData,
          updated_at: new Date().toISOString(),
        })
        .eq("id", seasonId);

      if (updateError) {
        return ephemeral("Couldn't save your Genesis pick. Try again.");
      }

      const team = side === "away" ? matchup.awayTeam : matchup.homeTeam;
      const signedLine = side === "away" ? matchup.awayLine : -matchup.awayLine;
      const lineText =
        signedLine === 0
          ? "PK"
          : `${signedLine > 0 ? "+" : ""}${signedLine.toFixed(1)}`;
      await postGenesisPickAnnouncement(
        matchup.threadId,
        discordUserId,
        team,
        signedLine
      );

      return ephemeral(
        `🔒 Pick locked: **${team} ${lineText}**. This selection cannot be changed.`
      );
    }

    if (customId === "create_pvp_thread") {
      if (!interaction.guild_id) {
        return ephemeral("PvP threads can only be created inside the server.");
      }
      if (!hasThreadManagementPermission(interaction.member?.permissions)) {
        return ephemeral("Only a commissioner/moderator with Manage Threads can create a PvP thread.");
      }

      return NextResponse.json({
        type: 9,
        data: {
          custom_id: "create_pvp_thread_modal",
          title: "Create PvP Game Thread",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: "thread_name",
                  label: "Game thread name",
                  style: 1,
                  required: true,
                  min_length: 1,
                  max_length: 100,
                  placeholder: "Colorado @ Houston (Week 11, 2027)",
                },
              ],
            },
          ],
        },
      });
    }

    if (customId.startsWith("ready:")) {
      const seasonId = customId.slice("ready:".length);
      if (!discordUserId) return ephemeral("Couldn't identify your Discord account.");

      const resolved = await resolvePlayer(admin, discordUserId, seasonId);
      if ("error" in resolved) return respondToResolveError(resolved);

      return markPlayerReady(admin, resolved.seasonId, resolved.seasonData, resolved.player);
    }

    if (customId.startsWith("extend:")) {
      const seasonId = customId.slice("extend:".length);
      if (!discordUserId) return ephemeral("Couldn't identify your Discord account.");

      // Validate before showing the form, so a not-yet-linked person gets a
      // clear error instead of an empty modal that can't actually submit.
      const resolved = await resolvePlayer(admin, discordUserId, seasonId);
      if ("error" in resolved) return respondToResolveError(resolved);

      return NextResponse.json({
        type: 9, // MODAL
        data: {
          custom_id: `extend_modal:${seasonId}`,
          title: "Request an Extension",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4, // TEXT_INPUT
                  custom_id: "date",
                  label: "Date needed until (MM/DD/YYYY)",
                  style: 1, // SHORT
                  required: true,
                  placeholder: "7/28/2026",
                },
              ],
            },
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: "reason",
                  label: "Reason (optional)",
                  style: 2, // PARAGRAPH
                  required: false,
                  placeholder: "Traveling this week...",
                },
              ],
            },
          ],
        },
      });
    }
  }

  // Modal submit: the "Request an Extension" form
  if (interaction.type === 5 && typeof interaction.data?.custom_id === "string") {
    const customId = interaction.data.custom_id;

    if (customId.startsWith("genesis_stream_modal:")) {
      if (!discordUserId) {
        return ephemeral("Couldn't identify your Discord account.");
      }

      const parts = customId.split(":");
      const seasonId = parts[1];
      const matchupId = parts[2];
      if (!seasonId || !matchupId) {
        return ephemeral("That Genesis stream form is invalid.");
      }

      const values = new Map<string, string>();
      for (const row of interaction.data.components ?? []) {
        for (const field of row.components ?? []) {
          if (field.custom_id && typeof field.value === "string") {
            values.set(field.custom_id, field.value);
          }
        }
      }

      const streamUrl = validGenesisStreamUrl(values.get("stream_url") ?? "");
      if (!streamUrl) {
        return ephemeral("Use a valid YouTube or Twitch stream link.");
      }

      const resolved = await resolvePlayer(admin, discordUserId, seasonId);
      if ("error" in resolved) return respondToResolveError(resolved);

      const picksState = resolved.seasonData.genesisPicks;
      const matchup = picksState?.matchups.find((item) => item.id === matchupId);
      if (!picksState || !matchup) {
        return ephemeral("That Genesis matchup could not be found.");
      }

      const playerTeam = normalizeGenesisTeam(resolved.player.team);
      const isMatchupPlayer =
        playerTeam === normalizeGenesisTeam(matchup.awayTeam) ||
        playerTeam === normalizeGenesisTeam(matchup.homeTeam);

      if (!isMatchupPlayer) {
        return ephemeral("Only one of the two players in this matchup can post the game stream and start it.");
      }

      if (matchup.status === "locked") {
        return ephemeral("🔒 Genesis picks are already closed for this game.");
      }
      if (matchup.status === "settled") {
        return ephemeral("This Genesis matchup is already final.");
      }

      const lockedAt = new Date().toISOString();
      const nextMatchups = picksState.matchups.map((item) =>
        item.id === matchupId
          ? {
              ...item,
              status: "locked" as const,
              lockedAt,
            }
          : item
      );

      const nextSeasonData: SeasonData = {
        ...resolved.seasonData,
        genesisPicks: {
          ...picksState,
          matchups: nextMatchups,
        },
      };

      const { error: updateError } = await admin
        .from("seasons")
        .update({
          season_data: nextSeasonData,
          updated_at: new Date().toISOString(),
        })
        .eq("id", seasonId);

      if (updateError) {
        return ephemeral("Couldn't lock Genesis picks. Try again.");
      }

      const pickCount = Object.keys(matchup.picks || {}).length;
      await postGenesisStreamStartAnnouncement({
        threadId: matchup.threadId,
        discordUserId,
        streamUrl,
        pickCount,
      });

      return ephemeral(
        `📺 Stream posted. 🔒 Genesis picks are now closed with ${pickCount} pick${pickCount === 1 ? "" : "s"} locked in.`
      );
    }

    if (customId === "create_pvp_thread_modal") {
      if (!interaction.guild_id) {
        return ephemeral("PvP threads can only be created inside the server.");
      }
      if (!hasThreadManagementPermission(interaction.member?.permissions)) {
        return ephemeral("Only a commissioner/moderator with Manage Threads can create a PvP thread.");
      }

      const values = new Map<string, string>();
      for (const row of interaction.data.components ?? []) {
        for (const field of row.components ?? []) {
          if (field.custom_id && typeof field.value === "string") {
            values.set(field.custom_id, field.value);
          }
        }
      }

      const threadName = (values.get("thread_name") ?? "").trim();
      if (!threadName) return ephemeral("Give the PvP thread a name.");

      try {
        const result = await createGenesisPvpThread(threadName);
        return ephemeral(
          "✅ Created <#" +
            result.thread.id +
            "> under <#" +
            PVP_PARENT_CHANNEL_ID +
            ">. Tagged @genesis without individually adding every member."
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Discord error.";
        return ephemeral("Couldn't create the PvP thread: " + message);
      }
    }

    if (customId.startsWith("extend_modal:")) {
      const seasonId = customId.slice("extend_modal:".length);
      if (!discordUserId) return ephemeral("Couldn't identify your Discord account.");

      const values = new Map<string, string>();
      for (const row of interaction.data.components ?? []) {
        for (const field of row.components ?? []) {
          if (field.custom_id && typeof field.value === "string") {
            values.set(field.custom_id, field.value);
          }
        }
      }

      const rawDate = values.get("date") ?? "";
      const requestedUntilDate = parseModalDate(rawDate);

      if (!requestedUntilDate) {
        return ephemeral(
          `Couldn't understand "${rawDate}" as a date. Click the button again and use MM/DD/YYYY (e.g. 7/28/2026).`
        );
      }

      const resolved = await resolvePlayer(admin, discordUserId, seasonId);
      if ("error" in resolved) return respondToResolveError(resolved);

      const { seasonData, player } = resolved;
      const week = seasonData.currentWeek;

      const existing = seasonData.extensionRequests.find(
        (request) =>
          request.playerId === player.id &&
          request.week === week &&
          (request.status === "pending" || request.status === "granted")
      );

      if (existing) {
        return ephemeral(
          existing.status === "granted"
            ? "You already have a granted extension for this week."
            : "You already have a pending extension request for this week."
        );
      }

      const reason = (values.get("reason") ?? "").trim() || undefined;

      const request: ExtensionRequest = {
        id: crypto.randomUUID(),
        playerId: player.id,
        week,
        requestedUntilDate,
        reason,
        status: "pending",
        requestedAt: new Date().toISOString(),
      };

      const nextSeasonData: SeasonData = {
        ...seasonData,
        extensionRequests: [...seasonData.extensionRequests, request],
      };

      const { error: updateError } = await admin
        .from("seasons")
        .update({ season_data: nextSeasonData, updated_at: new Date().toISOString() })
        .eq("id", seasonId);

      if (updateError) {
        return ephemeral("Something went wrong saving your extension request. Try again.");
      }

      // The modal reply above is ephemeral (only the requester sees it) --
      // this is the public @everyone alert, same as the website's "Request
      // Extension" button posts.
      const publicMessage = buildDiscordMessage({
        type: "extension_requested",
        seasonTitle: seasonData.seasonTitle,
        week,
        playerName: player.name,
        team: player.team,
        requestedUntilDate,
        reason,
      });
      if (publicMessage) {
        await sendDiscordMessage(publicMessage);
      }

      return ephemeral(
        `🕒 Extension requested until ${requestedUntilDate} for ${periodHeading(seasonData.periodLabel, week, seasonData.seasonYear)}. The commissioner will review it.`
      );
    }
  }

  return NextResponse.json({ error: "Unhandled interaction" }, { status: 400 });
}
