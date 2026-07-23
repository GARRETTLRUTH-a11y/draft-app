import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { buildDiscordMessage } from "@/lib/discordMessages";
import type { DiscordNotifyPayload } from "@/lib/discord";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "DISCORD_WEBHOOK_URL is not configured on the server." },
      { status: 501 }
    );
  }

  let payload: DiscordNotifyPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = buildDiscordMessage(payload);
  if (!message) {
    return NextResponse.json({ error: "Invalid notification payload." }, { status: 400 });
  }

  const discordResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (!discordResponse.ok) {
    const text = await discordResponse.text();
    return NextResponse.json(
      { error: text || "Discord webhook request failed." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
