# syntax=docker/dockerfile:1

# Ultra-fast build using pre-built base image
# The base image has node_modules pre-installed
FROM ghcr.io/beenycool/bedwars-level-head-base:latest

WORKDIR /app

# Copy source code (node_modules already present from base image)
COPY . .

# Build the application (esbuild creates self-contained bundle)
RUN npm run bundle

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js"]
