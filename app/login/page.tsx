"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function loadUser() {
      const { data } = await supabase.auth.getUser();
      setUserEmail(data.user?.email ?? null);
    }

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function signUp() {
    setIsLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage(
        "Account created. Check your email if Supabase requires confirmation."
      );
    }

    setIsLoading(false);
  }

  async function signIn() {
    setIsLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Signed in successfully.");
    }

    setIsLoading(false);
  }

  async function signOut() {
    setIsLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signOut();

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Signed out.");
    }

    setIsLoading(false);
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-10">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
          <div className="mb-6">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
              Draft Anything
            </p>

            <h1 className="mt-4 text-4xl font-black">Login / Signup</h1>

            <p className="mt-3 text-slate-400">
              This is the first step toward saving drafts to your account.
            </p>
          </div>

          {userEmail ? (
            <div className="rounded-3xl border border-green-400/30 bg-green-400/10 p-5">
              <p className="text-sm font-semibold text-green-200">
                Signed in as
              </p>

              <p className="mt-2 text-xl font-black">{userEmail}</p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/create"
                  className="rounded-2xl bg-cyan-400 px-5 py-3 text-center font-bold text-slate-950 transition hover:bg-cyan-300"
                >
                  Go to Draft Builder
                </Link>

                <button
                  onClick={signOut}
                  disabled={isLoading}
                  className="rounded-2xl bg-white/10 px-5 py-3 font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
                type="email"
                className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
              />

              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                type="password"
                className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={signIn}
                  disabled={isLoading}
                  className="rounded-2xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Sign In
                </button>

                <button
                  onClick={signUp}
                  disabled={isLoading}
                  className="rounded-2xl bg-white px-5 py-3 font-bold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Sign Up
                </button>
              </div>
            </div>
          )}

          {message && (
            <div className="mt-6 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm font-semibold text-cyan-100">
              {message}
            </div>
          )}

          <div className="mt-6">
            <Link
              href="/"
              className="text-sm font-bold text-cyan-300 hover:text-cyan-200"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}