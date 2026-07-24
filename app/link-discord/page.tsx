"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type LinkStatus = "loading" | "success" | "error" | "signed-out";

export default function LinkDiscordPage() {
  return (
    <Suspense>
      <LinkDiscordPageContent />
    </Suspense>
  );
}

function LinkDiscordPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<LinkStatus>("loading");
  const [message, setMessage] = useState("");
  const [discordUsername, setDiscordUsername] = useState<string | null>(null);

  useEffect(() => {
    async function run() {
      if (!token) {
        setStatus("error");
        setMessage("Missing link token -- use the link Discord gave you from /link.");
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (!accessToken) {
        setStatus("signed-out");
        return;
      }

      const response = await fetch("/api/discord/link", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ linkToken: token }),
      });

      const data = await response.json();

      if (!response.ok) {
        setStatus("error");
        setMessage(data.error || "Something went wrong linking your account.");
        return;
      }

      setDiscordUsername(data.discordUsername ?? null);
      setStatus("success");
    }

    // Deliberate one-shot run on mount -- not a subscription.
    run();
  }, [token]);

  function signInAndRetry() {
    const redirect = `/link-discord?token=${token ?? ""}`;
    router.push(`/login?redirect=${encodeURIComponent(redirect)}`);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
      <section className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
          Season Check-In
        </p>
        <h1 className="mt-4 text-3xl font-black">Link Discord Account</h1>

        {status === "loading" && <p className="mt-4 text-slate-300">Linking your account...</p>}

        {status === "signed-out" && (
          <div className="mt-4">
            <p className="text-slate-300">Sign in to the app first, then this link will finish automatically.</p>
            <button
              onClick={signInAndRetry}
              className="mt-4 rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
            >
              Sign In
            </button>
          </div>
        )}

        {status === "success" && (
          <div className="mt-4 rounded-2xl border border-green-400/30 bg-green-400/10 p-4 text-green-200">
            ✅ Linked{discordUsername ? ` to Discord as @${discordUsername}` : ""}. You can close this
            tab and use the &quot;✅ I&apos;m Ready&quot; button in Discord now.
          </div>
        )}

        {status === "error" && (
          <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-red-200">
            {message}
          </div>
        )}

        <Link href="/season" className="mt-6 inline-flex text-sm font-bold text-slate-400 transition hover:text-white">
          ← Back to Seasons
        </Link>
      </section>
    </main>
  );
}
