"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useDraftSetup, type Drafter } from "@/lib/useDraftSetup";
import { WizardSteps } from "@/components/WizardSteps";

export default function LotteryStepPage() {
  const router = useRouter();
  const params = useParams();
  const rawDraftId = params.draftId;
  const draftId = Array.isArray(rawDraftId) ? rawDraftId[0] : rawDraftId;

  const { draft, isLoading, isSaving, message, save } = useDraftSetup(draftId);

  const drafters = draft?.draft_data.drafters ?? [];
  const lotteryHasRun = draft?.draft_data.lotteryHasRun ?? false;
  const picksStarted = (draft?.draft_data.picks.length ?? 0) > 0;

  async function runWeightedLottery() {
    if (picksStarted || drafters.length <= 1) return;

    const remaining = [...drafters];
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

    await save({ drafters: newOrder, lotteryHasRun: true });
  }

  async function randomizeEqualOdds() {
    if (picksStarted || drafters.length <= 1) return;

    const shuffled = [...drafters];

    for (let i = shuffled.length - 1; i > 0; i--) {
      const randomIndex = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[i]];
    }

    await save({ drafters: shuffled, lotteryHasRun: true });
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

        <WizardSteps draftId={draft.id} current="lottery" />

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-bold">Run the Lottery</h2>
          <p className="mt-2 text-sm text-slate-400">
            Run a weighted lottery using each drafter&apos;s tickets, or just
            randomize with equal odds. This sets the pick order.
          </p>

          {picksStarted && (
            <div className="mt-5 rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-sm font-semibold text-yellow-100">
              This draft is already in progress, so the order is locked.
            </div>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              onClick={runWeightedLottery}
              disabled={picksStarted || drafters.length <= 1}
              className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Run Weighted Lottery
            </button>

            <button
              onClick={randomizeEqualOdds}
              disabled={picksStarted || drafters.length <= 1}
              className="rounded-2xl bg-white px-5 py-3 font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Randomize Equal Odds
            </button>
          </div>

          {drafters.length <= 1 && (
            <p className="mt-3 text-xs text-slate-500">
              Add at least two drafters to run the lottery.
            </p>
          )}

          {lotteryHasRun && (
            <div className="mt-5 rounded-2xl border border-green-400/30 bg-green-400/10 p-4 text-sm font-semibold text-green-200">
              Lottery complete. Draft order below.
            </div>
          )}

          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
            {drafters.length === 0 ? (
              <div className="p-5 text-slate-500">No drafters yet.</div>
            ) : (
              drafters.map((drafter, index) => (
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
                </div>
              ))
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
