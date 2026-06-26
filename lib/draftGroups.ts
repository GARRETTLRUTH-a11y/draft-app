import type { DraftGroup, Drafter } from "@/lib/useDraftSetup";

export const DEFAULT_GROUP_ID = "default";

const GROUP_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function getGroups(groups: DraftGroup[] | undefined): DraftGroup[] {
  if (groups && groups.length > 0) return groups;
  return [{ id: DEFAULT_GROUP_ID, name: "Group A", mode: "lottery" }];
}

export function getDrafterGroupId(
  drafter: Drafter,
  groups: DraftGroup[]
): string {
  if (drafter.groupId && groups.some((group) => group.id === drafter.groupId)) {
    return drafter.groupId;
  }
  return groups[0].id;
}

export function groupMembers(
  drafters: Drafter[],
  groups: DraftGroup[],
  groupId: string
): Drafter[] {
  return drafters.filter(
    (drafter) => getDrafterGroupId(drafter, groups) === groupId
  );
}

export function nextGroupName(existingGroups: DraftGroup[]): string {
  const usedNames = new Set(existingGroups.map((group) => group.name));

  for (const letter of GROUP_LETTERS) {
    const candidate = `Group ${letter}`;
    if (!usedNames.has(candidate)) return candidate;
  }

  return `Group ${existingGroups.length + 1}`;
}

export function rebuildOrderedDrafters(
  drafters: Drafter[],
  groups: DraftGroup[]
): Drafter[] {
  return groups.flatMap((group) => groupMembers(drafters, groups, group.id));
}
