import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

function normalizeTeam(value: string) {
  return value.trim().toLowerCase();
}

async function resolveMatchupDiscordUserIds(
  admin: SupabaseClient,
  seasonId: string,
  seasonData: SeasonData,
  awayTeam?: string,
  homeTeam?: string
) {
  if (!awayTeam || !homeTeam) return [] as string[];

  const selectedTeams = new Set([
    normalizeTeam(awayTeam),
    normalizeTeam(homeTeam),
  ]);

  const playerNames = seasonData.players
    .filter((player) => player.team && selectedTeams.has(normalizeTeam(player.team)))
    .map((player) => player.name);

  if (!playerNames.length) return [] as string[];

  const { data: participants } = await admin
    .from("season_participants")
    .select("user_id, player_name")
    .eq("season_id", seasonId)
    .in("player_name", playerNames);

  const userIds = [...new Set((participants || []).map((row) => row.user_id).filter(Boolean))];
  if (!userIds.length) return [] as string[];

  const { data: links } = await admin
    .from("discord_links")
    .select("user_id, discord_user_id")
    .in("user_id", userIds);

  return [...new Set((links || []).map((row) => row.discord_user_id).filter(Boolean))] as string[];
}

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

    const matchupDiscordUserIds = await resolveMatchupDiscordUserIds(
      admin,
      seasonId,
      season.season_data as SeasonData,
      awayTeam,
      homeTeam
    );

    const result = await createGenesisPvpThread(
      threadName,
      line ? genesisStarterMessage(threadName, line) : undefined,
      matchupDiscordUserIds
    );

    return NextResponse.json({
      ok: true,
      threadId: result.thread.id,
      threadName: result.thread.name || threadName,
      genesisRoleTagged: result.genesisRoleTagged,
      taggedPlayers: result.taggedUserIds.length,
      line,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Discord error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
