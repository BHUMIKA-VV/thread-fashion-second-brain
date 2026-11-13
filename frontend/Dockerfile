# syntax=docker/dockerfile:1
# The Thread website for deployment: a standalone Next.js server. Build from the repository
# root, giving the API's address as the server reaches it (Railway: its private network):
#
#   docker build -f frontend/Dockerfile --build-arg THREAD_API_URL=http://api.railway.internal:8000 -t thread-web .
#
# THREAD_API_URL is fixed at build time: the /api proxy (next.config.ts rewrites) is
# compiled into the server. THREAD_CONTACT_EMAIL (shown on /terms and /privacy) too.

FROM node:24-alpine AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
ARG THREAD_API_URL
ARG THREAD_CONTACT_EMAIL=""
ARG THREAD_MAX_UPLOAD_BYTES=15728640
ENV THREAD_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    THREAD_API_URL=${THREAD_API_URL} \
    THREAD_CONTACT_EMAIL=${THREAD_CONTACT_EMAIL} \
    THREAD_MAX_UPLOAD_BYTES=${THREAD_MAX_UPLOAD_BYTES}
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./
RUN test -n "$THREAD_API_URL" || (echo "Set --build-arg THREAD_API_URL" >&2; exit 1)
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" >/dev/null || exit 1
CMD ["node", "server.js"]
