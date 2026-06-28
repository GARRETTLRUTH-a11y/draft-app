"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useDraftSetup } from "@/lib/useDraftSetup";
import { WizardSteps } from "@/components/WizardSteps";
import { CFB_ITEMS, CONFERENCE_ORDER, CONFERENCE_TIERS, TIER_ORDER } from "@/lib/cfbTeams";
import { buildTiers, groupItemsByConference } from "@/lib/draftBoard";
import { CompactDraftBoard } from "@/components/CompactDraftBoard";
import { StarRatingSelector } from "@/components/StarRatingSelector";

export default function TeamsStepPage() {
  const router = useRouter();
  const params = useParams();
  const rawDraftId = params.draftId;
  const draftId = Array.isArray(rawDraftId) ? rawDraftId[0] : rawDraftId;

  const { draft, isLoading, isSaving, message, save } = useDraftSetup(draftId);

  const [minPrestige, setMinPrestige] = useState(0);

  const eligibleIds = useMemo(
    () => new Set((draft?.draft_data.availableItems ?? []).map((item) => item.id)),
    [draft]
  );

  const picksStarted = (draft?.draft_data.picks.length ?? 0) > 0;

  const allTeamsTiers = useMemo(
    () =>
      buildTiers(
        groupItemsByConference(CFB_ITEMS, [], CONFERENCE_ORDER).groups,
        CONFERENCE_TIERS,
        TIER_ORDER
      ),
    []
  );

  async function applyEligibility(nextIds: Set<number>) {
    const nextAvailableItems = CFB_ITEMS.filter((item) => nextIds.has(item.id));
    await save({ availableItems: nextAvailableItems });
  }

  function toggleTeam(id: number) {
    if (picksStarted) return;

    const next = new Set(eligibleIds);

    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }

    applyEligibility(next);
  }

  function applyPrestigeFilter() {
    if (picksStarted) return;

    const next = new Set(eligibleIds);

    CFB_ITEMS.forEach((item) => {
      if (item.prestige != null && item.prestige < minPrestige) {
        next.delete(item.id);
      }
    });

    applyEligibility(next);
  }

  function setConferenceEligibility(conference: string, eligible: boolean) {
    if (picksStarted) return;

    const conferenceIds = CFB_ITEMS.filter(
      (item) => item.category === conference
    ).map((item) => item.id);

    const next = new Set(eligibleIds);

    conferenceIds.forEach((id) => {
      if (eligible) {
        next.add(id);
      } else {
        next.delete(id);
      }
    });

    applyEligibility(next);
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
      <section className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
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

        <WizardSteps draftId={draft.id} current="teams" />

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-2xl font-bold">CFB Team Pool</h2>
              <p className="mt-2 text-sm text-slate-400">
                Disable any teams or whole conferences you don&apos;t want
                eligible for this draft.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-300">
              <span className="font-bold text-cyan-300">
                {eligibleIds.size}
              </span>{" "}
              / {CFB_ITEMS.length} teams eligible
            </div>
          </div>

          {picksStarted && (
            <div className="mt-5 rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-sm font-semibold text-yellow-100">
              This draft is already in progress, so team eligibility is
              locked.
            </div>
          )}

          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-white">
                Exclude by Prestige
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Pick a minimum prestige, then exclude every rated team below
                it. Unrated (TBD) teams are never excluded by this filter.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <StarRatingSelector
                value={minPrestige}
                onChange={setMinPrestige}
                disabled={picksStarted}
              />

              <span className="w-10 flex-shrink-0 text-sm font-bold text-cyan-300">
                {minPrestige.toFixed(1)}★
              </span>

              <button
                onClick={applyPrestigeFilter}
                disabled={picksStarted}
                className="flex-shrink-0 rounded-xl bg-cyan-400 px-3 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Exclude Below {minPrestige.toFixed(1)}★
              </button>
            </div>
          </div>

          <div className="mt-5">
            <CompactDraftBoard
              tiers={allTeamsTiers}
              getStatus={(item) =>
                eligibleIds.has(item.id)
                  ? { variant: "available" }
                  : { variant: "disabled", badge: "Excluded" }
              }
              onSelect={(item) => toggleTeam(item.id)}
              isClickable={() => !picksStarted}
              groupActions={(category) => (
                <>
                  <button
                    onClick={() => setConferenceEligibility(category, true)}
                    disabled={picksStarted}
                    className="rounded-lg bg-white/10 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Enable All
                  </button>

                  <button
                    onClick={() => setConferenceEligibility(category, false)}
                    disabled={picksStarted}
                    className="rounded-lg bg-white/10 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Disable All
                  </button>
                </>
              )}
              legend={[
                { label: "Eligible", swatchClassName: "bg-white/10" },
                { label: "Excluded", swatchClassName: "bg-slate-800/60" },
              ]}
            />
          </div>
        </section>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Link
            href={`/create/${draft.id}/lottery`}
            className="rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15"
          >
            Back: Lottery
          </Link>

          <button
            onClick={() => router.push(`/create/${draft.id}/summary`)}
            className="rounded-2xl bg-cyan-400 px-5 py-3 font-black text-slate-950 transition hover:bg-cyan-300"
          >
            Next: Summary
          </button>
        </div>
      </section>
    </main>
  );
}
