# Self-hosted server image (`server`) and web front end (`web`); see docker-compose.yml.
ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM node:24-bookworm-slim AS deps
ARG NPM_REGISTRY
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY npm_config_registry=$NPM_REGISTRY COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /src
# The download layer depends on the lockfile only, so source edits reuse it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter @gonggong/server... --filter @gonggong/web...

FROM deps AS web-build
RUN pnpm --filter @gonggong/web build

FROM nginx:1.29-alpine AS web
COPY --from=web-build /src/apps/web/dist /usr/share/nginx/html
COPY scripts/docker/nginx.conf /etc/nginx/conf.d/default.conf

# Server package + its production dependencies only. --legacy: the workspace does not inject workspace packages.
FROM deps AS server-build
RUN pnpm --filter @gonggong/server --prod deploy --legacy /out

FROM node:24-bookworm-slim AS server
RUN apt-get update && apt-get install -y --no-install-recommends git openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* && mkdir /data && chown node: /data
COPY --from=server-build --chown=node:node /out /app
COPY scripts/docker/server-entrypoint.sh /usr/local/bin/
USER node
WORKDIR /app
ENV HOST=0.0.0.0 GONGGONG_DATA_DIR=/data
EXPOSE 8787
ENTRYPOINT ["server-entrypoint.sh"]
CMD ["node_modules/.bin/tsx", "src/main.ts"]
