import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { GenesisPickMatchup, SeasonData } from "@/lib/season";
import { syncGenesisKickoffScheduleMessage } from "@/lib/genesisPicks";

type Payload = {
  seasonId?: string;
  matchupId?: string;
  scheduledKickoffAt?: string | null;
  autoLockAtKickoff?: boolean;
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
  const scheduledKickoffAt = payload.scheduledKickoffAt?.trim() || undefined;

  if (!seasonId || !matchupId) {
    return NextResponse.json(
      { error: "seasonId and matchupId are required." },
      { status: 400 }
    );
  }

  if (
    scheduledKickoffAt &&
    !Number.isFinite(new Date(scheduledKickoffAt).getTime())
  ) {
    return NextResponse.json(
      { error: "Scheduled kickoff time is invalid." },
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
      { error: "Only the season commissioner can schedule Genesis kickoffs." },
      { status: 403 }
    );
  }

  const seasonData = season.season_data as SeasonData;
  const picksState = seasonData.genesisPicks;
  const currentMatchup = picksState?.matchups.find(
    (item) => item.id === matchupId
  );

  if (!picksState || !currentMatchup) {
    return NextResponse.json(
      { error: "Genesis matchup not found." },
      { status: 404 }
    );
  }

  if (currentMatchup.status !== "open") {
    return NextResponse.json(
      {
        error:
          "Kickoff scheduling is only available while Genesis picks are still open.",
      },
      { status: 409 }
    );
  }

  const updatedMatchup: GenesisPickMatchup = {
    ...currentMatchup,
    scheduledKickoffAt,
    autoLockAtKickoff: scheduledKickoffAt
      ? payload.autoLockAtKickoff !== false
      : undefined,
    kickoffReminderSentAt: undefined,
  };

  const discordSchedule = await syncGenesisKickoffScheduleMessage(updatedMatchup);
  const savedMatchup = discordSchedule.matchup;

  const nextSeasonData: SeasonData = {
    ...seasonData,
    genesisPicks: {
      ...picksState,
      matchups: picksState.matchups.map((item) =>
        item.id === matchupId ? savedMatchup : item
      ),
    },
  };

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
    matchupId,
    scheduledKickoffAt: savedMatchup.scheduledKickoffAt,
    autoLockAtKickoff: savedMatchup.autoLockAtKickoff,
    discordWarning: discordSchedule.warning,
  });
}
