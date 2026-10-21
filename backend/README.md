# Backend - Web3 Authentication API (TypeScript)

This is the Node.js + TypeScript backend for the Web3 authentication demo. Part of the Do Not Stop full-stack Web3 application.

## Features

- **Nonce Generation**: Generates unique nonces for message signing
- **Signature Verification**: Verifies Ethereum signatures using ethers.js
- **JWT Authentication**: Issues JWT tokens upon successful verification
- **Protected Routes**: Example protected endpoints that require JWT
- **User Management**: Simple in-memory user storage (use database in production)
- **CORS Enabled**: Cross-origin requests from frontend
- **Health Monitoring**: Health check endpoints for monitoring
- **TypeScript**: Full type safety with strict configuration
- **Hot Reload**: Automatic restart on file changes with tsx
- **Type-safe Routes**: Express routes with proper TypeScript types

## API Endpoints

### Root
- `GET /` - API information and available endpoints

### Authentication (`/api/auth`)
- `GET /api/auth/nonce` - Get a nonce for signing
- `POST /api/auth/verify` - Verify signature and get JWT token

### Protected Routes (`/api/protected`)
- `GET /api/protected/profile` - Get user profile (requires JWT)
- `GET /api/protected/users` - Get all users (requires JWT)

### Health Check (`/api/health`)
- `GET /api/health` - Server health status

### GraphQL game data (`/graphql`)
- `POST /graphql` - JWT-protected roster/battle reads (the v2 `opponents`
  matchmaking query and the `winEstimate` pre-fight odds query). Reads what
  `indexer-go` writes; see [API.md](./API.md#graphql--game-data-v2) for the
  schema, the v2 pet fields, and the `INDEXER_GRPC_ADDR` / `ROSTER_READ_SOURCE`
  env vars + the Prisma migration prerequisite.

## Setup

### Automated (Recommended)
From the project root:
```bash
# Install all dependencies and start everything
pnpm install
pnpm dev
```

### Manual Setup
1. **Install dependencies**:
   ```bash
   cd backend
   pnpm install
   ```

2. **Set environment variables**:
   ```bash
   cp env.example .env
   # Edit .env with your JWT secret
   ```

3. **Start the server**:
   ```bash
   # Development (TypeScript with hot reload)
   pnpm dev
   
   # Production (compiled JavaScript)
   pnpm start
   
   # Build TypeScript
   pnpm build
   ```

The server will run on `http://localhost:3001`

### From Project Root
```bash
# Start backend only
pnpm dev:be

# Or start everything
pnpm dev
```

## Environment Variables

- `JWT_SECRET`: Secret key for JWT signing (required)
- `PORT`: Server port (default: 3001; Render sets this automatically)
- `CORS_ORIGIN`: Optional comma-separated allowed origins for production CORS

See [`env.example`](./env.example) for the full list (indexer link, AI dialogue,
Helius webhooks, the settle keeper's `KEEPER_*` vars — see
[API.md](./API.md#relevant-environment-variables)).

## Deploy to Render

This repo includes a [`render.yaml`](../render.yaml) blueprint at the monorepo root.

### Option A — Blueprint (recommended)

1. Push the repo to GitHub/GitLab.
2. In [Render](https://render.com), click **New → Blueprint** and connect the repo.
3. Render creates a **Web Service** named `do-not-stop-api` with:
   - **Build:** `pnpm install --frozen-lockfile && pnpm --filter backend build`
   - **Start:** `pnpm --filter backend start`
   - **Health check:** `/api/health`
4. `JWT_SECRET` is auto-generated; override it in the service **Environment** tab if needed.
5. Copy the service URL (e.g. `https://do-not-stop-api.onrender.com`) into your frontend:
   ```bash
   VITE_API_URL=https://do-not-stop-api.onrender.com
   ```
6. Optional: set `CORS_ORIGIN` on Render to your frontend URL(s).

### Option B — Manual Web Service

| Setting | Value |
|--------|--------|
| Root Directory | *(leave empty — monorepo root)* |
| Runtime | Node |
| Build Command | `HUSKY=0 pnpm install --frozen-lockfile --filter backend... && pnpm --filter backend build` |
| Start Command | `pnpm --filter backend start` |
| Health Check Path | `/api/health` |

Add environment variables: `JWT_SECRET` (required), `NODE_ENV=production`, and optionally `CORS_ORIGIN`.

### Verify

```bash
curl https://YOUR-SERVICE.onrender.com/api/health
```

### Troubleshooting

| Symptom | Fix |
|--------|-----|
| `tsc` / `@types/*` not found | Remove `NODE_ENV=production` from Render **Environment** (it skips devDependencies during install). Use the updated `render.yaml` — `NODE_ENV` is only set at **start**, not build. |
| `pnpm: command not found` | Ensure root `package.json` has `"packageManager": "pnpm@9.15.9"` — Render installs pnpm via Corepack automatically. Do **not** run `corepack prepare` in the build command (Render's `/usr/bin` is read-only). |
| `husky` / `prepare` script failed | Set `HUSKY=0` in Render environment (included in `render.yaml`). |
| Lockfile errors | Ensure `pnpm-lock.yaml` is committed at the repo root. |
| Wrong root | **Root Directory** must be empty (repo root), not `backend`. |

## Deploy to Vercel

The backend can also run as one Vercel function. [`vercel.json`](./vercel.json) holds the
build settings. The code a serverless host needs is in `src/serverless/`, and
`scripts/bundle-vercel.cjs` bundles it with the Express app into one file.

### Project settings

| Setting | Value |
|--------|--------|
| Root Directory | `backend` |
| Framework Preset | Other (`vercel.json` sets `"framework": null`) |
| Include files outside the root directory in the Build Step | On (the install runs from the monorepo root) |

Build and install commands come from `vercel.json`. Leave them empty in the dashboard.

### Environment variables

Copy the variables Render uses, then set these:

| Variable | Value |
|--------|--------|
| `DATABASE_URL` | The Supabase **pooler** URL on port 6543, ending in `?pgbouncer=true&connection_limit=1`. Every function instance opens its own connection. |
| `CRON_SECRET` | A long random string. Vercel sends it to the scheduled jobs; without it, they refuse every call. |
| `KEEPER_ENABLED` | `false`. The settle keeper needs a long-running process. Players are asked to finish a breed or mint themselves after about 45 seconds. |
| `REDIS_URL` | Optional: a hosted Redis, such as Upstash. Keeps the dialogue cache across instances. |

Before the first deploy, create the `auth_nonce` table:

```bash
pnpm --filter backend prisma:migrate
```

Without it, `GET /api/auth/nonce` fails, so nobody can log in. This applies to Render too.

### How the long-running parts work here

| Part | On Render | On Vercel |
|--------|--------|--------|
| Login nonces | `auth_nonce` table | The same table, so any instance can check a nonce another one issued. |
| Battle signer | Set up at server start | Set up on the first request of each instance (`src/serverless/runtime.ts`). |
| Battle worker | Timer, every 2 seconds | Runs after a battle accept and after each battle state read, which the client polls while it waits (`src/serverless/handler.ts`). It waits for a step due within 8 seconds, such as the drand round. A daily job at `/api/cron/battle-worker` is a backup. |
| Batch anchor | Timer | Daily job at `/api/cron/battle-anchor`. On a paid plan, run it more often by changing the schedule in `vercel.json`. |
| Settle keeper | Timer, if `KEEPER_ENABLED` | Off. See `KEEPER_ENABLED` above. |
| WebSockets | Battle room and chat | Not available on Vercel functions. Battles and chat fall back to polling every 5 seconds. |
| Rate limits | One count per server | One count per instance, so they are weaker. |

### Running on Render and Vercel together

If both use the same database, run the batch anchor and the settle keeper on only one of
them. Both send blockchain transactions, and two copies would send duplicates. Two battle
workers are safe, since the queue lock gives each message to one worker.

### Verify

```bash
curl https://YOUR-PROJECT.vercel.app/api/health
curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-PROJECT.vercel.app/api/cron/battle-worker
```

The second call answers `{"processed":0}` when no battle is waiting.

### Troubleshooting

| Symptom | Fix |
|--------|-----|
| `Cannot read properties of undefined (reading 'fsPath')` | The root `.vercelignore` is removing `backend/`. Do not list `backend/` there. |
| `GET /api/auth/nonce` answers `500`, so nobody can log in | The `auth_nonce` table is missing. Run the migration above. |
| Battles stay at `accepted` | Check the function logs for `[battle-signer]` and `[battle-worker]` lines. |
| Battles stop at `computed`, then forfeit | `INDEXER_GRPC_ADDR` is not set, so the independent verifier cannot run. |
| Scheduled jobs answer `401` | `CRON_SECRET` is not set in the Vercel project. |

## How It Works

1. Frontend requests a nonce from `/api/auth/nonce`
2. User signs a message containing the nonce
3. Frontend sends address, signature, and nonce to `/api/auth/verify`
4. Backend verifies the signature matches the address
5. If valid, backend issues a JWT token
6. Frontend uses JWT token for authenticated requests
