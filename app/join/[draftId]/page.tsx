"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function JoinRedirectPage() {
  const router = useRouter();
  const params = useParams();
  const rawDraftId = params.draftId;
  const draftId = Array.isArray(rawDraftId) ? rawDraftId[0] : rawDraftId;

  useEffect(() => {
    if (draftId) {
      router.replace(`/room/${draftId}`);
    }
  }, [draftId, router]);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
      <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
          CFB Draft Tool
        </p>
        <h1 className="mt-4 text-4xl font-black">Redirecting...</h1>
      </section>
    </main>
  );
}
