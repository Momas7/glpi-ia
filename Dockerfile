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

# ---- web: Next.js standalone + migrations na subida
FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# node_modules completo só para o `prisma migrate deploy` na subida (otimizar na Fase 6)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next/standalone ./
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
