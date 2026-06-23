"use client";

import type { ReactNode } from "react";
import type { DraftItemLike, ItemTier } from "@/lib/draftBoard";

export type ItemStatus = {
  variant: "available" | "taken" | "disabled";
  badge?: string;
};

type CompactDraftBoardProps<T extends DraftItemLike> = {
  tiers: ItemTier<T>[];
  getStatus: (item: T) => ItemStatus;
  onSelect?: (item: T) => void;
  isClickable?: (item: T) => boolean;
  groupActions?: (category: string) => ReactNode;
  emptyMessage?: string;
  legend?: { label: string; swatchClassName: string }[];
  strikethroughOnTaken?: boolean;
};

const VARIANT_ROW_CLASSES: Record<ItemStatus["variant"], string> = {
  available: "text-white",
  taken: "cursor-default bg-green-400/20 text-green-100",
  disabled: "bg-slate-800/60 text-slate-500",
};

const VARIANT_DOT_COLOR: Record<ItemStatus["variant"], string | undefined> = {
  available: undefined,
  taken: "#4ade80",
  disabled: "#475569",
};

const VARIANT_BADGE_CLASSES: Record<string, string> = {
  taken: "border-green-400/30 bg-green-400/10 text-green-200",
  disabled: "border-slate-400/30 bg-slate-400/10 text-slate-400",
};

export function CompactDraftBoard<T extends DraftItemLike>({
  tiers,
  getStatus,
  onSelect,
  isClickable,
  groupActions,
  emptyMessage = "No items.",
  legend,
  strikethroughOnTaken = true,
}: CompactDraftBoardProps<T>) {
  const hasAnyItems = tiers.some((tier) =>
    tier.groups.some((group) => group.items.length > 0)
  );

  if (!hasAnyItems) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 p-5 text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {tiers.map((tier) => {
        const visibleGroups = tier.groups.filter(
          (group) => group.items.length > 0
        );

        if (visibleGroups.length === 0) return null;

        return (
          <div
            key={tier.tier}
            className="overflow-hidden rounded-2xl border border-white/10"
          >
            <div className="bg-slate-950 px-4 py-1.5 text-center text-xs font-black uppercase tracking-[0.25em] text-amber-300">
              {tier.tier}
            </div>

            <div
              className="grid divide-x divide-white/10 bg-slate-900"
              style={{
                gridTemplateColumns: `repeat(${visibleGroups.length}, minmax(0, 1fr))`,
              }}
            >
              {visibleGroups.map((group) => (
                <div key={group.category} className="flex flex-col">
                  <div className="border-b border-white/10 bg-white/5 px-2 py-1.5 text-center text-xs font-bold italic text-cyan-300">
                    {group.category}
                  </div>

                  {groupActions && (
                    <div className="flex justify-center gap-1 border-b border-white/10 bg-white/5 px-2 py-1.5">
                      {groupActions(group.category)}
                    </div>
                  )}

                  <div className="flex flex-col">
                    {group.items.map((item) => {
                      const status = getStatus(item);
                      const clickable =
                        Boolean(onSelect) &&
                        status.variant !== "taken" &&
                        (isClickable ? isClickable(item) : true);

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => clickable && onSelect?.(item)}
                          disabled={!clickable}
                          title={
                            status.variant === "taken"
                              ? `Drafted by ${status.badge}`
                              : status.variant === "disabled"
                                ? "Excluded from this draft"
                                : item.description
                          }
                          className={`flex items-center gap-1.5 border-b border-white/5 px-2 py-1 text-left text-xs transition last:border-b-0 ${
                            VARIANT_ROW_CLASSES[status.variant]
                          } ${
                            clickable
                              ? "cursor-pointer hover:bg-white/10"
                              : status.variant === "available"
                                ? "cursor-default text-slate-500"
                                : "cursor-default"
                          }`}
                        >
                          {item.color && (
                            <span
                              className="h-2 w-2 flex-shrink-0 rounded-full"
                              style={{
                                backgroundColor:
                                  VARIANT_DOT_COLOR[status.variant] ??
                                  item.color,
                              }}
                            />
                          )}

                          <span
                            className={`truncate font-semibold ${
                              status.variant === "disabled" ||
                              (status.variant === "taken" &&
                                strikethroughOnTaken)
                                ? "line-through"
                                : ""
                            }`}
                          >
                            {item.name}
                          </span>

                          {status.badge && status.variant !== "available" && (
                            <span
                              className={`ml-auto flex-shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${
                                VARIANT_BADGE_CLASSES[status.variant]
                              }`}
                            >
                              {status.variant === "disabled" ? "✕ " : ""}
                              {status.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {legend && legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          {legend.map((entry) => (
            <span key={entry.label} className="flex items-center gap-2">
              <span className={`h-3 w-3 rounded ${entry.swatchClassName}`} />{" "}
              {entry.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
