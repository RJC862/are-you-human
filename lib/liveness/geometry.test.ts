import { describe, it, expect } from "vitest";
import {
  boundingBox,
  overlapRatio,
  pointInBox,
  dist2D,
  minHandPointDistance,
} from "./geometry";

describe("boundingBox", () => {
  it("computes min/max over points", () => {
    const b = boundingBox([
      { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.4 },
      { x: 0.3, y: 0.9 },
    ]);
    expect(b).toEqual({ minX: 0.1, minY: 0.2, maxX: 0.5, maxY: 0.9 });
  });
  it("returns null for empty input", () => {
    expect(boundingBox([])).toBeNull();
  });
});

describe("overlapRatio", () => {
  const face = { minX: 0.3, minY: 0.3, maxX: 0.7, maxY: 0.7 };
  it("is 0 for disjoint boxes", () => {
    expect(overlapRatio(face, { minX: 0.8, minY: 0.8, maxX: 0.9, maxY: 0.9 })).toBe(0);
  });
  it("is 1 when the smaller box is fully contained", () => {
    expect(overlapRatio(face, { minX: 0.4, minY: 0.4, maxX: 0.5, maxY: 0.5 })).toBe(1);
  });
  it("is partial for a partial overlap", () => {
    const r = overlapRatio(face, { minX: 0.5, minY: 0.5, maxX: 0.9, maxY: 0.9 });
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
  });
});

describe("pointInBox", () => {
  const box = { minX: 0.2, minY: 0.2, maxX: 0.8, maxY: 0.8 };
  it("detects inside/outside", () => {
    expect(pointInBox({ x: 0.5, y: 0.5 }, box)).toBe(true);
    expect(pointInBox({ x: 0.1, y: 0.5 }, box)).toBe(false);
  });
  it("honors padding", () => {
    expect(pointInBox({ x: 0.85, y: 0.5 }, box, 0.1)).toBe(true);
  });
});

describe("dist2D / minHandPointDistance", () => {
  it("computes euclidean distance", () => {
    expect(dist2D({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  it("finds the closest hand point to a target", () => {
    const hand = [
      { x: 0.9, y: 0.9, z: 0 },
      { x: 0.5, y: 0.5, z: 0 },
    ];
    expect(minHandPointDistance(hand, { x: 0.5, y: 0.5 })).toBeCloseTo(0, 5);
  });
});
