export type DraftItemLike = {
  id: number;
  name: string;
  category: string;
  description: string;
  color?: string;
};

export type ItemGroup<T extends DraftItemLike> = {
  category: string;
  items: T[];
};

export type ItemTier<T extends DraftItemLike> = {
  tier: string;
  groups: ItemGroup<T>[];
};

export type PickLike<T extends DraftItemLike> = {
  pickNumber: number;
  drafter: string;
  item: T;
};

export function groupItemsByConference<T extends DraftItemLike>(
  availableItems: T[],
  picks: PickLike<T>[],
  conferenceOrder?: string[]
) {
  const pickByItemId = new Map<number, PickLike<T>>();
  picks.forEach((pick) => pickByItemId.set(pick.item.id, pick));

  const allItems = [...availableItems, ...picks.map((pick) => pick.item)];

  const grouped = new Map<string, T[]>();
  allItems.forEach((item) => {
    const list = grouped.get(item.category) || [];
    list.push(item);
    grouped.set(item.category, list);
  });

  const orderedCategories = conferenceOrder
    ? [
        ...conferenceOrder.filter((category) => grouped.has(category)),
        ...[...grouped.keys()]
          .filter((category) => !conferenceOrder.includes(category))
          .sort(),
      ]
    : [...grouped.keys()].sort();

  return {
    pickByItemId,
    groups: orderedCategories.map((category) => ({
      category,
      items: grouped.get(category) || [],
    })),
  };
}

export function buildTiers<T extends DraftItemLike>(
  groups: ItemGroup<T>[],
  tierByCategory?: Record<string, string>,
  tierOrder?: string[]
): ItemTier<T>[] {
  if (!tierByCategory) {
    return [{ tier: "Items", groups }];
  }

  const byTier = new Map<string, ItemGroup<T>[]>();

  groups.forEach((group) => {
    const tier = tierByCategory[group.category] || "Other";
    const list = byTier.get(tier) || [];
    list.push(group);
    byTier.set(tier, list);
  });

  const orderedTiers = tierOrder
    ? [
        ...tierOrder.filter((tier) => byTier.has(tier)),
        ...[...byTier.keys()].filter((tier) => !tierOrder.includes(tier)),
      ]
    : [...byTier.keys()];

  return orderedTiers.map((tier) => ({
    tier,
    groups: byTier.get(tier) || [],
  }));
}
