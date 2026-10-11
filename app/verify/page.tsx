"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import CameraView, { type CameraStatus } from "@/components/CameraView";
import { blendshape } from "@/lib/landmarks/parse";
import type { FaceFrame } from "@/lib/landmarks/types";
import {
  ACTION_LABELS,
  ACTION_SPECS,
  ALL_ACTIONS,
  ANTI_SPOOF_ACTIONS,
  type LivenessAction,
} from "@/lib/liveness/actions";
import { round } from "@/lib/utils";
import {
  MIN_MESH_JITTER,
  MIN_PASSIVE_SCORE,
} from "@/lib/liveness/verdict";
import type { PassiveResult } from "@/lib/liveness/passive";
import {
  generateChallenges,
  DEFAULT_CHALLENGE_COUNT,
  type Challenge,
} from "@/lib/liveness/challenge";
import {
  createVerificationEngine,
  type EngineState,
  type VerificationEngine,
} from "@/lib/liveness/engine";
import { decide, explain, type Verdict } from "@/lib/liveness/verdict";

/** Build a 4-step sequence guaranteed to include at least one anti-spoof action. */
function buildSequence(): Challenge[] {
  const seq = generateChallenges(DEFAULT_CHALLENGE_COUNT);
  if (!seq.some((c) => ANTI_SPOOF_ACTIONS.includes(c.action))) {
    const antiSpoof = generateChallenges(1, undefined, ANTI_SPOOF_ACTIONS)[0];
    if (antiSpoof) seq[seq.length - 1] = antiSpoof;
  }
  return seq;
}

export default function VerifyPage() {
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [state, setState] = useState<EngineState | null>(null);
  const [started, setStarted] = useState(false);
  const [verdict, setVerdict] = useState<{ v: Verdict; explanation: string } | null>(
    null
  );

  const [token, setToken] = useState<string | null>(null);
  const [tokenPending, setTokenPending] = useState(false);

  const [source, setSource] = useState<"camera" | "video">("camera");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [dbg, setDbg] = useState<DebugInfo | null>(null);

  const engineRef = useRef<VerificationEngine | null>(null);
  const throttleRef = useRef(0);
  const verdictDoneRef = useRef(false);
  const nonceRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Request a proof-of-liveness token from the serverless endpoint. */
  const requestToken = useCallback(async (v: Verdict) => {
    if (!v.isHuman) return;
    setTokenPending(true);
    try {
      const res = await fetch("/api/issue-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nonce: nonceRef.current,
          isHuman: v.isHuman,
          confidence: v.confidence,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { token?: string };
        if (data.token) setToken(data.token);
      }
    } catch {
      // Non-fatal: the verdict still shows; token button just won't appear.
    } finally {
      setTokenPending(false);
    }
  }, []);

  const handleFrame = useCallback(
    (f: FaceFrame) => {
      const engine = engineRef.current;
      if (!engine) return;
      const next = engine.update(f); // full-rate update for accurate detection

      // Compute the rule-based verdict exactly once, when the session completes.
      if (next.phase === "complete" && !verdictDoneRef.current) {
        verdictDoneRef.current = true;
        const sig = engine.getSignals();
        const v = decide(sig);
        setVerdict({ v, explanation: explain(v, sig) });
        void requestToken(v);
      }

      const now = performance.now();
      if (now - throttleRef.current < 66) return; // ~15 fps UI
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
        passive: next.passive,
      });
    },
    [requestToken]
  );

  // Toggle the debug/tuning panel with the "d" key.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "d" || e.key === "D") setDebug((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const begin = useCallback(() => {
    const engine = createVerificationEngine(buildSequence());
    engineRef.current = engine;
    verdictDoneRef.current = false;
    setVerdict(null);
    setToken(null);
    // Open a server session (nonce the token will be bound to). Non-blocking.
    nonceRef.current = null;
    fetch("/api/session", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.nonce) nonceRef.current = d.nonce;
      })
      .catch(() => {});
    engine.start(performance.now());
    setState(engine.getState());
    setStarted(true);
  }, []);

  const reset = useCallback(() => {
    engineRef.current?.reset();
    engineRef.current = null;
    verdictDoneRef.current = false;
    nonceRef.current = null;
    setVerdict(null);
    setToken(null);
    setState(null);
    setStarted(false);
  }, []);

  const useCamera = useCallback(() => {
    reset();
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setSource("camera");
  }, [reset]);

  const onSelectFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      reset();
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      setSource("video");
    },
    [reset]
  );

  const complete = state?.phase === "complete";
  const showCamera = source === "camera" || Boolean(videoUrl);

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center justify-between">
          <Link href="/" className="font-mono text-sm text-gray-500 hover:text-gray-300">
            ← back
          </Link>
          <h1 className="text-xl font-semibold">Liveness Verification</h1>
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

        <DemoControls
          source={source}
          hasVideo={Boolean(videoUrl)}
          onUseCamera={useCamera}
          onPickFile={() => fileInputRef.current?.click()}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={onSelectFile}
        />

        <div className="mt-4 grid gap-6 md:grid-cols-[2fr_1fr]">
          <div className="relative">
            {showCamera ? (
              <CameraView
                key={source + (videoUrl ?? "")}
                onFrame={handleFrame}
                onStatus={setCameraStatus}
                videoSrc={source === "video" ? videoUrl ?? undefined : undefined}
                mirrored={source === "camera"}
                className="aspect-video w-full"
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-gray-700 bg-panel text-center text-sm text-gray-500">
                Choose a video file to analyze (a recorded replay, a photo on a
                phone screen, or a filtered clip).
              </div>
            )}
            <ChallengeOverlay
              state={state}
              started={started}
              cameraStatus={cameraStatus}
              onBegin={begin}
              disabled={!showCamera}
            />
          </div>

          <aside className="space-y-4">
            <RoundList state={state} />
            {complete && verdict && (
              <VerdictCard
                verdict={verdict.v}
                explanation={verdict.explanation}
                token={token}
                tokenPending={tokenPending}
                onReset={reset}
              />
            )}
            {debug && <DebugPanel dbg={dbg} />}
          </aside>
        </div>

        <p className="mt-4 text-center font-mono text-xs text-gray-600">
          Press <kbd className="rounded bg-gray-800 px-1">D</kbd> to toggle the
          live signal / threshold tuning panel.
        </p>
      </div>
    </main>
  );
}

function DemoControls({
  source,
  hasVideo,
  onUseCamera,
  onPickFile,
}: {
  source: "camera" | "video";
  hasVideo: boolean;
  onUseCamera: () => void;
  onPickFile: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-panel p-2">
      <span className="px-1 font-mono text-xs uppercase tracking-widest text-gray-500">
        source
      </span>
      <button
        onClick={onUseCamera}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
          source === "camera"
            ? "bg-accent text-white"
            : "text-gray-300 hover:bg-gray-800"
        }`}
      >
        Live camera
      </button>
      <button
        onClick={onPickFile}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
          source === "video"
            ? "bg-accent text-white"
            : "text-gray-300 hover:bg-gray-800"
        }`}
      >
        {hasVideo && source === "video" ? "Change clip" : "Replay / filter demo"}
      </button>
      <span className="ml-auto px-1 text-xs text-gray-600">
        Adversarial demo: feed a recorded or filtered clip and watch it fail.
      </span>
    </div>
  );
}

function ChallengeOverlay({
  state,
  started,
  cameraStatus,
  onBegin,
  disabled = false,
}: {
  state: EngineState | null;
  started: boolean;
  cameraStatus: CameraStatus;
  onBegin: () => void;
  disabled?: boolean;
}) {
  // Pre-start: show a Begin button once the camera is tracking.
  if (!started || !state) {
    if (disabled) return null;
    return (
      <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-6">
        <button
          onClick={onBegin}
          disabled={cameraStatus === "error"}
          className="pointer-events-auto pulse-ring rounded-lg bg-accent px-8 py-3 text-base font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40"
        >
          Begin Verification
        </button>
      </div>
    );
  }

  if (state.phase === "complete") return null;

  const ready = state.roundStatus === "ready";
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4">
      <div className="rounded-lg bg-black/70 p-4 backdrop-blur">
        <div className="mb-1 flex items-center justify-between font-mono text-xs text-gray-400">
          <span>
            Step {state.index + 1} / {state.total}
          </span>
          {state.current && ANTI_SPOOF_ACTIONS.includes(state.current.action) && (
            <span className="rounded bg-accent/20 px-1.5 py-0.5 text-accent">
              anti-deepfake
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
        Challenge Rounds
      </h2>
      {!state ? (
        <p className="text-sm text-gray-500">
          Press “Begin Verification” to start a randomized challenge sequence.
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
              <span className="text-white">
                {ACTION_LABELS[state.current.action]}
              </span>
              <span className="text-warn">
                {state.roundStatus === "ready" ? "…" : "active"}
              </span>
            </li>
          )}
        </ol>
      )}
      {state?.passive && (
        <div className="mt-4 border-t border-gray-800 pt-3">
          <div className="flex justify-between font-mono text-xs text-gray-500">
            <span>passive human-likeness</span>
            <span className="text-gray-300">
              {Math.round(state.passive.humanScore * 100)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function VerdictCard({
  verdict,
  explanation,
  token,
  tokenPending,
  onReset,
}: {
  verdict: Verdict;
  explanation: string;
  token: string | null;
  tokenPending: boolean;
  onReset: () => void;
}) {
  const pct = Math.round(verdict.confidence * 100);
  return (
    <div
      className={`rounded-xl border bg-panel p-4 ${
        verdict.isHuman ? "border-success/50" : "border-danger/50"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className={`rounded-md px-3 py-1 text-sm font-bold ${
            verdict.isHuman
              ? "bg-success/15 text-success"
              : "bg-danger/15 text-danger"
          }`}
        >
          {verdict.isHuman ? "✓ HUMAN VERIFIED" : "✗ NOT VERIFIED"}
        </span>
        <span className="font-mono text-sm text-gray-400">{pct}%</span>
      </div>

      <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-gray-800">
        <div
          className={`h-full ${verdict.isHuman ? "bg-success" : "bg-danger"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="mb-3 text-sm leading-relaxed text-gray-300">{explanation}</p>

      <ul className="mb-4 space-y-1.5">
        {verdict.reasons.map((r) => (
          <li key={r.key} className="flex items-start gap-2 text-xs">
            <span className={r.ok ? "text-success" : "text-danger"}>
              {r.ok ? "✓" : "✗"}
            </span>
            <span className="text-gray-400">{r.label}</span>
          </li>
        ))}
      </ul>

      {verdict.isHuman && (
        <div className="mb-3">
          {token ? (
            <a
              href={`/lobby?token=${encodeURIComponent(token)}`}
              className="block w-full rounded-lg bg-success px-4 py-2.5 text-center font-semibold text-black hover:bg-emerald-400"
            >
              Continue to the meeting lobby →
            </a>
          ) : tokenPending ? (
            <p className="text-center text-sm text-gray-500">
              Issuing proof-of-liveness token…
            </p>
          ) : (
            <p className="text-center text-xs text-gray-500">
              Token unavailable (offline). Verdict still valid locally.
            </p>
          )}
        </div>
      )}

      <button
        onClick={onReset}
        className="w-full rounded-lg border border-gray-700 px-4 py-2 font-semibold text-gray-300 hover:border-gray-500"
      >
        Run Again
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
  passive: PassiveResult | null;
}

/** One-line threshold summary for an action (for the tuning panel). */
function actionThreshold(action: LivenessAction): string {
  const spec = ACTION_SPECS[action];
  if (spec.kind === "edge") return `edge high=${spec.high} low=${spec.low} ×${spec.count}`;
  if (spec.kind === "sustain") return `sustain ≥${spec.threshold} for ${spec.holdMs}ms`;
  return "custom (hand/occlusion)";
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
          <Row k="face" v={dbg.hasFace ? `yes (${dbg.landmarkCount})` : "no"} warn={!dbg.hasFace} />
          <Row k="hands" v={String(dbg.hands)} />
          <Row k="yaw°" v={String(round(dbg.yaw, 1))} />
          <Row k="pitch°" v={String(round(dbg.pitch, 1))} />
          <Row k="roll°" v={String(round(dbg.roll, 1))} />
          <Row k="blink L/R" v={`${round(dbg.blinkL, 2)} / ${round(dbg.blinkR, 2)}`} />
          <Row k="jawOpen" v={String(round(dbg.jawOpen, 2))} />
          <Row k="smile L/R" v={`${round(dbg.smileL, 2)} / ${round(dbg.smileR, 2)}`} />
          {dbg.passive && (
            <>
              <div className="mt-2 border-t border-gray-800 pt-1 text-gray-500">
                passive
              </div>
              <Row
                k="meshJitter"
                v={`${dbg.passive.meshJitter.toFixed(4)} (min ${MIN_MESH_JITTER})`}
                warn={dbg.passive.meshJitter <= MIN_MESH_JITTER}
              />
              <Row k="meshStability" v={String(round(dbg.passive.sub.meshStability, 2))} />
              <Row k="poseVariance" v={String(round(dbg.passive.sub.poseVariance, 2))} />
              <Row k="expressiveness" v={String(round(dbg.passive.sub.expressiveness, 2))} />
              <Row
                k="humanScore"
                v={`${round(dbg.passive.humanScore, 2)} (min ${MIN_PASSIVE_SCORE})`}
                warn={dbg.passive.humanScore < MIN_PASSIVE_SCORE}
              />
            </>
          )}
          <div className="mt-2 border-t border-gray-800 pt-1 text-gray-500">
            action thresholds
          </div>
          {ALL_ACTIONS.map((a) => (
            <div key={a} className="flex justify-between gap-2">
              <span className="text-gray-500">{ACTION_LABELS[a]}</span>
              <span className="text-right text-gray-400">{actionThreshold(a)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
