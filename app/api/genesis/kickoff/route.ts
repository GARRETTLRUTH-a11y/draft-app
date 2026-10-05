import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { GenesisPickMatchup, SeasonData } from "@/lib/season";
import { syncGenesisKickoffScheduleMessage } from "@/lib/genesisPicks";

const SUPPORTED_KICKOFF_TIME_ZONES = new Set([
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
]);

type Payload = {
  seasonId?: string;
  matchupId?: string;
  scheduledKickoffLocal?: string | null;
  scheduledKickoffTimeZone?: string | null;
  autoLockAtKickoff?: boolean;
};

function zonedLocalToIso(localValue: string, timeZone: string) {
  const match = localValue.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
  );
  if (!match) return null;

  const [, y, mo, d, h, mi] = match;
  const targetParts = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
  };

  const targetUtc = Date.UTC(
    targetParts.year,
    targetParts.month - 1,
    targetParts.day,
    targetParts.hour,
    targetParts.minute,
    0,
    0
  );

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const partsAt = (timestamp: number) => {
    const values: Record<string, number> = {};
    for (const part of formatter.formatToParts(new Date(timestamp))) {
      if (["year", "month", "day", "hour", "minute"].includes(part.type)) {
        values[part.type] = Number(part.value);
      }
    }

    return {
      year: values.year,
      month: values.month,
      day: values.day,
      hour: values.hour,
      minute: values.minute,
    };
  };

  let guess = targetUtc;
  for (let index = 0; index < 4; index++) {
    const shown = partsAt(guess);
    const shownAsUtc = Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute,
      0,
      0
    );
    const delta = targetUtc - shownAsUtc;
    guess += delta;
    if (delta === 0) break;
  }

  const finalParts = partsAt(guess);
  if (
    finalParts.year !== targetParts.year ||
    finalParts.month !== targetParts.month ||
    finalParts.day !== targetParts.day ||
    finalParts.hour !== targetParts.hour ||
    finalParts.minute !== targetParts.minute
  ) {
    return null;
  }

  return new Date(guess).toISOString();
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
  const scheduledKickoffLocal =
    payload.scheduledKickoffLocal?.trim() || undefined;
  const scheduledKickoffTimeZone =
    payload.scheduledKickoffTimeZone?.trim() || undefined;

  if (!seasonId || !matchupId) {
    return NextResponse.json(
      { error: "seasonId and matchupId are required." },
      { status: 400 }
    );
  }

  if (
    scheduledKickoffLocal &&
    (!scheduledKickoffTimeZone ||
      !SUPPORTED_KICKOFF_TIME_ZONES.has(scheduledKickoffTimeZone))
  ) {
    return NextResponse.json(
      { error: "Choose a supported kickoff time zone." },
      { status: 400 }
    );
  }

  let scheduledKickoffAt: string | undefined;
  if (scheduledKickoffLocal && scheduledKickoffTimeZone) {
    const converted = zonedLocalToIso(
      scheduledKickoffLocal,
      scheduledKickoffTimeZone
    );

    if (!converted) {
      return NextResponse.json(
        {
          error:
            "That kickoff time is invalid in the selected time zone. Check the date/time, especially around daylight-saving changes.",
        },
        { status: 400 }
      );
    }

    scheduledKickoffAt = converted;
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

  const kickoffChanged =
    currentMatchup.scheduledKickoffAt !== scheduledKickoffAt ||
    currentMatchup.scheduledKickoffTimeZone !== scheduledKickoffTimeZone;

  const updatedMatchup: GenesisPickMatchup = {
    ...currentMatchup,
    scheduledKickoffAt,
    scheduledKickoffTimeZone: scheduledKickoffAt
      ? scheduledKickoffTimeZone
      : undefined,
    autoLockAtKickoff: scheduledKickoffAt
      ? payload.autoLockAtKickoff !== false
      : undefined,
    kickoffReminderSentAt: kickoffChanged
      ? undefined
      : currentMatchup.kickoffReminderSentAt,
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
    scheduledKickoffTimeZone: savedMatchup.scheduledKickoffTimeZone,
    autoLockAtKickoff: savedMatchup.autoLockAtKickoff,
    discordWarning: discordSchedule.warning,
  });
}
