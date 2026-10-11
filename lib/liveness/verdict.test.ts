import { describe, it, expect } from "vitest";
import { decide, explain } from "./verdict";
import type { SessionSignals } from "./engine";

function signals(partial: Partial<SessionSignals> = {}): SessionSignals {
  return {
    rounds: [],
    passedRounds: 4,
    totalRounds: 4,
    usedAntiSpoof: true,
    antiSpoofPassed: 1,
    antiSpoofTotal: 1,
    durationMs: 20000,
    passiveHumanScore: 0.8,
    passiveMinHumanScore: 0.7,
    meshJitter: 0.004,
    minMeshJitter: 0.003,
    ...partial,
  };
}

describe("decide", () => {
  it("passes a clean human session", () => {
    const v = decide(signals());
    expect(v.isHuman).toBe(true);
    expect(v.confidence).toBeGreaterThan(0.8);
  });

  it("allows exactly one missed challenge", () => {
    const v = decide(signals({ passedRounds: 3, totalRounds: 4 }));
    expect(v.isHuman).toBe(true);
  });

  it("fails when too many challenges are missed", () => {
    const v = decide(signals({ passedRounds: 2, totalRounds: 4 }));
    expect(v.isHuman).toBe(false);
    expect(v.reasons.find((r) => r.key === "challenges")?.ok).toBe(false);
  });

  it("fails a static/photo feed (jitter too low)", () => {
    const v = decide(signals({ minMeshJitter: 0.0001 }));
    expect(v.isHuman).toBe(false);
    expect(v.reasons.find((r) => r.key === "motion")?.ok).toBe(false);
  });

  it("fails when the anti-spoof action was not passed", () => {
    const v = decide(signals({ antiSpoofTotal: 1, antiSpoofPassed: 0 }));
    expect(v.isHuman).toBe(false);
    expect(v.reasons.find((r) => r.key === "antiSpoof")?.ok).toBe(false);
  });

  it("fails a low passive human-likeness (filter/deepfake signature)", () => {
    const v = decide(signals({ passiveMinHumanScore: 0.2 }));
    expect(v.isHuman).toBe(false);
    expect(v.reasons.find((r) => r.key === "passive")?.ok).toBe(false);
  });

  it("does not require anti-spoof when none were used", () => {
    const v = decide(
      signals({ usedAntiSpoof: false, antiSpoofTotal: 0, antiSpoofPassed: 0 })
    );
    expect(v.reasons.find((r) => r.key === "antiSpoof")?.ok).toBe(true);
    expect(v.isHuman).toBe(true);
  });
});

describe("explain", () => {
  it("describes a pass", () => {
    const s = signals();
    const text = explain(decide(s), s);
    expect(text).toMatch(/Verified human/i);
    expect(text).toContain("4 of 4");
  });

  it("describes a static-feed failure", () => {
    const s = signals({ minMeshJitter: 0.0001 });
    const text = explain(decide(s), s);
    expect(text).toMatch(/could not verify/i);
    expect(text).toMatch(/static|photo|replayed/i);
  });

  it("describes a missed-challenge failure with counts", () => {
    const s = signals({ passedRounds: 1, totalRounds: 4, antiSpoofPassed: 0 });
    const text = explain(decide(s), s);
    expect(text).toContain("1/4");
  });
});
