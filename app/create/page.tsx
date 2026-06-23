"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import {
  CFB_TEAMS,
  CONFERENCE_ORDER,
  CONFERENCE_TIERS,
  TIER_ORDER,
} from "@/lib/cfbTeams";
import { buildTiers, groupItemsByConference } from "@/lib/draftBoard";
import { CompactDraftBoard } from "@/components/CompactDraftBoard";

type AppTab = "setup" | "draft" | "results";

type Drafter = {
  id: number;
  name: string;
  lotteryTickets: number;
};

type DraftItem = {
  id: number;
  name: string;
  category: string;
  description: string;
  color?: string;
};

type Pick = {
  pickNumber: number;
  drafter: string;
  item: DraftItem;
};

type SavedDraftState = {
  selectedTemplateId: string;
  draftTitle: string;
  drafters: Drafter[];
  availableItems: DraftItem[];
  picks: Pick[];
  lotteryHasRun: boolean;
};

type FullDraftExport = SavedDraftState & {
  exportedAt: string;
  appVersion: string;
};

type CloudDraft = {
  id: string;
  title: string;
  draft_data: SavedDraftState;
  updated_at: string;
  share_id: string;
  is_public: boolean;
};

const LOCAL_STORAGE_KEY = "draft-anything-current-draft";

const CFB_ITEMS: DraftItem[] = CFB_TEAMS.map((team, index) => ({
  id: index + 1,
  name: team.name,
  category: team.conference,
  description: `${team.conference} program.`,
  color: team.color,
}));

const DEFAULT_TITLE = "College Football Team Draft";

const DEFAULT_DRAFTERS: Drafter[] = [
  { id: 1, name: "Garrett", lotteryTickets: 30 },
  { id: 2, name: "Chris", lotteryTickets: 24 },
  { id: 3, name: "Tyler", lotteryTickets: 18 },
  { id: 4, name: "John", lotteryTickets: 14 },
  { id: 5, name: "Mike", lotteryTickets: 10 },
  { id: 6, name: "Brandon", lotteryTickets: 6 },
];

function cloneDrafters(drafters: Drafter[]) {
  return drafters.map((drafter) => ({ ...drafter }));
}

function cloneItems(items: DraftItem[]) {
  return items.map((item) => ({ ...item }));
}

function createShareId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replaceAll("-", "");
  }

  return `${Date.now()}${Math.random().toString(36).slice(2)}`;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<AppTab>("setup");
  const [hasLoadedSavedDraft, setHasLoadedSavedDraft] = useState(false);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [cloudDrafts, setCloudDrafts] = useState<CloudDraft[]>([]);
  const [currentCloudDraftId, setCurrentCloudDraftId] = useState<string | null>(
    null
  );
  const [cloudMessage, setCloudMessage] = useState("");
  const [isCloudLoading, setIsCloudLoading] = useState(false);

  const selectedTemplateId = "cfb";
  const [draftTitle, setDraftTitle] = useState(DEFAULT_TITLE);
  const [drafters, setDrafters] = useState<Drafter[]>(
    cloneDrafters(DEFAULT_DRAFTERS)
  );
  const [availableItems, setAvailableItems] = useState<DraftItem[]>(
    cloneItems(CFB_ITEMS)
  );
  const [picks, setPicks] = useState<Pick[]>([]);
  const [search, setSearch] = useState("");
  const [lotteryHasRun, setLotteryHasRun] = useState(false);
  const [cfbEligibleIds, setCfbEligibleIds] = useState<Set<number>>(
    new Set(CFB_ITEMS.map((item) => item.id))
  );

  const [newDrafter, setNewDrafter] = useState("");
  const [bulkDraftersText, setBulkDraftersText] = useState("");

  useEffect(() => {
    const savedDraft = localStorage.getItem(LOCAL_STORAGE_KEY);

    if (savedDraft) {
      try {
        const parsedDraft = JSON.parse(savedDraft) as SavedDraftState;
        applyDraftState(parsedDraft);
      } catch {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      }
    }

    setHasLoadedSavedDraft(true);
  }, []);

  useEffect(() => {
    async function loadUser() {
      const { data } = await supabase.auth.getUser();
      setUserEmail(data.user?.email ?? null);

      if (data.user) {
        await loadCloudDrafts();
      }
    }

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);

      if (session?.user) {
        loadCloudDrafts();
      } else {
        setCloudDrafts([]);
        setCurrentCloudDraftId(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedSavedDraft) return;

    const draftToSave = buildDraftState();

    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(draftToSave));
  }, [
    hasLoadedSavedDraft,
    selectedTemplateId,
    draftTitle,
    drafters,
    availableItems,
    picks,
    lotteryHasRun,
  ]);

  function applyCfbEligibility(nextEligibleIds: Set<number>) {
    setCfbEligibleIds(nextEligibleIds);
    setAvailableItems(
      CFB_ITEMS.filter((item) => nextEligibleIds.has(item.id))
    );
  }

  function toggleCfbTeam(id: number) {
    if (picks.length > 0) return;

    const next = new Set(cfbEligibleIds);

    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }

    applyCfbEligibility(next);
  }

  function setConferenceEligibility(conference: string, eligible: boolean) {
    if (picks.length > 0) return;

    const conferenceIds = CFB_ITEMS.filter(
      (item) => item.category === conference
    ).map((item) => item.id);

    const next = new Set(cfbEligibleIds);

    conferenceIds.forEach((id) => {
      if (eligible) {
        next.add(id);
      } else {
        next.delete(id);
      }
    });

    applyCfbEligibility(next);
  }

  const currentCloudDraft = cloudDrafts.find(
    (draft) => draft.id === currentCloudDraftId
  );

  const draftStatus = useMemo(() => {
    if (picks.length === 0) {
      return {
        label: "Draft Not Started",
        style: "border-slate-400/30 bg-slate-400/10 text-slate-200",
      };
    }

    if (availableItems.length === 0) {
      return {
        label: "Draft Complete",
        style: "border-green-400/30 bg-green-400/10 text-green-200",
      };
    }

    return {
      label: "Draft In Progress",
      style: "border-yellow-400/30 bg-yellow-400/10 text-yellow-200",
    };
  }, [picks.length, availableItems.length]);

  const totalTickets = drafters.reduce(
    (total, drafter) => total + drafter.lotteryTickets,
    0
  );

  const currentPickNumber = picks.length + 1;

  const currentDrafter = useMemo(() => {
    if (picks.length >= drafters.length) return undefined;

    return drafters[picks.length];
  }, [drafters, picks.length]);

  const { pickByItemId, groups: itemGroups } = useMemo(
    () =>
      groupItemsByConference(
        availableItems,
        picks,
        selectedTemplateId === "cfb" ? CONFERENCE_ORDER : undefined
      ),
    [availableItems, picks, selectedTemplateId]
  );

  const searchedGroups = useMemo(() => {
    const searchText = search.toLowerCase();

    return itemGroups
      .map((group) => ({
        category: group.category,
        items: group.items.filter((item) =>
          `${item.name} ${item.category} ${item.description}`
            .toLowerCase()
            .includes(searchText)
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [itemGroups, search]);

  const tiers = useMemo(
    () =>
      buildTiers(
        searchedGroups,
        selectedTemplateId === "cfb" ? CONFERENCE_TIERS : undefined,
        TIER_ORDER
      ),
    [searchedGroups, selectedTemplateId]
  );

  const { pickByItemId: pickedById, groups: pickedGroups } = useMemo(
    () => groupItemsByConference([], picks, CONFERENCE_ORDER),
    [picks]
  );

  const pickedTiers = useMemo(
    () => buildTiers(pickedGroups, CONFERENCE_TIERS, TIER_ORDER),
    [pickedGroups]
  );

  const allTeamsTiers = useMemo(
    () =>
      buildTiers(
        groupItemsByConference(CFB_ITEMS, [], CONFERENCE_ORDER).groups,
        CONFERENCE_TIERS,
        TIER_ORDER
      ),
    []
  );

  function buildDraftState(): SavedDraftState {
    return {
      selectedTemplateId,
      draftTitle,
      drafters,
      availableItems,
      picks,
      lotteryHasRun,
    };
  }

  function applyDraftState(draftState: SavedDraftState) {
    setDraftTitle(draftState.draftTitle || DEFAULT_TITLE);
    setDrafters(draftState.drafters || cloneDrafters(DEFAULT_DRAFTERS));
    const restoredItems =
      draftState.availableItems || cloneItems(CFB_ITEMS);

    setAvailableItems(restoredItems);
    setCfbEligibleIds(new Set(restoredItems.map((item) => item.id)));

    setPicks(draftState.picks || []);
    setLotteryHasRun(Boolean(draftState.lotteryHasRun));
  }

  function getShareLink(shareId: string) {
    if (typeof window === "undefined") {
      return `/draft/${shareId}`;
    }

    return `${window.location.origin}/draft/${shareId}`;
  }

  async function loadCloudDrafts() {
    setIsCloudLoading(true);
    setCloudMessage("");

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setCloudMessage("Sign in to load saved drafts.");
      setIsCloudLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("drafts")
      .select("id, title, draft_data, updated_at, share_id, is_public")
      .eq("user_id", userData.user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      setCloudMessage(error.message);
    } else {
      setCloudDrafts((data || []) as CloudDraft[]);
    }

    setIsCloudLoading(false);
  }

  async function createCloudDraft(titleToSave: string, successMessage: string) {
    setIsCloudLoading(true);
    setCloudMessage("");

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setCloudMessage("Sign in before saving drafts to your account.");
      setIsCloudLoading(false);
      return;
    }

    const cleanTitle = titleToSave.trim() || "Untitled Draft";

    const draftState: SavedDraftState = {
      ...buildDraftState(),
      draftTitle: cleanTitle,
    };

    const { data, error } = await supabase
      .from("drafts")
      .insert({
        user_id: userData.user.id,
        title: cleanTitle,
        draft_data: draftState,
        share_id: createShareId(),
        is_public: false,
      })
      .select("id")
      .single();

    if (error) {
      setCloudMessage(error.message);
    } else {
      setDraftTitle(cleanTitle);
      setCurrentCloudDraftId(data.id);
      setCloudMessage(successMessage);
      await loadCloudDrafts();
    }

    setIsCloudLoading(false);
  }

  async function saveNewDraftToAccount() {
    await createCloudDraft(draftTitle, "Saved as a new account draft.");
  }

  async function updateCurrentCloudDraft() {
    setIsCloudLoading(true);
    setCloudMessage("");

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setCloudMessage("Sign in before updating drafts.");
      setIsCloudLoading(false);
      return;
    }

    if (!currentCloudDraftId) {
      setCloudMessage(
        "No saved draft is currently loaded. Use Save New Draft first."
      );
      setIsCloudLoading(false);
      return;
    }

    const draftState = buildDraftState();

    const { error } = await supabase
      .from("drafts")
      .update({
        title: draftTitle,
        draft_data: draftState,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentCloudDraftId)
      .eq("user_id", userData.user.id);

    if (error) {
      setCloudMessage(error.message);
    } else {
      setCloudMessage("Current saved draft updated.");
      await loadCloudDrafts();
    }

    setIsCloudLoading(false);
  }

  function loadCloudDraft(draft: CloudDraft) {
    applyDraftState(draft.draft_data);
    setCurrentCloudDraftId(draft.id);
    setCloudMessage(`Loaded "${draft.title}".`);
    setActiveTab("draft");
  }

  async function deleteCloudDraft(draftId: string) {
    setIsCloudLoading(true);
    setCloudMessage("");

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setCloudMessage("Sign in before deleting drafts.");
      setIsCloudLoading(false);
      return;
    }

    const { error } = await supabase
      .from("drafts")
      .delete()
      .eq("id", draftId)
      .eq("user_id", userData.user.id);

    if (error) {
      setCloudMessage(error.message);
    } else {
      if (currentCloudDraftId === draftId) {
        setCurrentCloudDraftId(null);
      }

      setCloudMessage("Saved draft deleted.");
      await loadCloudDrafts();
    }

    setIsCloudLoading(false);
  }

  async function makeDraftPublic(draft: CloudDraft) {
    setIsCloudLoading(true);
    setCloudMessage("");

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setCloudMessage("Sign in before sharing drafts.");
      setIsCloudLoading(false);
      return;
    }

    const shareId = draft.share_id || createShareId();

    const { error } = await supabase
      .from("drafts")
      .update({
        share_id: shareId,
        is_public: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id)
      .eq("user_id", userData.user.id);

    if (error) {
      setCloudMessage(error.message);
    } else {
      setCloudMessage(`Public share link enabled: ${getShareLink(shareId)}`);
      await loadCloudDrafts();
    }

    setIsCloudLoading(false);
  }

  async function turnOffSharing(draft: CloudDraft) {
    setIsCloudLoading(true);
    setCloudMessage("");

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setCloudMessage("Sign in before changing sharing.");
      setIsCloudLoading(false);
      return;
    }

    const { error } = await supabase
      .from("drafts")
      .update({
        is_public: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id)
      .eq("user_id", userData.user.id);

    if (error) {
      setCloudMessage(error.message);
    } else {
      setCloudMessage("Public sharing turned off for that draft.");
      await loadCloudDrafts();
    }

    setIsCloudLoading(false);
  }

  async function copyShareLink(shareId: string) {
    const url = getShareLink(shareId);

    try {
      await navigator.clipboard.writeText(url);
      setCloudMessage("Share link copied to clipboard.");
    } catch {
      setCloudMessage(`Copy this link: ${url}`);
    }
  }

  function resetDraft() {
    setDraftTitle(DEFAULT_TITLE);
    setDrafters(cloneDrafters(DEFAULT_DRAFTERS));
    setAvailableItems(cloneItems(CFB_ITEMS));
    setCfbEligibleIds(new Set(CFB_ITEMS.map((item) => item.id)));
    setPicks([]);
    setSearch("");
    setLotteryHasRun(false);
    setNewDrafter("");
    setBulkDraftersText("");
    setCloudMessage("");
    setCurrentCloudDraftId(null);
    setActiveTab("setup");
  }

  function exportFullDraft() {
    const draftToExport: FullDraftExport = {
      ...buildDraftState(),
      exportedAt: new Date().toISOString(),
      appVersion: "draft-anything-mvp-1",
    };

    const jsonContent = JSON.stringify(draftToExport, null, 2);
    const blob = new Blob([jsonContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const safeTitle =
      draftTitle.trim().replaceAll(" ", "-").toLowerCase() || "draft-anything";

    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeTitle}-full-draft.json`;
    link.click();

    URL.revokeObjectURL(url);
  }

  function addDrafter() {
    const cleanedName = newDrafter.trim();

    if (!cleanedName) return;
    if (picks.length > 0) return;
    if (drafters.some((drafter) => drafter.name === cleanedName)) return;

    const newPerson: Drafter = {
      id: Date.now(),
      name: cleanedName,
      lotteryTickets: 10,
    };

    setDrafters([...drafters, newPerson]);
    setNewDrafter("");
    setLotteryHasRun(false);
  }

  function bulkAddDrafters() {
    if (picks.length > 0) return;

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

    setDrafters([...drafters, ...newDrafters]);
    setBulkDraftersText("");
    setLotteryHasRun(false);
  }

  function removeDrafter(id: number) {
    if (picks.length > 0) return;

    setDrafters(drafters.filter((drafter) => drafter.id !== id));
    setLotteryHasRun(false);
  }

  function clearAllDrafters() {
    if (picks.length > 0) return;

    setDrafters([]);
    setLotteryHasRun(false);
  }

  function updateLotteryTickets(id: number, tickets: number) {
    if (picks.length > 0) return;

    const safeTickets = Math.max(1, tickets || 1);

    setDrafters(
      drafters.map((drafter) =>
        drafter.id === id
          ? { ...drafter, lotteryTickets: safeTickets }
          : drafter
      )
    );

    setLotteryHasRun(false);
  }

  function runWeightedLottery() {
    if (picks.length > 0) return;
    if (drafters.length <= 1) return;

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

    setDrafters(newOrder);
    setLotteryHasRun(true);
  }

  function randomizeEqualOdds() {
    if (picks.length > 0) return;

    const shuffled = [...drafters];

    for (let i = shuffled.length - 1; i > 0; i--) {
      const randomIndex = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[i]];
    }

    setDrafters(shuffled);
    setLotteryHasRun(true);
  }

  function draftItem(item: DraftItem) {
    if (!currentDrafter) return;
    if (!availableItems.some((availableItem) => availableItem.id === item.id))
      return;

    const newPick: Pick = {
      pickNumber: currentPickNumber,
      drafter: currentDrafter.name,
      item,
    };

    setPicks([...picks, newPick]);
    setAvailableItems(
      availableItems.filter((draftItem) => draftItem.id !== item.id)
    );
  }

  function undoLastPick() {
    if (picks.length === 0) return;

    const lastPick = picks[picks.length - 1];

    setPicks(picks.slice(0, -1));
    setAvailableItems([...availableItems, lastPick.item]);
  }

  function exportDraftResults() {
    if (picks.length === 0) return;

    const csvHeader = "Pick,Drafter,Item,Category,Description\n";

    const csvRows = picks
      .map((pick) => {
        return [
          pick.pickNumber,
          pick.drafter,
          pick.item.name,
          pick.item.category,
          pick.item.description,
        ]
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(",");
      })
      .join("\n");

    const csvContent = csvHeader + csvRows;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${draftTitle.replaceAll(" ", "-").toLowerCase()}-results.csv`;
    link.click();

    URL.revokeObjectURL(url);
  }

  function tabButtonClass(tab: AppTab) {
    return `rounded-2xl px-5 py-3 text-sm font-black transition ${
      activeTab === tab
        ? "bg-cyan-400 text-slate-950"
        : "bg-white/10 text-white hover:bg-white/15"
    }`;
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-8">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
              Draft Anything
            </p>

            <span
              className={`rounded-full border px-4 py-1.5 text-xs font-bold ${draftStatus.style}`}
            >
              {draftStatus.label}
            </span>

            <span className="rounded-full border border-green-400/30 bg-green-400/10 px-4 py-1.5 text-xs font-bold text-green-200">
              Auto-saved
            </span>

            {userEmail ? (
              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1.5 text-xs font-bold text-cyan-200">
                Signed in
              </span>
            ) : (
              <Link
                href="/login"
                className="rounded-full border border-white/10 bg-white/10 px-4 py-1.5 text-xs font-bold text-white hover:bg-white/15"
              >
                Login
              </Link>
            )}

            {currentCloudDraft?.is_public && (
              <span className="rounded-full border border-purple-400/30 bg-purple-400/10 px-4 py-1.5 text-xs font-bold text-purple-200">
                Public Link On
              </span>
            )}
          </div>

          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="w-full">
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-3xl font-black tracking-tight text-white outline-none focus:border-cyan-300 md:text-5xl"
              />

              <p className="mt-4 max-w-3xl text-lg text-slate-300">
                Set lottery odds, choose which teams are eligible, and run a
                live college football team draft with your group.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <button
                onClick={resetDraft}
                className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
              >
                Reset Draft
              </button>

              <button
                onClick={saveNewDraftToAccount}
                disabled={isCloudLoading}
                className="rounded-2xl bg-white px-5 py-3 font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save New Draft
              </button>

              <button
                onClick={updateCurrentCloudDraft}
                disabled={isCloudLoading || !currentCloudDraftId}
                className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Update Current
              </button>

              <button
                onClick={exportFullDraft}
                className="rounded-2xl bg-white/10 px-5 py-3 font-bold text-white transition hover:bg-white/15"
              >
                Export Full Draft
              </button>
            </div>
          </div>

          {currentCloudDraftId && (
            <div className="mt-5 rounded-2xl border border-green-400/30 bg-green-400/10 p-4 text-sm font-semibold text-green-100">
              A saved account draft is currently loaded. Use Update Current to
              overwrite it, or Save New Draft to create another copy.
            </div>
          )}

          {cloudMessage && (
            <div className="mt-5 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm font-semibold text-cyan-100">
              {cloudMessage}
            </div>
          )}
        </header>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-2xl font-bold">Account Drafts</h2>
              <p className="mt-2 text-sm text-slate-400">
                Save drafts to your account, then open the live Room to let
                players log in, claim a name, and make their own picks. The
                public link below is read-only for spectators.
              </p>
            </div>

            <button
              onClick={loadCloudDrafts}
              disabled={isCloudLoading || !userEmail}
              className="rounded-2xl bg-white/10 px-5 py-3 font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Refresh Saved Drafts
            </button>
          </div>

          {!userEmail && (
            <div className="mt-5 rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-sm font-semibold text-yellow-100">
              You are not signed in.{" "}
              <Link href="/login" className="text-cyan-200 underline">
                Login or sign up
              </Link>{" "}
              to save drafts to your account.
            </div>
          )}

          {userEmail && cloudDrafts.length === 0 && (
            <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900 p-4 text-sm text-slate-400">
              No saved account drafts yet. Click Save New Draft to create one.
            </div>
          )}

          {userEmail && cloudDrafts.length > 0 && (
            <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {cloudDrafts.map((draft) => (
                <div
                  key={draft.id}
                  className={`rounded-2xl border p-4 ${
                    draft.id === currentCloudDraftId
                      ? "border-cyan-300 bg-cyan-300/10"
                      : "border-white/10 bg-slate-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-black">{draft.title}</h3>
                      <p className="mt-2 text-xs text-slate-400">
                        Updated {new Date(draft.updated_at).toLocaleString()}
                      </p>
                    </div>

                    {draft.is_public && (
                      <span className="rounded-full bg-purple-400/10 px-3 py-1 text-xs font-bold text-purple-200">
                        Public
                      </span>
                    )}
                  </div>

                  {draft.is_public && (
                    <div className="mt-4 rounded-xl border border-purple-400/20 bg-purple-400/10 p-3 text-xs text-purple-100">
                      {getShareLink(draft.share_id)}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => loadCloudDraft(draft)}
                      className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-300"
                    >
                      Load
                    </button>

                    <Link
                      href={`/room/${draft.id}`}
                      className="rounded-2xl bg-green-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-green-300"
                    >
                      Open Room
                    </Link>

                    {draft.is_public ? (
                      <>
                        <Link
                          href={`/draft/${draft.share_id}`}
                          target="_blank"
                          className="rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-slate-200"
                        >
                          Spectator Link
                        </Link>

                        <button
                          onClick={() => copyShareLink(draft.share_id)}
                          className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15"
                        >
                          Copy Spectator Link
                        </button>

                        <button
                          onClick={() => turnOffSharing(draft)}
                          disabled={isCloudLoading}
                          className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Turn Off
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => makeDraftPublic(draft)}
                        disabled={isCloudLoading}
                        className="rounded-2xl bg-purple-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-purple-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Make Public
                      </button>
                    )}

                    <button
                      onClick={() => deleteCloudDraft(draft.id)}
                      disabled={isCloudLoading}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <nav className="grid gap-3 rounded-3xl border border-white/10 bg-white/5 p-3 md:grid-cols-3">
          <button
            onClick={() => setActiveTab("setup")}
            className={tabButtonClass("setup")}
          >
            1. Setup
          </button>

          <button
            onClick={() => setActiveTab("draft")}
            className={tabButtonClass("draft")}
          >
            2. Draft Room
          </button>

          <button
            onClick={() => setActiveTab("results")}
            className={tabButtonClass("results")}
          >
            3. Results
          </button>
        </nav>

        {activeTab === "setup" && (
          <section className="grid gap-6 lg:grid-cols-2">
            <div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <h2 className="text-2xl font-bold">Lottery</h2>

                <div className="mt-5 grid grid-cols-3 gap-3">
                  <div className="rounded-2xl bg-slate-900 p-4">
                    <div className="text-2xl font-black">{drafters.length}</div>
                    <div className="text-xs text-slate-400">Drafters</div>
                  </div>

                  <div className="rounded-2xl bg-slate-900 p-4">
                    <div className="text-2xl font-black">
                      {availableItems.length}
                    </div>
                    <div className="text-xs text-slate-400">Available</div>
                  </div>

                  <div className="rounded-2xl bg-slate-900 p-4">
                    <div className="text-2xl font-black">{picks.length}</div>
                    <div className="text-xs text-slate-400">Picks</div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3">
                  <button
                    onClick={runWeightedLottery}
                    disabled={picks.length > 0 || drafters.length <= 1}
                    className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Run Weighted Lottery
                  </button>

                  <button
                    onClick={randomizeEqualOdds}
                    disabled={picks.length > 0 || drafters.length <= 1}
                    className="rounded-2xl bg-white px-5 py-3 font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Randomize Equal Odds
                  </button>

                  {lotteryHasRun && (
                    <div className="rounded-2xl border border-green-400/30 bg-green-400/10 p-4 text-sm font-semibold text-green-200">
                      Lottery complete. Draft order has been updated.
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setActiveTab("draft")}
                  className="mt-5 w-full rounded-2xl bg-white px-5 py-3 font-black text-slate-950 transition hover:bg-slate-200"
                >
                  Go to Draft Room
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-bold">Drafters + Odds</h2>
                  <p className="mt-2 text-sm text-slate-400">
                    Add one person at a time, or paste a bulk list like:
                    Garrett, 30.
                  </p>
                </div>

                <button
                  onClick={clearAllDrafters}
                  disabled={picks.length > 0 || drafters.length === 0}
                  className="rounded-2xl bg-white/10 px-4 py-2 text-xs font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear All
                </button>
              </div>

              {picks.length > 0 && (
                <div className="mt-5 rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-sm font-semibold text-yellow-100">
                  Drafters are locked after the first pick. Undo all picks or
                  reset the draft to edit drafters.
                </div>
              )}

              <div className="mt-5 flex gap-2">
                <input
                  value={newDrafter}
                  onChange={(event) => setNewDrafter(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addDrafter();
                  }}
                  disabled={picks.length > 0}
                  placeholder="Add drafter..."
                  className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                />

                <button
                  onClick={addDrafter}
                  disabled={picks.length > 0}
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
                  disabled={picks.length > 0}
                  placeholder={`Garrett, 30\nChris, 24\nTyler, 18\nJohn, 14`}
                  className="mt-4 min-h-32 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                />

                <button
                  onClick={bulkAddDrafters}
                  disabled={picks.length > 0}
                  className="mt-3 rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Bulk Add Drafters
                </button>
              </div>

              <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
                {drafters.length === 0 ? (
                  <div className="p-5 text-slate-500">
                    No drafters yet. Add people to start a custom draft.
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 border-b border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                      <span className="w-6 flex-shrink-0">#</span>
                      <span className="min-w-0 flex-1">Name</span>
                      <span className="w-12 flex-shrink-0 text-right">Odds</span>
                      <span className="w-16 flex-shrink-0 text-right">Tickets</span>
                      <span className="w-6 flex-shrink-0" />
                    </div>

                    {drafters.map((drafter, index) => {
                      const odds =
                        totalTickets > 0
                          ? (
                              (drafter.lotteryTickets / totalTickets) *
                              100
                            ).toFixed(1)
                          : "0.0";

                      const isOnClock = drafter.id === currentDrafter?.id;

                      return (
                        <div
                          key={drafter.id}
                          className={`flex items-center gap-3 border-b border-white/5 px-3 py-2 text-sm last:border-b-0 ${
                            isOnClock
                              ? "bg-cyan-300/10 text-white"
                              : "bg-slate-900 text-white"
                          }`}
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

                          <input
                            type="number"
                            min={1}
                            value={drafter.lotteryTickets}
                            onChange={(event) =>
                              updateLotteryTickets(
                                drafter.id,
                                Number(event.target.value)
                              )
                            }
                            disabled={picks.length > 0}
                            className="w-16 flex-shrink-0 rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-right text-xs text-white outline-none focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                          />

                          <button
                            onClick={() => removeDrafter(drafter.id)}
                            disabled={picks.length > 0}
                            title="Remove drafter"
                            className="w-6 flex-shrink-0 rounded-lg bg-white/10 py-1 text-xs font-bold text-slate-300 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>

          </section>
        )}

        {activeTab === "setup" && (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-2xl font-bold">CFB Team Pool</h2>
                <p className="mt-2 text-sm text-slate-400">
                  Disable any teams or whole conferences you don&apos;t want
                  eligible for this draft. Only enabled teams will be available
                  to draft.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-300">
                <span className="font-bold text-cyan-300">
                  {cfbEligibleIds.size}
                </span>{" "}
                / {CFB_ITEMS.length} teams eligible
              </div>
            </div>

            {picks.length > 0 && (
              <div className="mt-5 rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-sm font-semibold text-yellow-100">
                Team eligibility is locked after the first pick. Undo all picks
                or reset the draft to make changes.
              </div>
            )}

            <div className="mt-5">
              <CompactDraftBoard
                tiers={allTeamsTiers}
                getStatus={(item) =>
                  cfbEligibleIds.has(item.id)
                    ? { variant: "available" }
                    : { variant: "disabled", badge: "Excluded" }
                }
                onSelect={(item) => toggleCfbTeam(item.id)}
                isClickable={() => picks.length === 0}
                groupActions={(category) => (
                  <>
                    <button
                      onClick={() => setConferenceEligibility(category, true)}
                      disabled={picks.length > 0}
                      className="rounded-lg bg-white/10 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Enable All
                    </button>

                    <button
                      onClick={() => setConferenceEligibility(category, false)}
                      disabled={picks.length > 0}
                      className="rounded-lg bg-white/10 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Disable All
                    </button>
                  </>
                )}
                legend={[
                  { label: "Eligible", swatchClassName: "bg-white/10" },
                  {
                    label: "Excluded",
                    swatchClassName: "bg-slate-800/60",
                  },
                ]}
              />
            </div>
          </section>
        )}

        {activeTab === "draft" && (
          <section className="flex flex-col gap-6">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
                    Current Pick
                  </p>
                  <h2 className="mt-2 text-4xl font-black">
                    {currentDrafter?.name || "Add drafters first"}
                  </h2>
                  <p className="mt-2 text-slate-400">
                    Pick {currentPickNumber} of {drafters.length}
                  </p>
                </div>

                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search available items..."
                  className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                />
              </div>

              <div className="mt-6">
                <CompactDraftBoard
                  tiers={tiers}
                  getStatus={(item) => {
                    const pick = pickByItemId.get(item.id);
                    return pick
                      ? { variant: "taken", badge: pick.drafter }
                      : { variant: "available" };
                  }}
                  onSelect={draftItem}
                  isClickable={() => Boolean(currentDrafter)}
                  emptyMessage="No items. Add items in Setup or choose a template."
                  legend={[
                    { label: "Drafted", swatchClassName: "bg-green-400/20" },
                    { label: "Available", swatchClassName: "bg-white/10" },
                  ]}
                />
              </div>

              {availableItems.length === 0 && picks.length > 0 && (
                <div className="mt-6 rounded-2xl border border-green-400/30 bg-green-400/10 p-5 text-green-200">
                  Draft complete.
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-2xl font-bold">Draft Board</h2>
                  <p className="mt-2 text-sm text-slate-400">
                    Every selection, organized by conference.
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={undoLastPick}
                    disabled={picks.length === 0}
                    className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Undo
                  </button>

                  <button
                    onClick={exportDraftResults}
                    disabled={picks.length === 0}
                    className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Export
                  </button>
                </div>
              </div>

              <div className="mt-6">
                <CompactDraftBoard
                  tiers={pickedTiers}
                  getStatus={(item) => {
                    const pick = pickedById.get(item.id);
                    return pick
                      ? { variant: "taken", badge: pick.drafter }
                      : { variant: "available" };
                  }}
                  strikethroughOnTaken={false}
                  emptyMessage="No picks yet."
                />
              </div>
            </div>
          </section>
        )}

        {activeTab === "results" && (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-3xl font-black">Draft Results</h2>
                <p className="mt-2 text-slate-400">
                  Review the final board or export it as a CSV.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={exportDraftResults}
                  disabled={picks.length === 0}
                  className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Export Results CSV
                </button>

                <button
                  onClick={exportFullDraft}
                  className="rounded-2xl bg-white px-5 py-3 font-bold text-slate-950 transition hover:bg-slate-200"
                >
                  Export Full Draft JSON
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {picks.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/15 p-5 text-slate-500">
                  No picks yet. Go to the Draft Room to make selections.
                </div>
              )}

              {picks.map((pick) => (
                <div
                  key={pick.pickNumber}
                  className="rounded-2xl border border-white/10 bg-slate-900 p-5"
                >
                  <div className="text-sm text-slate-400">
                    Pick {pick.pickNumber}
                  </div>
                  <div className="mt-1 text-sm font-bold text-cyan-300">
                    {pick.drafter}
                  </div>
                  <div className="mt-3 text-2xl font-black">{pick.item.name}</div>
                  <div className="mt-1 text-sm text-slate-400">
                    {pick.item.category}
                  </div>
                  <p className="mt-4 text-sm text-slate-400">
                    {pick.item.description}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}