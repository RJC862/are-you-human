/**
 * Passive liveness signals (on-device, landmark-only).
 *
 * A rolling-window analyzer that turns a stream of FaceFrames into a
 * `humanScore` in [0, 1] from cheap temporal statistics of the face mesh.
 * Core intuition: a *live* human produces natural landmark micro-jitter,
 * head-pose drift, and continuous micro-expressions. Static images and
 * replayed/paused video are unnaturally still and fail these.
 *
 * (FFT/texture analysis was intentionally dropped to keep the pipeline lean
 * and fully landmark-based — mesh jitter is the primary signal.)
 *
 * Pure and framework-free so it is unit-testable.
 */
import { clamp, mean, stddev } from "@/lib/utils";
import { blendshape } from "@/lib/landmarks/parse";
import type { FaceFrame } from "@/lib/landmarks/types";

export interface PassiveSubScores {
  /** Natural landmark micro-jitter is present (not frozen, not erratic). */
  meshStability: number;
  /** Head pose drifts naturally (not perfectly static). */
  poseVariance: number;
  /** Continuous micro-expressions (blendshape variation over time). */
  expressiveness: number;
}

export interface PassiveResult {
  /** Weighted human-likeness in [0, 1]. */
  humanScore: number;
  sub: PassiveSubScores;
  /** Number of frames currently in the window. */
  samples: number;
  /** Raw mean landmark jitter (exposed for the debug/tuning panel). */
  meshJitter: number;
}

/**
 * Trapezoidal band score: 0 outside [a, d], ramping to 1 across [a, b],
 * flat 1 across [b, c], ramping back to 0 across [c, d].
 */
export function bandScore(
  value: number,
  a: number,
  b: number,
  c: number,
  d: number
): number {
  if (value <= a || value >= d) return 0;
  if (value < b) return clamp((value - a) / (b - a), 0, 1);
  if (value <= c) return 1;
  return clamp(1 - (value - c) / (d - c), 0, 1);
}

const KEY_BLENDSHAPES = [
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "jawOpen",
  "mouthSmileLeft",
  "mouthSmileRight",
  "browInnerUp",
  "eyeLookInLeft",
  "eyeLookOutLeft",
  "mouthPucker",
];

// Calibration bands (documented defaults; refined with live testing + the
// debug panel). Mesh jitter is in normalized-image-space units per frame.
const MESH_BAND = [0.0003, 0.0015, 0.02, 0.05] as const;
const POSE_BAND = [0.03, 0.25, 35, 70] as const;
const EXPR_BAND = [0.0008, 0.008, 0.5, 0.9] as const;

const WEIGHTS = { meshStability: 0.45, poseVariance: 0.3, expressiveness: 0.25 };
const NEUTRAL = 0.5;

export interface PassiveAnalyzerOptions {
  /** Rolling window length in frames. */
  windowSize?: number;
}

export interface PassiveAnalyzer {
  update(frame: FaceFrame): PassiveResult;
  reset(): void;
}

export function createPassiveAnalyzer(
  opts: PassiveAnalyzerOptions = {}
): PassiveAnalyzer {
  const windowSize = opts.windowSize ?? 30;

  let prevLandmarks: FaceFrame["landmarks"] | null = null;
  let jitter: number[] = [];
  let yaws: number[] = [];
  let pitches: number[] = [];
  let rolls: number[] = [];
  let blendSeries: number[][] = [];

  function cap<T>(arr: T[]): void {
    if (arr.length > windowSize) arr.splice(0, arr.length - windowSize);
  }

  function reset() {
    prevLandmarks = null;
    jitter = [];
    yaws = [];
    pitches = [];
    rolls = [];
    blendSeries = KEY_BLENDSHAPES.map(() => []);
  }
  reset();

  function meanLandmarkDisplacement(curr: FaceFrame["landmarks"]): number | null {
    if (!prevLandmarks || prevLandmarks.length !== curr.length || curr.length === 0) {
      return null;
    }
    let sum = 0;
    for (let i = 0; i < curr.length; i++) {
      const dx = curr[i].x - prevLandmarks[i].x;
      const dy = curr[i].y - prevLandmarks[i].y;
      sum += Math.hypot(dx, dy);
    }
    return sum / curr.length;
  }

  function update(frame: FaceFrame): PassiveResult {
    if (frame.hasFace) {
      const disp = meanLandmarkDisplacement(frame.landmarks);
      if (disp !== null) {
        jitter.push(disp);
        cap(jitter);
      }
      prevLandmarks = frame.landmarks;

      yaws.push(frame.pose.yaw);
      pitches.push(frame.pose.pitch);
      rolls.push(frame.pose.roll);
      cap(yaws);
      cap(pitches);
      cap(rolls);

      KEY_BLENDSHAPES.forEach((name, idx) => {
        blendSeries[idx].push(blendshape(frame, name));
        cap(blendSeries[idx]);
      });
    } else {
      // Break temporal continuity so a gap isn't read as a giant jump.
      prevLandmarks = null;
    }

    const meshJitter = jitter.length > 0 ? mean(jitter) : 0;
    const meshStability =
      jitter.length >= 3 ? bandScore(meshJitter, ...MESH_BAND) : NEUTRAL;

    const poseStd =
      yaws.length >= 3
        ? mean([stddev(yaws), stddev(pitches), stddev(rolls)])
        : -1;
    const poseVariance = poseStd >= 0 ? bandScore(poseStd, ...POSE_BAND) : NEUTRAL;

    let expressiveness = NEUTRAL;
    if (blendSeries[0].length >= 3) {
      const perShapeStd = blendSeries.map((s) => stddev(s));
      expressiveness = bandScore(mean(perShapeStd), ...EXPR_BAND);
    }

    const humanScore =
      WEIGHTS.meshStability * meshStability +
      WEIGHTS.poseVariance * poseVariance +
      WEIGHTS.expressiveness * expressiveness;

    return {
      humanScore: clamp(humanScore, 0, 1),
      sub: { meshStability, poseVariance, expressiveness },
      samples: yaws.length,
      meshJitter,
    };
  }

  return { update, reset };
}
