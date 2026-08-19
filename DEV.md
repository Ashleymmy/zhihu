# 🚀 开发环境启动指南

## 📋 当前运行状态

### ✅ 已启动的服务

| 服务 | 状态 | 地址 | 说明 |
|------|------|------|------|
| **MySQL** | 🟢 运行中 | `localhost:3308` | Docker 容器 |
| **Redis** | 🟢 运行中 | `localhost:6382` | Docker 容器 |
| **后端 BFF** | 🟢 运行中 | `http://localhost:3001` | 本地开发服务 |
| **Admin 前端** | 🔄 待启动 | `http://localhost:5173` | Vue 3 + Vite |

### 🔍 快速验证

```bash
# 检查后端健康状态
curl http://localhost:3001/healthz
# 预期输出：{"status":"ok"}

# 检查 Docker 服务
docker compose -f compose.dev.yaml ps
# 预期：mysql 和 redis 都是 Up (healthy)
```

---

## 🛠️ 启动步骤

### 1. 启动 Docker 服务 (MySQL + Redis)

```bash
# 在项目根目录执行
docker compose -f compose.dev.yaml up -d

# 查看服务状态
docker compose -f compose.dev.yaml ps

# 查看日志（可选）
docker compose -f compose.dev.yaml logs -f
```

**端口映射**:
- MySQL: `3308:3306` (避免与其他项目冲突)
- Redis: `6382:6379` (避免与其他项目冲突)

### 2. 运行数据库迁移

```bash
cd server

# 复制开发环境配置
cp .env.development .env

# 运行迁移
pnpm migrate

# 预期输出：
# applied 001_init.sql
# applied 002_callbacks.sql
# applied 003_composition_v2.sql
# applied 004_identity_rbac.sql
# applied 005_project_courses.sql
```

### 3. 启动后端开发服务

```bash
cd server

# 方式一：前台运行（推荐调试）
pnpm dev

# 方式二：后台运行
pnpm dev &

# 预期输出：
# Server started on http://localhost:3001
```

**环境变量** (`.env.development`):
```env
NODE_ENV=development
PORT=3001
DB_HOST=127.0.0.1
DB_PORT=3308
DB_NAME=zhihu_koc_dev
DB_USER=zhihu_dev
DB_PASS=zhihu_dev_pass
REDIS_URL=redis://:redis_dev_pass@127.0.0.1:6382
```

### 4. 启动前端开发服务

```bash
# Admin 管理端
cd apps/platform-admin
pnpm dev
# 访问：http://localhost:5173

# Leader 团长端
cd apps/platform-leader
pnpm dev
# 访问：http://localhost:5174

# Creator 达人端
cd apps/platform-creator
pnpm dev
# 访问：http://localhost:5175
```

---

## 🔧 配置说明

### 数据库配置

**MySQL**:
- 主机：`127.0.0.1`
- 端口：`3308`
- 数据库：`zhihu_koc_dev`
- 用户：`zhihu_dev`
- 密码：`zhihu_dev_pass`
- Root 密码：`root_dev_pass`

**连接命令**:
```bash
# 使用 MySQL CLI
mysql -h 127.0.0.1 -P 3308 -u zhihu_dev -p
# 输入密码：zhihu_dev_pass

# 使用 Docker exec
docker compose -f compose.dev.yaml exec mysql mysql -u zhihu_dev -p zhihu_koc_dev
```

**Redis**:
- 主机：`127.0.0.1`
- 端口：`6382`
- 密码：`redis_dev_pass`

**连接命令**:
```bash
# 使用 redis-cli
redis-cli -p 6382 -a redis_dev_pass

# 使用 Docker exec
docker compose -f compose.dev.yaml exec redis redis-cli -a redis_dev_pass
```

---

## 🧪 测试与验证

### 后端 API 测试

```bash
# 健康检查
curl http://localhost:3001/healthz

# 登录接口（需要先创建用户）
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'

# 项目列表（需要 token）
curl http://localhost:3001/api/v1/projects \
  -H "Authorization: Bearer <your_token>"
```

### 运行自动化测试

```bash
# 在项目根目录

# 类型检查
pnpm typecheck

# 单元测试
pnpm test:unit

# 一键质量检查
pnpm quality
```

---

## 🐛 常见问题

### Q1: 端口已被占用

**症状**: `Error: listen EADDRINUSE: address already in use :::3001`

**解决方案**:
```bash
# 方式一：更改端口
编辑 server/.env.development，修改 PORT=3002

# 方式二：停止占用端口的进程
# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:3001 | xargs kill -9
```

### Q2: Docker 服务无法启动

**症状**: `port is already allocated`

**解决方案**:
```bash
# 查看端口占用
netstat -ano | findstr :3308
netstat -ano | findstr :6382

# 停止旧容器
docker compose -f compose.dev.yaml down

# 清理所有容器（慎用）
docker ps -a | grep zhihu-koc-dev | awk '{print $1}' | xargs docker rm -f
```

### Q3: 数据库连接失败

**症状**: `Error: connect ECONNREFUSED 127.0.0.1:3308`

**解决方案**:
```bash
# 1. 检查 MySQL 容器状态
docker compose -f compose.dev.yaml ps mysql

# 2. 查看 MySQL 日志
docker compose -f compose.dev.yaml logs mysql

# 3. 等待 MySQL 完全启动（健康检查通过）
docker compose -f compose.dev.yaml ps
# 状态应为 Up (healthy)

# 4. 测试连接
mysql -h 127.0.0.1 -P 3308 -u zhihu_dev -p
```

### Q4: 迁移失败

**症状**: `validation error` 或 `migration failed`

**解决方案**:
```bash
cd server

# 检查环境变量
cat .env | grep -E "DB_|REDIS_|CALLBACK_"

# 确保 CALLBACK_SECRET_ENCRYPTION_KEY 是 64 位十六进制
# 正确格式：0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# 重新运行迁移
cp .env.development .env
pnpm migrate
```

### Q5: 前端无法访问后端 API

**症状**: `Network Error` 或 `CORS error`

**解决方案**:
```bash
# 1. 确认后端服务正在运行
curl http://localhost:3001/healthz

# 2. 检查前端 API 配置
# apps/platform-admin/.env.development
VITE_API_BASE_URL=http://localhost:3001/api/v1

# 3. 重启前端服务
cd apps/platform-admin
pnpm dev
```

---

## 🔄 停止服务

### 停止所有服务

```bash
# 1. 停止前端（Ctrl+C 或关闭终端）

# 2. 停止后端（Ctrl+C 或关闭终端）

# 3. 停止 Docker 服务
docker compose -f compose.dev.yaml down

# 4. 完全清理（包括数据卷，慎用）
docker compose -f compose.dev.yaml down -v
```

### 仅停止 Docker 服务

```bash
# 停止但保留容器
docker compose -f compose.dev.yaml stop

# 再次启动
docker compose -f compose.dev.yaml start
```

---

## 📊 开发工具推荐

### 数据库管理

- **DBeaver** (跨平台): https://dbeaver.io/
- **MySQL Workbench** (官方): https://www.mysql.com/products/workbench/
- **Navicat** (商业): https://www.navicat.com/

连接配置：
```
Host: 127.0.0.1
Port: 3308
Database: zhihu_koc_dev
Username: zhihu_dev
Password: zhihu_dev_pass
```

### Redis 管理

- **RedisInsight** (官方): https://redis.io/insight/
- **AnotherRedisDesktopManager**: https://github.com/qishibo/AnotherRedisDesktopManager

连接配置：
```
Host: 127.0.0.1
Port: 6382
Password: redis_dev_pass
```

### API 测试

- **Postman**: https://www.postman.com/
- **Insomnia**: https://insomnia.rest/
- **HTTPie Desktop**: https://httpie.io/desktop

导入 API 集合：
```bash
# 查看 API 文档
docs/03-接口文档.md
docs/08-BFF接口契约.md
```

---

## 📝 开发日志

### 种子数据（可选）

```bash
cd server

# 创建种子数据脚本
pnpm seed:dev

# 或者手动插入测试用户
# SQL 见下方
```

**测试用户 SQL**:
```sql
-- Admin 用户
INSERT INTO users (username, password, role, created_at, updated_at)
VALUES ('admin', '$2a$10$hashed_password', 'admin', NOW(), NOW());

-- Leader 用户
INSERT INTO users (username, password, role, created_at, updated_at)
VALUES ('leader', '$2a$10$hashed_password', 'leader', NOW(), NOW());

-- Creator 用户
INSERT INTO users (username, password, role, created_at, updated_at)
VALUES ('creator', '$2a$10$hashed_password', 'creator', NOW(), NOW());
```

---

## 🎯 下一步

开发环境启动后，您可以：

1. **查看项目状态**
   ```bash
   cat STATUS.md
   ```

2. **阅读开发文档**
   - `docs/07-环境搭建.md` - 详细环境配置
   - `docs/09-后端开发规范.md` - 后端开发指南
   - `docs/重构文档/03-前端架构设计.md` - 前端开发指南

3. **运行测试**
   ```bash
   pnpm quality
   ```

4. **开始开发**
   - 后端：`server/src/`
   - 前端：`apps/platform-*/src/`
   - 共享包：`packages/*/src/`

---

**文档版本**: v1.0  
**最后更新**: 2026-08-19  
**维护者**: 开发团队
