# syntax=docker/dockerfile:1

# Use pre-built base image with all dependencies
# Auto-built by GitHub Actions when package.json changes
FROM ghcr.io/beenycool/bedwars-level-head-base:latest AS build

WORKDIR /app

# Copy source code (node_modules already present from base)
COPY . .

# Build the application
RUN npm run bundle

# Production stage - minimal image with only runtime deps
FROM node:20-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

# Copy only production node_modules from base
COPY --from=build /app/node_modules ./node_modules

# Copy the built bundle
COPY --from=build /app/dist/index.js ./dist/index.js
COPY --from=build /app/package.json ./package.json

EXPOSE 3000

CMD ["node", "dist/index.js"]
