import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { PVP_PARENT_CHANNEL_ID } from "@/lib/discordPvpThreads";

export const runtime = "nodejs";
export const maxDuration = 60;

const DISCORD_API = "https://discord.com/api/v10";
const SNOWFLAKE = /^\d{17,20}$/;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

type DiscordAttachment = {
  id: string;
  url: string;
  filename: string;
  content_type?: string;
  size?: number;
};

type DiscordMessage = {
  id: string;
  attachments?: DiscordAttachment[];
};

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

async function discordGet(path: string): Promise<Response> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error("Discord bot is not configured.");

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(DISCORD_API + path, {
      headers: { Authorization: "Bot " + botToken },
      cache: "no-store",
    });
    if (response.status !== 429 || attempt === 2) return response;
    const rateLimit = (await response.json()) as { retry_after?: number };
    const delay = Math.min(Math.max(rateLimit.retry_after ?? 1, 0.1) * 1000, 5000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error("Discord rate limit exceeded.");
}

async function discordJson(path: string) {
  const response = await discordGet(path);
  if (!response.ok) {
    if (response.status === 403) throw new Error("RTA cannot read this Discord channel.");
    if (response.status === 404) throw new Error("Discord channel or message not found.");
    throw new Error("Discord API error " + response.status);
  }
  return response.json();
}

function validImageAttachment(a: DiscordAttachment): boolean {
  return (
    a.content_type?.toLowerCase().startsWith("image/") === true ||
    /\.(jpe?g|png|gif|webp|avif|heic|heif|apng|bmp)$/i.test(a.filename)
  );
}

function isDiscordAttachmentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "cdn.discordapp.com" || url.hostname === "media.discordapp.net") &&
      url.pathname.startsWith("/attachments/")
    );
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return jsonError("Unauthorized", 401);

  const { data: auth, error: authError } = await supabase.auth.getUser(bearer);
  if (authError || !auth.user) return jsonError("Unauthorized", 401);

  const params = new URL(request.url).searchParams;
  const seasonId = params.get("seasonId");
  const channelId = params.get("channelId");
  const messageId = params.get("messageId");
  const attachmentId = params.get("attachmentId");

  if (!seasonId || !channelId || !messageId || !attachmentId ||
      ![channelId, messageId, attachmentId].every((id) => SNOWFLAKE.test(id))) {
    return jsonError("Valid season, channel, message and attachment IDs are required.", 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return jsonError("Server not configured.", 501);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: season, error: seasonError } = await admin
    .from("seasons")
    .select("user_id")
    .eq("id", seasonId)
    .maybeSingle();
  if (seasonError || !season) return jsonError("Season not found.", 404);
  if (season.user_id !== auth.user.id) return jsonError("Commissioner only.", 403);

  try {
    const [parent, channel] = await Promise.all([
      discordJson("/channels/" + PVP_PARENT_CHANNEL_ID) as Promise<{ guild_id?: string }>,
      discordJson("/channels/" + channelId) as Promise<{ guild_id?: string; type?: number }>,
    ]);
    if (!parent.guild_id || channel.guild_id !== parent.guild_id) {
      return jsonError("Channel must be in the Genesis Discord server.", 403);
    }
    if (![0, 5, 10, 11, 12].includes(channel.type ?? -1)) {
      return jsonError("Choose a text channel or thread.", 400);
    }

    // The client cannot specify an arbitrary URL. Resolve the attachment from
    // Discord's live message response so we only proxy this channel's real images.
    const message = (await discordJson(
      "/channels/" + channelId + "/messages/" + messageId
    )) as DiscordMessage;
    const attachment = message.attachments?.find((a) => a.id === attachmentId);
    if (!attachment || !validImageAttachment(attachment)) {
      return jsonError("That image attachment is not available in the message.", 404);
    }

    if ((attachment.size ?? 0) > MAX_IMAGE_BYTES) {
      return jsonError("Image exceeds 25 MB download limit.", 413);
    }

    if (!isDiscordAttachmentUrl(attachment.url)) {
      return jsonError("Unsupported Discord attachment URL.", 400);
    }

    const response = await fetch(attachment.url, {
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      return jsonError("Discord image is unavailable (" + response.status + ").", 502);
    }

    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_IMAGE_BYTES) {
      await response.body?.cancel();
      return jsonError("Image exceeds 25 MB download limit.", 413);
    }

    // Cap streamed bytes as well as the advertised length to prevent a
    // pathological CDN response from exhausting server function memory.
    const reader = response.body?.getReader();
    if (!reader) return jsonError("Discord returned an empty image.", 502);
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_IMAGE_BYTES) {
          await reader.cancel();
          return jsonError("Image exceeds 25 MB download limit.", 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const contentType = response.headers.get("content-type") || attachment.content_type || "application/octet-stream";
    if (contentType.toLowerCase().includes("text/html")) {
      return jsonError("Discord returned a non-image response.", 502);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(total),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not fetch Discord image.", 502);
  }
}
