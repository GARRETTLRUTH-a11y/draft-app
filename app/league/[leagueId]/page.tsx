import type { Metadata } from "next";
import { LeagueWorkspace } from "@/components/LeagueWorkspace";

export const metadata: Metadata = {
  title: "League Workspace | CFB League Hub",
  description: "Choose the live draft or in-season management workspace for your league.",
};

export default async function LeagueWorkspacePage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  return <LeagueWorkspace leagueId={leagueId} />;
}
