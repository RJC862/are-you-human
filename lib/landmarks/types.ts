/**
 * Shared types for face-landmark processing.
 *
 * We define a *structural* subset of MediaPipe's FaceLandmarkerResult so our
 * pure parsing/scoring logic never imports the (browser-only) MediaPipe runtime.
 * This keeps the signal pipeline fully unit-testable under jsdom/node.
 */

export interface RawCategory {
  categoryName?: string;
  displayName?: string;
  score: number;
}

export interface RawClassification {
  categories: RawCategory[];
}

export interface RawMatrix {
  rows: number;
  columns: number;
  /** 4x4 transform, column-major (OpenGL convention). */
  data: number[] | Float32Array;
}

export interface RawLandmark {
  x: number;
  y: number;
  z: number;
}

/** Minimal structural shape of MediaPipe's FaceLandmarkerResult. */
export interface RawFaceResult {
  faceLandmarks?: RawLandmark[][];
  faceBlendshapes?: RawClassification[];
  facialTransformationMatrixes?: RawMatrix[];
}

/** Head orientation in degrees. */
export interface HeadPose {
  /** Left/right rotation. Positive = subject turns toward their left. */
  yaw: number;
  /** Up/down rotation. Positive = subject looks up. */
  pitch: number;
  /** Tilt. Positive = head tilts toward subject's right shoulder. */
  roll: number;
}

/** A normalized, framework-free snapshot of one analyzed video frame. */
export interface FaceFrame {
  /** Milliseconds (video/performance clock). */
  timestamp: number;
  hasFace: boolean;
  landmarkCount: number;
  /** Blendshape name -> score in [0, 1]. */
  blendshapes: Record<string, number>;
  pose: HeadPose;
  /** Normalized landmark coordinates (0..1 image space, z relative). */
  landmarks: RawLandmark[];
  /**
   * Detected hands this frame (from the Hand Landmarker), each a 21-point
   * landmark array in the same normalized image space as face landmarks.
   * Undefined when hand detection is not running. Used by the occlusion
   * (hand-over-face) and touch-nose challenges.
   */
  hands?: RawLandmark[][];
}
