"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Channel = { id: string; name: string };
type ExportMessage = {
  id: string;
  timestamp: string;
  content: string;
  author: { id: string; username: string; displayName: string; bot: boolean };
  attachments: { id: string; filename: string; url: string; contentType?: string | null }[];
};

type ExportPage = {
  channel: Channel;
  messages: ExportMessage[];
  nextBefore: string | null;
  hasMore: boolean;
  error?: string;
};

export default function DiscordHistoryExportPage() {
  const params = useParams();
  const rawId = params.seasonId;
  const seasonId = Array.isArray(rawId) ? rawId[0] : rawId;
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [threadId, setThreadId] = useState("");
  const [since, setSince] = useState("");
  const [maxMessages, setMaxMessages] = useState("10000");
  const [status, setStatus] = useState("Loading channels...");
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!seasonId) return;
    let cancelled = false;
    async function load() {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token) throw new Error("Please sign in to the commissioner site.");
        const query = new URLSearchParams({ seasonId: seasonId as string, action: "channels" });
        const response = await fetch("/api/discord/export?" + query, {
          headers: { Authorization: "Bearer " + token },
          cache: "no-store",
        });
        const result = await response.json() as { channels?: Channel[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load channels.");
        if (cancelled) return;
        setChannels(result.channels || []);
        setStatus("Choose a channel or paste a thread ID, then click Export JSON.");
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Could not load channels.");
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [seasonId]);

  async function exportChannel() {
    const selectedId = threadId.trim() || channelId;
    if (!selectedId || !seasonId) {
      setStatus("Choose a text channel, or paste a Discord thread ID.");
      return;
    }

    setIsExporting(true);
    setProgress(0);
    setStatus("Reading Discord history...");
    const abort = new AbortController();
    controller.current = abort;

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");

      const limit = Number(maxMessages);
      const cutoff = since ? new Date(since + "T00:00:00.000Z").getTime() : null;
      let before: string | null = null;
      let channelName = selectedId;
      let hasMore = true;
      let reachedDate = false;
      const messages: ExportMessage[] = [];

      while (hasMore && messages.length < limit && !reachedDate) {
        const query = new URLSearchParams({
          seasonId,
          channelId: selectedId,
          count: String(Math.min(200, limit - messages.length)),
        });
        if (before) query.set("before", before);

        const response = await fetch("/api/discord/export?" + query, {
          headers: { Authorization: "Bearer " + token },
          signal: abort.signal,
          cache: "no-store",
        });
        const page = await response.json() as ExportPage;
        if (!response.ok) throw new Error(page.error || "Discord history request failed.");

        channelName = page.channel.name;
        for (const message of page.messages) {
          if (cutoff !== null && new Date(message.timestamp).getTime() < cutoff) {
            reachedDate = true;
            break;
          }
          messages.push(message);
        }

        const nextBefore = page.nextBefore;
        hasMore = Boolean(page.hasMore && nextBefore && nextBefore !== before);
        before = nextBefore;
        setProgress(messages.length);
        setStatus("Retrieved " + messages.length.toLocaleString() + " messages from #" + channelName + "...");
      }

      if (abort.signal.aborted) return;

      const chronological = messages.reverse();
      const imageCount = chronological.reduce((count, message) => (
        count + message.attachments.filter((a) =>
          (a.contentType || "").startsWith("image/") ||
          /\.(png|jpe?g|gif|webp|heic)$/i.test(a.filename)
        ).length
      ), 0);

      const exported = {
        format: "genesis-discord-history-v1",
        exportedAt: new Date().toISOString(),
        channel: { id: selectedId, name: channelName },
        since: since || null,
        reachedHistoryEnd: !hasMore,
        truncatedAtMessageLimit: hasMore && !reachedDate,
        count: chronological.length,
        imageAttachmentCount: imageCount,
        note: "Media URLs are references, not embedded files; signed Discord attachment URLs can expire.",
        messages: chronological,
      };

      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "genesis-discord-" + channelName.replace(/[^a-z0-9_-]/gi, "-") + "-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
      setStatus("Exported " + chronological.length.toLocaleString() + " messages and " +
        imageCount.toLocaleString() + " image references. Upload the JSON file to ChatGPT. " +
        (hasMore && !reachedDate ? "The selected message limit was reached; select a higher limit for older history." : ""));
    } catch (error) {
      if (abort.signal.aborted) {
        setStatus("Export cancelled.");
      } else {
        setStatus(error instanceof Error ? error.message : "Export failed.");
      }
    } finally {
      setIsExporting(false);
      controller.current = null;
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-white">
      <div className="mx-auto max-w-2xl">
        <Link href={"/season/room/" + seasonId} className="text-sm font-bold text-cyan-300 hover:underline">
          ← Back to Genesis Commissioner Controls
        </Link>
        <section className="mt-6 rounded-3xl border border-cyan-400/30 bg-slate-900 p-6 shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">Commissioner only</p>
          <h1 className="mt-2 text-2xl font-black">Export Discord History</h1>
          <p className="mt-3 text-sm text-slate-300">
            Export past messages from a Genesis Discord text channel or PvP thread into one JSON file.
            Authors, timestamps, replies, embeds, and image attachment links are preserved.
            This does not post to Discord or change your league.
          </p>

          <div className="mt-6 space-y-5">
            <label className="block text-sm font-bold">
              Discord text channel
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)}
                disabled={isExporting}
                className="mt-2 w-full rounded-xl border border-white/20 bg-slate-800 px-3 py-3 text-white">
                <option value="">Choose a channel...</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
              </select>
            </label>

            <label className="block text-sm font-bold">
              Or paste a thread/channel ID (overrides selection)
              <input value={threadId} onChange={(e) => setThreadId(e.target.value)}
                disabled={isExporting} inputMode="numeric" placeholder="Optional — for PvP threads"
                className="mt-2 w-full rounded-xl border border-white/20 bg-slate-800 px-3 py-3 text-white" />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-bold">
                Only messages since (optional)
                <input type="date" value={since} onChange={(e) => setSince(e.target.value)}
                  disabled={isExporting}
                  className="mt-2 w-full rounded-xl border border-white/20 bg-slate-800 px-3 py-3 text-white" />
              </label>
              <label className="block text-sm font-bold">
                Maximum messages
                <select value={maxMessages} onChange={(e) => setMaxMessages(e.target.value)}
                  disabled={isExporting}
                  className="mt-2 w-full rounded-xl border border-white/20 bg-slate-800 px-3 py-3 text-white">
                  <option value="2000">2,000</option>
                  <option value="10000">10,000</option>
                  <option value="50000">50,000</option>
                </select>
              </label>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={() => void exportChannel()} disabled={isExporting || !(threadId.trim() || channelId)}
              className="rounded-xl bg-cyan-400 px-5 py-3 font-black text-slate-950 transition hover:bg-cyan-300 disabled:opacity-40">
              {isExporting ? "Exporting..." : "Export JSON"}
            </button>
            {isExporting && (
              <button onClick={() => controller.current?.abort()}
                className="rounded-xl border border-white/20 px-5 py-3 font-bold text-white hover:bg-white/10">
                Cancel
              </button>
            )}
          </div>
          <p aria-live="polite" className="mt-4 text-sm text-slate-300">{status}</p>
          {isExporting && <p className="mt-1 text-xs text-slate-400">{progress.toLocaleString()} messages fetched</p>}
          <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-relaxed text-slate-400">
            Export only channels and photos you have permission to share. JSON includes media links rather
            than downloading image bytes, so separately save important images for portraits.
            Discord may require Message Content Intent to be enabled in your bot settings.
            Forum channels contain individual threads, which must be exported using each thread ID.
          </p>
        </section>
      </div>
    </main>
  );
}
