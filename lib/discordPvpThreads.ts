// Shared Discord PvP-thread creation helper.
// Used by both the Discord interaction button and the commissioner web panel.

export const GENESIS_ROLE_ID = "1394487095317368863";
export const PVP_PARENT_CHANNEL_ID = "1393365326145523742";

const DISCORD_API_BASE = "https://discord.com/api/v10";

async function discordApi(path: string, init: RequestInit = {}) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN is not configured.");

  return fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
      ...(init.headers || {}),
    },
  });
}

export type PvpThreadCreateResult = {
  thread: { id: string; name?: string };
  added: number;
  total: number;
  failed: number;
};

export async function createGenesisPvpThread(
  threadName: string
): Promise<PvpThreadCreateResult> {
  const parentResponse = await discordApi(`/channels/${PVP_PARENT_CHANNEL_ID}`);
  if (!parentResponse.ok) {
    const body = await parentResponse.text();
    throw new Error(`Could not read PvP parent channel: ${body || parentResponse.statusText}`);
  }

  const parent = (await parentResponse.json()) as {
    guild_id?: string;
    type?: number;
    flags?: number;
    available_tags?: { id: string; name: string }[];
  };
  if (!parent.guild_id) {
    throw new Error("The configured PvP parent channel is not inside a Discord server.");
  }

  const isForumOrMedia = parent.type === 15 || parent.type === 16;
  const requiresTag = Boolean((parent.flags ?? 0) & (1 << 4));
  const pvpTag = parent.available_tags?.find(
    (tag) => tag.name.trim().toLowerCase() === "pvp"
  );

  if (requiresTag && !pvpTag) {
    const available = parent.available_tags?.map((tag) => tag.name).join(", ");
    throw new Error(
      available
        ? `This forum requires a tag. Add a tag named "PvP" to the parent channel, or make tags optional. Available tags: ${available}`
        : 'This forum requires a tag. Add a tag named "PvP" to the parent channel, or make tags optional.'
    );
  }

  const threadPayload = isForumOrMedia
    ? {
        name: threadName.slice(0, 100),
        auto_archive_duration: 10080,
        message: {
          content: `🏈 **${threadName}**`,
          allowed_mentions: { parse: [] as string[] },
        },
        ...(pvpTag ? { applied_tags: [pvpTag.id] } : {}),
      }
    : {
        name: threadName.slice(0, 100),
        type: 11, // PUBLIC_THREAD
        auto_archive_duration: 10080, // 7 days
      };

  const createResponse = await discordApi(`/channels/${PVP_PARENT_CHANNEL_ID}/threads`, {
    method: "POST",
    body: JSON.stringify(threadPayload),
  });

  if (!createResponse.ok) {
    const body = await createResponse.text();
    throw new Error(`Could not create thread: ${body || createResponse.statusText}`);
  }

  const thread = (await createResponse.json()) as { id: string; name?: string };

  const genesisUserIds: string[] = [];
  let after: string | undefined;

  do {
    const params = new URLSearchParams({ limit: "1000" });
    if (after) params.set("after", after);

    const membersResponse = await discordApi(
      `/guilds/${parent.guild_id}/members?${params.toString()}`
    );
    if (!membersResponse.ok) {
      const body = await membersResponse.text();
      throw new Error(`Could not read @genesis members: ${body || membersResponse.statusText}`);
    }

    const members = (await membersResponse.json()) as {
      user?: { id?: string; bot?: boolean };
      roles?: string[];
    }[];

    for (const member of members) {
      const userId = member.user?.id;
      if (userId && !member.user?.bot && member.roles?.includes(GENESIS_ROLE_ID)) {
        genesisUserIds.push(userId);
      }
    }

    after = members.length === 1000 ? members[members.length - 1]?.user?.id : undefined;
  } while (after);

  let added = 0;
  let failed = 0;

  for (const userId of genesisUserIds) {
    const addResponse = await discordApi(`/channels/${thread.id}/thread-members/${userId}`, {
      method: "PUT",
    });

    if (addResponse.ok || addResponse.status === 204) added++;
    else failed++;
  }

  return { thread, added, total: genesisUserIds.length, failed };
}
