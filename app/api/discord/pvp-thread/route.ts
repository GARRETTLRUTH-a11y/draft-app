import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { createGenesisPvpThread } from "@/lib/discordPvpThreads";
import { buildGenesisLine, genesisStarterMessage } from "@/lib/genesisLines";
import type { SeasonData } from "@/lib/season";

type PvpThreadPayload = {
  seasonId?: string;
  threadName?: string;
  awayTeam?: string;
  homeTeam?: string;
  neutral?: boolean;
};

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

  let payload: PvpThreadPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const seasonId = payload.seasonId?.trim();
  const threadName = payload.threadName?.trim();

  if (!seasonId || !threadName) {
    return NextResponse.json({ error: "seasonId and threadName are required." }, { status: 400 });
  }

  if (threadName.length > 100) {
    return NextResponse.json({ error: "Thread name must be 100 characters or fewer." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: season, error: seasonError } = await admin
    .from("seasons")
    .select("user_id, season_data")
    .eq("id", seasonId)
    .maybeSingle();

  if (seasonError || !season) {
    return NextResponse.json({ error: "Season not found." }, { status: 404 });
  }

  if (season.user_id !== userData.user.id) {
    return NextResponse.json({ error: "Only the season commissioner can create PvP threads." }, { status: 403 });
  }

  try {
    const awayTeam = payload.awayTeam?.trim();
    const homeTeam = payload.homeTeam?.trim();
    const line =
      awayTeam && homeTeam
        ? buildGenesisLine(
            season.season_data as SeasonData,
            awayTeam,
            homeTeam,
            Boolean(payload.neutral)
          )
        : undefined;

    const result = await createGenesisPvpThread(
      threadName,
      line ? genesisStarterMessage(threadName, line) : undefined
    );

    return NextResponse.json({
      ok: true,
      threadId: result.thread.id,
      threadName: result.thread.name || threadName,
      added: result.added,
      total: result.total,
      failed: result.failed,
      failedMembers: result.failedMembers,
      reportedRoleCount: result.reportedRoleCount,
      line,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Discord error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
