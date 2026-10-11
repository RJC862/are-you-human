import { clamp } from "@/lib/utils";
import type {
  FaceFrame,
  HeadPose,
  RawFaceResult,
  RawMatrix,
} from "./types";

const RAD2DEG = 180 / Math.PI;

/**
 * Decode approximate Euler angles (degrees) from a 4x4 facial transformation
 * matrix. MediaPipe stores the matrix column-major, so element (row r, col c)
 * is `data[c * 4 + r]`.
 *
 * Convention (self-consistent, good enough for liveness heuristics):
 *   yaw   = atan2(r02, r22)   -> left/right head turn
 *   pitch = asin(-r12)        -> up/down nod
 *   roll  = atan2(r10, r11)   -> tilt
 */
export function matrixToEuler(matrix?: RawMatrix): HeadPose {
  if (!matrix || !matrix.data || matrix.data.length < 16) {
    return { yaw: 0, pitch: 0, roll: 0 };
  }
  const d = matrix.data;
  const get = (r: number, c: number) => Number(d[c * 4 + r]);

  const r02 = get(0, 2);
  const r22 = get(2, 2);
  const r12 = get(1, 2);
  const r10 = get(1, 0);
  const r11 = get(1, 1);

  const yaw = Math.atan2(r02, r22) * RAD2DEG;
  const pitch = Math.asin(clamp(-r12, -1, 1)) * RAD2DEG;
  const roll = Math.atan2(r10, r11) * RAD2DEG;

  return { yaw, pitch, roll };
}

/**
 * Convert a raw MediaPipe FaceLandmarkerResult into a normalized FaceFrame.
 * Returns a "no face" frame when the result contains no landmarks.
 */
export function parseFaceResult(
  result: RawFaceResult | null | undefined,
  timestamp: number
): FaceFrame {
  const landmarks = result?.faceLandmarks?.[0] ?? [];
  const hasFace = landmarks.length > 0;

  const blendshapes: Record<string, number> = {};
  const categories = result?.faceBlendshapes?.[0]?.categories ?? [];
  for (const cat of categories) {
    const name = cat.categoryName ?? cat.displayName;
    if (name) blendshapes[name] = cat.score;
  }

  const pose = hasFace
    ? matrixToEuler(result?.facialTransformationMatrixes?.[0])
    : { yaw: 0, pitch: 0, roll: 0 };

  return {
    timestamp,
    hasFace,
    landmarkCount: landmarks.length,
    blendshapes,
    pose,
    landmarks,
  };
}

/** Safe blendshape lookup (0 when absent). */
export function blendshape(frame: FaceFrame, name: string): number {
  return frame.blendshapes[name] ?? 0;
}
