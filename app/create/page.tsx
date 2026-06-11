"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

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
};

type Pick = {
  pickNumber: number;
  round: number;
  drafter: string;
  item: DraftItem;
};

type DraftTemplate = {
  id: string;
  label: string;
  title: string;
  summary: string;
  drafters: Drafter[];
  items: DraftItem[];
};

type SavedDraftState = {
  selectedTemplateId: string;
  draftTitle: string;
  drafters: Drafter[];
  availableItems: DraftItem[];
  picks: Pick[];
  snakeDraft: boolean;
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
};

const LOCAL_STORAGE_KEY = "draft-anything-current-draft";

const draftTemplates: DraftTemplate[] = [
  {
    id: "cfb",
    label: "CFB Team Draft",
    title: "College Football 26 Team Draft",
    summary: "Low-tier college football teams for a dynasty rebuild draft.",
    drafters: [
      { id: 1, name: "Garrett", lotteryTickets: 30 },
      { id: 2, name: "Chris", lotteryTickets: 24 },
      { id: 3, name: "Tyler", lotteryTickets: 18 },
      { id: 4, name: "John", lotteryTickets: 14 },
      { id: 5, name: "Mike", lotteryTickets: 10 },
      { id: 6, name: "Brandon", lotteryTickets: 6 },
    ],
    items: [
      {
        id: 1,
        name: "UTSA",
        category: "AAC",
        description: "High-upside rebuild with strong recruiting potential.",
      },
      {
        id: 2,
        name: "Tulane",
        category: "AAC",
        description: "Fun program with uniforms, location, and strong ceiling.",
      },
      {
        id: 3,
        name: "Appalachian State",
        category: "Sun Belt",
        description: "Classic dynasty rebuild with real football tradition.",
      },
      {
        id: 4,
        name: "James Madison",
        category: "Sun Belt",
        description: "Newer FBS feel with a lot of momentum.",
      },
      {
        id: 5,
        name: "Coastal Carolina",
        category: "Sun Belt",
        description: "Unique brand, teal field, and good rebuild vibes.",
      },
      {
        id: 6,
        name: "Memphis",
        category: "AAC",
        description: "Strong city, good uniforms, and solid football base.",
      },
      {
        id: 7,
        name: "ECU",
        category: "AAC",
        description: "Underrated fanbase and fun long-term rebuild.",
      },
      {
        id: 8,
        name: "USF",
        category: "AAC",
        description: "Florida recruiting base with sleeping giant potential.",
      },
    ],
  },
  {
    id: "food",
    label: "Food Draft",
    title: "Ultimate Food Draft",
    summary: "Draft the best foods of all time.",
    drafters: [
      { id: 1, name: "Garrett", lotteryTickets: 10 },
      { id: 2, name: "Chris", lotteryTickets: 10 },
      { id: 3, name: "Tyler", lotteryTickets: 10 },
      { id: 4, name: "John", lotteryTickets: 10 },
    ],
    items: [
      {
        id: 1,
        name: "Pizza",
        category: "Italian",
        description: "The clear 1.01 candidate in almost any food draft.",
      },
      {
        id: 2,
        name: "Burger",
        category: "American",
        description: "High-floor classic with endless customization.",
      },
      {
        id: 3,
        name: "Tacos",
        category: "Mexican",
        description: "Elite versatility and tremendous value.",
      },
      {
        id: 4,
        name: "Wings",
        category: "Game Day",
        description: "Strong social food with major sauce upside.",
      },
      {
        id: 5,
        name: "Sushi",
        category: "Japanese",
        description: "Premium pick with high-end ceiling.",
      },
      {
        id: 6,
        name: "Steak",
        category: "American",
        description: "Luxury pick with serious first-round potential.",
      },
      {
        id: 7,
        name: "Mac and Cheese",
        category: "Comfort Food",
        description: "Safe comfort pick with crowd appeal.",
      },
      {
        id: 8,
        name: "Ice Cream",
        category: "Dessert",
        description: "Best dessert weapon on the board.",
      },
    ],
  },
  {
    id: "movies",
    label: "Movie Draft",
    title: "All-Time Movie Draft",
    summary: "Draft the best movies for your personal movie roster.",
    drafters: [
      { id: 1, name: "Garrett", lotteryTickets: 10 },
      { id: 2, name: "Chris", lotteryTickets: 10 },
      { id: 3, name: "Tyler", lotteryTickets: 10 },
      { id: 4, name: "John", lotteryTickets: 10 },
    ],
    items: [
      {
        id: 1,
        name: "The Lord of the Rings",
        category: "Fantasy",
        description: "Elite franchise pick with massive replay value.",
      },
      {
        id: 2,
        name: "The Dark Knight",
        category: "Superhero",
        description: "Prestige superhero film with top-tier villain value.",
      },
      {
        id: 3,
        name: "Forrest Gump",
        category: "Drama",
        description: "Classic emotional pick with broad appeal.",
      },
      {
        id: 4,
        name: "Jurassic Park",
        category: "Adventure",
        description: "Iconic blockbuster with elite nostalgia.",
      },
      {
        id: 5,
        name: "Gladiator",
        category: "Action",
        description: "Strong masculine epic with championship energy.",
      },
      {
        id: 6,
        name: "Toy Story",
        category: "Animated",
        description: "Franchise-launching animated classic.",
      },
      {
        id: 7,
        name: "Top Gun: Maverick",
        category: "Action",
        description: "Modern blockbuster with massive rewatchability.",
      },
      {
        id: 8,
        name: "Remember the Titans",
        category: "Sports",
        description: "Strong locker-room movie with sports draft value.",
      },
    ],
  },
  {
    id: "blank",
    label: "Blank Custom Draft",
    title: "My Custom Draft",
    summary: "Start from scratch and add your own drafters and items.",
    drafters: [],
    items: [],
  },
];

function cloneDrafters(drafters: Drafter[]) {
  return drafters.map((drafter) => ({ ...drafter }));
}

function cloneItems(items: DraftItem[]) {
  return items.map((item) => ({ ...item }));
}

const defaultTemplate = draftTemplates[0];

export default function Home() {
  const [activeTab, setActiveTab] = useState<AppTab>("setup");
  const [hasLoadedSavedDraft, setHasLoadedSavedDraft] = useState(false);
  const [importMessage, setImportMessage] = useState("");

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [cloudDrafts, setCloudDrafts] = useState<CloudDraft[]>([]);
  const [currentCloudDraftId, setCurrentCloudDraftId] = useState<string | null>(
    null
  );
  const [cloudMessage, setCloudMessage] = useState("");
  const [isCloudLoading, setIsCloudLoading] = useState(false);

  const [selectedTemplateId, setSelectedTemplateId] = useState(defaultTemplate.id);
  const [draftTitle, setDraftTitle] = useState(defaultTemplate.title);
  const [drafters, setDrafters] = useState<Drafter[]>(
    cloneDrafters(defaultTemplate.drafters)
  );
  const [availableItems, setAvailableItems] = useState<DraftItem[]>(
    cloneItems(defaultTemplate.items)
  );
  const [picks, setPicks] = useState<Pick[]>([]);
  const [search, setSearch] = useState("");
  const [snakeDraft, setSnakeDraft] = useState(false);
  const [lotteryHasRun, setLotteryHasRun] = useState(false);

  const [newDrafter, setNewDrafter] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("");
  const [newItemDescription, setNewItemDescription] = useState("");

  const [bulkDraftersText, setBulkDraftersText] = useState("");
  const [bulkItemsText, setBulkItemsText] = useState("");

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
    snakeDraft,
    lotteryHasRun,
  ]);

  const activeTemplate =
    draftTemplates.find((template) => template.id === selectedTemplateId) ||
    defaultTemplate;

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

  const currentRound =
    drafters.length > 0 ? Math.floor(picks.length / drafters.length) + 1 : 1;

  const currentDrafter = useMemo(() => {
    if (drafters.length === 0) return undefined;

    const pickIndex = picks.length;
    const roundIndex = Math.floor(pickIndex / drafters.length);
    const pickInRound = pickIndex % drafters.length;

    if (snakeDraft && roundIndex % 2 === 1) {
      return drafters[drafters.length - 1 - pickInRound];
    }

    return drafters[pickInRound];
  }, [drafters, picks.length, snakeDraft]);

  const filteredItems = availableItems.filter((item) => {
    const searchText =
      `${item.name} ${item.category} ${item.description}`.toLowerCase();

    return searchText.includes(search.toLowerCase());
  });

  function buildDraftState(): SavedDraftState {
    return {
      selectedTemplateId,
      draftTitle,
      drafters,
      availableItems,
      picks,
      snakeDraft,
      lotteryHasRun,
    };
  }

  function applyDraftState(draftState: SavedDraftState) {
    setSelectedTemplateId(draftState.selectedTemplateId || defaultTemplate.id);
    setDraftTitle(draftState.draftTitle || defaultTemplate.title);
    setDrafters(draftState.drafters || cloneDrafters(defaultTemplate.drafters));
    setAvailableItems(
      draftState.availableItems || cloneItems(defaultTemplate.items)
    );
    setPicks(draftState.picks || []);
    setSnakeDraft(Boolean(draftState.snakeDraft));
    setLotteryHasRun(Boolean(draftState.lotteryHasRun));
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
      .select("id, title, draft_data, updated_at")
      .eq("user_id", userData.user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      setCloudMessage(error.message);
    } else {
      setCloudDrafts((data || []) as CloudDraft[]);
    }

    setIsCloudLoading(false);
  }

  async function saveDraftToAccount() {
    setIsCloudLoading(true);
    setCloudMessage("");

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setCloudMessage("Sign in before saving drafts to your account.");
      setIsCloudLoading(false);
      return;
    }

    const draftState = buildDraftState();

    if (currentCloudDraftId) {
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
        setCloudMessage("Saved draft updated in your account.");
        await loadCloudDrafts();
      }

      setIsCloudLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("drafts")
      .insert({
        user_id: userData.user.id,
        title: draftTitle,
        draft_data: draftState,
      })
      .select("id")
      .single();

    if (error) {
      setCloudMessage(error.message);
    } else {
      setCurrentCloudDraftId(data.id);
      setCloudMessage("Draft saved to your account.");
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

  function loadTemplate(templateId: string) {
    const template =
      draftTemplates.find((draftTemplate) => draftTemplate.id === templateId) ||
      defaultTemplate;

    setSelectedTemplateId(template.id);
    setDraftTitle(template.title);
    setDrafters(cloneDrafters(template.drafters));
    setAvailableItems(cloneItems(template.items));
    setPicks([]);
    setSearch("");
    setSnakeDraft(false);
    setLotteryHasRun(false);
    setNewDrafter("");
    setNewItemName("");
    setNewItemCategory("");
    setNewItemDescription("");
    setBulkDraftersText("");
    setBulkItemsText("");
    setImportMessage("");
    setCloudMessage("");
    setCurrentCloudDraftId(null);
    setActiveTab("setup");
  }

  function resetDraft() {
    loadTemplate(selectedTemplateId);
  }

  function clearSavedDraft() {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    loadTemplate(defaultTemplate.id);
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

  async function importFullDraft(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    try {
      const fileText = await file.text();
      const importedDraft = JSON.parse(fileText) as Partial<FullDraftExport>;

      if (
        !importedDraft.draftTitle ||
        !Array.isArray(importedDraft.drafters) ||
        !Array.isArray(importedDraft.availableItems) ||
        !Array.isArray(importedDraft.picks)
      ) {
        throw new Error("Invalid draft file");
      }

      applyDraftState({
        selectedTemplateId: importedDraft.selectedTemplateId || "blank",
        draftTitle: importedDraft.draftTitle,
        drafters: importedDraft.drafters,
        availableItems: importedDraft.availableItems,
        picks: importedDraft.picks,
        snakeDraft: Boolean(importedDraft.snakeDraft),
        lotteryHasRun: Boolean(importedDraft.lotteryHasRun),
      });

      setSearch("");
      setNewDrafter("");
      setNewItemName("");
      setNewItemCategory("");
      setNewItemDescription("");
      setBulkDraftersText("");
      setBulkItemsText("");
      setCurrentCloudDraftId(null);
      setImportMessage("Draft imported successfully.");
      setActiveTab("draft");
    } catch {
      setImportMessage(
        "Could not import that file. Make sure it is a Draft Anything JSON export."
      );
    } finally {
      event.target.value = "";
    }
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

  function addItem() {
    const cleanedName = newItemName.trim();

    if (!cleanedName) return;

    const newItem: DraftItem = {
      id: Date.now(),
      name: cleanedName,
      category: newItemCategory.trim() || "Custom",
      description: newItemDescription.trim() || "Custom draft item.",
    };

    setAvailableItems([...availableItems, newItem]);
    setNewItemName("");
    setNewItemCategory("");
    setNewItemDescription("");
  }

  function bulkAddItems() {
    const lines = bulkItemsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) return;

    const newItems: DraftItem[] = lines
      .map((line, index) => {
        const parts = line.split(",");
        const name = parts[0]?.trim();
        const category = parts[1]?.trim() || "Custom";
        const description =
          parts.slice(2).join(",").trim() || "Custom draft item.";

        if (!name) return null;

        return {
          id: Date.now() + index,
          name,
          category,
          description,
        };
      })
      .filter((item): item is DraftItem => item !== null);

    if (newItems.length === 0) return;

    setAvailableItems([...availableItems, ...newItems]);
    setBulkItemsText("");
  }

  function deleteAvailableItem(id: number) {
    setAvailableItems(availableItems.filter((item) => item.id !== id));
  }

  function clearAllAvailableItems() {
    setAvailableItems([]);
    setSearch("");
  }

  function draftItem(item: DraftItem) {
    if (!currentDrafter) return;

    const newPick: Pick = {
      pickNumber: currentPickNumber,
      round: currentRound,
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

    const csvHeader = "Pick,Round,Drafter,Item,Category,Description\n";

    const csvRows = picks
      .map((pick) => {
        return [
          pick.pickNumber,
          pick.round,
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
          </div>

          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="w-full">
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-3xl font-black tracking-tight text-white outline-none focus:border-cyan-300 md:text-5xl"
              />

              <p className="mt-4 max-w-3xl text-lg text-slate-300">
                Create a custom draft room, set lottery odds, choose a template,
                bulk-add drafters or items, and draft anything your group wants.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <button
                onClick={resetDraft}
                className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
              >
                Reset Current Template
              </button>

              <button
                onClick={clearSavedDraft}
                className="rounded-2xl bg-white/10 px-5 py-3 font-bold text-white transition hover:bg-white/15"
              >
                Clear Saved Draft
              </button>

              <button
                onClick={saveDraftToAccount}
                disabled={isCloudLoading}
                className="rounded-2xl bg-white px-5 py-3 font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save to Account
              </button>

              <button
                onClick={exportFullDraft}
                className="rounded-2xl bg-white/10 px-5 py-3 font-bold text-white transition hover:bg-white/15"
              >
                Export Full Draft
              </button>

              <label className="cursor-pointer rounded-2xl bg-white/10 px-5 py-3 text-center font-bold text-white transition hover:bg-white/15">
                Import Full Draft
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={importFullDraft}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {cloudMessage && (
            <div className="mt-5 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm font-semibold text-cyan-100">
              {cloudMessage}
            </div>
          )}

          {importMessage && (
            <div className="mt-5 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm font-semibold text-cyan-100">
              {importMessage}
            </div>
          )}
        </header>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-2xl font-bold">Account Drafts</h2>
              <p className="mt-2 text-sm text-slate-400">
                Save drafts to your account and load them later from any browser.
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
              No saved account drafts yet. Click Save to Account to create one.
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
                  <h3 className="text-lg font-black">{draft.title}</h3>
                  <p className="mt-2 text-xs text-slate-400">
                    Updated {new Date(draft.updated_at).toLocaleString()}
                  </p>

                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => loadCloudDraft(draft)}
                      className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-300"
                    >
                      Load
                    </button>

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
          <section className="grid gap-6 lg:grid-cols-[0.9fr_1fr_1fr]">
            <div className="flex flex-col gap-6">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <h2 className="text-2xl font-bold">Templates</h2>
                <p className="mt-2 text-sm text-slate-400">
                  Current template: {activeTemplate.summary}
                </p>

                <div className="mt-5 grid gap-3">
                  {draftTemplates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => loadTemplate(template.id)}
                      className={`rounded-2xl border p-4 text-left transition ${
                        selectedTemplateId === template.id
                          ? "border-cyan-300 bg-cyan-300/10"
                          : "border-white/10 bg-slate-900 hover:border-cyan-300"
                      }`}
                    >
                      <div className="font-black">{template.label}</div>
                      <div className="mt-2 text-xs text-slate-400">
                        {template.summary}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <h2 className="text-2xl font-bold">Lottery + Format</h2>

                <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900 p-4">
                  <div className="text-sm text-slate-400">Draft Format</div>

                  <button
                    onClick={() => setSnakeDraft(!snakeDraft)}
                    disabled={picks.length > 0}
                    className={`mt-3 w-full rounded-2xl px-4 py-3 font-bold transition ${
                      snakeDraft
                        ? "bg-cyan-400 text-slate-950"
                        : "bg-white/10 text-white hover:bg-white/15"
                    } ${picks.length > 0 ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    {snakeDraft ? "Snake Draft: On" : "Snake Draft: Off"}
                  </button>

                  {picks.length > 0 && (
                    <p className="mt-3 text-xs text-yellow-200">
                      Draft format is locked after the first pick.
                    </p>
                  )}
                </div>

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

              <div className="mt-5 space-y-3">
                {drafters.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/15 p-5 text-slate-500">
                    No drafters yet. Add people to start a custom draft.
                  </div>
                )}

                {drafters.map((drafter, index) => {
                  const odds =
                    totalTickets > 0
                      ? ((drafter.lotteryTickets / totalTickets) * 100).toFixed(1)
                      : "0.0";

                  return (
                    <div
                      key={drafter.id}
                      className={`rounded-2xl border p-4 ${
                        drafter.id === currentDrafter?.id
                          ? "border-cyan-300 bg-cyan-300/10"
                          : "border-white/10 bg-slate-900"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm text-slate-400">
                            Draft Slot {index + 1}
                          </div>
                          <div className="text-lg font-bold">{drafter.name}</div>
                          <div className="mt-1 text-xs text-cyan-300">
                            Lottery odds: {odds}%
                          </div>
                        </div>

                        <button
                          onClick={() => removeDrafter(drafter.id)}
                          disabled={picks.length > 0}
                          className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-slate-300 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Remove
                        </button>
                      </div>

                      <div className="mt-4">
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Lottery Tickets
                        </label>
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
                          className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-bold">Draft Items</h2>
                  <p className="mt-2 text-sm text-slate-400">
                    Add items one-by-one or bulk paste a list.
                  </p>
                </div>

                <button
                  onClick={clearAllAvailableItems}
                  disabled={availableItems.length === 0}
                  className="rounded-2xl bg-white/10 px-4 py-2 text-xs font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear Items
                </button>
              </div>

              <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900 p-5">
                <h3 className="text-lg font-bold">Add Custom Item</h3>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <input
                    value={newItemName}
                    onChange={(event) => setNewItemName(event.target.value)}
                    placeholder="Item name, ex: Pizza"
                    className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                  />

                  <input
                    value={newItemCategory}
                    onChange={(event) => setNewItemCategory(event.target.value)}
                    placeholder="Category, ex: Food"
                    className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                  />
                </div>

                <textarea
                  value={newItemDescription}
                  onChange={(event) => setNewItemDescription(event.target.value)}
                  placeholder="Description..."
                  className="mt-3 min-h-24 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                />

                <button
                  onClick={addItem}
                  className="mt-3 rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
                >
                  Add Item
                </button>
              </div>

              <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900 p-5">
                <h3 className="text-lg font-bold">Bulk Add Items</h3>
                <p className="mt-2 text-xs text-slate-400">
                  One per line. Format: Name, Category, Description
                </p>

                <textarea
                  value={bulkItemsText}
                  onChange={(event) => setBulkItemsText(event.target.value)}
                  placeholder={`UTSA, AAC, High-upside rebuild\nTulane, AAC, Great uniforms and location\nECU, AAC, Underrated fanbase`}
                  className="mt-4 min-h-36 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                />

                <button
                  onClick={bulkAddItems}
                  className="mt-3 rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
                >
                  Bulk Add Items
                </button>
              </div>

              <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900 p-4 text-sm text-slate-300">
                Available items:{" "}
                <span className="font-bold text-cyan-300">
                  {availableItems.length}
                </span>
              </div>
            </div>
          </section>
        )}

        {activeTab === "draft" && (
          <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
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
                    Pick {currentPickNumber} · Round {currentRound}
                  </p>
                </div>

                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search available items..."
                  className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                />
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {filteredItems.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/15 p-5 text-slate-500 md:col-span-2">
                    No available items. Add items in Setup or choose a template.
                  </div>
                )}

                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-white/10 bg-slate-900 p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-black">{item.name}</h3>
                        <p className="mt-1 text-sm font-semibold text-cyan-300">
                          {item.category}
                        </p>
                      </div>

                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => draftItem(item)}
                          disabled={!currentDrafter}
                          className="rounded-full bg-cyan-400 px-3 py-1 text-xs font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Draft
                        </button>

                        <button
                          onClick={() => deleteAvailableItem(item.id)}
                          className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white transition hover:bg-white/15"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <p className="mt-4 text-sm text-slate-400">{item.description}</p>
                  </div>
                ))}
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
                    Every selection appears here.
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

              <div className="mt-6 space-y-3">
                {picks.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/15 p-5 text-slate-500">
                    No picks yet.
                  </div>
                )}

                {picks.map((pick) => (
                  <div
                    key={pick.pickNumber}
                    className="rounded-2xl border border-white/10 bg-slate-900 p-4"
                  >
                    <div className="text-sm text-slate-400">
                      Pick {pick.pickNumber} · Round {pick.round} · {pick.drafter}
                    </div>

                    <div className="mt-1 text-lg font-black">{pick.item.name}</div>
                    <div className="text-sm text-cyan-300">{pick.item.category}</div>
                  </div>
                ))}
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
                    Pick {pick.pickNumber} · Round {pick.round}
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