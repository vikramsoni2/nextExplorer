# Contributing to nextExplorer

Thanks for helping improve nextExplorer! This guide keeps contributions smooth, minimal, and maintainable.

## Ways to Contribute

- Report bugs and propose features via GitHub Issues.
- Improve docs and examples in `docs/`.
- Fix bugs or add focused enhancements.

## Code Style (Keep It Simple)

- Modular, clean, minimal. Avoid unnecessary code and deps.
- Use project libraries and patterns instead of reinventing: Vue 3 + Pinia + Axios on the frontend; Express + Pino on the backend.
- Prefer small, composable functions. Clear names over comments; comment only where needed.
- Handle errors explicitly. Never log secrets or tokens.
- Keep changes focused; one concern per PR.

## Project Layout

- `web/` – Vue 3 + Vite app (Pinia, TailwindCSS, Vitest, ESLint).
- `api/` – Express API (Node 18+, Pino logging, OIDC via express-openid-connect).
- `docs/` – VitePress docs (site content and guides).
- `Dockerfile` – Multi-stage build packaging the full app.

## Prerequisites

- Node.js 18+ and npm 9+.
- Docker + Docker Compose v2 (optional, recommended for end-to-end dev).
- FFmpeg/ffprobe available if running api outside Docker.

## Local Development

Option A — single-port dev via Compose (recommended):

```
docker compose -f docker-compose.dev.yml up --build
```

- Frontend served at `http://localhost:3000`.
- API listens on `3001` inside the Compose network; Vite proxies API calls.

Option B — run services locally in two terminals:

```
# Terminal 1: api
cd api
npm install
PORT=3001 CONFIG_DIR=$PWD/.config CACHE_DIR=$PWD/.cache
npm start

# Terminal 2: web
cd web
npm install
VITE_BACKEND_ORIGIN=http://localhost:3001 npm run dev
```

Environment tips:

- Set `PUBLIC_URL` when running behind a reverse proxy; OIDC defaults derive from it.
- OIDC: set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, optional `OIDC_SCOPES`/`OIDC_ADMIN_GROUPS`.
- OnlyOffice (optional): `ONLYOFFICE_URL`, `ONLYOFFICE_SECRET`, `ONLYOFFICE_LANG`.

## Tests & Linting

- API tests (Node test runner):

```
cd api && npm test
```

- Frontend unit tests (Vitest):

```
cd web && npm run test:unit
```

- web lint (ESLint + vue):

```
cd web && npm run lint
```

## Build

- Production container:

```
docker build -t nextexplorer:dev .
```

- Frontend bundle only:

```
cd web && npm run build && npm run preview
```

## Pull Requests

- Keep PRs small and atomic. Describe the problem and the approach.
- Include tests for new behavior when practical (api: Node test runner + supertest; frontend: Vitest).
- Update docs in `docs/` and user-facing `README.md` when behavior or settings change.
- Run tests and linters locally before submitting.

Checklist:

- [ ] Focused changes; no unrelated diffs
- [ ] Tests pass locally (`api`/`web`)
- [ ] Lint passes (`web`)
- [ ] Docs and examples updated if needed

## Commit Messages & Branching

- Use clear, descriptive titles (e.g., "auth: fix token refresh on reverse proxy").
- Reference issues where relevant (e.g., "Closes #123").
- Branch naming: `feat/*`, `fix/*`, or `docs/*`.

## Security

- Do not include secrets in code or logs.
- Avoid permissive `TRUST_PROXY` settings; rely on `PUBLIC_URL`-derived defaults or explicitly set safe values.
- Report vulnerabilities privately via GitHub Security Advisories.

## Where to Look First

- API configuration: `api/src/config/index.js`, `api/src/config/trustProxy.js`.
- Logging: `api/src/utils/logger.js` (Pino).
- Auth routes and middleware: `api/src/routes/auth.js`, `api/src/middleware/authMiddleware.js`.
- web state and API: `web/src/stores/*`, `frontend/src/api/index.js`.

Thanks again for contributing!
