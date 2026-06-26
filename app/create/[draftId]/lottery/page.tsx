"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useDraftSetup, type Drafter } from "@/lib/useDraftSetup";
import {
  getGroups,
  groupMembers,
  rebuildOrderedDrafters,
} from "@/lib/draftGroups";
import { WizardSteps } from "@/components/WizardSteps";

function weightedShuffle(members: Drafter[]): Drafter[] {
  const remaining = [...members];
  const newOrder: Drafter[] = [];

  while (remaining.length > 0) {
    const ticketTotal = remaining.reduce(
      (total, drafter) => total + drafter.lotteryTickets,
      0
    );

    let randomNumber = Math.random() * ticketTotal;

    for (let i = 0; i < remaining.length; i++) {
      randomNumber -= remaining[i].lotteryTickets;

      if (randomNumber <= 0) {
        const selected = remaining.splice(i, 1)[0];
        newOrder.push(selected);
        break;
      }
    }
  }

  return newOrder;
}

function equalShuffle(members: Drafter[]): Drafter[] {
  const shuffled = [...members];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[i]];
  }

  return shuffled;
}

export default function LotteryStepPage() {
  const router = useRouter();
  const params = useParams();
  const rawDraftId = params.draftId;
  const draftId = Array.isArray(rawDraftId) ? rawDraftId[0] : rawDraftId;

  const { draft, isLoading, isSaving, message, save } = useDraftSetup(draftId);

  const drafters = draft?.draft_data.drafters ?? [];
  const groups = getGroups(draft?.draft_data.groups);
  const lotteryHasRun = draft?.draft_data.lotteryHasRun ?? false;
  const picksStarted = (draft?.draft_data.picks.length ?? 0) > 0;
  const multipleGroups = groups.length > 1;

  async function runGroupLottery(
    groupId: string,
    shuffle: (members: Drafter[]) => Drafter[]
  ) {
    if (picksStarted) return;

    const members = groupMembers(drafters, groups, groupId);
    if (members.length <= 1) return;

    const shuffled = shuffle(members);
    const others = drafters.filter(
      (drafter) => !members.some((member) => member.id === drafter.id)
    );

    const next = rebuildOrderedDrafters([...others, ...shuffled], groups);
    await save({ drafters: next, lotteryHasRun: true });
  }

  async function runAllLotteries() {
    if (picksStarted) return;

    let nextDrafters = drafters;

    for (const group of groups) {
      if (group.mode !== "lottery") continue;

      const members = groupMembers(nextDrafters, groups, group.id);
      if (members.length <= 1) continue;

      const shuffled = weightedShuffle(members);
      const others = nextDrafters.filter(
        (drafter) => !members.some((member) => member.id === drafter.id)
      );

      nextDrafters = [...others, ...shuffled];
    }

    nextDrafters = rebuildOrderedDrafters(nextDrafters, groups);
    await save({ drafters: nextDrafters, lotteryHasRun: true });
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

  const hasMultipleLotteryGroups =
    groups.filter((group) => group.mode === "lottery").length > 1;

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

        <WizardSteps draftId={draft.id} current="lottery" />

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-bold">Run the Lottery</h2>
          <p className="mt-2 text-sm text-slate-400">
            Run each lottery-mode group&apos;s randomization independently.
            Manual-order groups keep the order you set on the Odds step. The
            final pick order is each group, in order, back to back.
          </p>

          {picksStarted && (
            <div className="mt-5 rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-sm font-semibold text-yellow-100">
              This draft is already in progress, so the order is locked.
            </div>
          )}

          {hasMultipleLotteryGroups && !picksStarted && (
            <button
              onClick={runAllLotteries}
              className="mt-5 rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
            >
              Run All Group Lotteries
            </button>
          )}

          {lotteryHasRun && (
            <div className="mt-5 rounded-2xl border border-green-400/30 bg-green-400/10 p-4 text-sm font-semibold text-green-200">
              Order set. See each group below.
            </div>
          )}

          <div className="mt-5 flex flex-col gap-5">
            {drafters.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 text-slate-500">
                No drafters yet.
              </div>
            ) : (
              groups.map((group) => {
                const members = groupMembers(drafters, groups, group.id);
                const startIndex = groups
                  .slice(0, groups.indexOf(group))
                  .reduce(
                    (total, g) => total + groupMembers(drafters, groups, g.id).length,
                    0
                  );

                return (
                  <div
                    key={group.id}
                    className="overflow-hidden rounded-2xl border border-white/10"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-white/5 px-4 py-3">
                      <p className="text-sm font-black">
                        {group.name}
                        {multipleGroups && (
                          <span className="ml-2 text-xs font-semibold text-slate-400">
                            {group.mode === "manual" ? "Manual order" : "Lottery"}
                          </span>
                        )}
                      </p>

                      {group.mode === "lottery" && !picksStarted && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => runGroupLottery(group.id, weightedShuffle)}
                            disabled={members.length <= 1}
                            className="rounded-xl bg-cyan-400 px-3 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Run Weighted Lottery
                          </button>
                          <button
                            onClick={() => runGroupLottery(group.id, equalShuffle)}
                            disabled={members.length <= 1}
                            className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Randomize Equal Odds
                          </button>
                        </div>
                      )}

                      {group.mode === "manual" && (
                        <span className="text-xs font-semibold text-cyan-300">
                          Set manually on Odds step
                        </span>
                      )}
                    </div>

                    {members.length === 0 ? (
                      <div className="bg-slate-900 p-4 text-sm text-slate-500">
                        No drafters in this group.
                      </div>
                    ) : (
                      members.map((drafter, index) => (
                        <div
                          key={drafter.id}
                          className="flex items-center gap-3 border-b border-white/5 bg-slate-900 px-3 py-2 text-sm last:border-b-0"
                        >
                          <span className="w-8 flex-shrink-0 text-xs text-slate-500">
                            {startIndex + index + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-bold">
                            {drafter.name}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Link
            href={`/create/${draft.id}/odds`}
            className="rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15"
          >
            Back: Odds
          </Link>

          <button
            onClick={() => router.push(`/create/${draft.id}/teams`)}
            disabled={drafters.length === 0}
            className="rounded-2xl bg-cyan-400 px-5 py-3 font-black text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next: Teams
          </button>
        </div>
      </section>
    </main>
  );
}
