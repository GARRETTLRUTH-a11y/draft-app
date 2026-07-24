import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { buildDiscordMessage } from "@/lib/discordMessages";
import { sendDiscordMessage } from "@/lib/discordSend";
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

  const result = await sendDiscordMessage(message);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
