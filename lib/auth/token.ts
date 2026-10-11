/**
 * Proof-of-liveness tokens (server-only).
 *
 * Two token types, both signed HS256 with `LIVENESS_TOKEN_SECRET`:
 *  - "nonce"    — a short-lived session token minted when a verification
 *                 session starts. The liveness token is bound to it, so a token
 *                 can't be minted without first opening a server session.
 *  - "liveness" — the proof a consumer (e.g. the mock meeting lobby) checks to
 *                 admit the user.
 *
 * HONEST TRUST MODEL: detection runs on-device, and the browser reports the
 * verdict to `/api/issue-token`. The server therefore trusts the client's
 * claimed result. This is a known limitation (documented in the README); the
 * nonce raises the bar but does not fully close it. A production system would
 * verify pixels server-side (or in a trusted enclave).
 */
import { SignJWT, jwtVerify } from "jose";

const DEV_SECRET = "dev-insecure-secret-change-me-at-least-32-bytes-long";

function secretKey(): Uint8Array {
  const s = process.env.LIVENESS_TOKEN_SECRET || DEV_SECRET;
  return new TextEncoder().encode(s);
}

/** True when a real secret is configured (not the insecure dev fallback). */
export function hasConfiguredSecret(): boolean {
  return Boolean(process.env.LIVENESS_TOKEN_SECRET);
}

export interface LivenessClaims {
  isHuman: boolean;
  confidence: number;
  nonce?: string;
}

export interface VerifiedLiveness extends LivenessClaims {
  iat?: number;
  exp?: number;
}

/** Mint a short-lived session nonce (default 5 min). Returns a signed JWT. */
export async function issueSessionNonce(ttlSec = 300): Promise<string> {
  const nonce =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ typ: "nonce", nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + ttlSec)
    .sign(secretKey());
}

/** Verify a session nonce token; returns the nonce string or throws. */
export async function verifySessionNonce(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, secretKey());
  if (payload.typ !== "nonce" || typeof payload.nonce !== "string") {
    throw new Error("not a valid session nonce");
  }
  return payload.nonce;
}

/** Issue a proof-of-liveness token (default 10 min). */
export async function issueLivenessToken(
  claims: LivenessClaims,
  ttlSec = 600
): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({
    typ: "liveness",
    isHuman: claims.isHuman,
    confidence: claims.confidence,
    nonce: claims.nonce,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("liveness")
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + ttlSec)
    .sign(secretKey());
}

/** Verify a proof-of-liveness token; returns claims or throws. */
export async function verifyLivenessToken(
  token: string
): Promise<VerifiedLiveness> {
  const { payload } = await jwtVerify(token, secretKey());
  if (payload.typ !== "liveness") {
    throw new Error("not a liveness token");
  }
  return {
    isHuman: Boolean(payload.isHuman),
    confidence: Number(payload.confidence),
    nonce: typeof payload.nonce === "string" ? payload.nonce : undefined,
    iat: payload.iat,
    exp: payload.exp,
  };
}
