# Docker 云端部署

本文用于将知乎推广运营平台部署到一台安装了 Docker Engine 和 Docker Compose v2 的 Linux 云服务器，供团队联调和验收。

## 1. 部署结构

根目录 `compose.yaml` 会启动 4 个服务：

| 服务 | 镜像 | 作用 | 是否暴露公网端口 |
| --- | --- | --- | --- |
| `platform` | 本项目构建 | Nginx 托管 Vue 页面并代理 API | 是，默认 `80` |
| `server` | 本项目构建 | Express BFF、队列和定时同步 | 否 |
| `mysql` | `mysql:8.0` | 业务数据库 | 否 |
| `redis` | `redis:7-alpine` | 队列、限频、锁和 Token 撤销 | 否 |

后端容器每次启动时先执行幂等数据库迁移，迁移成功后才启动 API。MySQL 和 Redis 数据分别保存在命名卷 `mysql_data`、`redis_data` 中。

## 2. 云服务器准备

建议至少使用 2 核 CPU、4 GB 内存和 30 GB 磁盘。安装 Docker Engine、Docker Compose v2 和 Git，并确认：

```bash
docker version
docker compose version
git --version
```

安全组只开放：

- `22/tcp`：SSH，建议限制管理 IP。
- `80/tcp`：HTTP 测试入口。
- `443/tcp`：配置 HTTPS 后使用。

不要开放 `3000`、`3306` 或 `6379`。

## 3. 拉取代码和配置环境

```bash
git clone https://github.com/Ashleymmy/zhihu.git
cd zhihu
cp .env.docker.example .env.docker
chmod 600 .env.docker
```

生成随机配置：

```bash
openssl rand -hex 24   # 分别生成 MYSQL_PASSWORD、MYSQL_ROOT_PASSWORD、REDIS_PASSWORD
openssl rand -hex 32   # 生成 JWT_SECRET
openssl rand -hex 32   # 生成 CALLBACK_SECRET_ENCRYPTION_KEY，必须正好 64 个十六进制字符
```

编辑 `.env.docker`，填入所有空白项。`ZHIHU_ACCESS_TOKEN` 和 `ZHIHU_SECRET_KEY` 必须使用知乎提供的运行时凭据。不要把 `.env.docker` 发到聊天群、打进镜像或提交到 Git。

## 4. 构建并启动

在项目根目录执行：

```bash
docker compose --env-file .env.docker pull mysql redis
docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
```

首次启动通常需要等待 MySQL 初始化。所有服务均显示 `healthy` 后验证：

```bash
curl http://127.0.0.1/healthz
curl -I http://127.0.0.1/
```

`/healthz` 应返回 `{"status":"ok"}`，首页应返回 HTTP `200`。外部同事可使用 `http://云服务器公网IP/` 访问。

如果 `80` 端口已被占用，可在 `.env.docker` 中设置 `WEB_PORT=8080`，访问地址相应改为 `http://服务器IP:8080/`。

## 5. 创建首次管理员

项目不会在生产启动时自动创建测试账号。确认服务健康后，显式执行一次初始化命令：

```bash
docker compose --env-file .env.docker run --rm \
  -e NODE_ENV=development \
  -e DEV_ADMIN_USERNAME=admin \
  -e DEV_ADMIN_PASSWORD='替换为至少8位的临时强密码' \
  -e DEV_ADMIN_DISPLAY_NAME='系统管理员' \
  server node dist/scripts/seed-dev.js
```

该命令只运行一次 seed 进程，不会改变常驻后端的 `NODE_ENV=production`。账号创建后应立即登录并修改密码，再从后台创建团长和达人账号。

## 6. 日常运维

查看状态和日志：

```bash
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs --tail 200 server
docker compose --env-file .env.docker logs -f platform server
```

重启服务：

```bash
docker compose --env-file .env.docker restart server platform
```

停止服务但保留数据：

```bash
docker compose --env-file .env.docker down
```

不要使用 `down -v`，它会删除 MySQL 和 Redis 数据卷。

## 7. 数据库备份与恢复

创建备份目录并导出：

```bash
mkdir -p backups
docker compose --env-file .env.docker exec -T mysql \
  sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers "$MYSQL_DATABASE"' \
  > "backups/zhihu_koc-$(date +%Y%m%d-%H%M%S).sql"
```

恢复前应停止后端写入，并确认目标数据库和备份文件：

```bash
docker compose --env-file .env.docker stop server
docker compose --env-file .env.docker exec -T mysql \
  sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  < backups/要恢复的文件.sql
docker compose --env-file .env.docker start server
```

## 8. 更新与回滚

更新前先做数据库备份并记录当前提交：

```bash
git rev-parse HEAD
git pull --ff-only origin main
docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
```

如果新版本异常，切回已记录的提交后重新构建。数据库迁移默认只向前执行；涉及数据库结构的版本在回滚代码前必须先核对对应迁移，不能直接删除数据卷。

## 9. HTTPS 和域名

测试环境可先通过 HTTP 验证，但正式传输账号、密码和知乎数据前必须配置 HTTPS。推荐在云负载均衡、CDN 或宿主机 Caddy/Nginx 上终止 TLS，再反向代理到 `127.0.0.1:${WEB_PORT}`。证书和私钥不要放进本仓库。

配置 HTTPS 后，将安全组的业务入口收敛到 `443/tcp`，并把 HTTP 请求重定向到 HTTPS。

## 10. 故障排查

```bash
# 查看所有容器状态
docker compose --env-file .env.docker ps -a

# 查看后端启动、迁移或配置错误
docker compose --env-file .env.docker logs --tail 300 server

# 查看数据库和 Redis 健康状态
docker compose --env-file .env.docker logs --tail 200 mysql redis

# 重新构建单个服务
docker compose --env-file .env.docker build --no-cache server
docker compose --env-file .env.docker up -d server
```

生产环境缺少 `JWT_SECRET`、知乎凭据或回传加密密钥时，后端会拒绝启动。遇到 `unhealthy` 时先看对应服务日志，不要通过移除健康检查或删除数据卷规避问题。
