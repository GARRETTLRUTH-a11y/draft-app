import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import {
  createGenesisPvpThread,
  postGenesisPvpThreadMessage,
} from "@/lib/discordPvpThreads";
import {
  buildGenesisLine,
  buildGenesisMatchupHistoryCard,
  genesisStarterMessage,
} from "@/lib/genesisLines";
import type { SeasonData } from "@/lib/season";
import {
  buildGenesisPickComponents,
  createGenesisPickMatchup,
  syncGenesisLeaderboard,
  syncGenesisPickSummary,
} from "@/lib/genesisPicks";

export const maxDuration = 300;

type PvpThreadPayload = {
  seasonId?: string;
  threadName?: string;
  awayTeam?: string;
  homeTeam?: string;
  neutral?: boolean;
  postStreamInstructions?: boolean;
};

function normalizeTeam(value: string) {
  return value.trim().toLowerCase();
}

async function resolveMatchupDiscordUserIds(
  admin: SupabaseClient,
  seasonId: string,
  seasonData: SeasonData,
  awayTeam?: string,
  homeTeam?: string
) {
  if (!awayTeam || !homeTeam) return [] as string[];

  const selectedTeams = new Set([
    normalizeTeam(awayTeam),
    normalizeTeam(homeTeam),
  ]);

  const playerNames = seasonData.players
    .filter((player) => player.team && selectedTeams.has(normalizeTeam(player.team)))
    .map((player) => player.name);

  if (!playerNames.length) return [] as string[];

  const { data: participants } = await admin
    .from("season_participants")
    .select("user_id, player_name")
    .eq("season_id", seasonId)
    .in("player_name", playerNames);

  const userIds = [...new Set((participants || []).map((row) => row.user_id).filter(Boolean))];
  if (!userIds.length) return [] as string[];

  const { data: links } = await admin
    .from("discord_links")
    .select("user_id, discord_user_id")
    .in("user_id", userIds);

  return [...new Set((links || []).map((row) => row.discord_user_id).filter(Boolean))] as string[];
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

  let payload: PvpThreadPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const seasonId = payload.seasonId?.trim();
  const threadName = payload.threadName?.trim();

  if (!seasonId || !threadName) {
    return NextResponse.json({ error: "seasonId and threadName are required." }, { status: 400 });
  }

  if (threadName.length > 100) {
    return NextResponse.json({ error: "Thread name must be 100 characters or fewer." }, { status: 400 });
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
    return NextResponse.json({ error: "Only the season commissioner can create PvP threads." }, { status: 403 });
  }

  try {
    const awayTeam = payload.awayTeam?.trim();
    const homeTeam = payload.homeTeam?.trim();
    const seasonData = season.season_data as SeasonData;

    // The website refreshes Genesis history immediately before this
    // request. Keep thread creation fast and deterministic: do not make a
    // second Discord/OpenAI history pass while the user is waiting.
    let nextSeasonData = seasonData;

    const line =
      awayTeam && homeTeam
        ? buildGenesisLine(
            nextSeasonData,
            awayTeam,
            homeTeam,
            Boolean(payload.neutral)
          )
        : undefined;

    const matchupDiscordUserIds = await resolveMatchupDiscordUserIds(
      admin,
      seasonId,
      nextSeasonData,
      awayTeam,
      homeTeam
    );

    const matchupId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const pickComponents =
      line && awayTeam && homeTeam
        ? buildGenesisPickComponents(seasonId, matchupId, line)
        : [];

    const starterMessage = line
      ? `${genesisStarterMessage(threadName, line)}\n\n🎯 **Make your pick:** choose a side below. 🔒 Your selection locks immediately.`
      : undefined;

    const result = await createGenesisPvpThread(
      threadName,
      starterMessage,
      matchupDiscordUserIds,
      pickComponents
    );

    let matchupHistoryWarning: string | undefined;
    if (line && awayTeam && homeTeam) {
      try {
        await postGenesisPvpThreadMessage(
          result.thread.id,
          buildGenesisMatchupHistoryCard(nextSeasonData, awayTeam, homeTeam)
        );
      } catch (error) {
        matchupHistoryWarning =
          error instanceof Error
            ? error.message
            : "Could not post Genesis matchup history.";
      }
    }

    let streamInstructionsWarning: string | undefined;
    let streamInstructionsPosted = false;

    if (payload.postStreamInstructions) {
      try {
        await postGenesisPvpThreadMessage(
          result.thread.id,
          [
            "📅 **KICKOFF / GAME START INSTRUCTIONS**",
            "Either matchup player can use **/kickoff** in this thread to set or update the scheduled kickoff. Choose the date, time, and time zone when you run the command.",
            "RTA will show the kickoff in each Discord user's local time, post a reminder about 30 minutes before kickoff, and auto-lock Genesis picks at kickoff unless the commissioner disabled auto-lock.",
            "",
            "When the game is about to start, one of the two matchup players should use **/stream** in this thread and paste the YouTube or Twitch link.",
            "",
            "Using **/stream** will:",
            "• post the stream publicly in this game thread",
            "• mark the game as started",
            "• immediately close Genesis voting at the locked line",
            "",
            "After the game, RTA will prompt for the final score if it has not already been submitted.",
          ].join("\n")
        );
        streamInstructionsPosted = true;
      } catch (error) {
        streamInstructionsWarning =
          error instanceof Error
            ? error.message
            : "Could not post the /stream instructions.";
      }
    }

    let pickSummaryWarning: string | undefined;

    if (line && awayTeam && homeTeam) {
      const currentPicks = nextSeasonData.genesisPicks || { matchups: [] };
      const matchup = createGenesisPickMatchup({
        id: matchupId,
        threadId: result.thread.id,
        threadName: result.thread.name || threadName,
        createdAt: new Date().toISOString(),
        seasonYear: nextSeasonData.seasonYear,
        stage: nextSeasonData.periodLabel || undefined,
        line,
        starterMessageId: result.starterMessageId,
      });

      const summary = await syncGenesisPickSummary(matchup);
      pickSummaryWarning = summary.warning;

      nextSeasonData = {
        ...nextSeasonData,
        genesisPicks: {
          ...currentPicks,
          matchups: [...currentPicks.matchups, summary.matchup],
        },
      };
    }

    const leaderboard = await syncGenesisLeaderboard(nextSeasonData);
    nextSeasonData = leaderboard.seasonData;

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
      threadId: result.thread.id,
      threadName: result.thread.name || threadName,
      genesisRoleTagged: result.genesisRoleTagged,
      taggedPlayers: result.taggedUserIds.length,
      line,
      leaderboardChannelId: nextSeasonData.genesisPicks?.leaderboardChannelId,
      leaderboardWarning: leaderboard.warning,
      streamInstructionsPosted,
      streamInstructionsWarning,
      matchupHistoryWarning,
      pickSummaryWarning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Discord error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
