"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useDraftSetup, type Drafter } from "@/lib/useDraftSetup";
import { WizardSteps } from "@/components/WizardSteps";

export default function DraftersStepPage() {
  const router = useRouter();
  const params = useParams();
  const rawDraftId = params.draftId;
  const draftId = Array.isArray(rawDraftId) ? rawDraftId[0] : rawDraftId;

  const { draft, isLoading, isSaving, message, save } = useDraftSetup(draftId);

  const [newDrafter, setNewDrafter] = useState("");
  const [bulkDraftersText, setBulkDraftersText] = useState("");

  const drafters = draft?.draft_data.drafters ?? [];
  const picksStarted = (draft?.draft_data.picks.length ?? 0) > 0;

  async function saveTitle(value: string) {
    const cleanTitle = value.trim() || "Untitled Draft";
    await save({ draftTitle: cleanTitle });
  }

  async function addDrafter() {
    if (picksStarted) return;

    const cleanedName = newDrafter.trim();
    if (!cleanedName) return;
    if (drafters.some((drafter) => drafter.name === cleanedName)) return;

    const next = [
      ...drafters,
      { id: Date.now(), name: cleanedName, lotteryTickets: 10 },
    ];

    setNewDrafter("");
    await save({ drafters: next, lotteryHasRun: false });
  }

  async function bulkAddDrafters() {
    if (picksStarted) return;

    const lines = bulkDraftersText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) return;

    const existingNames = new Set(
      drafters.map((drafter) => drafter.name.toLowerCase())
    );

    const newDrafters: Drafter[] = [];

    lines.forEach((line, index) => {
      const parts = line.split(",");
      const name = parts[0]?.trim();
      const ticketValue = Number(parts[1]?.trim());
      const lotteryTickets = Math.max(1, ticketValue || 10);

      if (!name) return;
      if (existingNames.has(name.toLowerCase())) return;

      newDrafters.push({
        id: Date.now() + index,
        name,
        lotteryTickets,
      });

      existingNames.add(name.toLowerCase());
    });

    if (newDrafters.length === 0) return;

    const next = [...drafters, ...newDrafters];
    setBulkDraftersText("");
    await save({ drafters: next, lotteryHasRun: false });
  }

  async function removeDrafter(id: number) {
    if (picksStarted) return;

    const next = drafters.filter((drafter) => drafter.id !== id);
    await save({ drafters: next, lotteryHasRun: false });
  }

  async function clearAllDrafters() {
    if (picksStarted) return;

    await save({ drafters: [], lotteryHasRun: false });
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
          <p className="mt-4 text-slate-300">
            {message || "Sign in and try again, or it may have been deleted."}
          </p>
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

          <input
            key={draft.id}
            defaultValue={draft.draft_data.draftTitle}
            onBlur={(event) => saveTitle(event.target.value)}
            className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-2xl font-black text-white outline-none focus:border-cyan-300"
          />

          {isSaving && (
            <p className="mt-2 text-xs font-bold text-yellow-200">Saving...</p>
          )}

          {message && (
            <p className="mt-2 text-xs font-bold text-red-300">{message}</p>
          )}
        </header>

        <WizardSteps draftId={draft.id} current="drafters" />

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold">Drafters</h2>
              <p className="mt-2 text-sm text-slate-400">
                Add everyone who will be drafting a team.
              </p>
            </div>

            <button
              onClick={clearAllDrafters}
              disabled={picksStarted || drafters.length === 0}
              className="rounded-2xl bg-white/10 px-4 py-2 text-xs font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear All
            </button>
          </div>

          {picksStarted && (
            <div className="mt-5 rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-sm font-semibold text-yellow-100">
              This draft is already in progress, so drafters are locked. Visit
              the Room to continue.
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <input
              value={newDrafter}
              onChange={(event) => setNewDrafter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addDrafter();
              }}
              disabled={picksStarted}
              placeholder="Add drafter..."
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            />

            <button
              onClick={addDrafter}
              disabled={picksStarted}
              className="rounded-2xl bg-white px-4 py-3 font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add
            </button>
          </div>

          <div className="mt-5 rounded-3xl border border-white/10 bg-slate-900 p-5">
            <h3 className="text-lg font-bold">Bulk Add Drafters</h3>
            <p className="mt-2 text-xs text-slate-400">
              One per line. Format: Name, Tickets
            </p>

            <textarea
              value={bulkDraftersText}
              onChange={(event) => setBulkDraftersText(event.target.value)}
              disabled={picksStarted}
              placeholder={`Garrett, 30\nChris, 24\nTyler, 18\nJohn, 14`}
              className="mt-4 min-h-32 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            />

            <button
              onClick={bulkAddDrafters}
              disabled={picksStarted}
              className="mt-3 rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Bulk Add Drafters
            </button>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
            {drafters.length === 0 ? (
              <div className="p-5 text-slate-500">
                No drafters yet. Add people above to continue.
              </div>
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
                  <button
                    onClick={() => removeDrafter(drafter.id)}
                    disabled={picksStarted}
                    className="w-6 flex-shrink-0 rounded-lg bg-white/10 py-1 text-xs font-bold text-slate-300 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Link
            href="/create"
            className="rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15"
          >
            Back to Your Drafts
          </Link>

          <button
            onClick={() => router.push(`/create/${draft.id}/odds`)}
            disabled={drafters.length === 0}
            className="rounded-2xl bg-cyan-400 px-5 py-3 font-black text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next: Odds
          </button>
        </div>
      </section>
    </main>
  );
}
