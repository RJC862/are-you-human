/**
 * Challenge schema + local (on-device) sequence generation.
 *
 * Challenge sequences are generated entirely in the browser — no network calls.
 * This keeps the app fully on-device and demo-proof (works offline). An
 * optional seed makes sequences deterministic for tests.
 */
import { ALL_ACTIONS, ACTION_PROMPTS, type LivenessAction } from "./actions";

export interface Challenge {
  action: LivenessAction;
  /** Human-readable instruction shown to the user. */
  prompt: string;
  /** Required repeat count for edge actions (blink/nod). Optional. */
  count?: number;
  /** Per-round timeout in milliseconds. */
  timeoutMs: number;
}

export const DEFAULT_CHALLENGE_COUNT = 4;
export const MIN_CHALLENGES = 2;
export const MAX_CHALLENGES = 6;
export const DEFAULT_TIMEOUT_MS = 10000;

function clampCount(n: number): number {
  return Math.max(MIN_CHALLENGES, Math.min(MAX_CHALLENGES, Math.floor(n)));
}

/** Deterministic PRNG (mulberry32) for reproducible sequences in tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a randomized challenge sequence of `count` distinct actions.
 * When `seed` is provided the order is deterministic.
 *
 * The optional `pool` lets callers restrict/extend the available actions (e.g.
 * once hand-occlusion challenges are added, or to force high-value anti-spoof
 * actions earlier in the sequence).
 */
export function generateChallenges(
  count: number = DEFAULT_CHALLENGE_COUNT,
  seed?: number,
  pool: LivenessAction[] = ALL_ACTIONS
): Challenge[] {
  const n = clampCount(count);
  const rand = seed === undefined ? Math.random : mulberry32(seed);

  // Fisher-Yates shuffle of a copy of the pool.
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, n).map((action) => ({
    action,
    prompt: ACTION_PROMPTS[action],
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }));
}
