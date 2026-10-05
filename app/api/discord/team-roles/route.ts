import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { listGenesisDiscordRoles } from "@/lib/discordPvpThreads";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const seasonId = url.searchParams.get("seasonId")?.trim();
  if (!seasonId) {
    return NextResponse.json({ error: "seasonId is required." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: season, error: seasonError } = await admin
    .from("seasons")
    .select("user_id")
    .eq("id", seasonId)
    .maybeSingle();

  if (seasonError || !season) {
    return NextResponse.json({ error: "Season not found." }, { status: 404 });
  }

  if (season.user_id !== userData.user.id) {
    return NextResponse.json(
      { error: "Only the season commissioner can view Discord team roles." },
      { status: 403 }
    );
  }

  try {
    const roles = await listGenesisDiscordRoles();
    return NextResponse.json({ roles });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load Discord roles.",
      },
      { status: 502 }
    );
  }
}
