# Deploy Guide: Vercel Frontend + Render Backend (No Data Loss)

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

1. Import the repository in Vercel.
2. Configure project:
   - **Root Directory**: `client`
   - **Framework Preset**: Create React App
   - **Build Command**: `npm run build`
   - **Output Directory**: `build`
3. Add environment variables:
   - `REACT_APP_API_URL=https://<your-render-backend-domain>`
   - Optional: `REACT_APP_SOCKET_URL=https://<your-render-backend-domain>`
4. Deploy.

## 4) Connect backend CORS to frontend

In Render backend env:
- Set `FRONTEND_URL` to your Vercel production domain.
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
