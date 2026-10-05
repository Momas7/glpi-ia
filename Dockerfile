# syntax=docker/dockerfile:1
FROM docker.io/library/node:24-slim AS base
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

# ---- migrate: só o CLI do Prisma (com o motor de migração), para o `migrate deploy` na subida do web
FROM base AS migrate
ARG PRISMA_VERSION=7.10.0
WORKDIR /migrate
RUN npm init -y >/dev/null && npm install --no-audit --no-fund prisma@${PRISMA_VERSION}

# ---- web: Next.js standalone + migrations na subida
FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
# o CLI do Prisma entra por cima do node_modules rastreado pelo standalone (sem copiar o node_modules do build inteiro)
COPY --from=migrate --chown=node:node /migrate/node_modules ./node_modules
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 3000
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]

# ---- worker: mesmo código, outro entrypoint
FROM build AS worker
ENV NODE_ENV=production SERVICE_NAME=worker
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
CMD ["npm", "run", "worker"]
