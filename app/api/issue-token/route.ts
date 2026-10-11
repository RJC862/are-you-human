/**
 * POST /api/issue-token — mint a proof-of-liveness token after a PASS.
 *
 * Body: { nonce: string, isHuman: boolean, confidence: number }
 * - The nonce (from /api/session) must be valid: a token can't be minted
 *   without first opening a server session.
 * - Only issues a token when isHuman is true.
 *
 * NOTE: the server trusts the client-reported verdict (detection is on-device).
 * This is a documented limitation; the nonce binding raises the bar.
 */
import {
  verifySessionNonce,
  issueLivenessToken,
} from "@/lib/auth/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: { nonce?: string; isHuman?: boolean; confidence?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  if (!body?.nonce || typeof body.nonce !== "string") {
    return Response.json({ error: "missing session nonce" }, { status: 400 });
  }

  let nonce: string;
  try {
    nonce = await verifySessionNonce(body.nonce);
  } catch {
    return Response.json(
      { error: "invalid or expired session" },
      { status: 401 }
    );
  }

  if (body.isHuman !== true) {
    return Response.json(
      { error: "verification did not pass" },
      { status: 403 }
    );
  }

  const confidence =
    typeof body.confidence === "number" && Number.isFinite(body.confidence)
      ? Math.max(0, Math.min(1, body.confidence))
      : 0;

  const token = await issueLivenessToken({ isHuman: true, confidence, nonce });
  return Response.json({ token });
}
