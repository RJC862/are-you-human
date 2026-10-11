# Are You Human? — Live Liveness Check

A browser-based liveness checker that asks you to complete a **randomized
sequence of 5 challenges** — each with a **5-second countdown** — and verifies
them live with on-device computer vision.

Built for the YC "Requests for Startups" theme *Proving you're human*.

## Challenges

Each check randomly picks **5 distinct** challenges from this pool, verified
with MediaPipe Face + Hand Landmarks:

- **Head pose:** turn head left, turn head right, look up, tilt head to the
  left shoulder, tilt head to the right shoulder
- **Expressions:** blink, smile, open mouth, raise both eyebrows, purse lips,
  squint
- **Hand + face:** touch your nose, touch your chin, touch your forehead, cover
  your mouth with one hand, hold your hand in front of your face

Each challenge has a brief get-ready moment, then a 5-second window to perform
it. All 5 must pass for a HUMAN VERIFIED result.

## What it does

- Runs **MediaPipe Face Landmarker + Hand Landmarker** in the browser (no video
  ever leaves your device).
- Generates a random challenge sequence and guides you through it one step at a
  time with a get-ready countdown and a 5-second window per challenge.
- Shows **pass/fail per challenge** and a final **PASS / FAIL** result screen.
- Uses the **Luminal LLM** *only* to phrase the on-screen instructions and the
  short result explanation. The pass/fail decision is made by deterministic
  rules in code — the model never changes the verdict. If the LLM is
  unavailable, hardcoded text is used instead.
- Hidden **debug panel** (press `D`) with live signal values for tuning.

## What it does and doesn't catch (honest pitch)

- **Stops** static-photo and simple replay attacks: a photo or a recorded clip
  can't follow a randomized, on-the-spot sequence of actions within the time
  limit.
- **Makes harder, but does not fully stop,** a real-time face-swap deepfake that
  mirrors the attacker's own movements. This is a liveness/challenge check, not
  a deepfake classifier. The hand challenges (cover mouth, hand in front of
  face) are the hardest for 2D filters/deepfakes to fake convincingly.
- The verdict is computed **in the browser**; this demo trusts the client. A
  production system would move verification server-side (or into a trusted
  enclave) and add anti-tamper measures.

## Tech

- Next.js (App Router) + TypeScript + Tailwind
- `@mediapipe/tasks-vision` (Face + Hand Landmarker, VIDEO mode)
- One serverless route (`/api/text`) that calls a Luminal-hosted,
  OpenAI-compatible model for instruction/explanation copy (optional)

## Run locally

```bash
npm install
npm run dev     # http://localhost:3000  (localhost is a secure context, so
                # the webcam works without HTTPS locally)
```

Open `/verify`, allow the camera, and press **Begin check**.

### Optional LLM text

Create `.env.local` to let the LLM phrase instructions/explanations (otherwise
hardcoded text is used — see `.env.example`):

```
LUMINAL_API_KEY=...
LUMINAL_BASE_URL=https://api.luminal.ai/v1
LUMINAL_MODEL=deepseek-chat
```

## Deploy

See [DEPLOY.md](./DEPLOY.md). The webcam requires HTTPS, which Vercel provides.

## Project layout

```
app/
  page.tsx            landing
  verify/page.tsx     the liveness check UI (+ hidden debug panel)
  api/text/route.ts   LLM copy, with hardcoded fallbacks
components/
  CameraView.tsx      webcam + Face/Hand Landmarker loop + overlay
lib/
  landmarks/          MediaPipe loaders, frame parsing, types
  liveness/           action detectors, challenge generator, engine, verdict
  llm/                Luminal client + text fetch helpers
```
