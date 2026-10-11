# Deploying "Are You Human?" to Vercel

The webcam requires **HTTPS**, which Vercel provides automatically. Deploy
early and redeploy after each feature so you never discover deploy problems
late. There are two ways to deploy — pick one.

> Note: all face/liveness detection runs **in the browser** (MediaPipe). The
> only server-side piece is JWT signing for the proof-of-liveness token, which
> needs one secret (`LIVENESS_TOKEN_SECRET`). Set it before using the token
> flow (Task 16); the app runs without it until then.

---

## Option A — Deploy from the GitHub repo (recommended)

The repo is already connected to `github.com/RJC862/are-you-human`.

1. Push your current branch (if you haven't):
   ```bash
   git add -A
   git commit -m "..."
   git push -u origin HEAD
   ```
2. Go to https://vercel.com/new and **Import** the `are-you-human` repo.
3. Framework preset: **Next.js** (auto-detected). Leave build/output defaults:
   - Build command: `next build`
   - Output: `.next`
   - Install command: `npm install`
4. Add the environment variable (Project → Settings → Environment Variables):
   | Name | Value | Environments |
   | --- | --- | --- |
   | `LIVENESS_TOKEN_SECRET` | a long random string (see below) | Production, Preview, Development |
5. Click **Deploy**. You'll get a live URL like `https://are-you-human.vercel.app`.
6. Every `git push` to the branch creates a fresh preview deploy automatically.

## Option B — Deploy with the Vercel CLI

```bash
npm i -g vercel          # once
vercel login             # once
vercel                   # first run: link/create the project (follow prompts)
vercel env add LIVENESS_TOKEN_SECRET   # paste the secret when asked
vercel --prod            # promote to production
```

---

## Generating `LIVENESS_TOKEN_SECRET`

Any long, random string works. Generate one:

```bash
# Node (cross-platform)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

```powershell
# PowerShell
-join ((48..57)+(97..102) | Get-Random -Count 96 | ForEach-Object {[char]$_})
```

Paste the result as the env var value. Keep it secret; never commit it.

---

## Local development

```bash
npm install
npm run dev     # http://localhost:3000  (localhost is treated as a secure
                # context, so the webcam works without HTTPS locally)
```

Create a local `.env.local` (git-ignored) if you want the token flow locally:

```
LIVENESS_TOKEN_SECRET=dev-secret-change-me
```

---

## Post-deploy checklist (do this after the FIRST deploy)

- [ ] Open the live `https://…vercel.app/verify` URL.
- [ ] Browser prompts for camera permission → **Allow**.
- [ ] You see the live face mesh overlay and the signal panels update.
- [ ] Try on a phone too (mobile Safari/Chrome) — confirms HTTPS + camera work.

If the camera doesn't start on the live URL, check the browser console and the
`Permissions-Policy` response header (set in `next.config.mjs`).
