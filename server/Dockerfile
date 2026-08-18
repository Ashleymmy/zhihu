# syntax=docker/dockerfile:1

FROM node:24.19.0-alpine3.24@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build && npm prune --omit=dev && npm ls --omit=dev --all

FROM node:24.19.0-alpine3.24@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Asia/Shanghai

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node migrations ./migrations

RUN set -eu; \
    apk add --no-cache tzdata; \
    ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime; \
    echo "$TZ" > /etc/timezone; \
    rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /opt/yarn-v1.22.22 \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
      /usr/local/bin/pnpm \
      /usr/local/bin/pnpx \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg; \
    for path in \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /opt/yarn-v1.22.22 \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
      /usr/local/bin/pnpm \
      /usr/local/bin/pnpx \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg; do \
      [ ! -e "$path" ] && [ ! -L "$path" ]; \
    done

USER node

EXPOSE 3000

CMD ["sh", "-c", "node dist/scripts/migrate.js && exec node dist/src/index.js"]
