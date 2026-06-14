FROM node:22-alpine AS base
WORKDIR /app

# ─── Install backend deps ─────────────────────────────────────────────────────
FROM base AS backend-deps
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Build backend ────────────────────────────────────────────────────────────
FROM base AS backend-build
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# ─── Build frontend ───────────────────────────────────────────────────────────
FROM base AS frontend-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client ./
RUN npm run build

# ─── Production image ─────────────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/client/dist ./client/dist
COPY package.json ./

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/index.js"]
