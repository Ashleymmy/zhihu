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
