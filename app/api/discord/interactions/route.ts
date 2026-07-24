import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { periodHeading, withPlayerMarkedReady, type SeasonData } from "@/lib/season";

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

type DiscordInteraction = {
  type: number;
  member?: { user?: { id?: string; username?: string } };
  user?: { id?: string; username?: string };
  data?: { name?: string; custom_id?: string };
};

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

  // Button click: custom_id "ready:<seasonId>"
  if (interaction.type === 3 && typeof interaction.data?.custom_id === "string") {
    const customId = interaction.data.custom_id;

    if (customId.startsWith("ready:")) {
      const seasonId = customId.slice("ready:".length);

      if (!discordUserId) return ephemeral("Couldn't identify your Discord account.");

      const { data: link } = await admin
        .from("discord_links")
        .select("user_id")
        .eq("discord_user_id", discordUserId)
        .maybeSingle();

      if (!link) {
        return ephemeral(
          "Your Discord account isn't linked yet. Run `/link` to connect it, then click the button again."
        );
      }

      const { data: participant } = await admin
        .from("season_participants")
        .select("player_name")
        .eq("season_id", seasonId)
        .eq("user_id", link.user_id)
        .maybeSingle();

      if (!participant) {
        return ephemeral("You haven't claimed a team in this season yet -- do that on the site first.");
      }

      const { data: seasonRow, error: seasonError } = await admin
        .from("seasons")
        .select("season_data")
        .eq("id", seasonId)
        .maybeSingle();

      if (seasonError || !seasonRow) {
        return ephemeral("Couldn't find that season.");
      }

      const seasonData = seasonRow.season_data as SeasonData;
      const player = seasonData.players.find(
        (p) => p.name.toLowerCase() === participant.player_name.toLowerCase()
      );

      if (!player) {
        return ephemeral("Couldn't match your claimed team to a player in this season.");
      }

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
  }

  return NextResponse.json({ error: "Unhandled interaction" }, { status: 400 });
}
