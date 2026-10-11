/**
 * POST /api/session — start a verification session.
 * Returns a short-lived signed nonce that the liveness token will be bound to.
 */
import { issueSessionNonce } from "@/lib/auth/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    const nonce = await issueSessionNonce();
    return Response.json({ nonce });
  } catch (err) {
    console.error("[/api/session] failed:", err);
    return Response.json({ error: "could not start session" }, { status: 500 });
  }
}
