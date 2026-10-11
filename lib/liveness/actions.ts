/**
 * Active liveness action detectors.
 *
 * Pure, stateful detectors that consume a stream of `FaceFrame`s and report
 * progress toward completing a requested action. Framework-free.
 *
 * Detector kinds:
 *  - "edge":    counts discrete pulses of a scalar (rises above `high`, then
 *               falls below `low`). Used for blinks.
 *  - "sustain": the scalar must stay beyond a threshold for `holdMs`. Smile,
 *               mouth-open, head turns.
 *  - "custom":  bespoke logic needing hand landmarks — touch_nose (an index
 *               fingertip reaches the nose tip).
 */
import { clamp } from "@/lib/utils";
import { blendshape } from "@/lib/landmarks/parse";
import type { FaceFrame, RawLandmark } from "@/lib/landmarks/types";
import { dist2D } from "./geometry";

export type LivenessAction =
  | "blink"
  | "smile"
  | "open_mouth"
  | "turn_left"
  | "turn_right"
  | "touch_nose";

export const ALL_ACTIONS: LivenessAction[] = [
  "blink",
  "smile",
  "open_mouth",
  "turn_left",
  "turn_right",
  "touch_nose",
];

/** Actions whose detection requires hand landmarks. */
export const HAND_ACTIONS: LivenessAction[] = ["touch_nose"];

export interface ActionProgress {
  /** Whether the action has been completed. */
  satisfied: boolean;
  /** Completion fraction in [0, 1] (for progress UI). */
  progress: number;
  /** Current raw scalar value for this action's signal. */
  value: number;
}

export interface ActionDetector {
  readonly action: LivenessAction;
  update(frame: FaceFrame): ActionProgress;
  reset(): void;
}

/** Scalar signal extractor per action. */
type SignalFn = (frame: FaceFrame) => number;

type DetectorSpec =
  | { kind: "edge"; signal: SignalFn; high: number; low: number; count: number }
  | { kind: "sustain"; signal: SignalFn; threshold: number; holdMs: number }
  | { kind: "custom" };

const avgSmile: SignalFn = (f) =>
  (blendshape(f, "mouthSmileLeft") + blendshape(f, "mouthSmileRight")) / 2;
const maxBlink: SignalFn = (f) =>
  Math.max(blendshape(f, "eyeBlinkLeft"), blendshape(f, "eyeBlinkRight"));

// --- touch_nose tuning constants (refine with the debug panel) ---
/** Face-mesh indices near the nose tip (MediaPipe 468-point mesh). */
const NOSE_INDICES = [1, 4];
/** Max normalized distance from fingertip to nose tip to count as a touch. */
const TOUCH_NOSE_DIST = 0.09;
const TOUCH_NOSE_HOLD = 150;
/** Index fingertip landmark in the 21-point hand model. */
const INDEX_FINGERTIP = 8;

/** Default detector specifications. */
export const ACTION_SPECS: Record<LivenessAction, DetectorSpec> = {
  blink: { kind: "edge", signal: maxBlink, high: 0.5, low: 0.2, count: 2 },
  smile: { kind: "sustain", signal: avgSmile, threshold: 0.4, holdMs: 400 },
  open_mouth: {
    kind: "sustain",
    signal: (f) => blendshape(f, "jawOpen"),
    threshold: 0.4,
    holdMs: 400,
  },
  // yaw > 0 = subject turns toward their left (see matrixToEuler convention).
  turn_left: { kind: "sustain", signal: (f) => f.pose.yaw, threshold: 18, holdMs: 400 },
  turn_right: { kind: "sustain", signal: (f) => -f.pose.yaw, threshold: 18, holdMs: 400 },
  touch_nose: { kind: "custom" },
};

/** Default human-readable instruction (fallback when the LLM is unavailable). */
export const ACTION_PROMPTS: Record<LivenessAction, string> = {
  blink: "Blink twice",
  smile: "Smile",
  open_mouth: "Open your mouth",
  turn_left: "Slowly turn your head to the left",
  turn_right: "Slowly turn your head to the right",
  touch_nose: "Touch the tip of your nose",
};

/** Short label for UI chips. */
export const ACTION_LABELS: Record<LivenessAction, string> = {
  blink: "Blink",
  smile: "Smile",
  open_mouth: "Mouth open",
  turn_left: "Turn left",
  turn_right: "Turn right",
  touch_nose: "Touch nose",
};

export interface DetectorOverrides {
  /** Override required pulse count for edge detectors (blink). */
  count?: number;
  /** Override sustain duration (ms) for sustain detectors. */
  holdMs?: number;
}

/** Average position of the nose-tip landmarks, or null if unavailable. */
function noseTip(landmarks: RawLandmark[]): { x: number; y: number } | null {
  const pts = NOSE_INDICES.map((i) => landmarks[i]).filter(Boolean);
  if (pts.length === 0) return null;
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x, y };
}

/** Create a stateful detector for a given action. */
export function createActionDetector(
  action: LivenessAction,
  overrides: DetectorOverrides = {}
): ActionDetector {
  const spec = ACTION_SPECS[action];

  if (spec.kind === "custom") {
    return createTouchNoseDetector(action);
  }

  if (spec.kind === "edge") {
    const required = overrides.count ?? spec.count;
    let count = 0;
    let armed = false;

    return {
      action,
      reset() {
        count = 0;
        armed = false;
      },
      update(frame: FaceFrame): ActionProgress {
        const value = spec.signal(frame);
        if (!frame.hasFace) {
          armed = false;
        } else {
          if (!armed && value >= spec.high) armed = true;
          else if (armed && value <= spec.low) {
            count++;
            armed = false;
          }
        }
        const partial = armed ? 0.5 : 0;
        const progress = clamp((count + partial) / required, 0, 1);
        return { satisfied: count >= required, progress, value };
      },
    };
  }

  // sustain
  const holdMs = overrides.holdMs ?? spec.holdMs;
  let holdStart: number | null = null;
  let heldMs = 0;

  return {
    action,
    reset() {
      holdStart = null;
      heldMs = 0;
    },
    update(frame: FaceFrame): ActionProgress {
      const value = spec.signal(frame);
      const passing = frame.hasFace && value >= spec.threshold;
      if (passing) {
        if (holdStart === null) holdStart = frame.timestamp;
        heldMs = frame.timestamp - holdStart;
      } else {
        holdStart = null;
        heldMs = 0;
      }
      const progress = clamp(heldMs / holdMs, 0, 1);
      return { satisfied: heldMs >= holdMs, progress, value };
    },
  };
}

/** Fingertip-to-nose touch detector (uses Hand Landmarker). */
function createTouchNoseDetector(action: LivenessAction): ActionDetector {
  let holdStart: number | null = null;
  let heldMs = 0;

  return {
    action,
    reset() {
      holdStart = null;
      heldMs = 0;
    },
    update(frame: FaceFrame): ActionProgress {
      let dist = Infinity;
      if (frame.hasFace && frame.hands && frame.hands.length > 0) {
        const nose = noseTip(frame.landmarks);
        if (nose) {
          for (const hand of frame.hands) {
            const tip = hand[INDEX_FINGERTIP];
            if (tip) {
              const d = dist2D(tip, nose);
              if (d < dist) dist = d;
            }
          }
        }
      }
      const touching = dist <= TOUCH_NOSE_DIST;
      if (touching) {
        if (holdStart === null) holdStart = frame.timestamp;
        heldMs = frame.timestamp - holdStart;
      } else {
        holdStart = null;
        heldMs = 0;
      }
      const proximity =
        dist === Infinity ? 0 : clamp(1 - dist / (TOUCH_NOSE_DIST * 3), 0, 1);
      const progress = touching
        ? clamp(0.5 + (0.5 * heldMs) / TOUCH_NOSE_HOLD, 0, 1)
        : 0.5 * proximity;
      return {
        satisfied: heldMs >= TOUCH_NOSE_HOLD,
        progress,
        value: dist === Infinity ? 999 : dist,
      };
    },
  };
}
