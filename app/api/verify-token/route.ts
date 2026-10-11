/**
 * POST /api/verify-token — a consumer (e.g. the mock meeting lobby) validates a
 * proof-of-liveness token.
 *
 * Body: { token: string }
 * Response: { valid: boolean, claims?: { isHuman, confidence, iat, exp } }
 */
import { verifyLivenessToken } from "@/lib/auth/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ valid: false, error: "invalid body" }, { status: 400 });
  }

  if (!body?.token || typeof body.token !== "string") {
    return Response.json({ valid: false, error: "missing token" }, { status: 400 });
  }

  try {
    const claims = await verifyLivenessToken(body.token);
    return Response.json({ valid: true, claims });
  } catch {
    return Response.json({ valid: false, error: "invalid or expired token" });
  }
}
