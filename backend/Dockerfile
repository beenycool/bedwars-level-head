# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifests first so dependency layers cache.
COPY package.json package-lock.json ./

RUN npm ci --no-audit --no-fund && npm cache clean --force

COPY . .

# esbuild inlines all dependencies into dist/index.js.
RUN npm run build


FROM node:22-alpine AS runner

WORKDIR /app

# The bundle needs no node_modules.
COPY --from=builder /app/dist/index.js ./dist/index.js
COPY --from=builder /app/package.json ./package.json

# The bundle only reads files and listens on a port; run unprivileged.
USER node

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"

EXPOSE 3000

CMD ["node", "dist/index.js"]
