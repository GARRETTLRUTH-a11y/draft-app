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

type DiscordButtonComponent =
  | {
      type: 2; // BUTTON
      style: 1 | 2 | 3 | 4;
      label: string;
      custom_id: string;
    }
  | {
      type: 2;
      style: 5; // LINK -- opens a URL directly, no interaction/custom_id
      label: string;
      url: string;
    };

type DiscordActionRow = {
  type: 1; // ACTION_ROW
  components: DiscordButtonComponent[];
};

export type DiscordMessage = {
  content?: string;
  embeds: DiscordEmbed[];
  // Explicit allow-list: nothing pings unless we intend it to (e.g. a
  // reminder with pingEveryone), regardless of what text ends up in
  // `content` (host-editable fields like the period label).
  allowed_mentions: { parse: ("everyone" | "roles" | "users")[] };
  components?: DiscordActionRow[];
};

// Only messages sent through the bot (not the plain webhook) can have
// working buttons -- Discord routes the click back to whichever
// Application owns the message, and a plain incoming webhook doesn't own
// one. Callers that still use the webhook (ready/extension_requested) just
// won't attach this.
function actionButtonsRow(seasonId: string): DiscordActionRow {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 3, // SUCCESS (green)
        label: "✅ I'm Ready",
        custom_id: `ready:${seasonId}`,
      },
      {
        type: 2,
        style: 2, // SECONDARY (gray) -- Discord's 5 button styles don't
        // include yellow, so this is as close as it gets to "distinct
        // from the others."
        label: "🕒 Request Extension",
        custom_id: `extend:${seasonId}`,
      },
      {
        type: 2,
        style: 1, // PRIMARY (blurple)
        label: "🔗 Link Discord Account",
        custom_id: "link_account",
      },
      {
        type: 2,
        style: 5, // LINK -- opens the room page directly, no round trip
        // through the bot.
        label: "🌐 Open Season Page",
        url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://cfb-draft.vercel.app"}/season/room/${seasonId}`,
      },
    ],
  };
}

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

  // Skip empty categories entirely (e.g. no one's requested an extension
  // yet) instead of showing a blank "—" field for it, so the message
  // doesn't get cluttered with sections nobody's in.
  const sections = [
    ready.length > 0 && { name: `✅ Ready (${ready.length})`, value: fieldValue(ready.map(personLine)) },
    pending.length > 0 && {
      name: `🕒 Pending Extension (${pending.length})`,
      value: fieldValue(pendingLines(pending)),
    },
    granted.length > 0 && {
      name: `🔵 Granted Extension (${granted.length})`,
      value: fieldValue(grantedLines(granted)),
    },
    denied.length > 0 && { name: `❌ Denied Extension (${denied.length})`, value: fieldValue(denied.map(personLine)) },
    notReady.length > 0 && { name: `⚪ Not Ready (${notReady.length})`, value: fieldValue(notReady.map(personLine)) },
  ].filter((section): section is { name: string; value: string } => Boolean(section));

  return sections.flatMap((section, index) => (index === 0 ? [section] : [SPACER_FIELD, section]));
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
    if (!payload.periodHeading || !payload.summary || !payload.seasonId) return null;

    const plannedAdvance = payload.plannedAdvanceTime || "Not set";

    return {
      // "# " and "## " are Discord's native header markdown — the only
      // way to get bigger text, since embeds don't support custom font
      // sizes. Planned Advance Time lives here (not as an embed field) so
      // it's actually readable at a glance instead of small embed text.
      content: `# ${payload.periodHeading}\n## 🗓️ Planned Advance: ${plannedAdvance}`,
      embeds: [
        {
          color: COLOR_GOLD,
          fields: statusFields(payload.summary),
          timestamp: new Date().toISOString(),
        },
      ],
      allowed_mentions: { parse: [] },
      components: [actionButtonsRow(payload.seasonId)],
    };
  }

  if (payload.type === "reminder") {
    if (!payload.periodHeading || !payload.summary || !payload.seasonId) return null;

    const plannedAdvance = payload.plannedAdvanceTime || "Not set";
    const header = `# ⏰ ${payload.periodHeading}\n## 🗓️ Planned Advance: ${plannedAdvance}`;

    return {
      content: payload.pingEveryone ? `@everyone\n${header}` : header,
      embeds: [
        {
          title: "Reminder: mark yourself ready to advance",
          color: COLOR_GOLD,
          fields: statusFields(payload.summary),
          timestamp: new Date().toISOString(),
        },
      ],
      allowed_mentions: { parse: payload.pingEveryone ? ["everyone"] : [] },
      components: [actionButtonsRow(payload.seasonId)],
    };
  }

  if (payload.type === "nudge") {
    if (!payload.periodHeading || !payload.seasonId) return null;

    const plannedAdvance = payload.plannedAdvanceTime || "Not set";

    return {
      content: `# ${payload.periodHeading}\n-# 🗓️ Planned advance: ${plannedAdvance}`,
      embeds: [],
      allowed_mentions: { parse: [] },
      components: [actionButtonsRow(payload.seasonId)],
    };
  }

  return null;
}
