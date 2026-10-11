/**
 * Active liveness action detectors.
 *
 * Pure, stateful detectors that consume a stream of `FaceFrame`s and report
 * progress toward completing a requested action. Framework-free and
 * unit-testable.
 *
 * Detector kinds:
 *  - "edge":    counts discrete pulses of a scalar (rises above `high`, then
 *               falls below `low`). Blinks, nods.
 *  - "sustain": the scalar must stay beyond a threshold for `holdMs`. Smile,
 *               mouth-open, head turns, look-up, full profile.
 *  - "custom":  bespoke logic that needs hand landmarks. These are the
 *               headline anti-deepfake challenges:
 *                 • hand_wave  — a hand passes in front of the face AND the
 *                   face tracking is briefly occluded (a real 3D hand hides a
 *                   real face; a 2D deepfake/filter renders the face ON TOP of
 *                   the hand, so the face is never occluded → it fails).
 *                 • touch_nose — a fingertip reaches the nose tip.
 */
import { clamp } from "@/lib/utils";
import { blendshape } from "@/lib/landmarks/parse";
import type { FaceFrame, RawLandmark } from "@/lib/landmarks/types";
import {
  boundingBox,
  overlapRatio,
  dist2D,
  type BBox,
} from "./geometry";

export type LivenessAction =
  | "blink"
  | "nod"
  | "smile"
  | "open_mouth"
  | "turn_left"
  | "turn_right"
  | "look_up"
  | "turn_profile"
  | "touch_nose"
  | "hand_wave";

export const ALL_ACTIONS: LivenessAction[] = [
  "blink",
  "nod",
  "smile",
  "open_mouth",
  "turn_left",
  "turn_right",
  "look_up",
  "turn_profile",
  "touch_nose",
  "hand_wave",
];

/** Actions whose detection requires hand landmarks. */
export const HAND_ACTIONS: LivenessAction[] = ["touch_nose", "hand_wave"];

/**
 * High-value anti-spoof actions that live deepfakes/filters struggle with.
 * The engine can prioritize these.
 */
export const ANTI_SPOOF_ACTIONS: LivenessAction[] = [
  "hand_wave",
  "touch_nose",
  "turn_profile",
];

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

// --- Custom-detector tuning constants (refine with the debug panel) ---
/** Face-mesh indices near the nose tip (MediaPipe 468-point mesh). */
const NOSE_INDICES = [1, 4];
/** Max normalized distance from fingertip to nose tip to count as a touch. */
const TOUCH_NOSE_DIST = 0.09;
const TOUCH_NOSE_HOLD = 150;
/** Index fingertip landmark in the 21-point hand model. */
const INDEX_FINGERTIP = 8;
/** Min hand/face box overlap to count the hand as "over the face". */
const OCCLUSION_OVERLAP = 0.1;
/** Below this landmark count, face tracking is considered disrupted. */
const FACE_DISRUPT_LANDMARKS = 50;

/** Default detector specifications. */
export const ACTION_SPECS: Record<LivenessAction, DetectorSpec> = {
  blink: { kind: "edge", signal: maxBlink, high: 0.5, low: 0.2, count: 2 },
  // Nod = downward pitch pulse (looking down then back up). pitch<0 = down.
  nod: { kind: "edge", signal: (f) => -f.pose.pitch, high: 12, low: 4, count: 1 },
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
  look_up: { kind: "sustain", signal: (f) => f.pose.pitch, threshold: 15, holdMs: 400 },
  // Full side profile: a strong yaw in either direction.
  turn_profile: {
    kind: "sustain",
    signal: (f) => Math.abs(f.pose.yaw),
    threshold: 35,
    holdMs: 300,
  },
  touch_nose: { kind: "custom" },
  hand_wave: { kind: "custom" },
};

/** Human-readable instruction. */
export const ACTION_PROMPTS: Record<LivenessAction, string> = {
  blink: "Blink twice",
  nod: "Nod your head",
  smile: "Smile",
  open_mouth: "Open your mouth",
  turn_left: "Slowly turn your head to the left",
  turn_right: "Slowly turn your head to the right",
  look_up: "Tilt your head up",
  turn_profile: "Turn to a full side profile",
  touch_nose: "Touch the tip of your nose",
  hand_wave: "Wave your hand in front of your face",
};

/** Short label for UI chips. */
export const ACTION_LABELS: Record<LivenessAction, string> = {
  blink: "Blink",
  nod: "Nod",
  smile: "Smile",
  open_mouth: "Mouth open",
  turn_left: "Turn left",
  turn_right: "Turn right",
  look_up: "Look up",
  turn_profile: "Profile",
  touch_nose: "Touch nose",
  hand_wave: "Hand wave",
};

export interface DetectorOverrides {
  /** Override required pulse count for edge detectors (blink/nod). */
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
    return action === "touch_nose"
      ? createTouchNoseDetector(action)
      : createOcclusionDetector(action);
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

/** Fingertip-to-nose touch detector. */
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

/**
 * Hand-over-face occlusion detector. Requires the sequence:
 *   face visible → hand covers face AND face tracking drops → face recovers.
 * This is what a live face-swap/filter can't reproduce (it keeps rendering the
 * face on top of the hand, so the face is never actually occluded).
 */
function createOcclusionDetector(action: LivenessAction): ActionDetector {
  let lastFaceBox: BBox | null = null;
  let phase: "waiting" | "occluded" = "waiting";
  let satisfied = false;

  return {
    action,
    reset() {
      lastFaceBox = null;
      phase = "waiting";
      satisfied = false;
    },
    update(frame: FaceFrame): ActionProgress {
      if (frame.hasFace) {
        lastFaceBox = boundingBox(frame.landmarks) ?? lastFaceBox;
      }

      const hands = frame.hands ?? [];
      let handOverFace = false;
      if (lastFaceBox) {
        for (const hand of hands) {
          const hb = boundingBox(hand);
          if (hb && overlapRatio(hb, lastFaceBox) > OCCLUSION_OVERLAP) {
            handOverFace = true;
            break;
          }
        }
      }

      const faceDisrupted =
        !frame.hasFace || frame.landmarkCount < FACE_DISRUPT_LANDMARKS;

      if (!satisfied) {
        if (phase === "waiting") {
          if (handOverFace && faceDisrupted) phase = "occluded";
        } else {
          // Face must come back AND the hand must have moved away.
          if (frame.hasFace && !handOverFace) satisfied = true;
        }
      }

      const progress = satisfied
        ? 1
        : phase === "occluded"
          ? 0.6
          : handOverFace
            ? 0.3
            : 0;
      return { satisfied, progress, value: handOverFace ? 1 : 0 };
    },
  };
}
