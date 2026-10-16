"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { makeZip } from "@/lib/zipArchive";

type Channel = { id: string; name: string };
type ExportAttachment = {
  id: string;
  filename: string;
  url: string;
  contentType?: string | null;
  size?: number | null;
  localPath?: string;
  downloadError?: string;
};
type ExportMessage = {
  id: string;
  timestamp: string;
  content: string;
  author: { id: string; username: string; displayName: string; bot: boolean };
  attachments: ExportAttachment[];
  [key: string]: unknown;
};

type ExportPage = {
  channel: Channel;
  messages: ExportMessage[];
  nextBefore: string | null;
  hasMore: boolean;
  error?: string;
};

type ImageJob = {
  messageId: string;
  attachment: ExportAttachment;
  path: string;
};

const MAX_IMAGES = 1000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 300 * 1024 * 1024;

function isPicture(attachment: ExportAttachment) {
  return (
    attachment.contentType?.toLowerCase().startsWith("image/") === true ||
    /\.(png|jpe?g|gif|webp|heic|heif|avif|apng|bmp)$/i.test(attachment.filename)
  );
}

function safeImagePath(messageId: string, attachment: ExportAttachment) {
  const cleanName = attachment.filename
    .replace(/[^a-z0-9_.-]/gi, "_")
    .replace(/\.\.+/g, "_")
    .replace(/^\.+/, "")
    .slice(-90) || "image";
  return "images/" + messageId + "_" + attachment.id + "_" + cleanName;
}

function downloadBlob(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}

export default function DiscordHistoryExportPage() {
  const params = useParams();
  const rawId = params.seasonId;
  const seasonId = Array.isArray(rawId) ? rawId[0] : rawId;
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [threadId, setThreadId] = useState("");
  const [since, setSince] = useState("");
  const [maxMessages, setMaxMessages] = useState("10000");
  const [includeImages, setIncludeImages] = useState(true);
  const [status, setStatus] = useState("Loading channels...");
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadedImages, setDownloadedImages] = useState(0);
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
        setStatus("Choose a channel or thread, then export.");
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
    setDownloadedImages(0);
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
      const imageJobs: ImageJob[] = [];
      for (const message of chronological) {
        for (const attachment of message.attachments || []) {
          if (!isPicture(attachment)) continue;
          imageJobs.push({
            messageId: message.id,
            attachment,
            path: safeImagePath(message.id, attachment),
          });
        }
      }

      if (includeImages && imageJobs.length > MAX_IMAGES) {
        throw new Error(
          "Found " + imageJobs.length.toLocaleString() + " pictures. " +
          "The ZIP limit is " + MAX_IMAGES.toLocaleString() +
          "; choose a shorter date range, or export JSON without images."
        );
      }

      const failedImages: { messageId: string; attachmentId: string; reason: string }[] = [];
      const files: { path: string; data: ArrayBuffer }[] = [];
      let imageBytes = 0;
      let imagesSaved = 0;

      if (includeImages && imageJobs.length) {
        let cursor = 0;
        setStatus("Downloading " + imageJobs.length.toLocaleString() + " pictures...");

        async function worker() {
          while (cursor < imageJobs.length && !abort.signal.aborted) {
            const job = imageJobs[cursor++];
            if ((job.attachment.size ?? 0) > MAX_IMAGE_BYTES) {
              const reason = "Image exceeds 25 MB per-file limit";
              job.attachment.downloadError = reason;
              failedImages.push({ messageId: job.messageId, attachmentId: job.attachment.id, reason });
              continue;
            }

            try {
              const query = new URLSearchParams({
                seasonId: seasonId as string,
                channelId: selectedId,
                messageId: job.messageId,
                attachmentId: job.attachment.id,
              });
              const response = await fetch("/api/discord/export/image?" + query, {
                headers: { Authorization: "Bearer " + token },
                signal: abort.signal,
                cache: "no-store",
              });

              if (!response.ok) {
                const result = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(result?.error || "HTTP " + response.status);
              }

              const buffer = await response.arrayBuffer();
              if (buffer.byteLength > MAX_IMAGE_BYTES) {
                throw new Error("Image exceeds 25 MB per-file limit");
              }
              if (imageBytes + buffer.byteLength > MAX_TOTAL_IMAGE_BYTES) {
                throw new Error("ZIP reached 300 MB image limit; export a shorter range");
              }

              imageBytes += buffer.byteLength;
              files.push({ path: job.path, data: buffer });
              job.attachment.localPath = job.path;
              imagesSaved++;
              setDownloadedImages(imagesSaved);
            } catch (error) {
              if (abort.signal.aborted) return;
              const reason = error instanceof Error ? error.message : "Download failed";
              job.attachment.downloadError = reason;
              failedImages.push({ messageId: job.messageId, attachmentId: job.attachment.id, reason });
            }
          }
        }

        // Restrict parallel downloads to avoid overwhelming Discord's API.
        await Promise.all(Array.from({ length: Math.min(3, imageJobs.length) }, () => worker()));
        if (abort.signal.aborted) return;
      }

      const exported = {
        format: "genesis-discord-history-v2",
        exportedAt: new Date().toISOString(),
        channel: { id: selectedId, name: channelName },
        since: since || null,
        reachedHistoryEnd: !hasMore,
        truncatedAtMessageLimit: hasMore && !reachedDate,
        count: chronological.length,
        imageAttachmentCount: imageJobs.length,
        imageDownloadSummary: {
          requested: includeImages,
          downloaded: imagesSaved,
          failed: failedImages.length,
          totalBytes: imageBytes,
          failedImages,
        },
        note: includeImages
          ? "Uploaded pictures are stored inside images/ and referenced via each attachment.localPath. Other embed/external GIF links remain URLs. Check imageDownloadSummary for missing files."
          : "This JSON contains image URLs only. Re-export with Include images to save original image files.",
        messages: chronological,
      };
      const stamp = new Date().toISOString().slice(0, 10);
      const baseName = "genesis-discord-" + channelName.replace(/[^a-z0-9_-]/gi, "-") + "-" + stamp;

      if (includeImages) {
        setStatus("Packaging " + imagesSaved.toLocaleString() + " downloaded pictures...");
        const jsonBuffer = new TextEncoder().encode(JSON.stringify(exported, null, 2)).buffer as ArrayBuffer;
        files.unshift({ path: "messages.json", data: jsonBuffer });
        files.sort((a, b) => a.path.localeCompare(b.path));
        const archive = makeZip(files);
        downloadBlob(archive, baseName + ".zip");
      } else {
        downloadBlob(
          new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }),
          baseName + ".json"
        );
      }

      setStatus(
        "Exported " + chronological.length.toLocaleString() + " messages" +
        (includeImages
          ? " and " + imagesSaved.toLocaleString() + "/" + imageJobs.length.toLocaleString() + " pictures in a ZIP."
          : " as JSON (image links only).") +
        (failedImages.length ? " " + failedImages.length.toLocaleString() + " images failed; details are in messages.json." : "") +
        (hasMore && !reachedDate ? " Message limit reached; use a larger limit to include older history." : "") +
        " Upload the export to ChatGPT."
      );
    } catch (error) {
      setStatus(abort.signal.aborted
        ? "Export cancelled."
        : error instanceof Error ? error.message : "Export failed.");
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
            Save Discord conversations and their uploaded pictures together. ZIP exports include
            messages.json plus the original image files. Each picture is linked to its author's
            message. Exporting does not post or change anything in Discord.
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

            <label className="flex items-start gap-3 rounded-xl border border-cyan-300/25 bg-cyan-300/5 p-4">
              <input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)}
                disabled={isExporting}
                className="mt-1 h-4 w-4 accent-cyan-300" />
              <span className="text-sm">
                <strong className="block text-white">Include actual pictures (ZIP download)</strong>
                <span className="mt-1 block text-slate-300">
                  Download original uploaded pictures, including GIFs, JPGs, PNGs and WebP images.
                  Image-only limits: 1,000 files, 25 MB per file, 300 MB per export.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={() => void exportChannel()} disabled={isExporting || !(threadId.trim() || channelId)}
              className="rounded-xl bg-cyan-400 px-5 py-3 font-black text-slate-950 transition hover:bg-cyan-300 disabled:opacity-40">
              {isExporting ? "Exporting..." : includeImages ? "Export Messages + Pictures (ZIP)" : "Export JSON"}
            </button>
            {isExporting && (
              <button onClick={() => controller.current?.abort()}
                className="rounded-xl border border-white/20 px-5 py-3 font-bold text-white hover:bg-white/10">
                Cancel
              </button>
            )}
          </div>
          <p aria-live="polite" className="mt-4 text-sm text-slate-300">{status}</p>
          {isExporting && (
            <p className="mt-1 text-xs text-slate-400">
              {progress.toLocaleString()} messages fetched · {downloadedImages.toLocaleString()} pictures saved
            </p>
          )}
          <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-relaxed text-slate-400">
            Export only conversations and photos you have permission to share. Uploaded images
            are saved in the ZIP; externally linked pictures and GIF embeds may remain URLs.
            Some deleted, oversized or inaccessible pictures may fail and will be noted in the JSON.
            The bot needs access to the channel's history and Message Content Intent.
            For forum channels, export individual threads using their IDs.
          </p>
        </section>
      </div>
    </main>
  );
}
