"use client";

import { CompactDraftBoard } from "@/components/CompactDraftBoard";
import { TEAM_PRESTIGE } from "@/lib/cfbTeams";
import type { ItemTier } from "@/lib/draftBoard";

type ExampleTeam = {
  id: number;
  name: string;
  category: string;
  description: string;
  color: string;
  drafter?: string;
  prestige?: number | null;
};

const EXAMPLE_TIERS: ItemTier<ExampleTeam>[] = [
  {
    tier: "Power Conferences",
    groups: [
      {
        category: "SEC",
        items: [
          { id: 1, name: "Alabama", category: "SEC", description: "", color: "#9E1B32", drafter: "Garrett", prestige: TEAM_PRESTIGE.Alabama },
          { id: 2, name: "Georgia", category: "SEC", description: "", color: "#BA0C2F", prestige: TEAM_PRESTIGE.Georgia },
          { id: 3, name: "LSU", category: "SEC", description: "", color: "#461D7C", prestige: TEAM_PRESTIGE.LSU },
        ],
      },
      {
        category: "Big Ten",
        items: [
          { id: 4, name: "Ohio State", category: "Big Ten", description: "", color: "#BB0000", drafter: "Chris", prestige: TEAM_PRESTIGE["Ohio State"] },
          { id: 5, name: "Michigan", category: "Big Ten", description: "", color: "#00274C", prestige: TEAM_PRESTIGE.Michigan },
          { id: 6, name: "Oregon", category: "Big Ten", description: "", color: "#154733", prestige: TEAM_PRESTIGE.Oregon },
        ],
      },
      {
        category: "Big 12",
        items: [
          { id: 7, name: "Texas Tech", category: "Big 12", description: "", color: "#CC0000", drafter: "Tyler", prestige: TEAM_PRESTIGE["Texas Tech"] },
          { id: 8, name: "Kansas State", category: "Big 12", description: "", color: "#512888", prestige: TEAM_PRESTIGE["Kansas State"] },
          { id: 9, name: "BYU", category: "Big 12", description: "", color: "#002E5D", prestige: TEAM_PRESTIGE.BYU },
        ],
      },
    ],
  },
];

export function HomeDraftPreview() {
  return (
    <CompactDraftBoard
      tiers={EXAMPLE_TIERS}
      getStatus={(item) =>
        item.drafter
          ? { variant: "taken", badge: item.drafter }
          : { variant: "available" }
      }
      legend={[
        { label: "Drafted", swatchClassName: "bg-green-400/20" },
        { label: "Available", swatchClassName: "bg-white/10" },
      ]}
    />
  );
}
