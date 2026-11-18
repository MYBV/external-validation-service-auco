
# ==========================================
# Stage 1: Build
# ==========================================
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Install dependencies using the lockfile
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code and compile NestJS
COPY . .
RUN npm run build

# ==========================================
# Stage 2: Production dependencies
# ==========================================
FROM node:24-bookworm-slim AS production-deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ==========================================
# Stage 3: Runtime
# ==========================================
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3300

WORKDIR /app

COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node

EXPOSE 3300

CMD ["node", "--enable-source-maps", "dist/main.js"]
