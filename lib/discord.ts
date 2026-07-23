// Shared between the client (room page) and the /api/discord/notify route.
// No secrets here — the webhook URL itself only ever lives server-side.

export type DiscordPersonSummary = {
  name: string;
  team?: string;
};

export type DiscordExtensionSummary = DiscordPersonSummary & {
  // The date (YYYY-MM-DD) the player asked for extra time until.
  requestedUntilDate: string;
};

export type DiscordGrantedSummary = DiscordPersonSummary & {
  until?: string;
};

export type DiscordWeekSummary = {
  ready: DiscordPersonSummary[];
  pending: DiscordExtensionSummary[];
  granted: DiscordGrantedSummary[];
  denied: DiscordPersonSummary[];
  notReady: DiscordPersonSummary[];
};

export type DiscordNotifyPayload =
  | {
      type: "ready";
      seasonTitle: string;
      week: number;
      playerName: string;
      team?: string;
    }
  | {
      type: "extension_requested";
      seasonTitle: string;
      week: number;
      playerName: string;
      team?: string;
      // The date (YYYY-MM-DD) the player asked for extra time until.
      requestedUntilDate: string;
      reason?: string;
    }
  | {
      type: "summary";
      // The big header text, e.g. "Preseason 2026" or "Week 3 2026".
      periodHeading: string;
      summary: DiscordWeekSummary;
      // Pre-formatted display string, e.g. "7/11/2026, 7:00 PM – 10:00 PM".
      plannedAdvanceTime?: string | null;
    }
  | {
      type: "reminder";
      // The big header text, e.g. "Preseason 2026" or "Week 3 2026".
      periodHeading: string;
      summary: DiscordWeekSummary;
      // Pre-formatted display string, e.g. "7/11/2026, 7:00 PM – 10:00 PM".
      plannedAdvanceTime?: string | null;
      pingEveryone: boolean;
    };
