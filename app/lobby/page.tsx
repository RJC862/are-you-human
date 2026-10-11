"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Claims {
  isHuman: boolean;
  confidence: number;
  iat?: number;
  exp?: number;
}

type LobbyState =
  | { phase: "no-token" }
  | { phase: "verifying" }
  | { phase: "admitted"; claims: Claims }
  | { phase: "rejected"; reason: string };

/**
 * Mock "meeting lobby" — stands in for a consumer app (Zoom, a marketplace,
 * etc.) that requires a proof-of-liveness token before admitting a user. It
 * reads ?token= from the URL and validates it via /api/verify-token.
 */
export default function LobbyPage() {
  const [state, setState] = useState<LobbyState>({ phase: "verifying" });

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState({ phase: "no-token" });
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/verify-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json()) as {
          valid: boolean;
          claims?: Claims;
          error?: string;
        };
        if (data.valid && data.claims?.isHuman) {
          setState({ phase: "admitted", claims: data.claims });
        } else {
          setState({
            phase: "rejected",
            reason: data.error ?? "token not valid",
          });
        }
      } catch {
        setState({ phase: "rejected", reason: "could not reach verifier" });
      }
    })();
  }, []);

  return (
    <main className="grid-backdrop flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-panel p-8 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-gray-500">
          Daily Standup · Meeting Lobby
        </p>
        <h1 className="mt-2 text-2xl font-bold">Join the meeting</h1>

        <div className="mt-8">
          {state.phase === "verifying" && (
            <p className="animate-pulse text-gray-400">Checking your pass…</p>
          )}

          {state.phase === "no-token" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-warn/40 bg-warn/10 p-4 text-sm text-warn">
                A human-verification pass is required to enter this meeting.
              </div>
              <Link
                href="/verify"
                className="inline-block rounded-lg bg-accent px-6 py-2.5 font-semibold text-white hover:bg-indigo-500"
              >
                Verify I&apos;m human
              </Link>
            </div>
          )}

          {state.phase === "admitted" && (
            <div className="space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-3xl text-success">
                ✓
              </div>
              <div>
                <p className="text-lg font-semibold text-success">
                  Human verified — you&apos;re in
                </p>
                <p className="mt-1 text-sm text-gray-400">
                  Admitted with {Math.round(state.claims.confidence * 100)}%
                  confidence. Pass valid for this session.
                </p>
              </div>
              <button className="w-full rounded-lg bg-success/90 px-6 py-2.5 font-semibold text-black hover:bg-success">
                Enter meeting room
              </button>
            </div>
          )}

          {state.phase === "rejected" && (
            <div className="space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-danger/15 text-3xl text-danger">
                ✗
              </div>
              <div>
                <p className="text-lg font-semibold text-danger">
                  Access denied
                </p>
                <p className="mt-1 text-sm text-gray-400">
                  Your pass could not be verified ({state.reason}).
                </p>
              </div>
              <Link
                href="/verify"
                className="inline-block rounded-lg bg-accent px-6 py-2.5 font-semibold text-white hover:bg-indigo-500"
              >
                Try verification again
              </Link>
            </div>
          )}
        </div>
      </div>

      <Link
        href="/"
        className="mt-6 font-mono text-xs text-gray-600 hover:text-gray-400"
      >
        ← home
      </Link>
    </main>
  );
}
