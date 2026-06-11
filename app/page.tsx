import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8">
        <header className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/5 px-6 py-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
              Draft Anything
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Custom drafts for sports, food, movies, leagues, and anything else.
            </p>
          </div>

          <Link
            href="/create"
            className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
          >
            Create Draft
          </Link>
        </header>

        <div className="grid flex-1 items-center gap-10 py-16 lg:grid-cols-[1.1fr_0.9fr]">
          <section>
            <div className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-200">
              Build a draft room for anything
            </div>

            <h1 className="mt-6 text-5xl font-black tracking-tight md:text-7xl">
              Draft teams, foods, movies, players, or anything your group can
              argue about.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Create a custom draft, add drafters, set weighted lottery odds,
              bulk-add draftable items, run the lottery, make picks, undo
              mistakes, and export the final results.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/create"
                className="rounded-2xl bg-cyan-400 px-6 py-4 text-center font-black text-slate-950 transition hover:bg-cyan-300"
              >
                Start a Draft
              </Link>

              <a
                href="#features"
                className="rounded-2xl bg-white/10 px-6 py-4 text-center font-black text-white transition hover:bg-white/15"
              >
                View Features
              </a>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl">
            <div className="rounded-3xl border border-cyan-400/20 bg-slate-900 p-6">
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-300">
                Example Draft
              </p>

              <h2 className="mt-4 text-3xl font-black">
                College Football 26 Team Draft
              </h2>

              <div className="mt-6 space-y-3">
                {[
                  ["1.01", "Garrett", "UTSA"],
                  ["1.02", "Chris", "Tulane"],
                  ["1.03", "Tyler", "James Madison"],
                  ["1.04", "John", "ECU"],
                ].map(([pick, drafter, item]) => (
                  <div
                    key={pick}
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950 p-4"
                  >
                    <div>
                      <div className="text-xs text-slate-500">{pick}</div>
                      <div className="font-bold">{drafter}</div>
                    </div>

                    <div className="text-right">
                      <div className="text-lg font-black">{item}</div>
                      <div className="text-xs text-cyan-300">Drafted</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <section id="features" className="grid gap-4 pb-10 md:grid-cols-4">
          {[
            ["Templates", "Start with CFB, food, movies, or blank drafts."],
            ["Weighted Lottery", "Give users custom odds for draft order."],
            ["Bulk Add", "Paste drafters and draft items in seconds."],
            ["Export Results", "Download the final draft board as a CSV."],
          ].map(([title, text]) => (
            <div
              key={title}
              className="rounded-3xl border border-white/10 bg-white/5 p-6"
            >
              <h3 className="text-xl font-black">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-400">{text}</p>
            </div>
          ))}
        </section>
      </section>
    </main>
  );
}