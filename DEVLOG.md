# Development Log — "Are You Human?"

A step-by-step record of how this project was built during the hackathon. Each
entry describes what was added, why, and how it was verified.

---

## Task 1 — Project scaffold + deploy skeleton

**Goal:** Stand up a Next.js + TypeScript + Tailwind app with a test harness and
a landing page, buildable and deployable to Vercel.

**What was done**

- Chose a **manual Next.js scaffold** (App Router) instead of `create-next-app`
  because the interactive CLI blocks non-interactive execution and the repo
  already contained files (`.git`, `README.md`).
- Added configuration:
  - `package.json` — scripts (`dev`, `build`, `start`, `test`, `test:watch`) and
    pinned dependencies.
  - `tsconfig.json` — strict TypeScript, `@/*` path alias to the repo root.
  - `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs` — framework
    config; custom Tailwind theme colors (accent/success/danger/warn) for the UI.
  - `vitest.config.ts` — jsdom environment, React plugin, `@` alias.
  - `.gitignore`, `.env.example` — the latter documents the server-side env vars
    (`LUMINAL_API_KEY`, `LUMINAL_BASE_URL`, `LUMINAL_MODEL`, `LIVENESS_TOKEN_SECRET`).
- Added app shell:
  - `app/layout.tsx` — root layout + metadata.
  - `app/globals.css` — dark theme, animated grid backdrop, pulse-ring button.
  - `app/page.tsx` — landing page with "Start Verification" and "Meeting Lobby
    Demo" calls to action (routes wired up in later tasks).
- Added `lib/utils.ts` — pure helpers (`clamp`, `normalize`, `mean`, `stddev`,
  `round`) that the signal extractors will build on, with `lib/utils.test.ts`.

**Security note:** The Luminal API key and the JWT signing secret are declared as
server-side env vars only. They are never shipped to the browser; later tasks
access them exclusively inside `/api` serverless routes.

**Dependency note:** Pinned `next` to `15.5.27` after `15.1.6` flagged a security
advisory (CVE-2025-66478). Remaining `npm audit` warnings are in transitive dev
tooling and do not affect the production bundle.

**Verification**

- `npm test` → 11/11 unit tests pass.
- `npm run build` → compiles successfully; static pages generated; landing route
  (`/`) prerendered.

---

## Task 2 — Webcam capture + MediaPipe Face Landmarker live overlay

**Goal:** Capture the webcam in-browser, run the MediaPipe Face Landmarker in
VIDEO mode, draw a live mesh overlay, and surface normalized per-frame signals.

**What was done**

- `lib/landmarks/types.ts` — framework-free structural types. We deliberately
  model only the *subset* of MediaPipe's result we consume (`RawFaceResult`),
  plus our normalized `FaceFrame` (timestamp, hasFace, landmark count,
  blendshape map, head pose, landmarks). This keeps all scoring logic testable
  without importing the browser-only runtime.
- `lib/landmarks/parse.ts`:
  - `matrixToEuler()` — decodes yaw/pitch/roll (degrees) from the 4x4 facial
    transformation matrix. Documented the column-major layout
    (`data[c*4 + r]`) and the extraction convention.
  - `parseFaceResult()` — converts a raw result into a `FaceFrame`; returns a
    safe "no face" frame for empty/null input.
  - `blendshape()` — safe lookup helper.
- `lib/landmarks/parse.test.ts` — 8 tests: identity matrix → ~0 angles, a
  constructed Y-rotation matrix → correct signed yaw, missing-matrix defaults,
  full-result parsing, and empty/null handling.
- `lib/landmarks/faceLandmarker.ts` — browser-only loader, **dynamically
  imported** so WASM never runs during SSR/tests. VIDEO mode, 1 face,
  blendshapes + transformation matrix enabled, GPU delegate. WASM from the
  jsDelivr CDN, model from Google's model storage.
- `components/CameraView.tsx` — client component. Acquires the webcam (or an
  optional `videoSrc` for the later adversarial demo), runs the detection loop
  on new frames only, draws the tesselation overlay, tracks FPS, and emits
  `FaceFrame`s via `onFrame`. Handles permission-denied / no-camera gracefully
  and retries once on GPU-delegate failure (CPU fallback).
- `app/verify/page.tsx` — hosts the camera with a live signal readout panel
  (landmark count, yaw/pitch/roll, blink/jaw/smile blendshapes), with React
  state updates throttled to ~10/s while detection runs at full rate.

**Fixes during the task**

- Typed the overlay landmarks as `NormalizedLandmark[]` to satisfy
  `DrawingUtils.drawConnectors`.
- Set `outputFileTracingRoot` in `next.config.mjs` to this project directory to
  resolve a "multiple lockfiles" warning caused by a stray parent-folder
  lockfile (also ensures correct Vercel file tracing).

**Verification**

- `npm test` → 19/19 pass (added 8 parser tests).
- `npm run build` → compiles; `/verify` route built (3.18 kB).
- **Manual/live:** the webcam loop + mesh overlay require a real browser +
  camera and will be exercised during live demo testing in Task 10; they cannot
  run headless in this environment.

---

## Task 3 — Active liveness signal extractors

**Goal:** Turn blendshape/pose streams into robust, debounced detectors for the
discrete actions a liveness challenge asks for.

**What was done**

- `lib/liveness/actions.ts`:
  - `LivenessAction` union + `ALL_ACTIONS`: blink, nod, smile, open_mouth,
    turn_left, turn_right, look_up.
  - Two reusable detector kinds behind one `createActionDetector(action)` API:
    - **edge** (blink, nod): counts pulses — scalar rises above `high`, then
      falls below `low`. Blink defaults to 2 pulses; nod to 1.
    - **sustain** (smile, open_mouth, turns, look_up): scalar must stay beyond
      a threshold for `holdMs` (400 ms) to defeat momentary noise.
  - `ACTION_SPECS` holds tuned thresholds; `ACTION_PROMPTS`/`ACTION_LABELS`
    provide fallback instruction text (used if the LLM is unavailable).
  - Signal mapping documented, incl. the yaw-sign convention
    (`yaw > 0` = subject turns to their left) and nod = downward-pitch pulse.
  - Detectors handle missing faces: sustain progress resets; edge detectors
    don't count while no face is present. `overrides` allow per-challenge
    `count`/`holdMs`.
- `lib/liveness/actions.test.ts` — 12 tests: rest produces no false fire, two
  blinks satisfy / one doesn't, custom count override, sustain requires the
  full hold, hold resets on drop, turn-left fires on positive yaw but not
  negative, mouth-open fires, and no-face handling for both detector kinds.
- `app/verify/page.tsx` — added a live `ActionGrid`. Detectors update at full
  frame rate inside `onFrame` (critical for accurate blink edges); React render
  state is throttled to ~12/s. Edge detectors auto-reset ~1 s after satisfying
  so the live demo can repeat an action.

**Verification**

- `npm test` → 31/31 pass (12 new).
- `npm run build` → compiles; `/verify` route 4.05 kB.

---

## Task 4 — Passive filter/deepfake signal extractors

**Goal:** Score how "live human" a feed looks without any challenge, using
temporal statistics and skin-texture analysis, to catch static images,
replayed video, AR filters, and over-smoothed deepfakes.

**What was done**

- `lib/liveness/texture.ts` — pure image metrics:
  - `laplacianVariance()` — high-frequency-energy / sharpness proxy; filters and
    upscaled fakes over-smooth skin and drop this.
  - `shannonEntropy()` — intensity-histogram entropy (bits).
  - `rgbaToGray()` (Rec. 601 luma) and `computeTextureSample()`.
- `lib/liveness/texture.test.ts` — 11 tests: flat image → 0 variance;
  checkerboard high and > gradient; entropy 0 / 1-bit / 8-bit cases; RGBA→gray.
- `lib/liveness/passive.ts`:
  - `bandScore()` — trapezoidal scorer (0 outside a band, 1 in the sweet spot),
    the shared primitive for "natural range" checks.
  - `createPassiveAnalyzer()` — rolling window (30 frames) producing a
    `humanScore` (0..1) from four sub-scores:
    - **meshStability**: mean landmark displacement in a natural micro-jitter
      band (frozen → low; erratic → low).
    - **poseVariance**: combined yaw/pitch/roll stddev (static replay → ~0).
    - **expressiveness**: mean temporal stddev of key blendshapes
      (micro-expressions; a frozen face → ~0).
    - **texture**: Laplacian-variance band + normalized entropy (filter
      smoothing → low).
  - Weighted combo (mesh .30 / pose .20 / expr .25 / texture .25); weights
    **renormalize** when texture is unavailable. Sub-scores stay neutral (0.5)
    until ≥3 samples so startup doesn't false-fail. Face-loss breaks temporal
    continuity so a gap isn't read as a huge jump.
- `lib/liveness/passive.test.ts` — 10 tests incl. frozen feed → low score,
  lively synthetic feed → high score, over-smoothed texture penalized,
  weight renormalization, and face-gap handling.
- `components/CameraView.tsx` — added `sampleFaceTexture()`: downsamples the
  face bounding box to a 64×64 grayscale patch on a **detached** canvas and
  computes a `TextureSample` each frame; `onFrame` now passes `(frame, texture)`.
  Guards against tainted-canvas `getImageData` throws.
- `app/verify/page.tsx` — runs the analyzer each frame and renders a live
  "Passive Filter / Deepfake Check" panel: overall human-likeness % (color
  toned) plus the four sub-score bars.

**Note on calibration:** the texture/jitter band constants are documented
defaults. Absolute values depend on camera/lighting, so they get a live tuning
pass in Task 10; the relative behavior (live vs. static/filtered) is what the
tests lock in.

**Verification**

- `npm test` → 48/48 pass (21 new across texture + passive).
- `npm run build` → compiles; `/verify` route 5.69 kB.

---

## Plan revision (after design review)

Based on feedback, the project pivoted to a tighter, **fully on-device** design:

- **No cloud AI.** Removed the Luminal client and the `/api/challenge` route.
  All face/liveness analysis runs in-browser via MediaPipe. The only server
  piece left (coming up) is JWT signing for the proof-of-liveness token.
- **Rule-based verdict.** Pass/fail will be deterministic threshold code; any
  text explanation is template-based (no model in the decision path).
- **Passive = landmark-only.** Dropped FFT/texture-entropy; mesh jitter is the
  primary passive signal (plus pose variance and expressiveness).
- **Occlusion/profile challenges** (hand-over-face, touch-nose, side profile)
  are the headline anti-deepfake feature, detected on-device.
- **Deploy early/often** to Vercel; **redirect** (not iframe) to the mock lobby;
  tests focused on token issue/verify. Stop at each testable feature.

## Task 11 — Refactor to on-device only

**What was done**

- Deleted `lib/llm/json.ts`, `lib/llm/luminal.ts`, `lib/liveness/texture.ts`,
  `lib/liveness/challengeClient.ts`, `app/api/challenge/route.ts`, and their
  tests; removed the now-empty `lib/llm` and `app/api` directories.
- Rewrote `lib/liveness/challenge.ts` to a local generator:
  `generateChallenges(count, seed?, pool?)` — Fisher-Yates shuffle (seedable),
  no network. Kept the `Challenge` type and sequence constants.
- Simplified `lib/liveness/passive.ts` to landmark-only: sub-scores
  meshStability / poseVariance / expressiveness (weights .45/.30/.25), and now
  exposes raw `meshJitter` for the upcoming debug panel. `update(frame)` no
  longer takes a texture argument.
- Updated `components/CameraView.tsx`: removed face-region texture sampling and
  the detached sampling canvas; `onFrame` is back to `(frame)`.
- Updated `app/verify/page.tsx`: dropped the texture sub-score bar; passive
  panel shows the three landmark signals.
- Updated `.env.example` to only `LIVENESS_TOKEN_SECRET` (no cloud keys).
- Fixed landing-page copy to "100% on-device".

**Verification**

- `npm test` → 37/37 pass (removed texture/LLM tests; passive tests updated).
- `npm run build` → compiles; `/verify` 5 kB; no `/api/challenge` route.

**How to test this feature live:** run `npm run dev`, open
`http://localhost:3000/verify`, allow the camera, and confirm the face mesh,
action grid, and the (now 3-bar) passive panel still respond. A static image
held to the camera should drive the passive human-likeness % down.

---

## Task 12 — Vercel deploy prep

**What was done**

- Added response headers in `next.config.mjs` (applied locally and on Vercel):
  `Permissions-Policy: camera=(self), microphone=()` so the webcam is allowed,
  plus `X-Content-Type-Options` and `Referrer-Policy`.
- Wrote `DEPLOY.md` with two deploy paths (GitHub import — recommended, since
  the repo is already linked to `RJC862/are-you-human` — and the Vercel CLI),
  how to generate `LIVENESS_TOKEN_SECRET`, local dev notes (localhost is a
  secure context so the webcam works without HTTPS), and a post-deploy
  checklist (allow camera, confirm mesh overlay, test on mobile).

**Why now:** the webcam needs HTTPS; deploying early de-risks the demo. Deploy
is a user action (Vercel login required); everything is configured so it's a
few clicks.

**Verification**

- `npm run build` → compiles cleanly with the new headers config.
- Live verification is the user's post-deploy checklist in `DEPLOY.md`.

---

## Task 13 — Hand Landmarker + occlusion/profile/hand-wave challenges

**Goal:** Add the challenges that actually defeat live deepfakes and filters —
hand-over-face occlusion, touch-nose, and full side profile — detected
entirely on-device.

**What was done**

- `lib/landmarks/handLandmarker.ts` — browser-only MediaPipe Hand Landmarker
  loader (VIDEO mode, up to 2 hands), dynamically imported.
- Extended `FaceFrame` with optional `hands?: RawLandmark[][]` (21-pt hands in
  the same normalized space as the face mesh).
- `lib/liveness/geometry.ts` — pure helpers: `boundingBox`, `overlapRatio`
  (intersection / smaller-box area), `pointInBox`, `dist2D`,
  `minHandPointDistance`. Tested in `geometry.test.ts` (12 tests).
- `lib/liveness/actions.ts` — three new actions + a "custom" detector kind:
  - **turn_profile** (sustain on `|yaw|` > 35°): a full side profile.
  - **touch_nose** (custom): index fingertip within 0.09 of the nose tip
    (face mesh indices 1/4), held ~150 ms.
  - **hand_wave** (custom, the key one): a state machine requiring
    *face visible → hand overlaps the face box AND face tracking drops →
    face recovers*. A live face-swap/filter renders the face on top of the
    hand, so the face is never actually occluded and this **fails** — exactly
    the discriminator we want. Added `HAND_ACTIONS` and `ANTI_SPOOF_ACTIONS`
    exports for the engine to prioritize.
- `components/CameraView.tsx` — runs the Hand Landmarker alongside the face
  model each frame, attaches `frame.hands`, and draws hand skeletons (green)
  over the mesh. Hand detection is optional/non-blocking: if its model fails to
  load the app still runs (those two challenges just won't fire).
- Added detector tests for turn_profile, touch_nose (fires on touch; not when
  far or no hands), and hand_wave (fires on the occlusion sequence; does NOT
  fire when the face keeps tracking through the hand — the deepfake case).

**Verification**

- `npm test` → 53/53 pass (geometry + new detector tests added).
- `npm run build` → compiles; `/verify` 5.87 kB.

**How to test this feature live:** `npm run dev` → `/verify`. You should now see
green hand skeletons when a hand is visible, and the action grid includes
"Profile", "Touch nose", and "Hand wave". Wave a hand across your face and watch
the mesh briefly drop then recover (hand_wave satisfies); touch your nose
(touch_nose); turn fully sideways (turn_profile). These are the ones to point a
filtered/deepfaked feed at later — they should NOT pass.

---

## Task 14 — Verification engine (guided round flow)

**Goal:** Orchestrate a full guided session: present each challenge, detect it
within a timeout, aggregate per-round results and passive stats.

**What was done**

- `lib/liveness/engine.ts` — `createVerificationEngine(challenges, options)`:
  - Pure state machine driven by `update(frame)` (clock = `frame.timestamp`).
  - Per round: a short **ready cooldown** (default 800 ms, shown as a countdown)
    so an action in progress can't bleed into the next round, then the matching
    detector runs until it satisfies (**pass**) or the challenge `timeoutMs`
    elapses (**fail**); then it advances.
  - Owns a passive analyzer and tracks session-wide stats: latest + **minimum**
    human-likeness and mesh jitter (the minima catch a feed that was ever
    static/photo-like).
  - `getSignals()` returns the aggregate `SessionSignals` (rounds, passed count,
    anti-spoof passed/total, duration, passive scores) that the rule-based
    verdict (Task 15) will consume.
- `lib/liveness/engine.test.ts` — 7 tests: starts active, ignores detection
  during cooldown, passes on action, fails on timeout, advances through rounds
  in order, tracks anti-spoof counts + passive stats, resets to idle.
- `app/verify/page.tsx` — rebuilt as the guided flow: a “Begin Verification”
  button, a live challenge overlay on the camera (step X/N, "anti-deepfake"
  tag, get-ready countdown, big prompt, progress bar), a per-round pass/fail
  list, a passive human-likeness readout, a completion card, and a Reset button.
  Each sequence is guaranteed to include at least one anti-spoof action.

**Verification**

- `npm test` → 60/60 pass (7 engine tests added).
- `npm run build` → compiles; `/verify` 6.95 kB.

**How to test this feature live:** `npm run dev` → `/verify` → “Begin
Verification”. Follow the prompts (smile, turn, wave hand, etc.). Each round
shows a get-ready countdown, then detects your action or times out, then moves
on; the right panel logs pass/fail and the session ends with an X/N summary.

---

## Task 15 — Rule-based verdict + template explanation

**Goal:** Decide human/not-human with deterministic rules (no AI in the
decision), and explain the result in plain language from templates.

**What was done**

- `lib/liveness/verdict.ts`:
  - `decide(signals): Verdict` — four rules, all must hold:
    1. **Challenges** — at most one missed round (`passed >= total - 1`).
    2. **Anti-spoof** — if any anti-spoof actions were included, ≥1 passed.
    3. **Motion** — `minMeshJitter > 0.0006` (rejects photos/paused video).
    4. **Passive** — `passiveMinHumanScore >= 0.35` (rejects filter/deepfake
       signatures).
    Returns `isHuman`, a blended `confidence` (0..1), and a structured
    `reasons[]` checklist. Thresholds are exported constants (tunable).
  - `explain(verdict, signals): string` — deterministic template text that
    *reports* the decision (cites counts and the specific failing reasons);
    it can never change the decision. No model call.
- `lib/liveness/verdict.test.ts` — 10 tests: clean pass, one-miss allowed,
  too-many-missed fail, static-jitter fail, anti-spoof fail, low-passive fail,
  no-anti-spoof-required case, and explanation wording/counts.
- `app/verify/page.tsx` — computes the verdict exactly once on completion
  (via `engine.getSignals()`), and renders a `VerdictCard`: PASS/FAIL badge,
  confidence bar, the plain-language explanation, and the reasons checklist,
  plus Run Again. (The "continue to lobby" token button comes in Task 16.)

**Why rules, not an LLM:** language models are inconsistent at judging numbers
and could flip a verdict between identical runs — unacceptable during a live
demo. Deterministic thresholds guarantee the same inputs always yield the same
verdict.

**Verification**

- `npm test` → 70/70 pass (10 verdict tests added).
- `npm run build` → compiles; `/verify` 7.88 kB.

**How to test this feature live:** `npm run dev` → `/verify` → complete a run.
A real human doing the actions should get “HUMAN VERIFIED” with a high
confidence; sitting still / holding a photo (fails motion + challenges) should
get “NOT VERIFIED” with an explanation naming the static-feed reason.

---

## Task 16 — Proof-of-liveness token + mock lobby (serverless, redirect)

**Goal:** Turn a PASS into a verifiable, embeddable credential a consumer app
can require — the "third-party authenticator" story — using a redirect (not an
iframe) to a mock meeting lobby.

**What was done**

- `lib/auth/token.ts` (server-only, `jose` HS256, secret from
  `LIVENESS_TOKEN_SECRET` with an insecure dev fallback):
  - `issueSessionNonce()` / `verifySessionNonce()` — short-lived (5 min) session
    nonce; the liveness token is bound to it, so a token can't be minted without
    first opening a server session.
  - `issueLivenessToken()` / `verifyLivenessToken()` — 10-min proof token with
    `isHuman` + `confidence` claims and a type tag.
  - `hasConfiguredSecret()` for a prod warning.
- Serverless routes (nodejs runtime):
  - `POST /api/session` → `{ nonce }`.
  - `POST /api/issue-token` → validates the nonce, requires `isHuman === true`,
    returns `{ token }` (401 bad session / 403 not passed).
  - `POST /api/verify-token` → `{ valid, claims }` for consumers.
- `app/lobby/page.tsx` — a mock "Daily Standup" meeting lobby that reads
  `?token=` from the URL, verifies it via `/api/verify-token`, and shows
  admitted / rejected / no-token states.
- `app/verify/page.tsx` — opens a session (nonce) on Begin; on a PASS, requests
  a token and shows a "Continue to the meeting lobby →" link
  (`/lobby?token=…`). Token failure is non-fatal (verdict still shows).
- `lib/auth/token.test.ts` — 7 tests (node env via `@vitest-environment node`,
  since `jose` needs `crypto.subtle`): nonce + liveness round-trips, tamper
  rejection, expiry rejection, and token-type-mismatch rejection.

**HONEST TRUST MODEL (documented):** detection is on-device and the browser
reports its verdict to `/api/issue-token`, so the server trusts the client's
claim. The nonce binding raises the bar but doesn't fully close it; a judge
could forge a PASS via dev tools. Production would verify pixels server-side /
in a trusted enclave. This limitation goes in the README (Task 19).

**Verification**

- `npm test` → 77/77 pass (7 token tests added).
- `npm run build` → compiles; `/api/session`, `/api/issue-token`,
  `/api/verify-token`, `/lobby` (1.33 kB), `/verify` (8.3 kB) all built.

**How to test this feature live:** set `LIVENESS_TOKEN_SECRET` (or rely on the
dev fallback), `npm run dev`, complete a PASS on `/verify`, click "Continue to
the meeting lobby" → `/lobby` admits you with the confidence shown. Visiting
`/lobby` directly (no token) shows the "pass required" gate.

---

## Task 17 — Adversarial demo mode

**Goal:** Run the exact same pipeline against a non-live feed (a recorded
replay, a photo on a phone screen, or a filtered clip) to show it fail — the
money shot for judges.

**What was done**

- Reused `CameraView`'s existing `videoSrc` prop (no camera when a video source
  is set; loops the clip).
- `app/verify/page.tsx` — added a `DemoControls` source toggle:
  - **Live camera** (default) and **Replay / filter demo** (file picker,
    `accept="video/*"`). The chosen file becomes an object URL fed to
    `CameraView` (unmirrored); switching sources revokes the old URL and resets
    the engine. A placeholder prompts for a file until one is chosen.
  - `CameraView` is keyed by source so the detection loop restarts cleanly on
    switch; the Begin overlay is suppressed until a source is ready.
- The same engine/verdict/token path runs on the clip. A replay can't respond
  to randomized prompts ("turn left now", "wave your hand") so challenge rounds
  time out; a static photo additionally collapses mesh jitter → the motion rule
  fails. Either way the verdict is NOT VERIFIED with a reason.

**Why upload instead of a bundled sample:** per the demo plan, the strongest,
rights-safe clips are ones the team records themselves (a 20s replay, a photo on
a phone, a beauty-filtered selfie). The uploader accepts any of these; no
third-party or binary asset is shipped.

**Verification**

- `npm test` → 77/77 pass (no logic changes; UI wiring).
- `npm run build` → compiles; `/verify` 8.84 kB.

**How to test this feature live:** `npm run dev` → `/verify` → “Replay / filter
demo” → pick a short clip of a face (or record one). Press Begin: it should fail
the randomized challenges (and, for a still photo, the motion/static rule),
ending in NOT VERIFIED. Switch back with “Live camera”. Record these clips early
so thresholds can be tuned against real attacks (debug panel next).
