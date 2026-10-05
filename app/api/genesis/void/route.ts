import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { GenesisVoidReason, SeasonData } from "@/lib/season";
import {
  postGenesisVoidToThread,
  syncGenesisLeaderboard,
  syncGenesisPickSummary,
  voidGenesisMatchup,
} from "@/lib/genesisPicks";

type Payload = {
  seasonId?: string;
  matchupId?: string;
  reason?: GenesisVoidReason;
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
  const reason = payload.reason;

  if (!seasonId || !matchupId) {
    return NextResponse.json(
      { error: "seasonId and matchupId are required." },
      { status: 400 }
    );
  }

  if (reason !== "auto_sim" && reason !== "force_win") {
    return NextResponse.json(
      { error: "Void reason must be auto_sim or force_win." },
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
      { error: "Only the season commissioner can void Genesis matchups." },
      { status: 403 }
    );
  }

  const seasonData = season.season_data as SeasonData;
  const voided = voidGenesisMatchup(seasonData, matchupId, reason);

  if ("error" in voided) {
    return NextResponse.json({ error: voided.error }, { status: 409 });
  }

  let nextSeasonData: SeasonData = voided.seasonData;
  const voidedMatchup = nextSeasonData.genesisPicks?.matchups.find(
    (item) => item.id === matchupId
  );
  if (voidedMatchup) {
    const summary = await syncGenesisPickSummary(voidedMatchup);
    if (
      summary.matchup.pickSummaryMessageId !==
      voidedMatchup.pickSummaryMessageId
    ) {
      nextSeasonData = {
        ...nextSeasonData,
        genesisPicks: {
          ...nextSeasonData.genesisPicks!,
          matchups: nextSeasonData.genesisPicks!.matchups.map((item) =>
            item.id === matchupId ? summary.matchup : item
          ),
        },
      };
    }
  }

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

  const discordPosted = await postGenesisVoidToThread({
    matchup: voided.matchup,
    reason,
  });

  return NextResponse.json({
    ok: true,
    matchupId,
    reason,
    discordPosted,
    leaderboardWarning: leaderboard.warning,
  });
}
