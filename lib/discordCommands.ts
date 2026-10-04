import { PVP_PARENT_CHANNEL_ID } from "@/lib/discordPvpThreads";

const DISCORD_API_BASE = "https://discord.com/api/v10";

async function discordApi(path: string, init: RequestInit = {}) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN is not configured.");

  return fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
}

export async function registerGenesisStreamCommand() {
  const parentResponse = await discordApi(`/channels/${PVP_PARENT_CHANNEL_ID}`);
  if (!parentResponse.ok) {
    const body = await parentResponse.text();
    throw new Error(
      `Could not read the PvP parent while registering /stream: ${body || parentResponse.statusText}`
    );
  }

  const parent = (await parentResponse.json()) as { guild_id?: string };
  if (!parent.guild_id) {
    throw new Error("The PvP parent channel is not inside a Discord server.");
  }

  let applicationId = process.env.DISCORD_APPLICATION_ID?.trim();
  if (!applicationId) {
    const botResponse = await discordApi("/users/@me");
    if (!botResponse.ok) {
      const body = await botResponse.text();
      throw new Error(
        `Could not identify the RTA application: ${body || botResponse.statusText}`
      );
    }

    const bot = (await botResponse.json()) as { id?: string };
    applicationId = bot.id;
  }

  if (!applicationId) {
    throw new Error("Could not determine the RTA Discord application ID.");
  }

  const response = await discordApi(
    `/applications/${applicationId}/guilds/${parent.guild_id}/commands`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "stream",
        type: 1,
        description: "Post your game stream and lock Genesis picks",
        options: [
          {
            type: 3,
            name: "link",
            description: "YouTube or Twitch stream URL",
            required: true,
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Could not register /stream: ${body || response.statusText}`
    );
  }

  return {
    guildId: parent.guild_id,
    applicationId,
  };
}
