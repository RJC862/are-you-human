/**
 * Verification engine — the guided round-flow state machine.
 *
 * Given a challenge sequence, it presents one challenge at a time, drives the
 * matching detector, enforces a per-round timeout, aggregates per-round
 * results, and collects passive-signal statistics across the whole session.
 *
 * Pure and framework-free: `update(frame)` is called once per analyzed frame
 * and returns the current UI state. The clock comes from `frame.timestamp`.
 */
import {
  createActionDetector,
  ANTI_SPOOF_ACTIONS,
  type ActionDetector,
  type LivenessAction,
} from "./actions";
import { createPassiveAnalyzer, type PassiveResult } from "./passive";
import type { Challenge } from "./challenge";
import type { FaceFrame } from "@/lib/landmarks/types";

export type EnginePhase = "idle" | "active" | "complete";
export type RoundStatus = "ready" | "detecting";

export interface RoundResult {
  action: LivenessAction;
  prompt: string;
  passed: boolean;
  elapsedMs: number;
}

export interface EngineState {
  phase: EnginePhase;
  index: number;
  total: number;
  current: Challenge | null;
  roundStatus: RoundStatus;
  /** Remaining pre-round "get ready" countdown, ms. */
  readyCountdownMs: number;
  /** Progress of the current round in [0, 1]. */
  currentProgress: number;
  results: RoundResult[];
  passive: PassiveResult | null;
}

export interface SessionSignals {
  rounds: RoundResult[];
  passedRounds: number;
  totalRounds: number;
  usedAntiSpoof: boolean;
  antiSpoofPassed: number;
  antiSpoofTotal: number;
  durationMs: number;
  /** Latest passive human-likeness score (0..1). */
  passiveHumanScore: number;
  /** Lowest passive human-likeness observed across the session. */
  passiveMinHumanScore: number;
  /** Latest mean mesh jitter. */
  meshJitter: number;
  /** Lowest mean mesh jitter observed (catches static/photo feeds). */
  minMeshJitter: number;
}

export interface EngineOptions {
  /** "Get ready" pause before each round starts evaluating, ms. */
  cooldownMs?: number;
}

export interface VerificationEngine {
  start(now: number): void;
  update(frame: FaceFrame): EngineState;
  getState(): EngineState;
  getSignals(): SessionSignals;
  reset(): void;
}

export function createVerificationEngine(
  challenges: Challenge[],
  options: EngineOptions = {}
): VerificationEngine {
  const cooldownMs = options.cooldownMs ?? 800;
  const total = challenges.length;
  const passive = createPassiveAnalyzer();

  let phase: EnginePhase = "idle";
  let index = 0;
  let detector: ActionDetector | null = null;
  let roundStartTime = 0; // when detection actually begins (after cooldown)
  let cooldownUntil = 0;
  let startTime = 0;
  let lastNow = 0;
  let currentProgress = 0;
  const results: RoundResult[] = [];

  let latestPassive: PassiveResult | null = null;
  let minHumanScore = 1;
  let minMeshJitter = Infinity;

  function beginRound(i: number, now: number) {
    const ch = challenges[i];
    detector = createActionDetector(ch.action, { count: ch.count });
    cooldownUntil = now + cooldownMs;
    roundStartTime = cooldownUntil;
    currentProgress = 0;
  }

  function finishRound(passed: boolean, now: number) {
    const ch = challenges[index];
    results.push({
      action: ch.action,
      prompt: ch.prompt,
      passed,
      elapsedMs: Math.max(0, Math.round(now - roundStartTime)),
    });
    index++;
    if (index >= total) {
      phase = "complete";
      detector = null;
    } else {
      beginRound(index, now);
    }
  }

  function start(now: number) {
    phase = total > 0 ? "active" : "complete";
    index = 0;
    results.length = 0;
    startTime = now;
    lastNow = now;
    currentProgress = 0;
    minHumanScore = 1;
    minMeshJitter = Infinity;
    passive.reset();
    if (total > 0) beginRound(0, now);
  }

  function update(frame: FaceFrame): EngineState {
    lastNow = frame.timestamp;

    // Passive signals are collected for the entire session.
    latestPassive = passive.update(frame);
    if (latestPassive.samples >= 3) {
      if (latestPassive.humanScore < minHumanScore)
        minHumanScore = latestPassive.humanScore;
      if (latestPassive.meshJitter < minMeshJitter)
        minMeshJitter = latestPassive.meshJitter;
    }

    if (phase === "active" && detector) {
      const now = frame.timestamp;
      if (now >= cooldownUntil) {
        const res = detector.update(frame);
        currentProgress = res.progress;
        if (res.satisfied) {
          finishRound(true, now);
        } else if (now - roundStartTime >= challenges[index]?.timeoutMs) {
          finishRound(false, now);
        }
      }
    }

    return getState();
  }

  function getState(): EngineState {
    const readyCountdownMs =
      phase === "active" ? Math.max(0, Math.round(cooldownUntil - lastNow)) : 0;
    return {
      phase,
      index,
      total,
      current: phase === "active" ? challenges[index] ?? null : null,
      roundStatus: readyCountdownMs > 0 ? "ready" : "detecting",
      readyCountdownMs,
      currentProgress,
      results: [...results],
      passive: latestPassive,
    };
  }

  function getSignals(): SessionSignals {
    const passedRounds = results.filter((r) => r.passed).length;
    const antiSpoofRounds = results.filter((r) =>
      ANTI_SPOOF_ACTIONS.includes(r.action)
    );
    return {
      rounds: [...results],
      passedRounds,
      totalRounds: total,
      usedAntiSpoof: challenges.some((c) =>
        ANTI_SPOOF_ACTIONS.includes(c.action)
      ),
      antiSpoofPassed: antiSpoofRounds.filter((r) => r.passed).length,
      antiSpoofTotal: antiSpoofRounds.length,
      durationMs: Math.max(0, Math.round(lastNow - startTime)),
      passiveHumanScore: latestPassive?.humanScore ?? 0,
      passiveMinHumanScore: minHumanScore === 1 && results.length === 0 ? 0 : minHumanScore,
      meshJitter: latestPassive?.meshJitter ?? 0,
      minMeshJitter: minMeshJitter === Infinity ? 0 : minMeshJitter,
    };
  }

  function reset() {
    phase = "idle";
    index = 0;
    detector = null;
    results.length = 0;
    currentProgress = 0;
    latestPassive = null;
    minHumanScore = 1;
    minMeshJitter = Infinity;
    passive.reset();
  }

  return { start, update, getState, getSignals, reset };
}
