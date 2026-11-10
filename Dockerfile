# Stage 1: install everything and build model, frontend and backend.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY model/package.json model/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY model model
COPY backend backend
COPY frontend frontend
RUN npm run build

# Stage 2: only what the running backend needs.
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY model/package.json model/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev -w backend
COPY --from=build /app/model/dist model/dist
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
COPY backend/migrations backend/migrations
RUN mkdir -p /data/storage && chown node:node /data/storage
USER node
ENV STORAGE_DIR=/data/storage PORT=4000
EXPOSE 4000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:4000/health || exit 1
WORKDIR /app/backend
CMD ["node", "dist/index.js"]
