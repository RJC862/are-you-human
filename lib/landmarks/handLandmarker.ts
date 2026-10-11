/**
 * Browser-only loader for the MediaPipe Hand Landmarker.
 * Dynamically imported (inside useEffect) so WASM never runs during SSR/tests.
 */
import type { HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

let handPromise: Promise<HandLandmarker> | null = null;

/** Create (once) a HandLandmarker configured for VIDEO mode, up to 2 hands. */
export async function getHandLandmarker(): Promise<HandLandmarker> {
  if (handPromise) return handPromise;

  handPromise = (async () => {
    const { HandLandmarker, FilesetResolver } = await import(
      "@mediapipe/tasks-vision"
    );
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
    });
  })();

  return handPromise;
}

export function resetHandLandmarker() {
  handPromise = null;
}
