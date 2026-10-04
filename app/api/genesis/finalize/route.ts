import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { SeasonData } from "@/lib/season";
import {
  postGenesisFinalToThread,
  settleGenesisMatchupByScore,
  syncGenesisLeaderboard,
} from "@/lib/genesisPicks";

type Payload = {
  seasonId?: string;
  matchupId?: string;
  awayScore?: number;
  homeScore?: number;
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
  const awayScore = Number(payload.awayScore);
  const homeScore = Number(payload.homeScore);

  if (!seasonId || !matchupId) {
    return NextResponse.json(
      { error: "seasonId and matchupId are required." },
      { status: 400 }
    );
  }

  if (
    !Number.isInteger(awayScore) ||
    !Number.isInteger(homeScore) ||
    awayScore < 0 ||
    homeScore < 0
  ) {
    return NextResponse.json(
      { error: "Final scores must be whole numbers of 0 or greater." },
      { status: 400 }
    );
  }

  if (awayScore === homeScore) {
    return NextResponse.json(
      { error: "College football games cannot end in a tie." },
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
      { error: "Only the season commissioner can finalize Genesis matchups." },
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

  if (matchup.status === "settled") {
    return NextResponse.json(
      { error: "That Genesis matchup is already finalized." },
      { status: 409 }
    );
  }

  const settled = settleGenesisMatchupByScore(
    seasonData,
    matchupId,
    awayScore,
    homeScore
  );

  if ("error" in settled) {
    return NextResponse.json({ error: settled.error }, { status: 409 });
  }

  const atsWinner = settled.atsWinner;
  let nextSeasonData: SeasonData = settled.seasonData;

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
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await postGenesisFinalToThread({
    matchup,
    awayScore,
    homeScore,
    atsWinner,
  });

  return NextResponse.json({
    ok: true,
    matchupId,
    atsWinner,
    leaderboardChannelId: nextSeasonData.genesisPicks?.leaderboardChannelId,
    leaderboardWarning: leaderboard.warning,
  });
}
