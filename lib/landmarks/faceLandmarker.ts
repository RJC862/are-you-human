/**
 * Browser-only loader for the MediaPipe Face Landmarker.
 *
 * Imported dynamically (inside useEffect) so the MediaPipe runtime — which
 * touches `self`/WASM — never executes during SSR or in unit tests.
 */
import type { FaceLandmarker } from "@mediapipe/tasks-vision";

const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

/**
 * Create (once) and return a FaceLandmarker configured for VIDEO mode with
 * blendshapes and the facial transformation matrix enabled.
 */
export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (landmarkerPromise) return landmarkerPromise;

  landmarkerPromise = (async () => {
    const { FaceLandmarker, FilesetResolver } = await import(
      "@mediapipe/tasks-vision"
    );
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  })();

  return landmarkerPromise;
}

/** Reset the cached landmarker (used when switching GPU->CPU fallback). */
export function resetFaceLandmarker() {
  landmarkerPromise = null;
}
