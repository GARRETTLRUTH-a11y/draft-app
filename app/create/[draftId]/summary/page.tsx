"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useDraftSetup } from "@/lib/useDraftSetup";
import { WizardSteps } from "@/components/WizardSteps";
import { CFB_ITEMS } from "@/lib/cfbTeams";

export default function SummaryStepPage() {
  const router = useRouter();
  const params = useParams();
  const rawDraftId = params.draftId;
  const draftId = Array.isArray(rawDraftId) ? rawDraftId[0] : rawDraftId;

  const { draft, isLoading, message } = useDraftSetup(draftId);

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

  const { drafters, availableItems, lotteryHasRun, picks } = draft.draft_data;
  const totalTickets = drafters.reduce(
    (total, drafter) => total + drafter.lotteryTickets,
    0
  );
  const picksStarted = picks.length > 0;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            CFB Draft Tool
          </p>
          <h1 className="mt-3 text-2xl font-black">{draft.draft_data.draftTitle}</h1>
        </header>

        <WizardSteps draftId={draft.id} current="summary" />

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-bold">Summary</h2>
          <p className="mt-2 text-sm text-slate-400">
            Review everything below, then start the draft.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-slate-900 p-4">
              <div className="text-2xl font-black">{drafters.length}</div>
              <div className="text-xs text-slate-400">Drafters</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900 p-4">
              <div className="text-2xl font-black">{availableItems.length}</div>
              <div className="text-xs text-slate-400">
                / {CFB_ITEMS.length} Teams Eligible
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900 p-4">
              <div className="text-2xl font-black">
                {lotteryHasRun ? "Set" : "Default"}
              </div>
              <div className="text-xs text-slate-400">Draft Order</div>
            </div>
          </div>

          {drafters.length === 0 && (
            <div className="mt-5 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm font-semibold text-red-200">
              You need at least one drafter before starting.{" "}
              <Link href={`/create/${draft.id}/drafters`} className="underline">
                Add drafters
              </Link>
              .
            </div>
          )}

          {availableItems.length === 0 && drafters.length > 0 && (
            <div className="mt-5 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm font-semibold text-red-200">
              No teams are eligible.{" "}
              <Link href={`/create/${draft.id}/teams`} className="underline">
                Enable some teams
              </Link>
              .
            </div>
          )}

          {!lotteryHasRun && drafters.length > 1 && (
            <div className="mt-5 rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-sm font-semibold text-yellow-100">
              You haven&apos;t run the lottery yet. Drafters will pick in the
              order they were added unless you{" "}
              <Link href={`/create/${draft.id}/lottery`} className="underline">
                run it now
              </Link>
              .
            </div>
          )}

          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
            <div className="flex items-center gap-3 border-b border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              <span className="w-6 flex-shrink-0">#</span>
              <span className="min-w-0 flex-1">Name</span>
              <span className="w-12 flex-shrink-0 text-right">Odds</span>
            </div>

            {drafters.length === 0 ? (
              <div className="p-5 text-slate-500">No drafters yet.</div>
            ) : (
              drafters.map((drafter, index) => {
                const odds =
                  totalTickets > 0
                    ? ((drafter.lotteryTickets / totalTickets) * 100).toFixed(1)
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
                    <span className="w-12 flex-shrink-0 text-right text-xs text-cyan-300">
                      {odds}%
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Link
            href={`/create/${draft.id}/teams`}
            className="rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15"
          >
            Back: Teams
          </Link>

          <button
            onClick={() => router.push(`/room/${draft.id}`)}
            disabled={drafters.length === 0 || availableItems.length === 0}
            className="rounded-2xl bg-green-400 px-5 py-3 font-black text-slate-950 transition hover:bg-green-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {picksStarted ? "Go to Live Room" : "Start Draft"}
          </button>
        </div>
      </section>
    </main>
  );
}
