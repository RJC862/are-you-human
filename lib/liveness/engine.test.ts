import { describe, it, expect } from "vitest";
import { createVerificationEngine } from "./engine";
import type { Challenge } from "./challenge";
import type { FaceFrame } from "@/lib/landmarks/types";

function frame(partial: Partial<FaceFrame> & { timestamp: number }): FaceFrame {
  return {
    hasFace: true,
    landmarkCount: 478,
    blendshapes: {},
    pose: { yaw: 0, pitch: 0, roll: 0 },
    landmarks: [],
    ...partial,
  };
}

const smile: Challenge = { action: "smile", prompt: "Smile", timeoutMs: 5000 };
const openMouth: Challenge = {
  action: "open_mouth",
  prompt: "Open your mouth",
  timeoutMs: 5000,
};

/** Feed frames with a smiling expression across a span of time. */
function smilingFrames(startT: number, endT: number, step = 33): FaceFrame[] {
  const out: FaceFrame[] = [];
  for (let t = startT; t <= endT; t += step) {
    out.push(
      frame({
        timestamp: t,
        blendshapes: { mouthSmileLeft: 0.7, mouthSmileRight: 0.7 },
      })
    );
  }
  return out;
}

describe("createVerificationEngine", () => {
  it("starts in active phase on the first challenge", () => {
    const e = createVerificationEngine([smile], { cooldownMs: 500 });
    e.start(0);
    const s = e.getState();
    expect(s.phase).toBe("active");
    expect(s.current?.action).toBe("smile");
    expect(s.total).toBe(1);
  });

  it("ignores detection during the ready cooldown", () => {
    const e = createVerificationEngine([smile], { cooldownMs: 500 });
    e.start(0);
    // Smiling during cooldown should NOT complete the round.
    const s = e.update(frame({ timestamp: 100, blendshapes: { mouthSmileLeft: 0.9, mouthSmileRight: 0.9 } }));
    expect(s.roundStatus).toBe("ready");
    expect(s.readyCountdownMs).toBeGreaterThan(0);
    expect(s.phase).toBe("active");
  });

  it("passes a round when the action is performed after cooldown", () => {
    const e = createVerificationEngine([smile], { cooldownMs: 500 });
    e.start(0);
    let state = e.getState();
    for (const f of smilingFrames(0, 2000)) state = e.update(f);
    expect(state.phase).toBe("complete");
    const sig = e.getSignals();
    expect(sig.passedRounds).toBe(1);
    expect(sig.rounds[0].passed).toBe(true);
  });

  it("fails a round on timeout and still completes the session", () => {
    const e = createVerificationEngine([smile], { cooldownMs: 500 });
    e.start(0);
    let state = e.getState();
    // Neutral frames (no smile) past cooldown + timeout.
    for (let t = 0; t <= 6000; t += 33) state = e.update(frame({ timestamp: t }));
    expect(state.phase).toBe("complete");
    const sig = e.getSignals();
    expect(sig.passedRounds).toBe(0);
    expect(sig.rounds[0].passed).toBe(false);
  });

  it("advances through multiple rounds in order", () => {
    const e = createVerificationEngine([smile, openMouth], { cooldownMs: 300 });
    e.start(0);
    let state = e.getState();
    // Round 1: smile from 0..1500.
    for (const f of smilingFrames(0, 1500)) state = e.update(f);
    // Round 2: open mouth from 1600..3200.
    for (let t = 1600; t <= 3200; t += 33) {
      state = e.update(frame({ timestamp: t, blendshapes: { jawOpen: 0.7 } }));
    }
    expect(state.phase).toBe("complete");
    const sig = e.getSignals();
    expect(sig.passedRounds).toBe(2);
    expect(sig.rounds.map((r) => r.action)).toEqual(["smile", "open_mouth"]);
  });

  it("tracks anti-spoof counts and passive stats", () => {
    const handWave: Challenge = {
      action: "turn_profile",
      prompt: "Profile",
      timeoutMs: 3000,
    };
    const e = createVerificationEngine([handWave], { cooldownMs: 200 });
    e.start(0);
    let state = e.getState();
    for (let t = 0; t <= 2000; t += 33) {
      state = e.update(frame({ timestamp: t, pose: { yaw: 45, pitch: 0, roll: 0 } }));
    }
    expect(state.phase).toBe("complete");
    const sig = e.getSignals();
    expect(sig.usedAntiSpoof).toBe(true);
    expect(sig.antiSpoofTotal).toBe(1);
    expect(sig.antiSpoofPassed).toBe(1);
  });

  it("resets back to idle", () => {
    const e = createVerificationEngine([smile]);
    e.start(0);
    e.reset();
    expect(e.getState().phase).toBe("idle");
  });
});
