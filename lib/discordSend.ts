// Actually delivers a built DiscordMessage. Shared by /api/discord/notify
// and /api/cron/season-reminders so both send the same way.

import type { DiscordMessage } from "@/lib/discordMessages";

export type DiscordSendResult = { ok: true } | { ok: false; error: string };

export async function sendDiscordMessage(message: DiscordMessage): Promise<DiscordSendResult> {
  // Buttons only work when the bot sends the message -- Discord routes a
  // component interaction back to whichever Application owns the message,
  // and a plain incoming webhook doesn't own one.
  if (message.components && message.components.length > 0) {
    const botToken = process.env.DISCORD_BOT_TOKEN;
    const channelId = process.env.DISCORD_CHANNEL_ID;

    if (!botToken || !channelId) {
      return {
        ok: false,
        error: "DISCORD_BOT_TOKEN/DISCORD_CHANNEL_ID are not configured on the server.",
      };
    }

    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: text || "Discord bot message request failed." };
    }

    return { ok: true };
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return { ok: false, error: "DISCORD_WEBHOOK_URL is not configured on the server." };
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const text = await response.text();
    return { ok: false, error: text || "Discord webhook request failed." };
  }

  return { ok: true };
}
