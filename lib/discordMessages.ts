// Builds the exact JSON body sent to the Discord webhook. Shared by the
// host-triggered /api/discord/notify route and the background
// /api/cron/season-reminders route, so both produce identical formatting.

import { formatWeekLabel } from "@/lib/season";
import type {
  DiscordExtensionSummary,
  DiscordGrantedSummary,
  DiscordNotifyPayload,
  DiscordPersonSummary,
  DiscordWeekSummary,
} from "@/lib/discord";

const COLOR_READY = parseInt("4ade80", 16);
const COLOR_PENDING = parseInt("f87171", 16);
const COLOR_GOLD = parseInt("f5d273", 16);

function personLine(person: DiscordPersonSummary) {
  return `**${person.team || person.name}** (${person.name})`;
}

// Parses a YYYY-MM-DD date (no time component) as a local calendar date,
// so it doesn't shift a day when displayed in a different timezone. Guards
// against pre-migration requests that predate the requestedUntilDate field.
function formatRequestedDate(isoDate: string | undefined) {
  if (!isoDate) return "an unspecified date";
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleDateString();
}

function fieldValue(lines: string[]) {
  const value = lines.join("\n");
  return value.length > 0 ? value.slice(0, 1024) : "—";
}

// Discord renders an empty-name/empty-value field as blank space, giving
// visible breathing room between status groups.
const SPACER_FIELD = { name: "​", value: "​" };

type DiscordEmbed = {
  title?: string;
  description?: string;
  color: number;
  fields?: { name: string; value: string }[];
  footer?: { text: string };
  timestamp?: string;
};

type DiscordMessage = {
  content?: string;
  embeds: DiscordEmbed[];
  // Explicit allow-list: nothing pings unless we intend it to (e.g. a
  // reminder with pingEveryone), regardless of what text ends up in
  // `content` (host-editable fields like the period label).
  allowed_mentions: { parse: ("everyone" | "roles" | "users")[] };
};

function statusFields(summary: DiscordWeekSummary) {
  const { ready, pending, granted, denied, notReady } = summary;

  const pendingLines = (list: DiscordExtensionSummary[]) =>
    list.map(
      (person) => `${personLine(person)} — until ${formatRequestedDate(person.requestedUntilDate)}`
    );

  const grantedLines = (list: DiscordGrantedSummary[]) =>
    list.map(
      (person) =>
        `${personLine(person)}${
          person.until ? ` — until ${new Date(person.until).toLocaleString()}` : ""
        }`
    );

  return [
    { name: `✅ Ready (${ready.length})`, value: fieldValue(ready.map(personLine)) },
    SPACER_FIELD,
    { name: `🕒 Pending Extension (${pending.length})`, value: fieldValue(pendingLines(pending)) },
    SPACER_FIELD,
    { name: `🔵 Granted Extension (${granted.length})`, value: fieldValue(grantedLines(granted)) },
    SPACER_FIELD,
    { name: `❌ Denied Extension (${denied.length})`, value: fieldValue(denied.map(personLine)) },
    SPACER_FIELD,
    { name: `⚪ Not Ready (${notReady.length})`, value: fieldValue(notReady.map(personLine)) },
  ];
}

export function buildDiscordMessage(payload: DiscordNotifyPayload): DiscordMessage | null {
  if (payload.type === "ready") {
    if (!payload.playerName || !payload.seasonTitle) return null;

    return {
      embeds: [
        {
          title: "✅ Ready to Advance",
          description: `${personLine({ name: payload.playerName, team: payload.team })} is ready to advance for ${formatWeekLabel(payload.week)}.`,
          color: COLOR_READY,
          footer: { text: payload.seasonTitle },
          timestamp: new Date().toISOString(),
        },
      ],
      allowed_mentions: { parse: [] },
    };
  }

  if (payload.type === "extension_requested") {
    if (!payload.playerName || !payload.seasonTitle || !payload.requestedUntilDate) {
      return null;
    }

    const reasonLine = payload.reason ? `\n> "${payload.reason}"` : "";

    return {
      embeds: [
        {
          title: "🕒 Extension Requested",
          description: `${personLine({ name: payload.playerName, team: payload.team })} requested an extension until ${formatRequestedDate(payload.requestedUntilDate)} for ${formatWeekLabel(payload.week)}.${reasonLine}`,
          color: COLOR_PENDING,
          footer: { text: payload.seasonTitle },
          timestamp: new Date().toISOString(),
        },
      ],
      allowed_mentions: { parse: [] },
    };
  }

  if (payload.type === "summary") {
    if (!payload.periodHeading || !payload.summary) return null;

    const plannedAdvance = payload.plannedAdvanceTime || "Not set";

    return {
      // "# " is Discord's native large-header markdown — the only way to
      // get bigger text, since embeds don't support custom font sizes.
      content: `# ${payload.periodHeading}`,
      embeds: [
        {
          color: COLOR_GOLD,
          fields: [...statusFields(payload.summary), SPACER_FIELD, { name: "🗓️ Planned Advance Time", value: plannedAdvance }],
          timestamp: new Date().toISOString(),
        },
      ],
      allowed_mentions: { parse: [] },
    };
  }

  if (payload.type === "reminder") {
    if (!payload.periodHeading || !payload.summary) return null;

    const plannedAdvance = payload.plannedAdvanceTime || "Not set";

    return {
      content: payload.pingEveryone
        ? `@everyone\n# ⏰ ${payload.periodHeading}`
        : `# ⏰ ${payload.periodHeading}`,
      embeds: [
        {
          title: "Reminder: mark yourself ready to advance",
          color: COLOR_GOLD,
          fields: [...statusFields(payload.summary), SPACER_FIELD, { name: "🗓️ Planned Advance Time", value: plannedAdvance }],
          timestamp: new Date().toISOString(),
        },
      ],
      allowed_mentions: { parse: payload.pingEveryone ? ["everyone"] : [] },
    };
  }

  return null;
}
