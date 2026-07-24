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

// Standard 12-byte ASN.1 SPKI prefix for raw Ed25519 public keys -- wraps
// Discord's raw 32-byte hex public key into a format Node's crypto module
// can import, without pulling in an extra dependency just for this.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

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

function randomToken(): string {
  return crypto.randomBytes(24).toString("hex");
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
  member?: { user?: { id?: string; username?: string } };
  user?: { id?: string; username?: string };
  data?: {
    name?: string;
    custom_id?: string;
    components?: { components?: { custom_id?: string; value?: string }[] }[];
  };
};

type ResolvedPlayer = { seasonData: SeasonData; player: SeasonPlayer };

async function resolvePlayer(
  admin: SupabaseClient,
  discordUserId: string,
  seasonId: string
): Promise<ResolvedPlayer | { error: string }> {
  const { data: link } = await admin
    .from("discord_links")
    .select("user_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (!link) {
    return { error: "Your Discord account isn't linked yet. Run `/link` to connect it, then try again." };
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

  return { seasonData, player };
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

  // Button click
  if (interaction.type === 3 && typeof interaction.data?.custom_id === "string") {
    const customId = interaction.data.custom_id;

    if (customId.startsWith("ready:")) {
      const seasonId = customId.slice("ready:".length);
      if (!discordUserId) return ephemeral("Couldn't identify your Discord account.");

      const resolved = await resolvePlayer(admin, discordUserId, seasonId);
      if ("error" in resolved) return ephemeral(resolved.error);

      const { seasonData, player } = resolved;
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

    if (customId.startsWith("extend:")) {
      const seasonId = customId.slice("extend:".length);
      if (!discordUserId) return ephemeral("Couldn't identify your Discord account.");

      // Validate before showing the form, so a not-yet-linked person gets a
      // clear error instead of an empty modal that can't actually submit.
      const resolved = await resolvePlayer(admin, discordUserId, seasonId);
      if ("error" in resolved) return ephemeral(resolved.error);

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
      if ("error" in resolved) return ephemeral(resolved.error);

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

      return ephemeral(
        `🕒 Extension requested until ${requestedUntilDate} for ${periodHeading(seasonData.periodLabel, week, seasonData.seasonYear)}. The commissioner will review it.`
      );
    }
  }

  return NextResponse.json({ error: "Unhandled interaction" }, { status: 400 });
}
