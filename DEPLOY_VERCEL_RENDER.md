# Deploy Guide: Vercel Frontend + Render Backend (No Data Loss)

**Production setup in use:**
- Frontend: **Vercel** → https://prinstinemanagementsystem.com (root directory: `client`)
- Backend: **Render** → https://prinstine-group-system.onrender.com

This guide deploys:
- Frontend (`client`) to Vercel
- Backend (`server`) to Render
- Existing SQLite data preserved using a Render persistent disk

## 1) Pre-deployment safety backup (required)

From project root:

```bash
mkdir -p safe-backups
cp database/pms.db safe-backups/pms-$(date +%Y%m%d-%H%M%S).db
```

Keep this backup file outside the deployment server.

## 2) Backend deploy on Render

This repo includes `render.yaml` with:
- persistent disk at `/var/data`
- `DB_PATH=/var/data/pms.db`
- `UPLOADS_DIR=/var/data/uploads`
- health endpoint `/api/health`

### Render setup

1. Push this repository to GitHub.
2. In Render, create a new **Blueprint** from the repo (it will read `render.yaml`).
3. Open backend service environment and set secret values:
   - `JWT_SECRET` (long random string)
   - `ENCRYPTION_KEY` (32+ chars)
   - `FRONTEND_URL` (your Vercel domain, e.g. `https://your-app.vercel.app`)
   - `EMAIL_*` values if you use email features
4. Deploy once so the service and disk are created.

### Move current SQLite data to Render disk

After first deploy, copy your local `database/pms.db` into the Render disk:

1. Open Render Shell for backend service.
2. Upload/transfer your backup db file to shell (or fetch from secure storage).
3. Place it at `/var/data/pms.db`.
4. Restart backend service.

The backend now uses that database permanently on the mounted disk.

### Move existing uploaded files (recommended)

If your system already has files in local `uploads/`, copy them to Render disk as well:

1. In Render Shell, create the uploads dir:
   - `mkdir -p /var/data/uploads`
2. Transfer your local `uploads/` folder contents into `/var/data/uploads`.
3. Restart backend service.

The backend startup links legacy `server/uploads` paths to `UPLOADS_DIR`, so existing code paths keep working while files remain persistent.

## 3) Frontend deploy on Vercel

This repo includes `client/vercel.json` with SPA rewrite to prevent 404 on deep links.

### Vercel setup

1. Import the repository in Vercel (GitHub: `prinstine-group-system`).
2. Configure project — use **one** of these options:

**Option A (recommended): Root Directory = `client`**

| Setting | Value |
|---------|--------|
| Root Directory | `client` |
| Framework Preset | Create React App |
| Build Command | `npm run build` |
| Output Directory | `build` |

**Option B: Root Directory = empty (repo root)**

Leave Root Directory blank. The repo root `vercel.json` builds `client/` and publishes `client/build`.

3. Add environment variables (Production) — **required for login/API**:
   - `REACT_APP_API_URL` = `https://prinstine-group-system.onrender.com`
   - Optional: `REACT_APP_SOCKET_URL` = `https://prinstine-group-system.onrender.com`

   **Important:** Create React App reads env vars at **build time**. After adding or changing them, you must **Redeploy** (new build). Saving env alone is not enough.

   The repo also includes `client/.env.production` with the same URL as a fallback if Vercel env is missing.

4. Deploy. Wait until status is **Ready** (not Error or Canceled).

### Fix login 405 / `REACT_APP_API_URL is not set`

If the browser console shows an empty API URL and `POST /auth/login` returns **405**, the frontend is calling Vercel instead of Render.

1. Set `REACT_APP_API_URL=https://prinstine-group-system.onrender.com` in Vercel → Environment Variables (Production).
2. **Redeploy** the project (Deployments → Redeploy).
3. Hard refresh https://prinstinemanagementsystem.com and try login again.
4. In DevTools → Network, login should go to `https://prinstine-group-system.onrender.com/api/auth/login`, not `prinstinemanagementsystem.com/auth/login`.
5. Add custom domain `prinstinemanagementsystem.com` under **Settings → Domains** and follow DNS instructions until status is **Valid**.

> **Important:** Git pushes update Render (API) automatically, but **Vercel must rebuild** to show new UI. After pushing code, open Vercel → Deployments → Redeploy if auto-deploy did not run.

### Fix Vercel `404: NOT_FOUND`

This error almost always means Vercel is not serving your React `build` folder.

1. **Check the latest deployment** (Vercel → Deployments):
   - Must be **Ready**, not Failed.
   - Open the deployment URL (`*.vercel.app`) — if that also shows 404, the build/output path is wrong.

2. **Fix Output Directory** (most common):
   - If Root Directory = `client` → Output Directory must be `build` (not `client/build`).
   - If Root Directory = empty → Output Directory must be `client/build`, or leave blank and use root `vercel.json`.

3. **Wrong Root Directory**:
   - Do not set Root Directory to `server` or `prinstine-management-system` unless that folder contains `package.json` with `react-scripts`.

4. **Custom domain**:
   - **Settings → Domains** → `prinstinemanagementsystem.com` must show **Valid**.
   - If Invalid, fix DNS at your registrar (Vercel shows required A/CNAME records).

5. **Redeploy** after fixing settings: Deployments → ⋮ → Redeploy.

## 4) Connect backend CORS to frontend

In Render backend env:
- Set `FRONTEND_URL=https://prinstinemanagementsystem.com`
- Redeploy backend.

## 5) Verification checklist

1. Backend health:
   - `https://<render-backend-domain>/api/health` returns success JSON.
2. Frontend loads from Vercel domain.
3. Login works.
4. Create/update records and reload page.
5. Confirm records still exist after backend restart (proves persistent disk is working).
6. Test direct route refresh in frontend (for example `/dashboard`) to confirm no 404.

## 6) Important notes

- Do not use Render ephemeral filesystem for SQLite; always keep `DB_PATH=/var/data/pms.db`.
- Keep uploads on persistent storage with `UPLOADS_DIR=/var/data/uploads`.
- Keep scheduled backups of `/var/data/pms.db`.
- If you later move to PostgreSQL, migrate only after a tested backup/restore drill.
