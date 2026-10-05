import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { buildGenesisLine, syncGenesisHistory } from "@/lib/genesisLines";
import {
  settleGenesisPicksFromHistory,
  syncGenesisLeaderboard,
  syncGenesisPickSummary,
  syncGenesisStarterButtons,
} from "@/lib/genesisPicks";
import type { SeasonData } from "@/lib/season";

export const maxDuration = 300;

type Payload = {
  seasonId?: string;
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

  let payload: Payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const seasonId = payload.seasonId?.trim();
  const awayTeam = payload.awayTeam?.trim();
  const homeTeam = payload.homeTeam?.trim();

  if (!seasonId || !awayTeam || !homeTeam) {
    return NextResponse.json(
      { error: "seasonId, awayTeam, and homeTeam are required." },
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
      { error: "Only the season commissioner can generate Genesis lines." },
      { status: 403 }
    );
  }

  try {
    const seasonData = season.season_data as SeasonData;
    const history = await syncGenesisHistory(seasonData, { mode: "incremental" });
    const withHistory: SeasonData = {
      ...seasonData,
      genesisHistory: history,
    };
    const settled = settleGenesisPicksFromHistory(withHistory);
    let nextSeasonData = settled.seasonData;
    let leaderboardWarning: string | undefined;

    for (const matchupId of settled.settledMatchupIds) {
      const settledMatchup = nextSeasonData.genesisPicks?.matchups.find(
        (item) => item.id === matchupId
      );
      if (!settledMatchup) continue;

      const summary = await syncGenesisPickSummary(settledMatchup, {
        createIfMissing: false,
      });
      if (
        summary.matchup.pickSummaryMessageId !==
        settledMatchup.pickSummaryMessageId
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

      await syncGenesisStarterButtons(
        seasonId,
        nextSeasonData.genesisPicks?.matchups.find(
          (item) => item.id === matchupId
        ) || settledMatchup
      );
    }

    if (settled.settledCount > 0 || nextSeasonData.genesisPicks?.leaderboardChannelId) {
      const leaderboard = await syncGenesisLeaderboard(nextSeasonData);
      nextSeasonData = leaderboard.seasonData;
      leaderboardWarning = leaderboard.warning;
    }

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

    const line = buildGenesisLine(
      nextSeasonData,
      awayTeam,
      homeTeam,
      Boolean(payload.neutral)
    );

    return NextResponse.json({
      ok: true,
      line,
      sync: {
        messagesScanned: history.messagesScanned,
        mode: history.lastSyncMode,
        totalGames: history.games.length,
        achievements: history.postseasonAchievements?.length ?? 0,
        lastSyncedAt: history.lastSyncedAt,
        settledPicks: settled.settledCount,
      },
      leaderboardWarning,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Genesis line error.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
