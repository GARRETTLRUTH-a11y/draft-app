"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useDraftSetup, type DraftGroup } from "@/lib/useDraftSetup";
import {
  getDrafterGroupId,
  getGroups,
  groupMembers,
  nextGroupName,
  rebuildOrderedDrafters,
} from "@/lib/draftGroups";
import { WizardSteps } from "@/components/WizardSteps";

export default function OddsStepPage() {
  const router = useRouter();
  const params = useParams();
  const rawDraftId = params.draftId;
  const draftId = Array.isArray(rawDraftId) ? rawDraftId[0] : rawDraftId;

  const { draft, isLoading, isSaving, message, save } = useDraftSetup(draftId);

  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const drafters = draft?.draft_data.drafters ?? [];
  const groups = getGroups(draft?.draft_data.groups);
  const picksStarted = (draft?.draft_data.picks.length ?? 0) > 0;
  const multipleGroups = groups.length > 1;

  async function updateTickets(id: number, tickets: number) {
    if (picksStarted) return;

    const safeTickets = Math.max(1, tickets || 1);
    const next = drafters.map((drafter) =>
      drafter.id === id ? { ...drafter, lotteryTickets: safeTickets } : drafter
    );

    await save({ drafters: next, lotteryHasRun: false });
  }

  async function setDrafterGroup(id: number, groupId: string) {
    if (picksStarted) return;

    const next = drafters.map((drafter) =>
      drafter.id === id ? { ...drafter, groupId } : drafter
    );

    await save({
      drafters: rebuildOrderedDrafters(next, groups),
      lotteryHasRun: false,
    });
  }

  async function setGroupMode(groupId: string, mode: DraftGroup["mode"]) {
    if (picksStarted) return;

    const nextGroups = groups.map((group) =>
      group.id === groupId ? { ...group, mode } : group
    );

    await save({ groups: nextGroups, lotteryHasRun: false });
  }

  async function renameGroup(groupId: string, name: string) {
    if (picksStarted) return;

    const cleanName = name.trim();
    if (!cleanName) return;

    const nextGroups = groups.map((group) =>
      group.id === groupId ? { ...group, name: cleanName } : group
    );

    await save({ groups: nextGroups });
  }

  async function addGroup() {
    if (picksStarted) return;

    const newGroup: DraftGroup = {
      id: crypto.randomUUID(),
      name: nextGroupName(groups),
      mode: "lottery",
    };

    await save({ groups: [...groups, newGroup] });
  }

  async function removeGroup(groupId: string) {
    if (picksStarted || groups.length <= 1) return;

    const remainingGroups = groups.filter((group) => group.id !== groupId);

    const next = drafters.map((drafter) =>
      getDrafterGroupId(drafter, groups) === groupId
        ? { ...drafter, groupId: remainingGroups[0].id }
        : drafter
    );

    await save({
      groups: remainingGroups,
      drafters: rebuildOrderedDrafters(next, remainingGroups),
      lotteryHasRun: false,
    });
  }

  async function reorderManualGroup(groupId: string, fromIndex: number, toIndex: number) {
    if (picksStarted || fromIndex === toIndex) return;

    const members = groupMembers(drafters, groups, groupId);
    const reordered = [...members];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    const others = drafters.filter(
      (drafter) => getDrafterGroupId(drafter, groups) !== groupId
    );

    const next = rebuildOrderedDrafters(
      [...others, ...reordered],
      groups
    );

    await save({ drafters: next, lotteryHasRun: true });
  }

  function handleDragStart(groupId: string, index: number) {
    setDragGroupId(groupId);
    setDragIndex(index);
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault();
  }

  function handleDrop(groupId: string, index: number) {
    if (dragGroupId === groupId && dragIndex !== null) {
      reorderManualGroup(groupId, dragIndex, index);
    }
    setDragGroupId(null);
    setDragIndex(null);
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <h1 className="text-4xl font-black">Loading draft...</h1>
        </section>
      </main>
    );
  }

  if (!draft) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
        <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <h1 className="text-4xl font-black">Draft Not Found</h1>
          <p className="mt-4 text-slate-300">{message}</p>
          <Link
            href="/create"
            className="mt-6 inline-flex rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
          >
            Back to Your Drafts
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            CFB Draft Tool
          </p>
          <h1 className="mt-3 text-2xl font-black">
            {draft.draft_data.draftTitle}
          </h1>

          {isSaving && (
            <p className="mt-2 text-xs font-bold text-yellow-200">Saving...</p>
          )}

          {message && (
            <p className="mt-2 text-xs font-bold text-red-300">{message}</p>
          )}
        </header>

        <WizardSteps draftId={draft.id} current="odds" />

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold">Assign Lottery Odds</h2>
              <p className="mt-2 text-sm text-slate-400">
                Give each drafter lottery tickets, or switch a group to manual
                order and drag drafters into place yourself. Use groups when
                part of your group already has a settled order and you only
                want to randomize the rest.
              </p>
            </div>

            <button
              onClick={addGroup}
              disabled={picksStarted}
              className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              + Group
            </button>
          </div>

          {picksStarted && (
            <div className="mt-5 rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-sm font-semibold text-yellow-100">
              This draft is already in progress, so odds and groups are
              locked.
            </div>
          )}

          {drafters.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-white/15 p-5 text-slate-500">
              No drafters yet.{" "}
              <Link href={`/create/${draft.id}/drafters`} className="underline">
                Add drafters first.
              </Link>
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-5">
              {groups.map((group) => {
                const members = groupMembers(drafters, groups, group.id);
                const totalTickets = members.reduce(
                  (total, drafter) => total + drafter.lotteryTickets,
                  0
                );

                return (
                  <div
                    key={group.id}
                    className="overflow-hidden rounded-2xl border border-white/10"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-white/5 px-4 py-3">
                      <input
                        defaultValue={group.name}
                        onBlur={(event) => renameGroup(group.id, event.target.value)}
                        disabled={picksStarted}
                        className="min-w-0 max-w-[12rem] flex-shrink rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-black text-white outline-none focus:border-cyan-300 focus:bg-slate-900 disabled:cursor-not-allowed"
                      />

                      <div className="flex items-center gap-2">
                        <div className="flex overflow-hidden rounded-xl border border-white/10">
                          <button
                            onClick={() => setGroupMode(group.id, "lottery")}
                            disabled={picksStarted}
                            className={`px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed ${
                              group.mode === "lottery"
                                ? "bg-cyan-400 text-slate-950"
                                : "bg-transparent text-slate-300 hover:bg-white/10"
                            }`}
                          >
                            Lottery
                          </button>
                          <button
                            onClick={() => setGroupMode(group.id, "manual")}
                            disabled={picksStarted}
                            className={`px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed ${
                              group.mode === "manual"
                                ? "bg-cyan-400 text-slate-950"
                                : "bg-transparent text-slate-300 hover:bg-white/10"
                            }`}
                          >
                            Manual Order
                          </button>
                        </div>

                        {multipleGroups && (
                          <button
                            onClick={() => removeGroup(group.id)}
                            disabled={picksStarted}
                            className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    {members.length === 0 ? (
                      <div className="bg-slate-900 p-4 text-sm text-slate-500">
                        No drafters in this group yet. Move someone in below.
                      </div>
                    ) : group.mode === "lottery" ? (
                      <div>
                        <div className="flex items-center gap-3 bg-white/5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                          <span className="w-6 flex-shrink-0">#</span>
                          <span className="min-w-0 flex-1">Name</span>
                          {multipleGroups && (
                            <span className="w-32 flex-shrink-0">Group</span>
                          )}
                          <span className="w-12 flex-shrink-0 text-right">
                            Odds
                          </span>
                          <span className="w-20 flex-shrink-0 text-right">
                            Tickets
                          </span>
                        </div>

                        {members.map((drafter, index) => {
                          const odds =
                            totalTickets > 0
                              ? (
                                  (drafter.lotteryTickets / totalTickets) *
                                  100
                                ).toFixed(1)
                              : "0.0";

                          return (
                            <div
                              key={drafter.id}
                              className="flex items-center gap-3 border-b border-white/5 bg-slate-900 px-3 py-2 text-sm last:border-b-0"
                            >
                              <span className="w-6 flex-shrink-0 text-xs text-slate-500">
                                {index + 1}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-bold">
                                {drafter.name}
                              </span>
                              {multipleGroups && (
                                <select
                                  value={group.id}
                                  onChange={(event) =>
                                    setDrafterGroup(drafter.id, event.target.value)
                                  }
                                  disabled={picksStarted}
                                  className="w-32 flex-shrink-0 rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-xs text-white outline-none focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {groups.map((g) => (
                                    <option key={g.id} value={g.id}>
                                      {g.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <span className="w-12 flex-shrink-0 text-right text-xs text-cyan-300">
                                {odds}%
                              </span>
                              <input
                                type="number"
                                min={1}
                                value={drafter.lotteryTickets}
                                onChange={(event) =>
                                  updateTickets(drafter.id, Number(event.target.value))
                                }
                                disabled={picksStarted}
                                className="w-20 flex-shrink-0 rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-right text-xs text-white outline-none focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div>
                        <div className="bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100">
                          Drag to set this group&apos;s draft order directly.
                        </div>

                        {members.map((drafter, index) => (
                          <div
                            key={drafter.id}
                            draggable={!picksStarted}
                            onDragStart={() => handleDragStart(group.id, index)}
                            onDragOver={handleDragOver}
                            onDrop={() => handleDrop(group.id, index)}
                            className="flex items-center gap-3 border-b border-white/5 bg-slate-900 px-3 py-2 text-sm last:border-b-0"
                          >
                            <span className="cursor-grab text-slate-500">⠿</span>
                            <span className="w-6 flex-shrink-0 text-xs text-slate-500">
                              {index + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-bold">
                              {drafter.name}
                            </span>
                            {multipleGroups && (
                              <select
                                value={group.id}
                                onChange={(event) =>
                                  setDrafterGroup(drafter.id, event.target.value)
                                }
                                disabled={picksStarted}
                                className="w-32 flex-shrink-0 rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-xs text-white outline-none focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {groups.map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name}
                                  </option>
                                ))}
                              </select>
                            )}
                            <div className="flex flex-shrink-0 gap-1">
                              <button
                                onClick={() =>
                                  reorderManualGroup(group.id, index, Math.max(0, index - 1))
                                }
                                disabled={picksStarted || index === 0}
                                className="rounded-lg bg-white/10 px-2 py-1 text-xs font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                ↑
                              </button>
                              <button
                                onClick={() =>
                                  reorderManualGroup(
                                    group.id,
                                    index,
                                    Math.min(members.length - 1, index + 1)
                                  )
                                }
                                disabled={picksStarted || index === members.length - 1}
                                className="rounded-lg bg-white/10 px-2 py-1 text-xs font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                ↓
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Link
            href={`/create/${draft.id}/drafters`}
            className="rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15"
          >
            Back: Drafters
          </Link>

          <button
            onClick={() => router.push(`/create/${draft.id}/lottery`)}
            disabled={drafters.length === 0}
            className="rounded-2xl bg-cyan-400 px-5 py-3 font-black text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next: Lottery
          </button>
        </div>
      </section>
    </main>
  );
}
