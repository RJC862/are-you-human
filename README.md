# Are You Human? — Live Liveness Check

A browser-based liveness checker that asks you to complete a short, **randomized
sequence of 3–5 challenges** (blink, smile, open your mouth, turn your head
left/right, touch your nose) — each with a **5-second countdown** — and verifies
them live with on-device computer vision.

Built for the YC "Requests for Startups" theme *Proving you're human*.

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
  a deepfake classifier.
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
