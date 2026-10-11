/**
 * Client helpers for /api/text. Both always resolve to usable strings: on any
 * network/API failure they return the provided hardcoded fallbacks.
 */

/** Fetch friendly per-challenge instructions (falls back to the given texts). */
export async function fetchInstructions(
  actions: string[],
  fallbacks: string[]
): Promise<string[]> {
  try {
    const res = await fetch("/api/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "instructions", actions, fallbacks }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { texts?: unknown };
    if (
      Array.isArray(data.texts) &&
      data.texts.length === actions.length &&
      data.texts.every((t) => typeof t === "string")
    ) {
      return data.texts as string[];
    }
  } catch {
    // ignore — use fallbacks
  }
  return fallbacks;
}

/** Fetch a short result explanation (falls back to the given string). */
export async function fetchExplanation(args: {
  isHuman: boolean;
  passed: number;
  total: number;
  fallback: string;
}): Promise<string> {
  try {
    const res = await fetch("/api/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "explanation", ...args }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { text?: unknown };
    if (typeof data.text === "string" && data.text.trim()) return data.text;
  } catch {
    // ignore — use fallback
  }
  return args.fallback;
}
