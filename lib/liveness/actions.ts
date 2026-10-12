/**
 * Active liveness action detectors.
 *
 * Pure, stateful detectors that consume a stream of `FaceFrame`s and report
 * progress toward completing a requested action. Framework-free.
 *
 * Detector kinds:
 *  - "edge":    counts discrete pulses of a scalar (rises above `high`, then
 *               falls below `low`). Used for blinks.
 *  - "sustain": a scalar must stay beyond a threshold for `holdMs`. Expressions
 *               and head pose.
 *  - "touch":   a hand fingertip (or any hand point) must come within a
 *               distance of a face target point and hold.
 *  - "region":  a hand bounding box must overlap a face region and hold
 *               (hand-in-front-of-face, cover mouth).
 */
import { clamp } from "@/lib/utils";
import { blendshape } from "@/lib/landmarks/parse";
import type { FaceFrame, RawLandmark } from "@/lib/landmarks/types";
import { dist2D, boundingBox, overlapRatio, type BBox } from "./geometry";

/**
 * Case-insensitive substrings that, when present in a camera device label,
 * flag the source as a likely virtual / software camera (OBS, Snap Camera,
 * DeepFaceLive, etc.) rather than a physical webcam.
 *
 * This is a soft risk signal only — it is surfaced as a warning banner and a
 * result-screen note. It never changes the pass/fail verdict.
 */
export const VIRTUAL_CAMERA_KEYWORDS: string[] = [
  "virtual",
  "obs",
  "manycam",
  "snap",
  "deepfacelive",
  "xsplit",
  "droidcam",
];

/**
 * Returns true if the given camera label matches any virtual-camera keyword.
 * Matching is case-insensitive and substring-based.
 */
export function isVirtualCameraLabel(label: string | undefined | null): boolean {
  if (!label) return false;
  const lower = label.toLowerCase();
  return VIRTUAL_CAMERA_KEYWORDS.some((kw) => lower.includes(kw));
}

export type LivenessAction =
  // Base
  | "blink"
  | "smile"
  | "open_mouth"
  | "turn_left"
  | "turn_right"
  | "touch_nose"
  // Tier 1 — head pose
  | "tilt_left"
  | "tilt_right"
  // Tier 1 — expressions
  | "raise_eyebrows"
  | "purse_lips"
  | "squint"
  // Tier 2 — face touches
  | "touch_chin"
  | "touch_forehead"
  // Tier 2 — hand-region holds
  | "cover_mouth";

export const ALL_ACTIONS: LivenessAction[] = [
  "blink",
  "smile",
  "open_mouth",
  "turn_left",
  "turn_right",
  "tilt_left",
  "tilt_right",
  "raise_eyebrows",
  "purse_lips",
  "squint",
  "touch_nose",
  "touch_chin",
  "touch_forehead",
  "cover_mouth",
];

/** Actions whose detection requires hand landmarks. */
export const HAND_ACTIONS: LivenessAction[] = [
  "touch_nose",
  "touch_chin",
  "touch_forehead",
  "cover_mouth",
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

/**
 * Face region specifier for "touch"/"region" detectors.
 * `indices` are MediaPipe FaceLandmarker 468-mesh indices whose average is the
 * target point / region center.
 */
type FaceRegion = "nose" | "chin" | "forehead" | "mouth";

type DetectorSpec =
  | { kind: "edge"; signal: SignalFn; high: number; low: number; count: number }
  | { kind: "sustain"; signal: SignalFn; threshold: number; holdMs: number }
  | { kind: "touch"; region: FaceRegion; dist: number; holdMs: number }
  | { kind: "region"; region: FaceRegion; overlap: number; holdMs: number };

const avgSmile: SignalFn = (f) =>
  (blendshape(f, "mouthSmileLeft") + blendshape(f, "mouthSmileRight")) / 2;
const maxBlink: SignalFn = (f) =>
  Math.max(blendshape(f, "eyeBlinkLeft"), blendshape(f, "eyeBlinkRight"));
const avgBrowUp: SignalFn = (f) =>
  (blendshape(f, "browInnerUp") +
    blendshape(f, "browOuterUpLeft") +
    blendshape(f, "browOuterUpRight")) /
  3;
const avgPucker: SignalFn = (f) =>
  Math.max(blendshape(f, "mouthPucker"), blendshape(f, "mouthFunnel"));
const avgSquint: SignalFn = (f) =>
  (blendshape(f, "eyeSquintLeft") + blendshape(f, "eyeSquintRight")) / 2;

/**
 * MediaPipe FaceLandmarker 468-mesh indices for region centers.
 * (Approximate but stable landmarks; refine via the debug panel.)
 */
const REGION_INDICES: Record<FaceRegion, number[]> = {
  nose: [1, 4],
  chin: [152, 175],
  forehead: [10, 151],
  mouth: [13, 14, 61, 291],
};

// --- Shared tuning constants (refine with the debug panel) ---
const TOUCH_DIST = 0.09; // normalized fingertip→target distance
const TOUCH_HOLD = 300;
const REGION_HOLD = 800;
const EXPR_HOLD = 500;
const POSE_HOLD = 500;
/** Hand point indices considered "fingertips/palm" for touch proximity. */
const HAND_TOUCH_POINTS = [8, 4, 12, 9]; // index tip, thumb tip, middle tip, palm

/** Default detector specifications. */
export const ACTION_SPECS: Record<LivenessAction, DetectorSpec> = {
  blink: { kind: "edge", signal: maxBlink, high: 0.5, low: 0.2, count: 2 },
  smile: { kind: "sustain", signal: avgSmile, threshold: 0.4, holdMs: 400 },
  open_mouth: { kind: "sustain", signal: (f) => blendshape(f, "jawOpen"), threshold: 0.4, holdMs: 400 },
  // yaw > 0 = subject turns toward their left (see matrixToEuler convention).
  turn_left: { kind: "sustain", signal: (f) => f.pose.yaw, threshold: 18, holdMs: 400 },
  turn_right: { kind: "sustain", signal: (f) => -f.pose.yaw, threshold: 18, holdMs: 400 },

  // Tier 1 — head pose. roll>0 = tilt toward subject's right shoulder.
  tilt_left: { kind: "sustain", signal: (f) => -f.pose.roll, threshold: 15, holdMs: POSE_HOLD },
  tilt_right: { kind: "sustain", signal: (f) => f.pose.roll, threshold: 15, holdMs: POSE_HOLD },

  // Tier 1 — expressions
  raise_eyebrows: { kind: "sustain", signal: avgBrowUp, threshold: 0.4, holdMs: EXPR_HOLD },
  purse_lips: { kind: "sustain", signal: avgPucker, threshold: 0.4, holdMs: EXPR_HOLD },
  squint: { kind: "sustain", signal: avgSquint, threshold: 0.45, holdMs: EXPR_HOLD },

  // Base + Tier 2 — face touches
  touch_nose: { kind: "touch", region: "nose", dist: TOUCH_DIST, holdMs: TOUCH_HOLD },
  touch_chin: { kind: "touch", region: "chin", dist: TOUCH_DIST, holdMs: TOUCH_HOLD },
  touch_forehead: { kind: "touch", region: "forehead", dist: 0.1, holdMs: TOUCH_HOLD },

  // Tier 2 — hand-region holds
  cover_mouth: { kind: "region", region: "mouth", overlap: 0.25, holdMs: REGION_HOLD },
};

/** Default human-readable instruction (fallback when the LLM is unavailable). */
export const ACTION_PROMPTS: Record<LivenessAction, string> = {
  blink: "Blink twice",
  smile: "Smile",
  open_mouth: "Open your mouth",
  turn_left: "Slowly turn your head to the left",
  turn_right: "Slowly turn your head to the right",
  tilt_left: "Tilt your head toward your left shoulder",
  tilt_right: "Tilt your head toward your right shoulder",
  raise_eyebrows: "Raise both eyebrows",
  purse_lips: "Purse your lips",
  squint: "Squint your eyes",
  touch_nose: "Touch the tip of your nose",
  touch_chin: "Touch your chin",
  touch_forehead: "Touch your forehead",
  cover_mouth: "Cover your mouth with one hand",
};

/** Short label for UI chips. */
export const ACTION_LABELS: Record<LivenessAction, string> = {
  blink: "Blink",
  smile: "Smile",
  open_mouth: "Mouth open",
  turn_left: "Turn left",
  turn_right: "Turn right",
  tilt_left: "Tilt left",
  tilt_right: "Tilt right",
  raise_eyebrows: "Raise brows",
  purse_lips: "Purse lips",
  squint: "Squint",
  touch_nose: "Touch nose",
  touch_chin: "Touch chin",
  touch_forehead: "Touch forehead",
  cover_mouth: "Cover mouth",
};

export interface DetectorOverrides {
  /** Override required pulse count for edge detectors (blink). */
  count?: number;
  /** Override sustain duration (ms) for sustain detectors. */
  holdMs?: number;
}

/** Average position of a set of face-mesh landmarks, or null if unavailable. */
function regionCenter(
  landmarks: RawLandmark[],
  region: FaceRegion
): { x: number; y: number } | null {
  const pts = REGION_INDICES[region].map((i) => landmarks[i]).filter(Boolean);
  if (pts.length === 0) return null;
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x, y };
}

/** Bounding box of a face region (padded). */
function regionBox(landmarks: RawLandmark[], region: FaceRegion): BBox | null {
  const pts = REGION_INDICES[region].map((i) => landmarks[i]).filter(Boolean);
  const box = boundingBox(pts);
  if (!box) return null;
  // Pad the small region so a hand can plausibly overlap it.
  const pad = 0.05;
  return {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  };
}

/** Create a stateful detector for a given action. */
export function createActionDetector(
  action: LivenessAction,
  overrides: DetectorOverrides = {}
): ActionDetector {
  const spec = ACTION_SPECS[action];

  switch (spec.kind) {
    case "touch":
      return createTouchDetector(action, spec.region, spec.dist, overrides.holdMs ?? spec.holdMs);
    case "region":
      return createRegionDetector(action, spec.region, spec.overlap, overrides.holdMs ?? spec.holdMs);
    case "edge":
      return createEdgeDetector(action, spec, overrides.count ?? spec.count);
    case "sustain":
      return createSustainDetector(action, spec.signal, spec.threshold, overrides.holdMs ?? spec.holdMs);
  }
}

function createEdgeDetector(
  action: LivenessAction,
  spec: { signal: SignalFn; high: number; low: number },
  required: number
): ActionDetector {
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

function createSustainDetector(
  action: LivenessAction,
  signal: SignalFn,
  threshold: number,
  holdMs: number
): ActionDetector {
  let holdStart: number | null = null;
  let heldMs = 0;
  return {
    action,
    reset() {
      holdStart = null;
      heldMs = 0;
    },
    update(frame: FaceFrame): ActionProgress {
      const value = signal(frame);
      const passing = frame.hasFace && value >= threshold;
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

/** Fingertip/palm-to-face-point touch detector (uses Hand Landmarker). */
function createTouchDetector(
  action: LivenessAction,
  region: FaceRegion,
  maxDist: number,
  holdMs: number
): ActionDetector {
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
        const target = regionCenter(frame.landmarks, region);
        if (target) {
          for (const hand of frame.hands) {
            for (const idx of HAND_TOUCH_POINTS) {
              const p = hand[idx];
              if (p) {
                const d = dist2D(p, target);
                if (d < dist) dist = d;
              }
            }
          }
        }
      }
      const touching = dist <= maxDist;
      if (touching) {
        if (holdStart === null) holdStart = frame.timestamp;
        heldMs = frame.timestamp - holdStart;
      } else {
        holdStart = null;
        heldMs = 0;
      }
      const proximity = dist === Infinity ? 0 : clamp(1 - dist / (maxDist * 3), 0, 1);
      const progress = touching ? clamp(0.5 + (0.5 * heldMs) / holdMs, 0, 1) : 0.5 * proximity;
      return { satisfied: heldMs >= holdMs, progress, value: dist === Infinity ? 999 : dist };
    },
  };
}

/** Hand-bbox-over-face-region sustain detector (hand in front of face, cover mouth). */
function createRegionDetector(
  action: LivenessAction,
  region: FaceRegion,
  minOverlap: number,
  holdMs: number
): ActionDetector {
  let holdStart: number | null = null;
  let heldMs = 0;
  return {
    action,
    reset() {
      holdStart = null;
      heldMs = 0;
    },
    update(frame: FaceFrame): ActionProgress {
      let best = 0;
      if (frame.hasFace && frame.hands && frame.hands.length > 0) {
        const target = regionBox(frame.landmarks, region);
        if (target) {
          for (const hand of frame.hands) {
            const hb = boundingBox(hand);
            if (hb) best = Math.max(best, overlapRatio(hb, target));
          }
        }
      }
      const passing = best >= minOverlap;
      if (passing) {
        if (holdStart === null) holdStart = frame.timestamp;
        heldMs = frame.timestamp - holdStart;
      } else {
        holdStart = null;
        heldMs = 0;
      }
      const progress = passing ? clamp(0.4 + (0.6 * heldMs) / holdMs, 0, 1) : clamp(best / minOverlap, 0, 0.4);
      return { satisfied: heldMs >= holdMs, progress, value: best };
    },
  };
}


