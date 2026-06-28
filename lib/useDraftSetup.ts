"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type Drafter = {
  id: number;
  name: string;
  lotteryTickets: number;
  groupId?: string;
  missedPicks?: number;
};

export type DraftGroupMode = "lottery" | "manual";

export type DraftGroup = {
  id: string;
  name: string;
  mode: DraftGroupMode;
};

export type DraftItem = {
  id: number;
  name: string;
  category: string;
  description: string;
  color?: string;
  prestige?: number | null;
};

export type Pick = {
  pickNumber: number;
  drafter: string;
  item: DraftItem;
};

export type SavedDraftState = {
  selectedTemplateId: string;
  draftTitle: string;
  drafters: Drafter[];
  availableItems: DraftItem[];
  picks: Pick[];
  lotteryHasRun: boolean;
  groups?: DraftGroup[];
  pickTimeLimitSeconds?: number | null;
  pickDeadline?: string | null;
};

export type CloudDraftRow = {
  id: string;
  title: string;
  draft_data: SavedDraftState;
  updated_at: string;
  is_joinable: boolean;
};

export function useDraftSetup(draftId: string | undefined) {
  const [draft, setDraft] = useState<CloudDraftRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    load();
  }, [draftId]);

  async function load() {
    if (!draftId) return;

    setIsLoading(true);
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) {
      setDraft(null);
      setIsLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("drafts")
      .select("id, title, draft_data, updated_at, is_joinable")
      .eq("id", draftId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (error) {
      setMessage(error.message);
      setDraft(null);
    } else {
      setDraft((data as CloudDraftRow) ?? null);
    }

    setIsLoading(false);
  }

  async function save(nextData: Partial<SavedDraftState>): Promise<boolean> {
    if (!draft) return false;

    setIsSaving(true);
    setMessage("");

    const nextDraftData: SavedDraftState = { ...draft.draft_data, ...nextData };

    const { error } = await supabase
      .from("drafts")
      .update({
        draft_data: nextDraftData,
        title: nextDraftData.draftTitle,
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id);

    if (error) {
      setMessage(error.message);
      setIsSaving(false);
      return false;
    }

    setDraft({
      ...draft,
      draft_data: nextDraftData,
      title: nextDraftData.draftTitle,
      updated_at: new Date().toISOString(),
    });

    setIsSaving(false);
    return true;
  }

  return { draft, isLoading, isSaving, message, setMessage, save, reload: load };
}
