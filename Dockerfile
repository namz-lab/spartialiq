# One image: the Vue app and the Fastify API, so the public site is one origin.
FROM node:22-bookworm-slim AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_ALLOW_DEMO_LOGIN=1
ENV DISABLE_PWA=1
ENV NODE_OPTIONS=--max-old-space-size=2048
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
