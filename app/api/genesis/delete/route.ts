import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { deleteGenesisPvpThread } from "@/lib/discordPvpThreads";
import { syncGenesisLeaderboard } from "@/lib/genesisPicks";
import type { SeasonData } from "@/lib/season";

type Payload = {
  seasonId?: string;
  matchupId?: string;
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

  let payload: Payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const seasonId = payload.seasonId?.trim();
  const matchupId = payload.matchupId?.trim();

  if (!seasonId || !matchupId) {
    return NextResponse.json(
      { error: "seasonId and matchupId are required." },
      { status: 400 }
    );
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
    return NextResponse.json(
      { error: "Only the season commissioner can delete Genesis matchups." },
      { status: 403 }
    );
  }

  const seasonData = season.season_data as SeasonData;
  const picksState = seasonData.genesisPicks;
  const matchup = picksState?.matchups.find((item) => item.id === matchupId);

  if (!picksState || !matchup) {
    return NextResponse.json(
      { error: "Genesis matchup not found." },
      { status: 404 }
    );
  }

  if (matchup.status === "settled" || matchup.status === "voided") {
    return NextResponse.json(
      { error: "Only active Genesis matchups can be deleted and remade." },
      { status: 409 }
    );
  }

  try {
    await deleteGenesisPvpThread(matchup.threadId);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not delete the Discord game thread.",
      },
      { status: 502 }
    );
  }

  let nextSeasonData: SeasonData = {
    ...seasonData,
    genesisPicks: {
      ...picksState,
      matchups: picksState.matchups.filter((item) => item.id !== matchupId),
    },
  };

  const leaderboard = await syncGenesisLeaderboard(nextSeasonData);
  nextSeasonData = leaderboard.seasonData;

  const { error: updateError } = await admin
    .from("seasons")
    .update({
      season_data: nextSeasonData,
      updated_at: new Date().toISOString(),
    })
    .eq("id", seasonId);

  if (updateError) {
    return NextResponse.json(
      {
        error:
          "Discord thread was deleted, but the Genesis matchup could not be removed from the website. Refresh and try the X again.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    matchupId,
    leaderboardWarning: leaderboard.warning,
  });
}
