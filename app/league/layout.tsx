import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "League Hub | CFB League Hub",
  description:
    "Create or select a college football league, then enter its live draft or in-season management workspace.",
};

export default function LeagueLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
