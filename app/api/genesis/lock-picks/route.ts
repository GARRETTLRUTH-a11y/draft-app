import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { SeasonData } from "@/lib/season";
import {
  syncGenesisLeaderboard,
  syncGenesisPickSummary,
  syncGenesisStarterButtons,
} from "@/lib/genesisPicks";

type Payload = {
  seasonId?: string;
  matchupId?: string;
};

async function postLockNotice(input: {
  threadId: string;
  pickCount: number;
}) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return false;

  const response = await fetch(
    `https://discord.com/api/v10/channels/${input.threadId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: [
          "🔒 **GENESIS PICKS CLOSED — GAME STARTED**",
          `**${input.pickCount}** pick${input.pickCount === 1 ? "" : "s"} locked in.`,
          "No additional picks will be accepted for this matchup.",
        ].join("\n"),
        allowed_mentions: { parse: [] as string[] },
      }),
    }
  );

  return response.ok;
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
      { error: "Only the season commissioner can lock Genesis picks." },
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

  if (matchup.status === "voided") {
    return NextResponse.json(
      { error: "That Genesis matchup was voided for an Auto Sim or Force Win." },
      { status: 409 }
    );
  }

  if (matchup.status === "locked") {
    return NextResponse.json({
      ok: true,
      alreadyLocked: true,
      pickCount: Object.keys(matchup.picks || {}).length,
    });
  }

  const lockedAt = new Date().toISOString();
  const matchups = picksState.matchups.map((item) =>
    item.id === matchupId
      ? {
          ...item,
          status: "locked" as const,
          lockedAt,
        }
      : item
  );

  let nextSeasonData: SeasonData = {
    ...seasonData,
    genesisPicks: {
      ...picksState,
      matchups,
    },
  };

  const lockedMatchup = matchups.find((item) => item.id === matchupId)!;
  const summary = await syncGenesisPickSummary(lockedMatchup);
  if (
    summary.matchup.pickSummaryMessageId !==
    lockedMatchup.pickSummaryMessageId
  ) {
    nextSeasonData = {
      ...nextSeasonData,
      genesisPicks: {
        ...nextSeasonData.genesisPicks!,
        matchups: matchups.map((item) =>
          item.id === matchupId ? summary.matchup : item
        ),
      },
    };
  }

  await syncGenesisStarterButtons(
    seasonId,
    nextSeasonData.genesisPicks!.matchups.find((item) => item.id === matchupId)!
  );

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

  const pickCount = Object.keys(matchup.picks || {}).length;
  const discordPosted = await postLockNotice({
    threadId: matchup.threadId,
    pickCount,
  });

  return NextResponse.json({
    ok: true,
    pickCount,
    discordPosted,
    leaderboardWarning: leaderboard.warning,
    pickSummaryWarning: summary.warning,
  });
}
