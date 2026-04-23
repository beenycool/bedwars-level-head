# syntax=docker/dockerfile:1

# ============================================================
# Stage 1: builder – install deps + esbuild bundle
# ============================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package manifests first (cache-friendly: only re-install on dependency changes)
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for esbuild)
RUN npm ci --no-audit --no-fund && npm cache clean --force

# Copy source code
COPY . .

# Build the self-contained bundle (esbuild inlines all deps into dist/index.js)
RUN npm run bundle

# ============================================================
# Stage 2: runner – minimal production image
# ============================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Copy only the esbuild bundle from builder (no node_modules needed)
COPY --from=builder /app/dist/index.js ./dist/index.js
COPY --from=builder /app/package.json ./package.json

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"

EXPOSE 3000

CMD ["node", "dist/index.js"]
