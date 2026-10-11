/**
 * Verification engine — the guided round-flow state machine.
 *
 * Given a challenge sequence, it presents one challenge at a time, drives the
 * matching detector, enforces a per-round 5-second timeout, and aggregates
 * per-round pass/fail results.
 *
 * Pure and framework-free: `update(frame)` is called once per analyzed frame
 * and returns the current UI state. The clock comes from `frame.timestamp`.
 */
import {
  createActionDetector,
  type ActionDetector,
  type LivenessAction,
} from "./actions";
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
  /** Remaining time to complete the current challenge, ms (the 5s window). */
  challengeCountdownMs: number;
  /** Progress of the current round in [0, 1]. */
  currentProgress: number;
  results: RoundResult[];
}

export interface SessionSignals {
  rounds: RoundResult[];
  passedRounds: number;
  totalRounds: number;
  durationMs: number;
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
  const cooldownMs = options.cooldownMs ?? 1000;
  const total = challenges.length;

  let phase: EnginePhase = "idle";
  let index = 0;
  let detector: ActionDetector | null = null;
  let roundStartTime = 0; // when detection actually begins (after cooldown)
  let cooldownUntil = 0;
  let startTime = 0;
  let lastNow = 0;
  let currentProgress = 0;
  const results: RoundResult[] = [];

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
    if (total > 0) beginRound(0, now);
  }

  function update(frame: FaceFrame): EngineState {
    lastNow = frame.timestamp;

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
    const timeoutMs = challenges[index]?.timeoutMs ?? 0;
    const challengeCountdownMs =
      phase === "active" && readyCountdownMs === 0
        ? Math.max(0, Math.round(roundStartTime + timeoutMs - lastNow))
        : timeoutMs;
    return {
      phase,
      index,
      total,
      current: phase === "active" ? challenges[index] ?? null : null,
      roundStatus: readyCountdownMs > 0 ? "ready" : "detecting",
      readyCountdownMs,
      challengeCountdownMs,
      currentProgress,
      results: [...results],
    };
  }

  function getSignals(): SessionSignals {
    return {
      rounds: [...results],
      passedRounds: results.filter((r) => r.passed).length,
      totalRounds: total,
      durationMs: Math.max(0, Math.round(lastNow - startTime)),
    };
  }

  function reset() {
    phase = "idle";
    index = 0;
    detector = null;
    results.length = 0;
    currentProgress = 0;
  }

  return { start, update, getState, getSignals, reset };
}
