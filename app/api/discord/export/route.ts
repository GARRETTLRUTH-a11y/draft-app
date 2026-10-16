import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { PVP_PARENT_CHANNEL_ID } from "@/lib/discordPvpThreads";

export const runtime = "nodejs";
export const maxDuration = 60;

const DISCORD_API = "https://discord.com/api/v10";
const SNOWFLAKE = /^\d{17,20}$/;
const PAGE_SIZE = 100;

type DiscordAttachment = {
  id: string;
  filename: string;
  content_type?: string;
  url: string;
  proxy_url?: string;
  size?: number;
  width?: number | null;
  height?: number | null;
  description?: string | null;
};

type DiscordMessage = {
  id: string;
  channel_id: string;
  content?: string;
  timestamp: string;
  edited_timestamp?: string | null;
  type?: number;
  pinned?: boolean;
  author: {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
    bot?: boolean;
  };
  member?: { nick?: string | null };
  attachments?: DiscordAttachment[];
  embeds?: unknown[];
  sticker_items?: unknown[];
  message_reference?: { message_id?: string; channel_id?: string };
  reactions?: unknown[];
};

async function discordGet(path: string): Promise<Response> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error("Discord bot is not configured.");

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(DISCORD_API + path, {
      headers: { Authorization: "Bot " + botToken },
      cache: "no-store",
    });
    if (response.status !== 429 || attempt === 2) return response;
    const info = (await response.json()) as { retry_after?: number };
    const delay = Math.min(Math.max(info.retry_after ?? 1, 0.1) * 1000, 5000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error("Discord rate limit exceeded.");
}

async function getDiscordObject(path: string) {
  const response = await discordGet(path);
  if (!response.ok) {
    if (response.status === 403) throw new Error("RTA lacks View Channel or Read Message History for this channel.");
    if (response.status === 404) throw new Error("Discord channel was not found or RTA cannot access it.");
    throw new Error("Discord request failed (" + response.status + ").");
  }
  return response.json();
}

function errorResponse(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Could not export Discord history." },
    { status: 502, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: auth, error: authError } = await supabase.auth.getUser(bearer);
  if (authError || !auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const seasonId = params.get("seasonId")?.trim();
  if (!seasonId) return NextResponse.json({ error: "seasonId is required." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Server not configured." }, { status: 501 });

  const admin = createClient(url, key);
  const { data: season, error: seasonError } = await admin
    .from("seasons")
    .select("user_id")
    .eq("id", seasonId)
    .maybeSingle();

  if (seasonError || !season) return NextResponse.json({ error: "Season not found." }, { status: 404 });
  if (season.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Only the season commissioner can export Discord history." }, { status: 403 });
  }

  try {
    const parent = (await getDiscordObject("/channels/" + PVP_PARENT_CHANNEL_ID)) as { guild_id?: string };
    if (!parent.guild_id) throw new Error("RTA is not linked to a Discord server.");

    if (params.get("action") === "channels") {
      const channels = (await getDiscordObject("/guilds/" + parent.guild_id + "/channels")) as {
        id: string;
        name: string;
        type: number;
        parent_id?: string | null;
      }[];
      // Discord does not include existing threads here. The form also supports
      // manually entering a thread ID for exporting PvP discussions.
      return NextResponse.json(
        { channels: channels.filter((c) => c.type === 0 || c.type === 5).map((c) => ({
          id: c.id, name: c.name, parentId: c.parent_id ?? null,
        })).sort((a, b) => a.name.localeCompare(b.name)) },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const channelId = params.get("channelId")?.trim();
    if (!channelId || !SNOWFLAKE.test(channelId)) {
      return NextResponse.json({ error: "Enter a valid Discord channel or thread ID." }, { status: 400 });
    }

    const channel = (await getDiscordObject("/channels/" + channelId)) as {
      id: string;
      name?: string;
      guild_id?: string;
      type?: number;
    };
    if (channel.guild_id !== parent.guild_id) {
      return NextResponse.json({ error: "Channel must belong to the Genesis Discord server." }, { status: 403 });
    }
    if (![0, 5, 10, 11, 12].includes(channel.type ?? -1)) {
      return NextResponse.json(
        { error: "Choose a text channel or individual thread (not a forum parent channel)." },
        { status: 400 }
      );
    }

    const before = params.get("before")?.trim();
    if (before && !SNOWFLAKE.test(before)) {
      return NextResponse.json({ error: "Invalid pagination cursor." }, { status: 400 });
    }
    const requestedCount = Number(params.get("count") || "200");
    if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 200) {
      return NextResponse.json({ error: "count must be between 1 and 200." }, { status: 400 });
    }

    const messages: DiscordMessage[] = [];
    let cursor = before;
    let hasMore = true;

    while (messages.length < requestedCount) {
      const fetchCount = Math.min(PAGE_SIZE, requestedCount - messages.length);
      const query = "?limit=" + fetchCount + (cursor ? "&before=" + cursor : "");
      const batch = (await getDiscordObject("/channels/" + channelId + "/messages" + query)) as DiscordMessage[];
      messages.push(...batch);
      if (batch.length < fetchCount || batch.length === 0) {
        hasMore = false;
        break;
      }
      cursor = batch[batch.length - 1].id;
    }

    const normalized = messages.map((m) => ({
      id: m.id,
      channelId: m.channel_id,
      timestamp: m.timestamp,
      editedTimestamp: m.edited_timestamp ?? null,
      author: {
        id: m.author.id,
        username: m.author.username,
        displayName: m.member?.nick || m.author.global_name || m.author.username,
        avatar: m.author.avatar ?? null,
        bot: Boolean(m.author.bot),
      },
      content: m.content ?? "",
      attachments: (m.attachments || []).map((a) => ({
        id: a.id, filename: a.filename, contentType: a.content_type || null,
        url: a.url, proxyUrl: a.proxy_url || null, size: a.size ?? null,
        width: a.width ?? null, height: a.height ?? null, description: a.description ?? null,
      })),
      embeds: m.embeds || [],
      stickers: m.sticker_items || [],
      replyToMessageId: m.message_reference?.message_id ?? null,
      type: m.type ?? 0,
      pinned: Boolean(m.pinned),
      reactions: m.reactions || [],
    }));

    return NextResponse.json({
      channel: { id: channel.id, name: channel.name || channel.id },
      messages: normalized,
      nextBefore: messages.length ? messages[messages.length - 1].id : null,
      hasMore,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
