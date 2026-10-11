# Development Log — "Are You Human?" (core liveness checker)

Scope: a random 3–5 challenge liveness check (blink, smile, mouth open, head
turn L/R, touch nose), 5-second countdown each, verified in-browser with
MediaPipe. Pass/fail per challenge + result screen. Luminal LLM only phrases
the instructions and the result explanation (hardcoded fallbacks). Hidden debug
panel. Deploys to Vercel. No token/lobby/widget, no passive FFT/texture, no
unit tests.

---

## Task 1 — Scaffold + deploy config

**What was done**

- Next.js (App Router) + TypeScript (strict) + Tailwind config; `@/*` path
  alias; Vitest removed (no unit tests this scope).
- `next.config.mjs` sets `Permissions-Policy: camera=(self)` (webcam allowed on
  the deployed origin) and pins `outputFileTracingRoot`.
- `.env.example` documents the optional Luminal vars (`LUMINAL_API_KEY`,
  `LUMINAL_BASE_URL`, `LUMINAL_MODEL`) — only used server-side for text.
- Landing page (`/`) with a "Start the check" link to `/verify`; dark theme,
  grid backdrop, pulse CTA.
- `DEPLOY.md` with GitHub-import and Vercel-CLI steps + post-deploy checklist.

**Note on the rebuild:** the workspace had been reset to a bare branch; some
earlier (larger-scope) files were still on disk. I pruned everything outside the
new scope — removed `lib/auth`, `/api/session`, `/api/issue-token`,
`/api/verify-token`, `/lobby`, `lib/liveness/passive.ts`, all `*.test.ts`, and
the stray `vitest.config.ts` — and simplified the rest to match.

## Tasks 2–4 (folded in during the rebuild)

Because solid versions of the camera, detectors, and engine already existed, the
pruning pass effectively completed the next tasks too; each is still individually
testable.

- **Task 2 — Camera + landmarks.** `components/CameraView.tsx` runs the MediaPipe
  Face Landmarker **and** Hand Landmarker (`lib/landmarks/faceLandmarker.ts`,
  `handLandmarker.ts`) in VIDEO mode, draws the face mesh + green hand skeletons,
  shows FPS/status, and emits a normalized `FaceFrame` (incl. `hands`) via
  `onFrame`. Graceful permission/no-camera handling; hand model optional.
- **Task 3 — Detectors + generator.** `lib/liveness/actions.ts` trimmed to the
  six in-scope actions: blink (edge ×2), smile / open_mouth / turn_left /
  turn_right (sustain), touch_nose (custom, index fingertip→nose tip via Hand
  Landmarker). `lib/liveness/challenge.ts` generates a randomized sequence of
  3–5 distinct actions, 5000 ms timeout each (`randomChallengeCount()`).
- **Task 4 — Engine + result.** `lib/liveness/engine.ts` is a pure state machine:
  a 1s "get ready" cooldown, then a **5-second** detection window per challenge
  (pass when the detector satisfies, fail on timeout), advancing through the
  sequence. `lib/liveness/verdict.ts` `decide()` = all challenges must pass;
  `fallbackExplanation()` is the hardcoded result text. `/verify` shows the live
  camera, a challenge overlay (step X/N, get-ready + 5s countdown, prompt,
  progress bar), a per-challenge pass/fail list, and a PASS/FAIL result card
  with Run again.

**Verification**

- `npm run build` → compiles cleanly; `/verify` ~5.9 kB.

**How to test:** `npm run dev` → `/verify` → "Begin check". Follow the prompts
(blink, smile, turn, touch nose). Each has a 5s countdown; the right panel logs
pass/fail; the session ends with a PASS/FAIL card.

---

## Task 5 — Luminal LLM text (instructions + explanation) with fallbacks

**What was done**

- `lib/llm/luminal.ts` — minimal server-only OpenAI-compatible client
  (`luminalChat`), base URL + model + key from env; 8s timeout; throws on any
  failure. `isLuminalConfigured()` gates calls.
- `app/api/text/route.ts` — `POST /api/text` (nodejs runtime), two kinds:
  - `instructions`: given the action list + hardcoded fallbacks, asks the LLM
    for a JSON array of ultra-short friendly prompts (one per action). Validates
    length/shape; **falls back** to the hardcoded prompts on any error or if the
    key is absent. Returns `source: "llm" | "fallback"`.
  - `explanation`: given the decision (isHuman + passed/total) and a hardcoded
    fallback, asks for a 1–2 sentence result explanation. The decision is passed
    in and the prompt forbids changing it (LLM only phrases). Falls back on error.
  - The LLM is used **only for copy**, never for the pass/fail decision.
- `lib/llm/textClient.ts` — `fetchInstructions()` / `fetchExplanation()` that
  always resolve to usable strings (return the fallbacks on any failure).
- `app/verify/page.tsx` — `begin()` now fetches LLM-phrased instructions and
  overrides each challenge `prompt` (hardcoded fallback otherwise). On
  completion it shows the hardcoded explanation immediately, then upgrades to
  the LLM phrasing when it arrives.

**Verification**

- `npm run build` → compiles; `/api/text` dynamic route built; `/verify` 6.23 kB.
- With no `LUMINAL_API_KEY`, the app uses the hardcoded prompts/explanation
  (verified by the fallback code path; set the key to exercise the LLM path).

**How to test:** without the key, run the flow — prompts are the hardcoded
defaults and the result explanation is the template. With `LUMINAL_*` env vars
set (`.env.local` or Vercel), prompts/explanation come from the model; kill the
network and they still fall back cleanly.

---

## Task 6 — Debug panel, polish, README, deploy

**What was done**

- **Hidden debug panel** on `/verify`, toggled with the `D` key (ignored while
  typing in inputs). Shows live signal values each frame: face present +
  landmark count, hands count, yaw/pitch/roll, blink L/R, jawOpen, smile L/R,
  and a one-line threshold reference for tuning.
- A hint line under the check: "Press D for the debug panel. Video never leaves
  your device."
- `README.md` rewritten for the final scope: what it does, an **honest pitch**
  (stops photo/replay; makes live deepfakes harder but isn't a deepfake
  classifier; verdict is client-side in this demo), tech, run/deploy steps, and
  project layout.

**Verification**

- `npm run build` → compiles cleanly. Routes: `/`, `/verify` (6.9 kB),
  `/api/text` (dynamic). No dangling imports to removed modules.

**How to test:** `npm run dev` → `/verify` → press `D` to toggle the debug
panel; perform actions and watch blink/jaw/smile/yaw values cross their
thresholds. Then deploy per `DEPLOY.md` and confirm the camera works on the live
HTTPS URL.

## Status

All six tasks complete. The app is a self-contained, on-device liveness checker
that builds cleanly and is ready to deploy to Vercel. Live webcam behavior
(mesh/hand tracking, detector tuning) must be validated in a browser with a
camera; thresholds in `lib/liveness/actions.ts` can be tuned using the debug
panel.

---

## Task 7 — Expanded challenge set (Tier 1 + Tier 2 + hand-in-front-of-face)

**Goal:** Grow the challenge variety with reliable, MediaPipe-detectable actions.

**What was added** (`lib/liveness/actions.ts`, now 25 actions, all in the
random pool via `ALL_ACTIONS`):

- **Tier 1 — head pose (sustain):** look_up, look_down, tilt_left, tilt_right
  (pitch/roll thresholds, 500 ms hold).
- **Tier 1 — expressions (sustain on blendshapes):** raise_eyebrows
  (`browInnerUp`+`browOuterUp*`), furrow_brows (`browDown*`), puff_cheeks
  (`cheekPuff`), purse_lips (`mouthPucker`/`mouthFunnel`), show_teeth
  (smile + jaw), neutral_face (inverse of the strongest expression; all low →
  pass).
- **Tier 2 — face touches (new generic "touch" detector):** touch_chin,
  touch_forehead, touch_left_cheek, touch_right_cheek, touch_left_ear,
  touch_right_ear — a hand point (index/thumb/middle tip or palm) within a
  normalized distance of a face-region center, held ~300 ms. Regions are keyed
  to 468-mesh indices; left/right are the **subject's** sides (mesh isn't
  mirrored), so prompts match the user regardless of the mirrored preview.
- **Tier 2 — hand-region holds (new "region"/"bothCheeks" detectors):**
  - **hand_in_front_of_face** — hand bbox overlaps the full-face bbox ≥0.12 and
    holds ~800 ms (the requested static hold).
  - **cover_mouth** — hand bbox over the mouth region.
  - **both_palms_cheeks** — a hand over each cheek region (needs 2 hands).

Refactored `createActionDetector` into focused factories (edge / sustain /
touch / region / bothCheeks). The existing `touch_nose` now uses the generic
touch detector.

**Honest notes:** ear touches sit at the mesh edge and are the least reliable
(may need threshold tuning via the `D` panel). "Frown" and "suck in cheeks"
from the request were omitted — no reliable blendshape. Finger-count / specific
hand-shape gestures (Tier 3) were not added; they need a gesture classifier.

**Verification**

- `npx tsc --noEmit` → 0 errors; `npm run build` → clean, `/verify` 8.5 kB.
- The LLM instruction/explanation path is generic, so new actions are phrased
  automatically (with the hardcoded `ACTION_PROMPTS` as fallback).

**How to test:** `/verify` → Begin check; the random sequence now draws from all
25 actions. Use the `D` panel to watch blendshape/pose values and tune any
threshold that feels off (expressions and ear touches are the likeliest).
