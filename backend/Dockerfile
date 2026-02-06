# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app

# Production dependencies stage - install only production deps
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --production --no-audit --no-fund

# Build stage - install all deps and build
FROM base AS build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund
COPY . .
RUN npm run bundle

# Production stage - minimal image
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
# Copy only production node_modules
COPY --from=deps /app/node_modules ./node_modules
# Copy the bundle
COPY --from=build /app/dist/index.js ./dist/index.js
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["node", "dist/index.js"]
