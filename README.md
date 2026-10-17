# Brief Note
This project was for an 8-hour hackathon hosted by a club at Penn State. Purely vibe coded for fun. I didn't hand code anything.


# Try It out
[Are You Human](https://are-you-human-bay.vercel.app/)

[Demo Video](https://youtube.com/shorts/3r7IVzHaD6A?feature=share)

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
  your mouth with one hand

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
