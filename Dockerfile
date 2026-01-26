FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS base

WORKDIR /app

# API dependencies (production only)
FROM base AS api_deps
ENV NODE_ENV=production
WORKDIR /app
COPY api/package*.json ./
RUN npm ci --omit=dev

# Frontend build (needs dev dependencies)
FROM base AS web_build
ENV NODE_ENV=development
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build -- --sourcemap false

# Final runtime image
FROM base AS runtime
ENV NODE_ENV=production

# Create the baseline app user; UID/GID may be mutated at runtime via entrypoint.sh.
RUN groupadd --system appuser && \
    useradd --system --gid appuser --shell /bin/bash --create-home appuser

# Install runtime tooling (ffmpeg, gosu for UID remapping, ripgrep for searches, imagemagick for HEIC thumbnails).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg gosu ripgrep imagemagick curl unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Make git metadata available at runtime for API /api/features endpoint
ARG GIT_COMMIT=""
ARG GIT_BRANCH=""
ARG REPO_URL=""
ENV GIT_COMMIT=${GIT_COMMIT}
ENV GIT_BRANCH=${GIT_BRANCH}
ENV REPO_URL=${REPO_URL}

# Bring in the API source and production dependencies.
COPY --from=api_deps /app/node_modules ./node_modules
COPY --from=api_deps /app/package.json ./
COPY api/src ./src
COPY healthcheck.js ./healthcheck.js

# Copy the built web assets only.
RUN mkdir -p src/public
COPY --from=web_build /app/web/dist/ ./src/public/

# Host checkouts can have restrictive umasks (e.g. 077) resulting in 0600 source files.
# Ensure the runtime user can always read/traverse the app source tree.
RUN chmod -R a+rX /app/src

# Bootstrap entrypoint script responsible for dynamic user mapping.
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

VOLUME ["/config", "/cache"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD [ "node", "healthcheck.js" ]

EXPOSE 3000
ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "src/app.js"]
