import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildDiscordMessage } from "@/lib/discordMessages";
import { sendDiscordMessage } from "@/lib/discordSend";
import {
  buildWeekSummary,
  formatAdvanceWindow,
  periodHeading,
  REMINDER_TIMEZONE,
  type ReminderSchedule,
  type SeasonData,
} from "@/lib/season";

// How long a reminder stays "due" after its target time before being
// skipped for the day. GitHub Actions scheduled workflows are NOT
// reliable timers -- GitHub's own docs warn runs can be arbitrarily
// delayed under load, and in practice this project's every-10-minutes
// schedule has actually landed with gaps over 90 minutes. This window is
// intentionally wide (not just the nominal 10-minute interval) so a
// reminder still fires even if the scheduler misses several beats in a
// row; a proper fix is a more reliable external trigger (e.g.
// cron-job.org) hitting this route instead of/alongside GitHub Actions.
const FIRE_WINDOW_MINUTES = 90;

function nowInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayIndex: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  // Some ICU implementations render midnight as "24" with hour12: false.
  const hour = get("hour") === "24" ? 0 : Number(get("hour"));

  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    minutesOfDay: hour * 60 + Number(get("minute")),
    dayOfWeek: weekdayIndex[get("weekday")] ?? 0,
  };
}

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + (minute || 0);
}

function isDue(
  reminder: ReminderSchedule,
  dateKey: string,
  minutesOfDay: number,
  dayOfWeek: number
) {
  if (!reminder.enabled) return false;
  if (!reminder.daysOfWeek.includes(dayOfWeek)) return false;
  if (reminder.lastSentDate === dateKey) return false;

  const elapsed = minutesOfDay - timeToMinutes(reminder.time);
  return elapsed >= 0 && elapsed < FIRE_WINDOW_MINUTES;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json(
      { error: "Reminders are not fully configured on the server." },
      { status: 501 }
    );
  }

  // Service-role client: bypasses RLS deliberately, since this route has no
  // signed-in user (it's called by a scheduler, not a browser) and needs to
  // read/update every season's reminder schedule. Never exposed to clients.
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: seasons, error } = await admin.from("seasons").select("id, season_data");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { dateKey, minutesOfDay, dayOfWeek } = nowInTimeZone(REMINDER_TIMEZONE);

  let sentCount = 0;

  for (const row of seasons || []) {
    const seasonData = row.season_data as SeasonData;
    const reminders = seasonData.reminders || [];
    if (reminders.length === 0) continue;

    let changed = false;

    const nextReminders: ReminderSchedule[] = [];
    for (const reminder of reminders) {
      if (!isDue(reminder, dateKey, minutesOfDay, dayOfWeek)) {
        nextReminders.push(reminder);
        continue;
      }

      const message = buildDiscordMessage({
        type: "reminder",
        seasonId: row.id,
        periodHeading: periodHeading(seasonData.periodLabel, seasonData.currentWeek, seasonData.seasonYear),
        summary: buildWeekSummary(seasonData, seasonData.currentWeek),
        plannedAdvanceTime: formatAdvanceWindow(seasonData.advanceWindow),
        pingEveryone: reminder.pingEveryone,
      });

      if (!message) {
        nextReminders.push(reminder);
        continue;
      }

      const result = await sendDiscordMessage(message);

      if (result.ok) {
        sentCount++;
        changed = true;
        nextReminders.push({ ...reminder, lastSentDate: dateKey });
      } else {
        nextReminders.push(reminder);
      }
    }

    if (changed) {
      await admin
        .from("seasons")
        .update({ season_data: { ...seasonData, reminders: nextReminders } })
        .eq("id", row.id);
    }
  }

  return NextResponse.json({ ok: true, sent: sentCount });
}
