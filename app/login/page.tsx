"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageContent />
    </Suspense>
  );
}

function describeAuthError(message: string) {
  if (message.toLowerCase().includes("anonymous sign-ins")) {
    return "Enter an email and password.";
  }

  return message;
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get("redirect") || "/create";

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
    if (!email.trim() || !password) {
      setMessage("Enter an email and password.");
      return;
    }

    setIsLoading(true);
    setMessage("");

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}${redirectTarget}`
            : undefined,
      },
    });

    if (error) {
      setMessage(describeAuthError(error.message));
    } else if (data.session) {
      router.push(redirectTarget);
      return;
    } else {
      setMessage(
        "Account created. Check your email if Supabase requires confirmation."
      );
    }

    setIsLoading(false);
  }

  async function signIn() {
    if (!email.trim() || !password) {
      setMessage("Enter an email and password.");
      return;
    }

    setIsLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (!error) {
      router.push(redirectTarget);
      return;
    }

    setMessage(describeAuthError(error.message));
    setIsLoading(false);
  }

  async function signInWithDiscord() {
    setIsLoading(true);
    setMessage("");

    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}${redirectTarget}`
        : undefined;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo,
        scopes: "identify email",
      },
    });

    if (error) {
      setMessage(error.message);
      setIsLoading(false);
    }
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
              CFB Draft Tool
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
                  href={redirectTarget}
                  className="rounded-2xl bg-cyan-400 px-5 py-3 text-center font-bold text-slate-950 transition hover:bg-cyan-300"
                >
                  {searchParams.get("redirect")
                    ? "Continue to Draft"
                    : "Go to Draft Builder"}
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
              <button
                onClick={signInWithDiscord}
                disabled={isLoading}
                className="w-full rounded-2xl border border-[#5865F2] bg-[#5865F2] px-5 py-3 font-bold text-white transition hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue with Discord
              </button>

              <div className="flex items-center gap-3 text-sm text-slate-400">
                <div className="h-px flex-1 bg-white/10" />
                <span>or use email</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

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