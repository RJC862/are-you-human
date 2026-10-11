// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  issueSessionNonce,
  verifySessionNonce,
  issueLivenessToken,
  verifyLivenessToken,
} from "./token";

describe("session nonce", () => {
  it("issues and verifies a nonce round-trip", async () => {
    const token = await issueSessionNonce();
    const nonce = await verifySessionNonce(token);
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
  });

  it("rejects a tampered nonce", async () => {
    const token = await issueSessionNonce();
    const tampered = token.slice(0, -2) + (token.endsWith("a") ? "b" : "a");
    await expect(verifySessionNonce(tampered)).rejects.toBeTruthy();
  });

  it("rejects an expired nonce", async () => {
    const token = await issueSessionNonce(-10); // already expired
    await expect(verifySessionNonce(token)).rejects.toBeTruthy();
  });
});

describe("liveness token", () => {
  it("issues and verifies claims round-trip", async () => {
    const nonce = await verifySessionNonce(await issueSessionNonce());
    const token = await issueLivenessToken({
      isHuman: true,
      confidence: 0.92,
      nonce,
    });
    const claims = await verifyLivenessToken(token);
    expect(claims.isHuman).toBe(true);
    expect(claims.confidence).toBeCloseTo(0.92, 5);
    expect(claims.nonce).toBe(nonce);
    expect(claims.exp).toBeGreaterThan(claims.iat ?? 0);
  });

  it("rejects a tampered liveness token", async () => {
    const token = await issueLivenessToken({ isHuman: true, confidence: 1 });
    const tampered = "x" + token.slice(1);
    await expect(verifyLivenessToken(tampered)).rejects.toBeTruthy();
  });

  it("rejects an expired liveness token", async () => {
    const token = await issueLivenessToken({ isHuman: true, confidence: 1 }, -10);
    await expect(verifyLivenessToken(token)).rejects.toBeTruthy();
  });

  it("rejects a nonce token used as a liveness token (type mismatch)", async () => {
    const nonceToken = await issueSessionNonce();
    await expect(verifyLivenessToken(nonceToken)).rejects.toBeTruthy();
  });
});
