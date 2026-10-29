# syntax=docker/dockerfile:1
# 全栈一体镜像：统一前端 + 共享包 + 后端 + 门户/落地页静态产物
# 构建：docker build -t zhihu-koc:latest .
# 运行依赖：MySQL 8 + Redis 7（见 compose.yaml）

# ── 阶段 1：构建前端（pnpm workspace：packages + apps）──
FROM node:24.22.1-alpine3.24@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d AS frontend-build
RUN apk add --no-cache --upgrade 'ca-certificates-bundle>=20261020-r0'

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# 先拷贝依赖清单，利用镜像层缓存
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY weixin-app/docs/用户协议.md weixin-app/docs/隐私协议.md ./weixin-app/docs/

RUN pnpm install --frozen-lockfile
RUN pnpm build

# ── 阶段 2：构建后端（server 独立 npm 管理）──
FROM node:24.22.1-alpine3.24@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d AS server-build
RUN apk add --no-cache --upgrade 'ca-certificates-bundle>=20261020-r0'

WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
COPY server/scripts ./scripts
RUN npm run build && npm prune --omit=dev

# ── 阶段 3：运行时 ──
FROM node:24.22.1-alpine3.24@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d AS runtime
RUN apk add --no-cache --upgrade 'ca-certificates-bundle>=20261020-r0'

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Asia/Shanghai

# 后端
COPY --from=server-build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=server-build --chown=node:node /app/node_modules ./node_modules
COPY --from=server-build --chown=node:node /app/dist ./dist
COPY --chown=node:node server/migrations ./migrations
COPY --chown=node:node server/schema ./schema

# 门户/落地页静态产物（已提交在仓库 server/public）
COPY --chown=node:node server/public ./public

# 统一前端产物，后端挂载 /app/ 并兼容旧三端地址
COPY --from=frontend-build --chown=node:node /workspace/apps/platform-admin/dist /apps/platform-admin/dist

# Node ships ICU timezone data; keep TZ in the environment so restricted/offline builds do not depend on Alpine package downloads.

USER node
EXPOSE 3000

# 启动即迁移，再起服务
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/scripts/bootstrap.js && exec node dist/src/index.js"]
