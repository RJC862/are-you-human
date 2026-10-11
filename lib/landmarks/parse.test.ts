import { describe, it, expect } from "vitest";
import { parseFaceResult, matrixToEuler, blendshape } from "./parse";
import type { RawFaceResult, RawMatrix } from "./types";

/** Build a column-major 4x4 rotation-about-Y (yaw) matrix for `deg` degrees. */
function yawMatrix(deg: number): RawMatrix {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // Row-major R: r00=cos r02=sin r20=-sin r22=cos. Column-major data[c*4+r]:
  const data = [
    cos, 0, -sin, 0, // col 0
    0, 1, 0, 0,      // col 1
    sin, 0, cos, 0,  // col 2
    0, 0, 0, 1,      // col 3
  ];
  return { rows: 4, columns: 4, data };
}

describe("matrixToEuler", () => {
  it("returns zero angles for identity", () => {
    const identity: RawMatrix = {
      rows: 4,
      columns: 4,
      data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    };
    const pose = matrixToEuler(identity);
    expect(Math.abs(pose.yaw)).toBeLessThan(0.001);
    expect(Math.abs(pose.pitch)).toBeLessThan(0.001);
    expect(Math.abs(pose.roll)).toBeLessThan(0.001);
  });

  it("extracts a positive yaw from a Y-rotation matrix", () => {
    const pose = matrixToEuler(yawMatrix(30));
    expect(pose.yaw).toBeCloseTo(30, 1);
    expect(Math.abs(pose.pitch)).toBeLessThan(0.5);
    expect(Math.abs(pose.roll)).toBeLessThan(0.5);
  });

  it("extracts a negative yaw for opposite rotation", () => {
    const pose = matrixToEuler(yawMatrix(-45));
    expect(pose.yaw).toBeCloseTo(-45, 1);
  });

  it("defaults to zeros for missing/short matrix", () => {
    expect(matrixToEuler(undefined)).toEqual({ yaw: 0, pitch: 0, roll: 0 });
    expect(matrixToEuler({ rows: 2, columns: 2, data: [1, 0, 0, 1] })).toEqual({
      yaw: 0,
      pitch: 0,
      roll: 0,
    });
  });
});

describe("parseFaceResult", () => {
  const sample: RawFaceResult = {
    faceLandmarks: [[
      { x: 0.5, y: 0.5, z: 0 },
      { x: 0.4, y: 0.6, z: 0.1 },
    ]],
    faceBlendshapes: [
      {
        categories: [
          { categoryName: "eyeBlinkLeft", score: 0.9 },
          { categoryName: "mouthSmileLeft", score: 0.2 },
        ],
      },
    ],
    facialTransformationMatrixes: [yawMatrix(15)],
  };

  it("parses landmarks, blendshapes, and pose", () => {
    const frame = parseFaceResult(sample, 1234);
    expect(frame.timestamp).toBe(1234);
    expect(frame.hasFace).toBe(true);
    expect(frame.landmarkCount).toBe(2);
    expect(frame.blendshapes.eyeBlinkLeft).toBe(0.9);
    expect(frame.pose.yaw).toBeCloseTo(15, 1);
  });

  it("returns a no-face frame for empty results", () => {
    const frame = parseFaceResult({}, 10);
    expect(frame.hasFace).toBe(false);
    expect(frame.landmarkCount).toBe(0);
    expect(frame.pose).toEqual({ yaw: 0, pitch: 0, roll: 0 });
  });

  it("handles null input", () => {
    const frame = parseFaceResult(null, 0);
    expect(frame.hasFace).toBe(false);
  });

  it("blendshape() helper returns 0 for missing keys", () => {
    const frame = parseFaceResult(sample, 0);
    expect(blendshape(frame, "eyeBlinkLeft")).toBe(0.9);
    expect(blendshape(frame, "doesNotExist")).toBe(0);
  });
});
