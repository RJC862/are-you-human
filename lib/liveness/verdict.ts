/**
 * Rule-based verdict + hardcoded fallback explanation.
 *
 * The pass/fail decision is made entirely by deterministic rule code so it is
 * consistent every run. No language model is involved in the decision. The
 * result-screen explanation is normally written by the LLM (/api/text); this
 * module provides the hardcoded fallback used when the LLM is unavailable.
 */
import type { SessionSignals } from "./engine";

export interface Verdict {
  isHuman: boolean;
  passedRounds: number;
  totalRounds: number;
  /** Overall confidence in [0, 1] = fraction of challenges passed. */
  confidence: number;
}

/**
 * Decide whether the session proves a live human.
 * Rule: all challenges must pass (a short, in-person sequence should be easy
 * for a real human; missing any one is a fail).
 */
export function decide(signals: SessionSignals): Verdict {
  const isHuman =
    signals.totalRounds > 0 && signals.passedRounds === signals.totalRounds;
  const confidence =
    signals.totalRounds > 0 ? signals.passedRounds / signals.totalRounds : 0;
  return {
    isHuman,
    passedRounds: signals.passedRounds,
    totalRounds: signals.totalRounds,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/** Hardcoded, deterministic explanation (fallback when the LLM is unavailable). */
export function fallbackExplanation(verdict: Verdict): string {
  if (verdict.isHuman) {
    return (
      `Verified human — you completed all ${verdict.totalRounds} liveness ` +
      `challenges in time. A real, present person responds to randomized, ` +
      `on-the-spot prompts; recordings and still images can't.`
    );
  }
  const missed = verdict.totalRounds - verdict.passedRounds;
  return (
    `Could not verify a live human — ${verdict.passedRounds} of ` +
    `${verdict.totalRounds} challenges passed (${missed} missed). The prompts ` +
    `must be performed in order within the time limit.`
  );
}
