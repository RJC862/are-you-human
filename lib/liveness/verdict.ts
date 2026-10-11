/**
 * Rule-based verdict + template explanation.
 *
 * The pass/fail decision is made entirely by deterministic threshold code so it
 * is consistent every run (critical for a live demo). No language model is
 * involved in the decision. `explain()` produces a plain-language description
 * of the decision from templates — it reports the decision, never changes it.
 */
import type { SessionSignals } from "./engine";

export interface VerdictReason {
  key: string;
  ok: boolean;
  label: string;
}

export interface Verdict {
  isHuman: boolean;
  /** Overall confidence in [0, 1]. */
  confidence: number;
  reasons: VerdictReason[];
}

// --- Decision thresholds (tunable via the debug panel) ---
/** Below this mean mesh jitter the feed is "too still" (photo/paused video). */
export const MIN_MESH_JITTER = 0.0006;
/** Minimum passive human-likeness that must hold at all times. */
export const MIN_PASSIVE_SCORE = 0.35;

/**
 * Decide whether the session proves a live human. Rules:
 *  1. Challenges: at most one missed round.
 *  2. Anti-spoof: if any anti-spoof actions were included, at least one passed.
 *  3. Motion: mesh jitter never collapsed to photo/static levels.
 *  4. Passive: human-likeness never dropped below the floor.
 * All four must hold.
 */
export function decide(signals: SessionSignals): Verdict {
  const challengesOk =
    signals.totalRounds > 0 &&
    signals.passedRounds >= signals.totalRounds - 1;

  const antiSpoofOk =
    signals.antiSpoofTotal === 0 || signals.antiSpoofPassed >= 1;

  const motionOk = signals.minMeshJitter > MIN_MESH_JITTER;

  const passiveOk = signals.passiveMinHumanScore >= MIN_PASSIVE_SCORE;

  const reasons: VerdictReason[] = [
    {
      key: "challenges",
      ok: challengesOk,
      label: `Challenges passed (${signals.passedRounds}/${signals.totalRounds})`,
    },
    {
      key: "antiSpoof",
      ok: antiSpoofOk,
      label:
        signals.antiSpoofTotal === 0
          ? "Anti-deepfake action (none required)"
          : `Anti-deepfake action passed (${signals.antiSpoofPassed}/${signals.antiSpoofTotal})`,
    },
    {
      key: "motion",
      ok: motionOk,
      label: "Natural facial micro-motion (not a static image)",
    },
    {
      key: "passive",
      ok: passiveOk,
      label: "Live human-likeness held (no filter/deepfake signature)",
    },
  ];

  const isHuman = challengesOk && antiSpoofOk && motionOk && passiveOk;

  // Confidence blends the signal strengths.
  const challengeScore =
    signals.totalRounds > 0 ? signals.passedRounds / signals.totalRounds : 0;
  const antiSpoofScore =
    signals.antiSpoofTotal > 0
      ? signals.antiSpoofPassed / signals.antiSpoofTotal
      : 1;
  const passiveScore = clamp01(signals.passiveMinHumanScore);
  const jitterScore = clamp01(signals.minMeshJitter / 0.003);
  const confidence = round2(
    0.4 * challengeScore +
      0.25 * antiSpoofScore +
      0.2 * passiveScore +
      0.15 * jitterScore
  );

  return { isHuman, confidence, reasons };
}

/** Deterministic, template-based explanation of the decision. */
export function explain(verdict: Verdict, signals: SessionSignals): string {
  if (verdict.isHuman) {
    const anti =
      signals.antiSpoofTotal > 0
        ? ` including ${signals.antiSpoofPassed} anti-deepfake action${
            signals.antiSpoofPassed === 1 ? "" : "s"
          }`
        : "";
    return (
      `Verified human. You completed ${signals.passedRounds} of ` +
      `${signals.totalRounds} randomized challenges${anti}, with natural ` +
      `facial micro-motion and no signs of a static image, filter, or deepfake.`
    );
  }

  const failing = verdict.reasons.filter((r) => !r.ok);
  const parts: string[] = [];
  for (const r of failing) {
    switch (r.key) {
      case "challenges":
        parts.push(
          `too many challenges were missed (${signals.passedRounds}/${signals.totalRounds})`
        );
        break;
      case "antiSpoof":
        parts.push(
          "the anti-deepfake action (such as a hand passing over the face or a full profile turn) was not completed the way a real face would"
        );
        break;
      case "motion":
        parts.push(
          "the feed was unnaturally static, consistent with a photo or a paused/replayed video"
        );
        break;
      case "passive":
        parts.push(
          "facial motion was inconsistent with a live person, suggesting a filter or deepfake"
        );
        break;
    }
  }
  const why =
    parts.length > 0 ? parts.join("; ") : "the liveness signals were insufficient";
  return `Could not verify a live human: ${why}.`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
