"use client";"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import CameraView, { type CameraStatus } from "@/components/CameraView";
import { blendshape } from "@/lib/landmarks/parse";
import type { FaceFrame } from "@/lib/landmarks/types";
import {
  ACTION_LABELS,
  ACTION_PROMPTS,
  type LivenessAction,
} from "@/lib/liveness/actions";
import { round } from "@/lib/utils";
import { generateChallenges, randomChallengeCount } from "@/lib/liveness/challenge";
import {
  createVerificationEngine,
  type EngineState,
  type VerificationEngine,
} from "@/lib/liveness/engine";
import { decide, fallbackExplanation, type Verdict } from "@/lib/liveness/verdict";
import { fetchInstructions, fetchExplanation } from "@/lib/llm/textClient";

export default function VerifyPage() {
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [state, setState] = useState<EngineState | null>(null);
  const [started, setStarted] = useState(false);
  const [result, setResult] = useState<{ verdict: Verdict; explanation: string } | null>(
    null
  );

  const [debug, setDebug] = useState(false);
  const [dbg, setDbg] = useState<DebugInfo | null>(null);

  const engineRef = useRef<VerificationEngine | null>(null);
  const throttleRef = useRef(0);
  const doneRef = useRef(false);

  const handleFrame = useCallback((f: FaceFrame) => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = engine.update(f); // full-rate update for accurate detection

    if (next.phase === "complete" && !doneRef.current) {
      doneRef.current = true;
      const verdict = decide(engine.getSignals());
      const fallback = fallbackExplanation(verdict);
      // Show the fallback immediately, then upgrade to the LLM phrasing.
      setResult({ verdict, explanation: fallback });
      void fetchExplanation({
        isHuman: verdict.isHuman,
        passed: verdict.passedRounds,
        total: verdict.totalRounds,
        fallback,
      }).then((explanation) => setResult({ verdict, explanation }));
    }

    const now = performance.now();
    if (now - throttleRef.current < 50) return; // ~20 fps UI
    throttleRef.current = now;
    setState(next);
    setDbg({
      hasFace: f.hasFace,
      landmarkCount: f.landmarkCount,
      yaw: f.pose.yaw,
      pitch: f.pose.pitch,
      roll: f.pose.roll,
      blinkL: blendshape(f, "eyeBlinkLeft"),
      blinkR: blendshape(f, "eyeBlinkRight"),
      jawOpen: blendshape(f, "jawOpen"),
      smileL: blendshape(f, "mouthSmileLeft"),
      smileR: blendshape(f, "mouthSmileRight"),
      hands: f.hands?.length ?? 0,
    });
  }, []);

  // Hidden debug panel: toggle with the "d" key.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "d" || e.key === "D") setDebug((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const begin = useCallback(async () => {
    const challenges = generateChallenges(randomChallengeCount());
    // Ask the LLM to phrase each instruction (hardcoded fallback on failure).
    const prompts = await fetchInstructions(
      challenges.map((c) => c.action),
      challenges.map((c) => ACTION_PROMPTS[c.action])
    );
    challenges.forEach((c, i) => {
      if (prompts[i]) c.prompt = prompts[i];
    });

    const engine = createVerificationEngine(challenges);
    engineRef.current = engine;
    doneRef.current = false;
    setResult(null);
    engine.start(performance.now());
    setState(engine.getState());
    setStarted(true);
  }, []);

  const reset = useCallback(() => {
    engineRef.current?.reset();
    engineRef.current = null;
    doneRef.current = false;
    setResult(null);
    setState(null);
    setStarted(false);
  }, []);

  const complete = state?.phase === "complete";

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center justify-between">
          <Link href="/" className="font-mono text-sm text-gray-500 hover:text-gray-300">
            ← back
          </Link>
          <h1 className="text-xl font-semibold">Liveness Check</h1>
          {started ? (
            <button
              onClick={reset}
              className="rounded-md border border-gray-700 px-3 py-1 text-sm text-gray-300 hover:border-gray-500"
            >
              Reset
            </button>
          ) : (
            <span className="w-16" />
          )}
        </header>

        <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
          <div className="relative">
            <CameraView
              onFrame={handleFrame}
              onStatus={setCameraStatus}
              className="aspect-video w-full"
            />
            <ChallengeOverlay
              state={state}
              started={started}
              cameraStatus={cameraStatus}
              onBegin={begin}
            />
          </div>

          <aside className="space-y-4">
            <RoundList state={state} />
            {complete && result && (
              <ResultCard
                verdict={result.verdict}
                explanation={result.explanation}
                onReset={reset}
              />
            )}
            {debug && <DebugPanel dbg={dbg} />}
          </aside>
        </div>

        <p className="mt-4 text-center font-mono text-xs text-gray-600">
          Press <kbd className="rounded bg-gray-800 px-1">D</kbd> for the debug
          panel. Video never leaves your device.
        </p>
      </div>
    </main>
  );
}

function ChallengeOverlay({
  state,
  started,
  cameraStatus,
  onBegin,
}: {
  state: EngineState | null;
  started: boolean;
  cameraStatus: CameraStatus;
  onBegin: () => void;
}) {
  if (!started || !state) {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-6">
        <button
          onClick={onBegin}
          disabled={cameraStatus === "error"}
          className="pointer-events-auto pulse-ring rounded-lg bg-accent px-8 py-3 text-base font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40"
        >
          Begin check
        </button>
      </div>
    );
  }

  if (state.phase === "complete") return null;

  const ready = state.roundStatus === "ready";
  const secondsLeft = Math.ceil(state.challengeCountdownMs / 1000);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4">
      <div className="rounded-lg bg-black/70 p-4 backdrop-blur">
        <div className="mb-1 flex items-center justify-between font-mono text-xs text-gray-400">
          <span>
            Step {state.index + 1} / {state.total}
          </span>
          {!ready && (
            <span className={secondsLeft <= 2 ? "text-danger" : "text-gray-300"}>
              {secondsLeft}s
            </span>
          )}
        </div>
        {ready ? (
          <p className="text-center text-lg font-semibold text-warn">
            Get ready… {Math.ceil(state.readyCountdownMs / 1000)}
          </p>
        ) : (
          <p className="text-center text-2xl font-bold text-white">
            {state.current?.prompt}
          </p>
        )}
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-800">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${Math.round(state.currentProgress * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function RoundList({ state }: { state: EngineState | null }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-panel p-4">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-gray-500">
        Challenges
      </h2>
      {!state ? (
        <p className="text-sm text-gray-500">
          Press “Begin check” to start a randomized liveness sequence.
        </p>
      ) : (
        <ol className="space-y-2">
          {state.results.map((r, i) => (
            <li key={i} className="flex items-center justify-between text-sm">
              <span className="text-gray-300">
                {ACTION_LABELS[r.action as LivenessAction] ?? r.action}
              </span>
              <span className={r.passed ? "text-success" : "text-danger"}>
                {r.passed ? "✓ pass" : "✗ fail"}
              </span>
            </li>
          ))}
          {state.current && (
            <li className="flex items-center justify-between text-sm">
              <span className="text-white">{ACTION_LABELS[state.current.action]}</span>
              <span className="text-warn">
                {state.roundStatus === "ready" ? "…" : "active"}
              </span>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

function ResultCard({
  verdict,
  explanation,
  onReset,
}: {
  verdict: Verdict;
  explanation: string;
  onReset: () => void;
}) {
  return (
    <div
      className={`rounded-xl border bg-panel p-4 ${
        verdict.isHuman ? "border-success/50" : "border-danger/50"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className={`rounded-md px-3 py-1 text-sm font-bold ${
            verdict.isHuman ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
          }`}
        >
          {verdict.isHuman ? "✓ HUMAN VERIFIED" : "✗ NOT VERIFIED"}
        </span>
        <span className="font-mono text-sm text-gray-400">
          {verdict.passedRounds}/{verdict.totalRounds}
        </span>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-gray-300">{explanation}</p>
      <button
        onClick={onReset}
        className="w-full rounded-lg bg-accent px-4 py-2 font-semibold text-white hover:bg-indigo-500"
      >
        Run again
      </button>
    </div>
  );
}

interface DebugInfo {
  hasFace: boolean;
  landmarkCount: number;
  yaw: number;
  pitch: number;
  roll: number;
  blinkL: number;
  blinkR: number;
  jawOpen: number;
  smileL: number;
  smileR: number;
  hands: number;
}

function DebugPanel({ dbg }: { dbg: DebugInfo | null }) {
  const Row = ({ k, v, warn }: { k: string; v: string; warn?: boolean }) => (
    <div className="flex justify-between">
      <span className="text-gray-500">{k}</span>
      <span className={warn ? "text-warn" : "text-gray-200"}>{v}</span>
    </div>
  );
  return (
    <div className="rounded-xl border border-accent/40 bg-black/80 p-4 font-mono text-[11px]">
      <h2 className="mb-2 uppercase tracking-widest text-accent">
        Debug · live signals
      </h2>
      {!dbg ? (
        <p className="text-gray-500">waiting for frames…</p>
      ) : (
        <div className="space-y-1">
          <Row
            k="face"
            v={dbg.hasFace ? `yes (${dbg.landmarkCount} pts)` : "no"}
            warn={!dbg.hasFace}
          />
          <Row k="hands" v={String(dbg.hands)} />
          <Row k="yaw°" v={String(round(dbg.yaw, 1))} />
          <Row k="pitch°" v={String(round(dbg.pitch, 1))} />
          <Row k="roll°" v={String(round(dbg.roll, 1))} />
          <Row k="blink L/R" v={`${round(dbg.blinkL, 2)} / ${round(dbg.blinkR, 2)}`} />
          <Row k="jawOpen" v={String(round(dbg.jawOpen, 2))} />
          <Row k="smile L/R" v={`${round(dbg.smileL, 2)} / ${round(dbg.smileR, 2)}`} />
          <div className="mt-2 border-t border-gray-800 pt-1 text-gray-500">
            thresholds: blink≥0.5 ·2 · smile/jaw≥0.4 · turn |yaw|≥18° · nose≤0.09
          </div>
        </div>
      )}
    </div>
  );
}
