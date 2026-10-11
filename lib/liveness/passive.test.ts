import { describe, it, expect } from "vitest";
import { bandScore, createPassiveAnalyzer } from "./passive";
import type { FaceFrame } from "@/lib/landmarks/types";

describe("bandScore", () => {
  it("is 0 outside the band", () => {
    expect(bandScore(0, 1, 2, 3, 4)).toBe(0);
    expect(bandScore(5, 1, 2, 3, 4)).toBe(0);
  });
  it("is 1 inside the flat region", () => {
    expect(bandScore(2.5, 1, 2, 3, 4)).toBe(1);
  });
  it("ramps up and down linearly", () => {
    expect(bandScore(1.5, 1, 2, 3, 4)).toBeCloseTo(0.5, 5);
    expect(bandScore(3.5, 1, 2, 3, 4)).toBeCloseTo(0.5, 5);
  });
});

/** A set of landmarks laid out on a small grid, optionally shifted. */
function makeLandmarks(shift = 0) {
  const pts = [];
  for (let i = 0; i < 20; i++) {
    pts.push({ x: 0.3 + (i % 5) * 0.05 + shift, y: 0.3 + Math.floor(i / 5) * 0.05, z: 0 });
  }
  return pts;
}

function frame(partial: Partial<FaceFrame> & { timestamp: number }): FaceFrame {
  return {
    hasFace: true,
    landmarkCount: 20,
    blendshapes: {},
    pose: { yaw: 0, pitch: 0, roll: 0 },
    landmarks: makeLandmarks(),
    ...partial,
  };
}

describe("createPassiveAnalyzer", () => {
  it("scores a frozen (static) feed as low human-likeness", () => {
    const a = createPassiveAnalyzer();
    const fixedLandmarks = makeLandmarks();
    let res = createPassiveAnalyzer().update(frame({ timestamp: 0 }));
    // Every frame identical: no jitter, no pose drift, no expression change.
    for (let i = 0; i < 20; i++) {
      res = a.update(
        frame({
          timestamp: i * 33,
          landmarks: fixedLandmarks,
          pose: { yaw: 10, pitch: 2, roll: 1 }, // constant pose
          blendshapes: { eyeBlinkLeft: 0.1, jawOpen: 0.05 }, // constant
        })
      );
    }
    expect(res.sub.meshStability).toBeLessThan(0.2);
    expect(res.sub.poseVariance).toBeLessThan(0.2);
    expect(res.sub.expressiveness).toBeLessThan(0.2);
    expect(res.humanScore).toBeLessThan(0.3);
    expect(res.meshJitter).toBeCloseTo(0, 5);
  });

  it("scores a lively feed as high human-likeness", () => {
    const a = createPassiveAnalyzer();
    let res = a.update(frame({ timestamp: 0 }));
    for (let i = 0; i < 25; i++) {
      const shift = i * 0.004; // natural micro-jitter ~0.004/frame
      res = a.update(
        frame({
          timestamp: i * 33,
          landmarks: makeLandmarks(shift),
          pose: {
            yaw: 5 * Math.sin(i / 3),
            pitch: 3 * Math.cos(i / 4),
            roll: 2 * Math.sin(i / 5),
          },
          blendshapes: {
            eyeBlinkLeft: 0.25 + 0.2 * Math.sin(i),
            eyeBlinkRight: 0.25 + 0.2 * Math.sin(i),
            jawOpen: 0.2 + 0.15 * Math.cos(i / 2),
            mouthSmileLeft: 0.2 + 0.1 * Math.sin(i / 2),
          },
        })
      );
    }
    expect(res.sub.meshStability).toBeGreaterThan(0.7);
    expect(res.sub.poseVariance).toBeGreaterThan(0.7);
    expect(res.sub.expressiveness).toBeGreaterThan(0.5);
    expect(res.humanScore).toBeGreaterThan(0.6);
    expect(res.meshJitter).toBeGreaterThan(0.002);
  });

  it("does not treat a face-loss gap as a huge jump", () => {
    const a = createPassiveAnalyzer();
    a.update(frame({ timestamp: 0, landmarks: makeLandmarks(0) }));
    a.update(frame({ timestamp: 33, hasFace: false, landmarks: [] }));
    const res = a.update(frame({ timestamp: 66, landmarks: makeLandmarks(0.5) }));
    expect(res.samples).toBeGreaterThan(0);
  });
});
