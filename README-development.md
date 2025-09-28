# Development Guide

This document covers local development, testing, and release workflows for nextExplorer. For user-facing deployment instructions, see `README.md`.

## Project Layout
- `frontend/` – Vue 3 + Vite SPA (Pinia, TailwindCSS).
- `backend/` – Express server exposing the file-system API, thumbnail generation, uploads, and terminal bridge.
- `Dockerfile` – Multi-stage build that bakes the frontend into the backend image.
- `docker-compose.yml` – Two-service stack for running frontend and backend with live reload.
- `docker-compose.fullstack.yml` – Single container that ships the production bundle.

## Prerequisites
- Node.js 18 or later and npm 9 or later.
- FFmpeg installed locally (the Docker image installs it automatically).
- Docker Desktop / Docker Engine + Compose v2 if you plan to build or run containers.
- macOS/Linux with file-system permissions to mount your working directories under `/mnt` and `/cache`.

## Local Setup

### Backend API
```bash
cd backend
npm install
npm start
```

- `npm start` runs `nodemon app.js` and restarts on code changes.
- Environment variables:
  - `PORT` (default `3000`)
  - `VOLUME_ROOT` (default `/mnt`)
  - `CACHE_DIR` (default `/cache`, thumbnails in `${CACHE_DIR}/thumbnails`)
  - `AUTH_MODE` – optional. Set to `oidc` to force OpenID Connect, otherwise auto-detected based on the variables below.
  - `APP_BASE_URL` – the external base URL for callback redirects (defaults to `http://localhost:${PORT}`).
  - `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` – required when `AUTH_MODE=oidc` (or when auto-detecting OIDC).
  - `OIDC_REDIRECT_URI` – optional. Defaults to `${APP_BASE_URL}/api/auth/oidc/callback`.
  - `OIDC_POST_LOGOUT_REDIRECT_URI` – optional. Defaults to `${APP_BASE_URL}/auth/login`.
  - `OIDC_SCOPE` – optional scopes (default `openid profile email`).
  - `OIDC_PROMPT`, `OIDC_RESPONSE_MODE`, `OIDC_PROVIDER_NAME` – advanced overrides for the authorization request and UI copy.
- Ensure the process user can read/write the directories pointed to by `VOLUME_ROOT` and `CACHE_DIR`.

### Frontend SPA
```bash
cd frontend
npm install
cp .env.example .env  # adjust VITE_API_URL if the backend runs on a different host/port
npm run dev
```

### OpenID Connect mode

When the backend boots with valid `OIDC_*` credentials it issues short-lived session tokens after a user completes an authorization-code flow. The SPA stores that session token just like the original password-based gate, so no additional frontend configuration is required beyond pointing `VITE_API_URL` at the backend. You can return to password mode by unsetting the OIDC variables (or explicitly setting `AUTH_MODE=password`).

- Dev server runs on `http://localhost:5173` with hot-module replacement.
- Helpful scripts:
  - `npm run build` – production bundle.
  - `npm run preview` – serve the built assets locally.
  - `npm run test:unit` – Vitest unit suite.
  - `npm run lint` – ESLint with Vue plugin; auto-fixes where possible.

### Full-stack Docker (development targets)
The default `docker-compose.yml` spins up both services with live mounts:
```bash
docker compose up --build
```
- Update the host volume paths under the `backend` service to match directories you want to expose.
- The frontend is available at `http://localhost:5173`, the backend at `http://localhost:3000`.
- Commented `node_modules` volumes are handy if you run into permission issues.

## Testing & Quality
- Frontend unit tests: `cd frontend && npm run test:unit`.
- Frontend lint: `cd frontend && npm run lint` (expect a few legacy warnings that still need cleanup).
- Backend currently has no automated tests; consider adding Vitest or Jest when introducing new API surface.

## Building Production Images
The multi-stage `Dockerfile` builds the Vue app and packages it with the Node backend.

### Local build
```bash
docker build -t nextexplorer:dev .
```

### Multi-architecture build & push
```bash
docker buildx create --use --name multi || docker buildx use multi
# Install QEMU binfmt for cross-compilation (one-time per host)
docker run --privileged --rm tonistiigi/binfmt --install all

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t nxzai/explorer:latest \
  --push .
```

## Release Checklist
- Update `README.md` screenshots or feature descriptions if UX changes.
- Regenerate the frontend production build (`npm run build`) and smoke-test locally.
- Run through critical file operations (upload/move/delete) on a staging instance.
- Bump Docker tags or package versions as needed and publish release notes.
