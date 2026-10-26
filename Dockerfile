# One image for all four bots; docker-compose.yml picks the entry point per service.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Toolchain for building better-sqlite3 if no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY tickets-bot/package.json tickets-bot/
COPY guard-bot/package.json guard-bot/
COPY community-bot/package.json community-bot/
COPY ai-bot/package.json ai-bot/
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p tickets-bot/data guard-bot/data community-bot/data ai-bot/data backups \
  && chown -R node:node tickets-bot/data guard-bot/data community-bot/data ai-bot/data backups
USER node
