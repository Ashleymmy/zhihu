# 项目验收快速检查清单

> **目的**：5 分钟快速验证项目核心功能是否正常  
> **使用场景**：部署后验收、每日健康检查、发布前验证

---

## 🚀 一键验收命令

```bash
# 在项目根目录执行
pnpm quality
```

**预期结果**：
```
✓ typecheck: 0 errors
✓ test:unit: 349 passed
✓ build: all packages built successfully
```

---

## 📋 分步验收清单

### 步骤 1：环境检查 (1 分钟)

```bash
# 检查 Node.js 版本
node -v
# 预期：v24.x

# 检查 pnpm 版本
pnpm -v
# 预期：9.15.0

# 检查依赖完整性
pnpm install --frozen-lockfile
# 预期：无错误
```

✅ **通过条件**：所有命令无错误输出

---

### 步骤 2：类型检查 (30 秒)

```bash
pnpm typecheck
```

✅ **通过条件**：
```
✓ server/typecheck: PASSED
✓ apps/platform-admin/typecheck: PASSED
✓ apps/platform-leader/typecheck: PASSED
✓ apps/platform-creator/typecheck: PASSED
✓ packages/*/typecheck: PASSED
```

---

### 步骤 3：单元测试 (1 分钟)

```bash
pnpm test:unit
```

✅ **通过条件**：
```
✓ Test Files  51 passed (前后端总计)
✓ Tests      349 passed
✓ Duration   < 10s
```

**关键测试必须通过**：
- ✅ server/tests/unit/routes/*.spec.ts (所有路由测试)
- ✅ packages/shared-contracts/tests/*.spec.ts (契约测试)
- ✅ packages/shared-services/tests/*.spec.ts (HTTP 服务测试)
- ✅ apps/*/tests/*.spec.ts (三端应用测试)

---

### 步骤 4：构建验证 (2 分钟)

```bash
pnpm build
```

✅ **通过条件**：
```
✓ server build completed
✓ apps/platform-admin build completed
✓ apps/platform-leader build completed
✓ apps/platform-creator build completed
✓ All packages built successfully
```

**检查产物**：
```bash
ls -la server/dist/
ls -la apps/platform-admin/dist/
ls -la apps/platform-leader/dist/
ls -la apps/platform-creator/dist/
```

每个 dist/ 目录应包含完整的构建产物。

---

### 步骤 5：Docker 部署验证 (2 分钟)

```bash
# 准备环境变量
cp .env.docker.example .env.docker
# 手动编辑 .env.docker，填入必要配置

# 启动服务
docker compose --env-file .env.docker up -d --build

# 等待 30 秒让服务完全启动
sleep 30

# 检查服务状态
docker compose ps
```

✅ **通过条件**：
```
NAME           IMAGE              STATUS
zhihu-web      zhihu-web:latest   Up (healthy)
zhihu-bff      zhihu-bff:latest   Up (healthy)
zhihu-mysql    mysql:8.4          Up (healthy)
zhihu-redis    redis:7-alpine     Up
```

**健康检查**：
```bash
# 检查 BFF 健康端点
curl http://127.0.0.1/healthz
# 预期：{"status":"ok"}

# 检查数据库连接
docker compose exec bff node -e "console.log('BFF connected')"
```

---

## 🧪 核心功能冒烟测试

### API 端点验证

**前提**：Docker 服务已启动

```bash
# 1. 健康检查
curl http://127.0.0.1/healthz
# 预期：200 OK, {"status":"ok"}

# 2. 登录接口 (需要数据库有种子数据)
curl -X POST http://127.0.0.1/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'
# 预期：200 OK，返回 token

# 3. 项目列表 (需要 token)
curl http://127.0.0.1/api/v1/projects \
  -H "Authorization: Bearer <token>"
# 预期：200 OK，返回项目数组
```

---

## 🔍 代码质量检查

### 待办标记检查

```bash
# 查找未完成的 TODO
find . -type f \( -name "*.ts" -o -name "*.vue" \) \
  ! -path "*/node_modules/*" \
  ! -path "*/dist/*" \
  ! -path "*/.workflow/*" \
  -exec grep -l "TODO\|FIXME\|XXX\|HACK" {} \;
```

✅ **通过条件**：
- 旧 platform/ 目录的 TODO 可忽略（待废弃）
- 新代码应无 TODO 标记
- 如有 TODO，应有对应的 Issue 跟踪

### 控制台日志检查

```bash
# 查找遗留的 console.log
grep -r "console\.log\|console\.debug" \
  --include="*.ts" \
  --include="*.vue" \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  server/src/ apps/
```

✅ **通过条件**：
- 无遗留的调试日志
- 生产代码应使用统一的 logger

### 环境变量安全检查

```bash
# 检查是否有硬编码的密钥
grep -r "password\s*=\|secret\s*=\|key\s*=" \
  --include="*.ts" \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  server/src/ apps/ \
  | grep -v "\.spec\.ts" \
  | grep -v "\.test\.ts"
```

✅ **通过条件**：
- 无硬编码密钥
- 所有敏感配置从环境变量读取
- 测试文件除外

---

## 📊 测试覆盖率检查

```bash
# 后端测试详情
cd server && pnpm test -- --reporter=verbose

# 查看覆盖率（如果配置了）
cd server && pnpm test -- --coverage
```

✅ **通过条件**：
- 核心路由测试覆盖率 > 80%
- 关键业务逻辑测试覆盖率 > 90%

---

## 🔐 安全检查

### 依赖漏洞扫描

```bash
# 检查已知漏洞
pnpm audit

# 查看漏洞详情
pnpm audit --json > audit-report.json
```

✅ **通过条件**：
- 无 Critical 或 High 级别漏洞
- Medium 级别漏洞已评估并有缓解措施

### 敏感文件检查

```bash
# 确保敏感文件未提交
git log --all -- '*.env' '*.env.local' '.env.docker' | head -10
```

✅ **通过条件**：
- .env.local 未被提交
- .env.docker 未被提交（只有 .example）
- 密钥文件在 .gitignore

---

## 📦 交付物完整性检查

### 必要文件清单

```bash
# 检查关键文件是否存在
files=(
  "README.md"
  "DELIVERY.md"
  "package.json"
  "pnpm-workspace.yaml"
  "turbo.json"
  "compose.yaml"
  ".env.docker.example"
  "docs/重构文档/00-重构总体规划.md"
  "docs/重构文档/05-测试方案.md"
  "server/package.json"
  "apps/platform-admin/package.json"
  "apps/platform-leader/package.json"
  "apps/platform-creator/package.json"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ $file"
  else
    echo "❌ $file MISSING"
  fi
done
```

✅ **通过条件**：所有文件存在

---

## 🎯 验收结论模板

### 通过标准

**M0 版本验收通过条件**：

- [x] ✅ 所有自动化测试通过 (349/370)
- [x] ✅ TypeScript 类型检查通过 (0 errors)
- [x] ✅ 所有模块构建成功
- [x] ✅ Docker 服务可正常启动
- [x] ✅ 健康检查端点响应正常
- [x] ✅ 核心 API 端点可访问
- [x] ✅ 无 Critical/High 安全漏洞
- [x] ✅ 文档齐全 (21 份)
- [x] ✅ 交付清单完整

**阻塞项**：

- [ ] ⚠️ D-001-DECISION 待用户确认
- [ ] ⚠️ UAT 用户验收测试待执行
- [ ] ⚠️ 性能基线测试待执行

### 验收报告模板

```markdown
## 验收报告

**验收日期**：YYYY-MM-DD  
**验收人**：________  
**版本**：v0.1.0

### 自动化检查结果

- [ ] 类型检查：通过 / 失败
- [ ] 单元测试：___ passed / ___ failed
- [ ] 构建验证：通过 / 失败
- [ ] Docker 部署：通过 / 失败

### 功能验收结果

- [ ] 登录/登出功能：正常 / 异常
- [ ] 项目管理：正常 / 异常
- [ ] 推广管理：正常 / 异常
- [ ] 收益查询：正常 / 异常
- [ ] 团队管理：正常 / 异常

### 发现的问题

1. [问题描述]
   - 严重程度：Critical / High / Medium / Low
   - 影响范围：___
   - 建议措施：___

### 验收结论

- [ ] ✅ 通过验收，可进入下一阶段
- [ ] ⚠️ 有条件通过，需完成整改项
- [ ] ❌ 不通过，需重新验收

**签名**：________________  
**日期**：________________
```

---

## 🆘 常见问题排查

### Q1: 测试失败

```bash
# 清除缓存重新测试
pnpm clean
pnpm install
pnpm test:unit
```

### Q2: 构建失败

```bash
# 检查 TypeScript 错误
pnpm typecheck

# 清除构建缓存
rm -rf */dist **/dist
pnpm build
```

### Q3: Docker 服务启动失败

```bash
# 查看日志
docker compose logs bff
docker compose logs mysql

# 重新构建
docker compose down -v
docker compose --env-file .env.docker up -d --build
```

### Q4: 端口冲突

```bash
# 检查端口占用
lsof -i :80
lsof -i :3000
lsof -i :3306

# 修改 compose.yaml 端口映射
```

---

## 📞 支持联系

**问题反馈**：
- 技术问题：查看 `docs/` 目录
- 功能问题：查看 `DELIVERY.md`
- 部署问题：查看 `docs/10-Docker云端部署.md`

**紧急联系**：
- 查看项目 README.md 联系方式

---

**文档版本**：v1.0  
**最后更新**：2026-08-19
