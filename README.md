# 知乎推广运营平台

项目由以下部分组成：

- `platform/`：Vue 3 运营后台。
- `server/`：Express + TypeScript BFF 后端。
- `app/`：预留的微信小程序工程。
- `docs/`：产品、接口和部署文档。

## Docker 快速启动

```bash
cp .env.docker.example .env.docker
# 编辑 .env.docker，填入所有空白的安全配置
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
curl http://127.0.0.1/healthz
```

数据库迁移会在后端容器启动时自动执行。首次管理员初始化、云服务器安全组、HTTPS、备份和升级步骤见 [Docker 云端部署文档](docs/10-Docker云端部署.md)。

## 核心功能

### 推广计划管理
- 创建和管理知乎推广计划
- 自动同步到知乎开放平台
- **审核状态实时同步** - 查看推广计划的审核状态和拒绝原因

### 作品管理
- 登记推广作品
- 同步到知乎联盟
- **审核状态追踪** - 监控作品审核进度

### 收益结算
- 自动拉取知乎推广数据
- 按定价规则自动结算
- 提现申请与审批流程

### 系统管理
- 用户权限管理（管理员/团长/达人）
- 团队入驻审核
- 操作日志审计
- **审核状态手动同步** - 系统工具页面一键同步

## 最新功能

### 知乎审核状态同步（v1.0.0）

自动从知乎开放平台同步推广计划和作品的审核状态：

- ✅ **自动同步**：每天凌晨 3 点自动同步审核状态
- 🎯 **状态追踪**：实时查看「待审核」「已通过」「已拒绝」状态
- 📋 **拒绝原因**：直接显示知乎的拒绝原因，便于快速修改
- 🔄 **手动触发**：系统工具页面支持立即同步

**功能文档**：
- [功能概览](docs/FEATURE-ZHIHU-AUDIT-STATUS.md) - 快速了解功能
- [详细说明](docs/zhihu-audit-status-sync.md) - 完整使用指南
- [部署指南](docs/zhihu-audit-status-deployment.md) - 部署和测试
- [快速参考](docs/QUICK-REFERENCE.md) - 常用命令和诊断
