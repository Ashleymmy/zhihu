# syntax=docker/dockerfile:1
# 全栈一体镜像：三端前端 + 共享包 + 后端 + 门户/落地页静态产物
# 构建：docker build -t zhihu-koc:latest .
# 运行依赖：MySQL 8 + Redis 7（见 compose.yaml）

# ── 阶段 1：构建前端（pnpm workspace：packages + apps）──
FROM node:24.19.0-alpine3.24@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS frontend-build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# 先拷贝依赖清单，利用镜像层缓存
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm -r build

# ── 阶段 2：构建后端（server 独立 npm 管理）──
FROM node:24.19.0-alpine3.24@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS server-build

WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
COPY server/scripts ./scripts
RUN npm run build && npm prune --omit=dev

# ── 阶段 3：运行时 ──
FROM node:24.19.0-alpine3.24@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Asia/Shanghai

# 后端
COPY --from=server-build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=server-build --chown=node:node /app/node_modules ./node_modules
COPY --from=server-build --chown=node:node /app/dist ./dist
COPY --chown=node:node server/migrations ./migrations

# 门户/落地页静态产物（已提交在仓库 server/public）
COPY --chown=node:node server/public ./public

# 三端前端构建产物（app.ts 以 cwd 相对路径 ../apps 挂载）
COPY --from=frontend-build --chown=node:node /workspace/apps/platform-admin/dist /apps/platform-admin/dist
COPY --from=frontend-build --chown=node:node /workspace/apps/platform-leader/dist /apps/platform-leader/dist
COPY --from=frontend-build --chown=node:node /workspace/apps/platform-creator/dist /apps/platform-creator/dist

RUN apk add --no-cache tzdata && ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime

USER node
EXPOSE 3000

# 启动即迁移，再起服务
CMD ["sh", "-c", "node dist/scripts/migrate.js && exec node dist/src/index.js"]
