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

export async function postGenesisPvpThreadMessage(
  threadId: string,
  content: string
) {
  const response = await discordApi(`/channels/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] as string[] },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Could not post PvP thread message: ${body || response.statusText}`
    );
  }

  return true;
}

export async function deleteGenesisPvpThread(threadId: string) {
  const response = await discordApi(`/channels/${threadId}`, {
    method: "DELETE",
  });

  if (response.ok || response.status === 404) return true;

  const body = await response.text();
  throw new Error(
    `Could not delete Discord PvP thread: ${body || response.statusText}`
  );
}

export type PvpThreadCreateResult = {
  thread: { id: string; name?: string };
  starterMessageId?: string;
  taggedUserIds: string[];
  genesisRoleTagged: boolean;
};

function buildTaggedStarterMessage(
  threadName: string,
  starterMessage: string | undefined,
  taggedUserIds: string[]
) {
  const uniqueUsers = [...new Set(taggedUserIds.filter(Boolean))];
  const mentions = [
    `<@&${GENESIS_ROLE_ID}>`,
    ...uniqueUsers.map((userId) => `<@${userId}>`),
  ].join(" ");

  const body = starterMessage || `🏈 **${threadName}**`;
  return `${mentions}\n\n${body}`;
}

export async function createGenesisPvpThread(
  threadName: string,
  starterMessage?: string,
  taggedUserIds: string[] = [],
  components: unknown[] = []
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

  const uniqueTaggedUsers = [...new Set(taggedUserIds.filter(Boolean))];
  const taggedMessage = buildTaggedStarterMessage(
    threadName,
    starterMessage,
    uniqueTaggedUsers
  );
  const allowedMentions = {
    parse: [] as string[],
    roles: [GENESIS_ROLE_ID],
    users: uniqueTaggedUsers,
  };

  const threadPayload = isForumOrMedia
    ? {
        name: threadName.slice(0, 100),
        auto_archive_duration: 10080,
        message: {
          content: taggedMessage,
          allowed_mentions: allowedMentions,
          ...(components.length ? { components } : {}),
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

  const thread = (await createResponse.json()) as {
    id: string;
    name?: string;
    message?: { id?: string };
  };
  let starterMessageId =
    isForumOrMedia ? thread.message?.id || thread.id : undefined;

  if (!isForumOrMedia) {
    const starterResponse = await discordApi(`/channels/${thread.id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: taggedMessage,
        allowed_mentions: allowedMentions,
        ...(components.length ? { components } : {}),
      }),
    });

    if (!starterResponse.ok) {
      const body = await starterResponse.text();
      throw new Error(
        `Thread created, but could not post matchup message: ${body || starterResponse.statusText}`
      );
    }

    const starter = (await starterResponse.json()) as { id?: string };
    starterMessageId = starter.id;
  }

  // Public forum/text threads are visible to everyone who can access the
  // parent channel. We intentionally do not add every @genesis member as a
  // thread member because Discord emits one noisy system message per add.
  return {
    thread,
    starterMessageId,
    taggedUserIds: uniqueTaggedUsers,
    genesisRoleTagged: true,
  };
}
