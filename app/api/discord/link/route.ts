import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

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

  let body: { linkToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const linkToken = body.linkToken;
  if (!linkToken) {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 501 });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: tokenRow, error: tokenError } = await admin
    .from("discord_link_tokens")
    .select("discord_user_id, discord_username, expires_at")
    .eq("token", linkToken)
    .maybeSingle();

  if (tokenError || !tokenRow) {
    return NextResponse.json({ error: "That link is invalid or has already been used." }, { status: 400 });
  }

  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    await admin.from("discord_link_tokens").delete().eq("token", linkToken);
    return NextResponse.json(
      { error: "That link has expired. Run /link again in Discord." },
      { status: 400 }
    );
  }

  const { error: upsertError } = await admin.from("discord_links").upsert(
    {
      user_id: userData.user.id,
      discord_user_id: tokenRow.discord_user_id,
      discord_username: tokenRow.discord_username,
      linked_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (upsertError) {
    const message = upsertError.message.includes("discord_links_discord_user_id_key")
      ? "That Discord account is already linked to a different app account."
      : upsertError.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await admin.from("discord_link_tokens").delete().eq("token", linkToken);

  return NextResponse.json({ ok: true, discordUsername: tokenRow.discord_username });
}
