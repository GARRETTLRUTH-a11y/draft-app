import type { DiscordWeekSummary } from "@/lib/discord";

export type SeasonPlayer = {
  id: number;
  name: string;
  team?: string;
};

export type ExtensionStatus = "pending" | "granted" | "denied";

export type ExtensionRequest = {
  id: string;
  playerId: number;
  week: number;
  // The date (YYYY-MM-DD) the player is asking for extra time until. The
  // host picks the actual grant time (date + hour) when approving.
  requestedUntilDate: string;
  reason?: string;
  status: ExtensionStatus;
  requestedAt: string;
  resolvedAt?: string;
  grantedUntil?: string;
};

export type AdvanceWindow = {
  date: string; // YYYY-MM-DD
  startHour: number; // 0-23
  endHour: number; // 0-23
};

// A recurring automatic Discord reminder, sent by a background cron job
// (not the app itself, since the app doesn't run when nobody has it open).
// Times are interpreted in REMINDER_TIMEZONE.
export type ReminderSchedule = {
  id: string;
  time: string; // "HH:MM", 24h
  daysOfWeek: number[]; // 0 (Sun) - 6 (Sat)
  pingEveryone: boolean;
  enabled: boolean;
  // YYYY-MM-DD (in REMINDER_TIMEZONE) this reminder last fired on — guards
  // against sending twice for the same day when the cron job's check
  // interval is shorter than a day.
  lastSentDate?: string | null;
};

export type SeasonData = {
  seasonTitle: string;
  players: SeasonPlayer[];
  currentWeek: number;
  readyPlayerIdsByWeek: Record<number, number[]>;
  extensionRequests: ExtensionRequest[];
  // Host-editable override of the auto week label (e.g. a custom name
  // instead of "Week 3"). Resets to null each time the week advances, so it
  // always starts back at the computed default.
  periodLabel?: string | null;
  seasonYear: number;
  // The window the host anticipates advancing during, e.g. Friday 7-10pm.
  // Hour-granularity only — no minutes/seconds.
  advanceWindow?: AdvanceWindow | null;
  sourceDraftId?: string | null;
  reminders?: ReminderSchedule[];
};

// The timezone reminder times are entered/interpreted in.
export const REMINDER_TIMEZONE = "America/New_York";

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatReminderTime(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute || 0).padStart(2, "0")} ${period}`;
}

export function formatReminderDays(daysOfWeek: number[]): string {
  if (daysOfWeek.length === 7) return "Every day";
  return [...daysOfWeek]
    .sort((a, b) => a - b)
    .map((day) => DAY_LABELS[day])
    .join(", ");
}

// Preseason is week 0: the roster-selection phase before weekly check-ins
// begin. Week 1 and onward are the actual regular-season weeks.
export const PRESEASON_WEEK = 0;

export function formatWeekLabel(week: number): string {
  return week <= PRESEASON_WEEK ? "Preseason" : `Week ${week}`;
}

// The big display heading: the (possibly custom) period label plus the
// season year, e.g. "Preseason 2026" or "Week 3 2026".
export function periodHeading(
  periodLabel: string | null | undefined,
  week: number,
  year: number
): string {
  const label = periodLabel?.trim() || formatWeekLabel(week);
  return `${label} ${year}`;
}

export function formatHourLabel(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const period = normalized < 12 ? "AM" : "PM";
  const displayHour = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${displayHour}:00 ${period}`;
}

export function advanceWindowStart(window: AdvanceWindow | null | undefined): Date | null {
  if (!window) return null;
  const [year, month, day] = window.date.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, window.startHour, 0, 0, 0);
}

export function formatAdvanceWindow(window: AdvanceWindow | null | undefined): string {
  const start = advanceWindowStart(window);
  if (!window || !start) return "Not set";
  return `${start.toLocaleDateString()}, ${formatHourLabel(window.startHour)} – ${formatHourLabel(window.endHour)}`;
}

// Minimal shape of a completed draft's saved data, enough to pull each
// drafter and the team they ended up with.
type DraftLikeData = {
  drafters: { id: number; name: string }[];
  picks: { drafter: string; item: { name: string } }[];
};

export function createSeasonDataFromDraft(
  seasonTitle: string,
  draftId: string,
  draftData: DraftLikeData
): SeasonData {
  const players: SeasonPlayer[] = draftData.drafters.map((drafter) => {
    const pick = draftData.picks.find((p) => p.drafter === drafter.name);
    return { id: drafter.id, name: drafter.name, team: pick?.item.name };
  });

  return {
    seasonTitle,
    players,
    currentWeek: PRESEASON_WEEK,
    readyPlayerIdsByWeek: { [PRESEASON_WEEK]: [] },
    extensionRequests: [],
    periodLabel: null,
    seasonYear: new Date().getFullYear(),
    advanceWindow: null,
    sourceDraftId: draftId,
    reminders: [],
  };
}

// Parses a simple CSV (RFC 4180-ish: quoted fields, "" for an escaped quote)
// into rows of raw string cells.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

// Builds a season roster from a draft results CSV (the same format this
// app's own "Export Results CSV" produces: Pick,Drafter,Item,...). Each
// drafter's first pick becomes their team; later picks by the same drafter
// are ignored.
export function createSeasonDataFromCsv(
  seasonTitle: string,
  csvText: string
): SeasonData {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    throw new Error("That CSV doesn't have any data rows.");
  }

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const drafterIndex = header.indexOf("drafter");
  const itemIndex = header.indexOf("item");

  if (drafterIndex === -1 || itemIndex === -1) {
    throw new Error('CSV must have "Drafter" and "Item" columns.');
  }

  const players: SeasonPlayer[] = [];
  const seenNames = new Set<string>();

  rows.slice(1).forEach((cells, index) => {
    const name = (cells[drafterIndex] ?? "").trim();
    const team = (cells[itemIndex] ?? "").trim();
    if (!name || seenNames.has(name.toLowerCase())) return;

    seenNames.add(name.toLowerCase());
    players.push({ id: index + 1, name, team: team || undefined });
  });

  if (players.length === 0) {
    throw new Error("No drafters found in that CSV.");
  }

  return {
    seasonTitle,
    players,
    currentWeek: PRESEASON_WEEK,
    readyPlayerIdsByWeek: { [PRESEASON_WEEK]: [] },
    extensionRequests: [],
    periodLabel: null,
    seasonYear: new Date().getFullYear(),
    advanceWindow: null,
    sourceDraftId: null,
    reminders: [],
  };
}

export function readyPlayerIdsForWeek(
  seasonData: SeasonData,
  week: number
): number[] {
  return seasonData.readyPlayerIdsByWeek[week] ?? [];
}

// Pure "mark this player ready for this week" transform, shared by the
// room page's markReady() and the Discord button-click handler so both
// produce identical results from identical fresh data.
export function withPlayerMarkedReady(
  seasonData: SeasonData,
  playerId: number,
  week: number
): SeasonData {
  const current = new Set(readyPlayerIdsForWeek(seasonData, week));
  current.add(playerId);
  return {
    ...seasonData,
    readyPlayerIdsByWeek: {
      ...seasonData.readyPlayerIdsByWeek,
      [week]: Array.from(current),
    },
  };
}

export function pendingExtensionRequests(
  seasonData: SeasonData
): ExtensionRequest[] {
  return seasonData.extensionRequests.filter(
    (request) => request.status === "pending"
  );
}

// Buckets every player into ready/pending/granted/denied/not-ready for a
// given week — shared by the room page's "Post to Discord" button and the
// background reminder cron job, so both produce identical summaries.
export function buildWeekSummary(
  seasonData: SeasonData,
  week: number
): DiscordWeekSummary {
  const readyIds = new Set(readyPlayerIdsForWeek(seasonData, week));

  const summary: DiscordWeekSummary = {
    ready: [],
    pending: [],
    granted: [],
    denied: [],
    notReady: [],
  };

  seasonData.players.forEach((player) => {
    const person = { name: player.name, team: player.team };

    if (readyIds.has(player.id)) {
      summary.ready.push(person);
      return;
    }

    const extension = seasonData.extensionRequests.find(
      (request) => request.playerId === player.id && request.week === week
    );

    if (extension?.status === "pending") {
      summary.pending.push({ ...person, requestedUntilDate: extension.requestedUntilDate });
      return;
    }

    if (extension?.status === "granted") {
      summary.granted.push({ ...person, until: extension.grantedUntil });
      return;
    }

    if (extension?.status === "denied") {
      summary.denied.push(person);
      return;
    }

    summary.notReady.push(person);
  });

  return summary;
}
