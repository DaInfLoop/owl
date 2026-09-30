# syntax=docker/dockerfile:1
FROM dhi.io/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile \
    && mkdir /production \
    && cp package.json bun.lock /production/ \
    && cd /production \
    && bun install --frozen-lockfile --production

COPY tsconfig*.json ./
COPY src ./src
RUN bun run build

FROM dhi.io/node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /production/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node drizzle ./drizzle
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Gate startup on migrations; keep credentials out of the image build.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/index.js"]
