import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { syncGenesisHistory } from "@/lib/genesisLines";
import {
  genesisWinBonusDeltas,
  postGenesisHistoryMoneyUpdate,
  settleGenesisPicksFromHistory,
  syncGenesisLeaderboard,
  syncGenesisPickSummary,
  syncGenesisStarterButtons,
} from "@/lib/genesisPicks";
import type { SeasonData } from "@/lib/season";

export const maxDuration = 300;

type Payload = {
  seasonId?: string;
  mode?: "full" | "incremental";
  trigger?: "manual" | "advance";
  fromStage?: string;
  toStage?: string;
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
    .select("user_id, season_data")
    .eq("id", seasonId)
    .maybeSingle();

  if (seasonError || !season) {
    return NextResponse.json({ error: "Season not found." }, { status: 404 });
  }

  if (season.user_id !== userData.user.id) {
    return NextResponse.json(
      { error: "Only the season commissioner can sync Genesis history." },
      { status: 403 }
    );
  }

  try {
    const seasonData = season.season_data as SeasonData;
    const requestedMode = payload.mode === "incremental" ? "incremental" : "full";
    const history = await syncGenesisHistory(seasonData, { mode: requestedMode });
    const withHistory: SeasonData = { ...seasonData, genesisHistory: history };
    const settled = settleGenesisPicksFromHistory(withHistory);
    let nextSeasonData = settled.seasonData;
    let bankrollLeaderboardUpdated = false;

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

    // History is the source of truth for the $5 CPU-win recovery credit.
    // Always republish the Discord leaderboards after a manual history check,
    // even when this pass did not settle a PvP wager. This makes the public
    // #genesis-picks balances reflect newly imported CPU results immediately.
    const leaderboard = await syncGenesisLeaderboard(nextSeasonData);
    nextSeasonData = leaderboard.seasonData;
    const leaderboardWarning = leaderboard.warning;
    bankrollLeaderboardUpdated = leaderboard.bankrollUpdated;

    const winBonusDeltas = genesisWinBonusDeltas(
      seasonData,
      nextSeasonData
    );
    const newPvpWinCredits = winBonusDeltas.reduce(
      (total, row) => total + row.pvpWinsAdded,
      0
    );
    const newCpuWinCredits = winBonusDeltas.reduce(
      (total, row) => total + row.cpuWinsAdded,
      0
    );
    const pvpWinCreditDollars = winBonusDeltas.reduce(
      (total, row) => total + row.pvpDollarsAdded,
      0
    );
    const cpuWinCreditDollars = winBonusDeltas.reduce(
      (total, row) => total + row.cpuDollarsAdded,
      0
    );

    const moneyNotice = await postGenesisHistoryMoneyUpdate({
      seasonData: nextSeasonData,
      deltas: winBonusDeltas,
      trigger: payload.trigger === "advance" ? "advance" : "manual",
      fromStage: payload.fromStage?.trim() || undefined,
      toStage: payload.toStage?.trim() || undefined,
    });
    nextSeasonData = moneyNotice.seasonData;

    const combinedWarnings = [
      leaderboardWarning,
      moneyNotice.warning,
    ].filter((warning): warning is string => Boolean(warning));

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

    return NextResponse.json({
      ok: true,
      games: history.games.length,
      messagesScanned: history.messagesScanned,
      lastSyncedAt: history.lastSyncedAt,
      sourceCounts: history.sourceCounts,
      achievements: history.postseasonAchievements?.length ?? 0,
      syncMode: history.lastSyncMode,
      settledPicks: settled.settledCount,
      newPvpWinCredits,
      pvpWinCreditDollars,
      newCpuWinCredits,
      cpuWinCreditDollars,
      historyMoneyNotificationPosted: moneyNotice.posted,
      bankrollLeaderboardUpdated,
      leaderboardWarning: combinedWarnings.length
        ? combinedWarnings.join(" ")
        : undefined,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Genesis history error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
