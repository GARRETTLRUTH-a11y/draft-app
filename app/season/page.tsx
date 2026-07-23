"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ChangeEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { createSeasonDataFromCsv, createSeasonDataFromDraft } from "@/lib/season";
import type { SavedDraftState } from "@/lib/useDraftSetup";

type CloudSeason = {
  id: string;
  title: string;
  updated_at: string;
};

type CloudDraft = {
  id: string;
  title: string;
  updated_at: string;
  draft_data: SavedDraftState;
};

export default function SeasonListPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<CloudSeason[]>([]);
  const [drafts, setDrafts] = useState<CloudDraft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [importingDraftId, setImportingDraftId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const [csvTitle, setCsvTitle] = useState("");
  const [csvText, setCsvText] = useState("");
  const [isImportingCsv, setIsImportingCsv] = useState(false);

  useEffect(() => {
    loadEverything();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);

      if (session?.user) {
        loadEverything();
      } else {
        setSeasons([]);
        setDrafts([]);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function loadEverything() {
    setIsLoading(true);
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();
    setUserEmail(userData.user?.email ?? null);

    if (!userData.user) {
      setSeasons([]);
      setDrafts([]);
      setIsLoading(false);
      return;
    }

    const [seasonsResult, draftsResult] = await Promise.all([
      supabase
        .from("seasons")
        .select("id, title, updated_at")
        .eq("user_id", userData.user.id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("drafts")
        .select("id, title, updated_at, draft_data")
        .eq("user_id", userData.user.id)
        .order("updated_at", { ascending: false }),
    ]);

    if (seasonsResult.error) {
      setMessage(seasonsResult.error.message);
    } else {
      setSeasons((seasonsResult.data || []) as CloudSeason[]);
    }

    if (!draftsResult.error) {
      setDrafts((draftsResult.data || []) as CloudDraft[]);
    }

    setIsLoading(false);
  }

  async function importFromDraft(draft: CloudDraft) {
    setImportingDraftId(draft.id);
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setMessage("Sign in before creating a season.");
      setImportingDraftId(null);
      return;
    }

    const seasonTitle = `${draft.draft_data.draftTitle || draft.title} — Weekly Check-In`;
    const seasonData = createSeasonDataFromDraft(seasonTitle, draft.id, draft.draft_data);

    const { data: newSeason, error: seasonError } = await supabase
      .from("seasons")
      .insert({
        user_id: userData.user.id,
        title: seasonTitle,
        season_data: seasonData,
        is_joinable: true,
      })
      .select("id")
      .single();

    if (seasonError) {
      setMessage(seasonError.message);
      setImportingDraftId(null);
      return;
    }

    const { data: draftParticipants, error: participantsError } = await supabase
      .from("draft_participants")
      .select("user_id, drafter_name, role")
      .eq("draft_id", draft.id);

    if (!participantsError && draftParticipants && draftParticipants.length > 0) {
      const seenUserIds = new Set<string>();
      const rows = draftParticipants
        .filter((participant) => {
          if (seenUserIds.has(participant.user_id)) return false;
          seenUserIds.add(participant.user_id);
          return true;
        })
        .map((participant) => ({
          season_id: newSeason.id,
          user_id: participant.user_id,
          player_name: participant.drafter_name,
          role: participant.role,
        }));

      const { error: copyError } = await supabase
        .from("season_participants")
        .insert(rows);

      if (copyError) {
        setMessage(
          `Season created, but couldn't carry over everyone's claimed slot automatically: ${copyError.message}`
        );
      }
    }

    router.push(`/season/room/${newSeason.id}`);
  }

  function handleCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ""));
      setCsvTitle((current) => current || file.name.replace(/\.csv$/i, ""));
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  async function importFromCsv() {
    setMessage("");

    if (!csvText.trim()) {
      setMessage("Paste or upload a CSV first.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setMessage("Sign in before creating a season.");
      return;
    }

    let seasonData;
    try {
      seasonData = createSeasonDataFromCsv(
        csvTitle.trim() || "Weekly Check-In",
        csvText
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read that CSV.");
      return;
    }

    setIsImportingCsv(true);

    const { data: newSeason, error } = await supabase
      .from("seasons")
      .insert({
        user_id: userData.user.id,
        title: seasonData.seasonTitle,
        season_data: seasonData,
        is_joinable: true,
      })
      .select("id")
      .single();

    if (error) {
      setMessage(error.message);
      setIsImportingCsv(false);
      return;
    }

    router.push(`/season/room/${newSeason.id}`);
  }

  async function deleteSeason(seasonId: string) {
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setMessage("Sign in before deleting seasons.");
      return;
    }

    const { error } = await supabase
      .from("seasons")
      .delete()
      .eq("id", seasonId)
      .eq("user_id", userData.user.id);

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Season deleted.");
      await loadEverything();
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-8">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
            Season Check-In
          </p>

          <div className="mt-4">
            <h1 className="text-4xl font-black tracking-tight md:text-5xl">
              Your Seasons
            </h1>
            <p className="mt-3 max-w-xl text-slate-300">
              Import a finished draft to bring in everyone who claimed a team,
              then track who&apos;s ready to advance each week and manage
              extension requests.
            </p>
          </div>

          {userEmail && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm font-semibold text-cyan-100">
              <span>Signed in as {userEmail}</span>

              <button
                onClick={signOut}
                className="rounded-xl bg-white/10 px-4 py-2 font-bold text-white transition hover:bg-white/15"
              >
                Sign Out
              </button>
            </div>
          )}

          {message && (
            <div className="mt-5 rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-sm font-semibold text-yellow-100">
              {message}
            </div>
          )}

          <div className="mt-5">
            <Link
              href="/"
              className="text-sm font-bold text-slate-400 transition hover:text-white"
            >
              ← Back to Home
            </Link>
          </div>
        </header>

        {!userEmail && !isLoading && (
          <section className="rounded-3xl border border-yellow-400/30 bg-yellow-400/10 p-6">
            <h2 className="text-2xl font-black">Sign in required</h2>
            <p className="mt-2 text-yellow-100">
              You need to sign in to create or manage seasons.
            </p>

            <Link
              href="/login"
              className="mt-5 inline-flex rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
            >
              Login
            </Link>
          </section>
        )}

        {isLoading && (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <p className="text-slate-300">Loading...</p>
          </section>
        )}

        {userEmail && !isLoading && (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">Start a Season</h2>
                <p className="mt-2 text-sm text-slate-400">
                  Pick a finished draft. Every drafter and the team they
                  claimed comes over automatically — nothing to type in by
                  hand.
                </p>
              </div>
            </div>

            {drafts.length === 0 ? (
              <p className="mt-5 text-sm text-slate-500">
                You don&apos;t have any drafts yet.{" "}
                <Link href="/create" className="font-bold text-cyan-300 hover:underline">
                  Start a draft
                </Link>{" "}
                first, then come back to import it here.
              </p>
            ) : (
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {drafts.map((draft) => {
                  const drafterCount = draft.draft_data.drafters?.length ?? 0;
                  const pickCount = draft.draft_data.picks?.length ?? 0;

                  return (
                    <div
                      key={draft.id}
                      className="rounded-2xl border border-white/10 bg-slate-900 p-4"
                    >
                      <h3 className="font-black">
                        {draft.draft_data.draftTitle || draft.title}
                      </h3>
                      <p className="mt-1 text-xs text-slate-400">
                        {drafterCount} drafters · {pickCount} picks made
                      </p>

                      <button
                        onClick={() => importFromDraft(draft)}
                        disabled={importingDraftId === draft.id || drafterCount === 0}
                        className="mt-3 w-full rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {importingDraftId === draft.id
                          ? "Importing..."
                          : "Import & Create Season"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {userEmail && !isLoading && (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-2xl font-black">Or Load Draft Results (CSV)</h2>
            <p className="mt-2 text-sm text-slate-400">
              For draft results that didn&apos;t come from this tool — upload
              or paste a CSV with <span className="text-slate-300">Drafter</span>{" "}
              and <span className="text-slate-300">Item</span> columns (the
              same format this app&apos;s own draft export uses).
            </p>

            <div className="mt-5 flex flex-col gap-3">
              <input
                value={csvTitle}
                onChange={(event) => setCsvTitle(event.target.value)}
                placeholder="Season title..."
                className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
              />

              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvFile}
                className="text-sm text-slate-400 file:mr-3 file:rounded-xl file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:font-bold file:text-white hover:file:bg-white/15"
              />

              <textarea
                value={csvText}
                onChange={(event) => setCsvText(event.target.value)}
                placeholder={`Pick,Drafter,Item,Category,Description\n"1","Tyler","Arizona State","Big 12","Big 12 program."`}
                className="min-h-32 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 font-mono text-xs text-white outline-none placeholder:text-slate-600 focus:border-cyan-300"
              />

              <button
                onClick={importFromCsv}
                disabled={isImportingCsv || !csvText.trim()}
                className="self-start rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isImportingCsv ? "Loading..." : "Load CSV & Create Season"}
              </button>
            </div>
          </section>
        )}

        {userEmail && !isLoading && seasons.length > 0 && (
          <section>
            <h2 className="text-2xl font-black">Existing Seasons</h2>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {seasons.map((season) => (
                <div
                  key={season.id}
                  className="rounded-3xl border border-white/10 bg-white/5 p-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-black">{season.title}</h3>
                      <p className="mt-2 text-xs text-slate-400">
                        Updated {new Date(season.updated_at).toLocaleString()}
                      </p>
                    </div>

                    <button
                      onClick={() => deleteSeason(season.id)}
                      title="Delete season"
                      className="text-xs font-bold text-slate-500 transition hover:text-red-300"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/season/room/${season.id}`}
                      className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-300"
                    >
                      Open Room
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
