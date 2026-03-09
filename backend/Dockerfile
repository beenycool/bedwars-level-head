# syntax=docker/dockerfile:1

# Stage 1: Build the application
FROM node:20-alpine AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable pnpm

# Copy package management files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies for esbuild)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm run bundle

# Stage 2: Production image
FROM node:20-alpine

WORKDIR /app

# Only copy the built bundle from the builder stage
# esbuild bundles all dependencies (except external ones, if any)
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"

EXPOSE 3000

CMD ["node", "dist/index.js"]
