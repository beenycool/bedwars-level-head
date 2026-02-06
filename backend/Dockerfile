# syntax=docker/dockerfile:1

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run bundle

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
# Only copy the bundle and package.json (needed for version reading)
COPY --from=build /app/dist/index.js ./dist/index.js
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["node", "dist/index.js"]
