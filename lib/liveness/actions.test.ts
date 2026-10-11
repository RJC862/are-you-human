import { describe, it, expect } from "vitest";
import { createActionDetector } from "./actions";
import type { FaceFrame } from "@/lib/landmarks/types";

/** Build a FaceFrame with sensible defaults, overriding what a test needs. */
function makeFrame(partial: Partial<FaceFrame> & { timestamp: number }): FaceFrame {
  return {
    hasFace: true,
    landmarkCount: 478,
    blendshapes: {},
    pose: { yaw: 0, pitch: 0, roll: 0 },
    landmarks: [],
    ...partial,
  };
}

/** Feed a detector a sequence of frames; return the final progress. */
function run(
  detector: ReturnType<typeof createActionDetector>,
  frames: FaceFrame[]
) {
  let last = { satisfied: false, progress: 0, value: 0 };
  for (const f of frames) last = detector.update(f);
  return last;
}

describe("blink detector (edge, count=2)", () => {
  it("does not fire at rest", () => {
    const d = createActionDetector("blink");
    const frames = Array.from({ length: 10 }, (_, i) =>
      makeFrame({ timestamp: i * 33, blendshapes: { eyeBlinkLeft: 0.05 } })
    );
    expect(run(d, frames).satisfied).toBe(false);
  });

  it("fires after two full blinks", () => {
    const d = createActionDetector("blink");
    // Each blink: open -> closed(>=0.5) -> open(<=0.2).
    const seq = [0.05, 0.8, 0.05, 0.05, 0.9, 0.05];
    const frames = seq.map((v, i) =>
      makeFrame({ timestamp: i * 33, blendshapes: { eyeBlinkLeft: v } })
    );
    expect(run(d, frames).satisfied).toBe(true);
  });

  it("one blink is not enough", () => {
    const d = createActionDetector("blink");
    const seq = [0.05, 0.8, 0.05];
    const frames = seq.map((v, i) =>
      makeFrame({ timestamp: i * 33, blendshapes: { eyeBlinkLeft: v } })
    );
    const res = run(d, frames);
    expect(res.satisfied).toBe(false);
    expect(res.progress).toBeGreaterThan(0);
  });

  it("respects a custom count override", () => {
    const d = createActionDetector("blink", { count: 1 });
    const seq = [0.05, 0.8, 0.05];
    const frames = seq.map((v, i) =>
      makeFrame({ timestamp: i * 33, blendshapes: { eyeBlinkLeft: v } })
    );
    expect(run(d, frames).satisfied).toBe(true);
  });
});

describe("smile detector (sustain 400ms)", () => {
  it("fires only after holding past the threshold long enough", () => {
    const d = createActionDetector("smile");
    const frames = Array.from({ length: 20 }, (_, i) =>
      makeFrame({
        timestamp: i * 33,
        blendshapes: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6 },
      })
    );
    expect(run(d, frames).satisfied).toBe(true);
  });

  it("a brief smile under hold time does not satisfy", () => {
    const d = createActionDetector("smile");
    const frames = [
      makeFrame({ timestamp: 0, blendshapes: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6 } }),
      makeFrame({ timestamp: 100, blendshapes: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6 } }),
    ];
    expect(run(d, frames).satisfied).toBe(false);
  });

  it("resets hold when the smile drops", () => {
    const d = createActionDetector("smile");
    const frames = [
      makeFrame({ timestamp: 0, blendshapes: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6 } }),
      makeFrame({ timestamp: 200, blendshapes: { mouthSmileLeft: 0.0, mouthSmileRight: 0.0 } }),
      makeFrame({ timestamp: 500, blendshapes: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6 } }),
    ];
    // Last frame restarts the hold, so not yet satisfied.
    expect(run(d, frames).satisfied).toBe(false);
  });
});

describe("turn_left detector (sustain on yaw)", () => {
  it("fires when yaw stays positive beyond threshold", () => {
    const d = createActionDetector("turn_left");
    const frames = Array.from({ length: 20 }, (_, i) =>
      makeFrame({ timestamp: i * 33, pose: { yaw: 25, pitch: 0, roll: 0 } })
    );
    expect(run(d, frames).satisfied).toBe(true);
  });

  it("does not fire for a right turn (negative yaw)", () => {
    const d = createActionDetector("turn_left");
    const frames = Array.from({ length: 20 }, (_, i) =>
      makeFrame({ timestamp: i * 33, pose: { yaw: -25, pitch: 0, roll: 0 } })
    );
    expect(run(d, frames).satisfied).toBe(false);
  });
});

describe("open_mouth detector", () => {
  it("fires when jawOpen is held", () => {
    const d = createActionDetector("open_mouth");
    const frames = Array.from({ length: 20 }, (_, i) =>
      makeFrame({ timestamp: i * 33, blendshapes: { jawOpen: 0.7 } })
    );
    expect(run(d, frames).satisfied).toBe(true);
  });
});

describe("no-face handling", () => {
  it("sustain progress resets when the face disappears", () => {
    const d = createActionDetector("smile");
    d.update(makeFrame({ timestamp: 0, blendshapes: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6 } }));
    const res = d.update(
      makeFrame({ timestamp: 200, hasFace: false, blendshapes: {} })
    );
    expect(res.progress).toBe(0);
  });

  it("edge detector does not count while no face is present", () => {
    const d = createActionDetector("blink", { count: 1 });
    const frames = [
      makeFrame({ timestamp: 0, hasFace: false, blendshapes: { eyeBlinkLeft: 0.9 } }),
      makeFrame({ timestamp: 33, hasFace: false, blendshapes: { eyeBlinkLeft: 0.05 } }),
    ];
    expect(run(d, frames).satisfied).toBe(false);
  });
});

// --- Anti-deepfake challenges (Task 13) ---

/** Face landmarks spanning the box [0.3,0.3]-[0.7,0.7], with nose at index 1/4. */
function faceLandmarks(nose = { x: 0.5, y: 0.5 }) {
  const pts = [
    { x: 0.3, y: 0.3, z: 0 }, // 0
    { x: nose.x, y: nose.y, z: 0 }, // 1 (nose)
    { x: 0.7, y: 0.3, z: 0 }, // 2
    { x: 0.3, y: 0.7, z: 0 }, // 3
    { x: nose.x, y: nose.y, z: 0 }, // 4 (nose)
    { x: 0.7, y: 0.7, z: 0 }, // 5
  ];
  return pts;
}

/**
 * A 21-point hand centered at `p` with real spatial extent (so its bounding
 * box isn't degenerate). Index-8 fingertip is exactly at `p`.
 */
function handAt(p: { x: number; y: number }, half = 0.12) {
  const hand = Array.from({ length: 21 }, () => ({ x: p.x, y: p.y, z: 0 }));
  hand[0] = { x: p.x - half, y: p.y - half, z: 0 }; // extends the bbox
  hand[1] = { x: p.x + half, y: p.y + half, z: 0 };
  hand[8] = { x: p.x, y: p.y, z: 0 }; // index fingertip
  return hand;
}

describe("turn_profile detector (sustain on |yaw|)", () => {
  it("fires for a strong profile turn held long enough", () => {
    const d = createActionDetector("turn_profile");
    const frames = Array.from({ length: 15 }, (_, i) =>
      makeFrame({ timestamp: i * 33, pose: { yaw: 42, pitch: 0, roll: 0 } })
    );
    expect(run(d, frames).satisfied).toBe(true);
  });
  it("does not fire for a mild turn", () => {
    const d = createActionDetector("turn_profile");
    const frames = Array.from({ length: 15 }, (_, i) =>
      makeFrame({ timestamp: i * 33, pose: { yaw: 20, pitch: 0, roll: 0 } })
    );
    expect(run(d, frames).satisfied).toBe(false);
  });
});

describe("touch_nose detector", () => {
  it("fires when a fingertip reaches the nose and holds", () => {
    const d = createActionDetector("touch_nose");
    const frames = [0, 80, 160, 240].map((t) =>
      makeFrame({
        timestamp: t,
        landmarks: faceLandmarks(),
        hands: [handAt({ x: 0.5, y: 0.5 })],
      })
    );
    expect(run(d, frames).satisfied).toBe(true);
  });
  it("does not fire when the hand is far from the nose", () => {
    const d = createActionDetector("touch_nose");
    const frames = [0, 80, 160, 240].map((t) =>
      makeFrame({
        timestamp: t,
        landmarks: faceLandmarks(),
        hands: [handAt({ x: 0.1, y: 0.1 })],
      })
    );
    expect(run(d, frames).satisfied).toBe(false);
  });
  it("does not fire with no hands present", () => {
    const d = createActionDetector("touch_nose");
    const frames = [0, 80, 160, 240].map((t) =>
      makeFrame({ timestamp: t, landmarks: faceLandmarks() })
    );
    expect(run(d, frames).satisfied).toBe(false);
  });
});

describe("hand_wave (occlusion) detector", () => {
  it("fires on the sequence: face → hand covers + face lost → face returns", () => {
    const d = createActionDetector("hand_wave");
    const frames = [
      // Face visible, no hand.
      makeFrame({ timestamp: 0, landmarks: faceLandmarks() }),
      // Hand over face AND face tracking disrupted (landmarkCount low / no face).
      makeFrame({
        timestamp: 100,
        hasFace: false,
        landmarkCount: 0,
        landmarks: [],
        hands: [handAt({ x: 0.5, y: 0.5 })],
      }),
      // Face recovers, hand moved away.
      makeFrame({ timestamp: 200, landmarks: faceLandmarks() }),
    ];
    expect(run(d, frames).satisfied).toBe(true);
  });

  it("does NOT fire if the face keeps tracking while the hand is over it (deepfake-like)", () => {
    const d = createActionDetector("hand_wave");
    const frames = [
      makeFrame({ timestamp: 0, landmarks: faceLandmarks() }),
      // Hand over the face but face NEVER drops (rendered on top) → suspicious.
      makeFrame({
        timestamp: 100,
        hasFace: true,
        landmarkCount: 478,
        landmarks: faceLandmarks(),
        hands: [handAt({ x: 0.5, y: 0.5 })],
      }),
      makeFrame({ timestamp: 200, landmarks: faceLandmarks() }),
    ];
    expect(run(d, frames).satisfied).toBe(false);
  });
});
