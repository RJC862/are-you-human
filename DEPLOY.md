# Deploying "Are You Human?" to Vercel

The webcam requires **HTTPS**, which Vercel provides automatically. Deploy
early and redeploy after each feature.

> All face/hand liveness detection runs in the browser (MediaPipe). The only
> server-side piece is `/api/text`, which calls the Luminal LLM to phrase
> instructions and the result explanation. It is optional — the app uses
> hardcoded fallbacks if the Luminal env vars are absent or the call fails.

## Option A — Deploy from GitHub (recommended)

1. Commit and push your branch:
   ```bash
   git add -A && git commit -m "liveness checker" && git push -u origin HEAD
   ```
2. Go to https://vercel.com/new and import the `are-you-human` repo.
3. Framework preset: **Next.js** (auto-detected); keep defaults.
4. (Optional) add env vars for LLM text — Settings → Environment Variables:
   | Name | Value |
   | --- | --- |
   | `LUMINAL_API_KEY` | your key |
   | `LUMINAL_BASE_URL` | e.g. `https://api.luminal.ai/v1` |
   | `LUMINAL_MODEL` | e.g. `deepseek-chat` |
5. Deploy. You get a live URL like `https://are-you-human.vercel.app`.

## Option B — Vercel CLI

```bash
npm i -g vercel
vercel login
vercel            # link/create project
vercel --prod     # production deploy
```

## Local development

```bash
npm install
npm run dev       # http://localhost:3000 (localhost is a secure context, so
                  # the webcam works without HTTPS locally)
```

Optional `.env.local` for LLM text locally:
```
LUMINAL_API_KEY=...
LUMINAL_BASE_URL=https://api.luminal.ai/v1
LUMINAL_MODEL=deepseek-chat
```

## Post-deploy checklist

- [ ] Open `https://…vercel.app/verify`, allow the camera.
- [ ] Confirm the live face mesh overlay appears.
- [ ] Run a check end to end; try on a phone too (HTTPS + camera).
