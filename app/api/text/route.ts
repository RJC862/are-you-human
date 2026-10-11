/**
 * POST /api/text — LLM-written UI copy, with hardcoded fallbacks.
 *
 * The Luminal LLM is used ONLY to phrase text; it never decides pass/fail.
 * Any failure (no key, API error, timeout) returns the hardcoded fallback with
 * source:"fallback", so the UI always gets usable text.
 *
 * Request bodies:
 *   { kind: "instructions", actions: string[], fallbacks: string[] }
 *     -> { texts: string[], source }   // one friendly instruction per action
 *   { kind: "explanation", isHuman: boolean, passed: number, total: number,
 *     fallback: string }
 *     -> { text: string, source }      // 1-2 sentence result explanation
 */
import { luminalChat, isLuminalConfigured } from "@/lib/llm/luminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Headroom over the 8s LLM timeout in luminalChat (Hobby plan allows up to 10s).
export const maxDuration = 10;

type Body =
  | { kind: "instructions"; actions?: string[]; fallbacks?: string[] }
  | {
      kind: "explanation";
      isHuman?: boolean;
      passed?: number;
      total?: number;
      fallback?: string;
    };

export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  if (body.kind === "instructions") {
    const actions = Array.isArray(body.actions) ? body.actions : [];
    const fallbacks = Array.isArray(body.fallbacks) ? body.fallbacks : [];
    if (!isLuminalConfigured()) {
      return Response.json({ texts: fallbacks, source: "fallback" });
    }
    try {
      const text = await luminalChat(
        [
          {
            role: "system",
            content:
              "You write ultra-short, friendly on-screen instructions for a " +
              "webcam liveness check. Return ONLY a JSON array of strings, one " +
              "per action, in order. Each under 6 words, imperative, no emojis.",
          },
          {
            role: "user",
            content:
              `Actions in order: ${JSON.stringify(actions)}. ` +
              `Write one instruction per action. Example: ["Blink twice","Give a big smile"].`,
          },
        ],
        { temperature: 0.9, maxTokens: 200, timeoutMs: 8000 }
      );
      const parsed = parseStringArray(text);
      if (parsed && parsed.length === actions.length) {
        return Response.json({ texts: parsed, source: "llm" });
      }
    } catch (err) {
      console.error("[/api/text] instructions LLM error:", err);
    }
    return Response.json({ texts: fallbacks, source: "fallback" });
  }

  if (body.kind === "explanation") {
    const fallback = typeof body.fallback === "string" ? body.fallback : "";
    if (!isLuminalConfigured()) {
      return Response.json({ text: fallback, source: "fallback" });
    }
    const decision = body.isHuman ? "PASS (verified human)" : "FAIL (not verified)";
    try {
      const text = await luminalChat(
        [
          {
            role: "system",
            content:
              "You explain a liveness-check result to the user in 1-2 short, " +
              "plain sentences. You are told the decision; DO NOT change it. " +
              "No emojis, no markdown.",
          },
          {
            role: "user",
            content:
              `Decision: ${decision}. Challenges passed: ${body.passed}/${body.total}. ` +
              `Write the explanation.`,
          },
        ],
        { temperature: 0.6, maxTokens: 120, timeoutMs: 8000 }
      );
      return Response.json({ text, source: "llm" });
    } catch (err) {
      console.error("[/api/text] explanation LLM error:", err);
      return Response.json({ text: fallback, source: "fallback" });
    }
  }

  return Response.json({ error: "unknown kind" }, { status: 400 });
}

/** Parse a JSON array of strings from a possibly fenced LLM reply. */
function parseStringArray(text: string): string[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const arr = JSON.parse(body.slice(start, end + 1));
    if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
      return arr.map((s) => s.trim()).filter(Boolean);
    }
  } catch {
    return null;
  }
  return null;
}
