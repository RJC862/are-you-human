import { describe, it, expect } from "vitest";
import { clamp, normalize, mean, stddev, round } from "./utils";

describe("clamp", () => {
  it("clamps within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
  it("returns min for NaN", () => {
    expect(clamp(NaN, 2, 10)).toBe(2);
  });
});

describe("normalize", () => {
  it("maps midpoint to 0.5", () => {
    expect(normalize(5, 0, 10)).toBe(0.5);
  });
  it("clamps output to [0,1]", () => {
    expect(normalize(-5, 0, 10)).toBe(0);
    expect(normalize(50, 0, 10)).toBe(1);
  });
  it("handles zero-width range", () => {
    expect(normalize(5, 5, 5)).toBe(0);
  });
});

describe("mean", () => {
  it("averages values", () => {
    expect(mean([2, 4, 6])).toBe(4);
  });
  it("returns 0 for empty", () => {
    expect(mean([])).toBe(0);
  });
});

describe("stddev", () => {
  it("is 0 for identical values", () => {
    expect(stddev([3, 3, 3])).toBe(0);
  });
  it("computes population stddev", () => {
    expect(round(stddev([2, 4, 6]), 3)).toBe(1.633);
  });
  it("is 0 for single value", () => {
    expect(stddev([5])).toBe(0);
  });
});

describe("round", () => {
  it("rounds to decimals", () => {
    expect(round(3.14159, 2)).toBe(3.14);
    expect(round(3.14159, 0)).toBe(3);
  });
});
