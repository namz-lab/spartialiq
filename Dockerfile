# One image: the Vue app and the Fastify API, so the public site is one origin.
FROM node:22-bookworm-slim AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# The Cloudflare Turnstile SITE key (public; it is in every page) is built into the app, so it must reach
# this stage. Render passes a service's environment variables to a Docker build only as declared ARGs:
# set VITE_TURNSTILE_SITE_KEY on the Render service. Without it the sign-in form says "The security check
# is not configured". The matching SECRET key is TURNSTILE_SECRET_KEY, read by the API at run time only.
ARG VITE_TURNSTILE_SITE_KEY
ENV VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY}
ENV VITE_ALLOW_DEMO_LOGIN=1
ENV DISABLE_PWA=1
ENV NODE_ENV=production
# Cap the heap below a typical 2 GiB Render builder. 2048 left no room for npm/vite
# native memory, so the kernel SIGKILL'd the step and the dashboard said BUILD FAILED.
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN npm run build:fast

FROM node:22-bookworm-slim
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY backend/ ./
COPY --from=web /src/frontend/dist ./public
ENV NODE_ENV=production
ENV PUBLIC_DIR=/app/public
ENV ALLOW_DEMO_LOGIN=1
ENV ALLOW_SUPERUSER_DB=1
EXPOSE 3000
CMD ["node", "server.js"]
