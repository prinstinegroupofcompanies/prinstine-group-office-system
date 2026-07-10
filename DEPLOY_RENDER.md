# Render Backend Deployment

**Backend URL:** https://prinstine-pms-backend.onrender.com

This guide deploys the Node.js API (`server/`) on Render with persistent SQLite storage.

## 1) Pre-deployment backup (required)

From project root:

```bash
mkdir -p safe-backups
cp database/pms.db safe-backups/pms-$(date +%Y%m%d-%H%M%S).db
```

Keep this backup outside the deployment server.

## 2) Create backend on Render

This repo includes `render.yaml` with:

- Persistent disk at `/var/data`
- `DB_PATH=/var/data/pms.db`
- `UPLOADS_DIR=/var/data/uploads`
- Health endpoint `/api/health`

### Setup steps

1. Push this repository to GitHub.
2. In Render, create a new **Blueprint** from the repo (reads `render.yaml`).
3. Set environment variables on the backend service:
   - `JWT_SECRET` — long random string
   - `ENCRYPTION_KEY` — 32+ characters
   - `ADMIN_DEFAULT_PASSWORD` — strong password for the initial admin account
   - `SYSTEM_ACCESS_ENABLED=true` — enable logins on the deployed backend
   - `FRONTEND_URL` — your Vercel domain (e.g. `https://prinstinemanagementsystem.com`)
   - `EMAIL_*` — if you use email features
   - `DATABASE_URL` — if using PostgreSQL (optional; SQLite uses disk path above)
4. Deploy once so the service and disk are created.

### Move SQLite data to Render disk

After first deploy:

1. Open **Render Shell** for the backend service.
2. Upload your backup `pms.db` to the shell.
3. Place it at `/var/data/pms.db`.
4. Restart the backend service.

### Move uploaded files (recommended)

```bash
mkdir -p /var/data/uploads
# Copy local uploads/ contents into /var/data/uploads
```

Restart the service after copying.

## 3) PostgreSQL (optional)

For production PostgreSQL on Render:

1. Create a **PostgreSQL** instance in Render.
2. Copy the **Internal Database URL** into `DATABASE_URL` on the backend service.
3. Redeploy the backend.

## 4) Connect CORS to frontend

In Render backend environment:

```
FRONTEND_URL=https://prinstinemanagementsystem.com
```

Redeploy after changing.

## 5) Verification

1. Open `https://<your-backend>/api/health` — should return success JSON.
2. Test login from the Vercel frontend.
3. Create a record, restart the backend, confirm data persists (disk working).

## 6) Expected startup logs (Render)

| Message                          | Meaning                                                                   |
| -------------------------------- | ------------------------------------------------------------------------- |
| `Using SQLite database`          | Normal if `DATABASE_URL` is not set; data lives on the disk at `DB_PATH`. |
| `Email configuration not found`  | Optional; set `EMAIL_*` env vars to enable mail.                          |
| `API-only mode: no client/build` | Normal — frontend is on Vercel, not bundled with the API service.         |
| `Your service is live`           | Backend is healthy; test `/api/health`.                                   |

To use **PostgreSQL** instead of SQLite, add Render’s `DATABASE_URL` to the backend service and redeploy.

## 7) Important notes

- Do not store SQLite on ephemeral filesystem; use `DB_PATH=/var/data/pms.db`.
- Keep uploads on `UPLOADS_DIR=/var/data/uploads`.
- Free tier spins down after ~15 minutes of inactivity; first request may take 30–50 seconds (cold start).
- Schedule regular backups of `/var/data/pms.db`.

See [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md) for frontend deployment.
