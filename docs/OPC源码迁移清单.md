# OPC 源码归属迁移清单

更新：2026-09-07。本表记录实现归属变更，不代表删除业务功能。后端旧位置保留兼容再导出，公共核心入口不依赖这些转接；新增代码应使用实际归属路径。迁移前已有的未提交业务代码一同移入模块。

## 后端迁移

| 原位置                                             | 实现位置                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| `server/src/dev-demo.ts`                           | `server/src/modules/zhihu/dev-demo.ts`                           |
| `server/src/jobs/index.ts`                         | `server/src/modules/zhihu/jobs/index.ts`                         |
| `server/src/jobs/pushComposition.ts`               | `server/src/modules/zhihu/jobs/pushComposition.ts`               |
| `server/src/jobs/pushPlan.ts`                      | `server/src/modules/zhihu/jobs/pushPlan.ts`                      |
| `server/src/jobs/settleEarnings.ts`                | `server/src/modules/zhihu/jobs/settleEarnings.ts`                |
| `server/src/jobs/syncCatalog.ts`                   | `server/src/modules/zhihu/jobs/syncCatalog.ts`                   |
| `server/src/jobs/syncCompositionStatus.ts`         | `server/src/modules/zhihu/jobs/syncCompositionStatus.ts`         |
| `server/src/jobs/syncMetrics.ts`                   | `server/src/modules/zhihu/jobs/syncMetrics.ts`                   |
| `server/src/jobs/syncPlanStatus.ts`                | `server/src/modules/zhihu/jobs/syncPlanStatus.ts`                |
| `server/src/routes/alliance.ts`                    | `server/src/modules/zhihu/routes/alliance.ts`                    |
| `server/src/routes/appeals.ts`                     | `server/src/modules/zhihu/routes/appeals.ts`                     |
| `server/src/routes/callbacks.ts`                   | `server/src/modules/zhihu/routes/callbacks.ts`                   |
| `server/src/routes/channels.ts`                    | `server/src/modules/zhihu/routes/channels.ts`                    |
| `server/src/routes/compositions.ts`                | `server/src/modules/zhihu/routes/compositions.ts`                |
| `server/src/routes/data-import.ts`                 | `server/src/modules/zhihu/routes/data-import.ts`                 |
| `server/src/routes/earnings.ts`                    | `server/src/modules/zhihu/routes/earnings.ts`                    |
| `server/src/routes/meta.ts`                        | `server/src/modules/zhihu/routes/meta.ts`                        |
| `server/src/routes/metrics.ts`                     | `server/src/modules/zhihu/routes/metrics.ts`                     |
| `server/src/routes/plans.ts`                       | `server/src/modules/zhihu/routes/plans.ts`                       |
| `server/src/routes/relay.ts`                       | `server/src/modules/zhihu/routes/relay.ts`                       |
| `server/src/routes/story-items.ts`                 | `server/src/modules/zhihu/routes/story-items.ts`                 |
| `server/src/routes/tasks.ts`                       | `server/src/modules/zhihu/routes/tasks.ts`                       |
| `server/src/routes/withdrawals.ts`                 | `server/src/modules/zhihu/routes/withdrawals.ts`                 |
| `server/src/routes/zhihu-content.ts`               | `server/src/modules/zhihu/routes/zhihu-content.ts`               |
| `server/src/services/callbacks.service.ts`         | `server/src/modules/zhihu/services/callbacks.service.ts`         |
| `server/src/services/catalog.service.ts`           | `server/src/modules/zhihu/services/catalog.service.ts`           |
| `server/src/services/compositions.service.ts`      | `server/src/modules/zhihu/services/compositions.service.ts`      |
| `server/src/services/data-import.service.ts`       | `server/src/modules/zhihu/services/data-import.service.ts`       |
| `server/src/services/earnings.service.ts`          | `server/src/modules/zhihu/services/earnings.service.ts`          |
| `server/src/services/finance-approvals.service.ts` | `server/src/modules/zhihu/services/finance-approvals.service.ts` |
| `server/src/services/metrics.service.ts`           | `server/src/modules/zhihu/services/metrics.service.ts`           |
| `server/src/services/plans.service.ts`             | `server/src/modules/zhihu/services/plans.service.ts`             |
| `server/src/services/relay.service.ts`             | `server/src/modules/zhihu/services/relay.service.ts`             |
| `server/src/services/story-items.service.ts`       | `server/src/modules/zhihu/services/story-items.service.ts`       |
| `server/src/sign/zhihu.ts`                         | `server/src/modules/zhihu/sign/zhihu.ts`                         |
| `server/src/utils/secretCrypto.ts`                 | `server/src/modules/zhihu/utils/secretCrypto.ts`                 |
| `server/src/zhihu/allianceAudit.ts`                | `server/src/modules/zhihu/zhihu/allianceAudit.ts`                |
| `server/src/zhihu/allianceContracts.ts`            | `server/src/modules/zhihu/zhihu/allianceContracts.ts`            |
| `server/src/zhihu/allianceEgress.ts`               | `server/src/modules/zhihu/zhihu/allianceEgress.ts`               |
| `server/src/zhihu/allianceEndpointRegistry.ts`     | `server/src/modules/zhihu/zhihu/allianceEndpointRegistry.ts`     |
| `server/src/zhihu/allianceQuota.ts`                | `server/src/modules/zhihu/zhihu/allianceQuota.ts`                |
| `server/src/zhihu/allianceVersionPolicy.ts`        | `server/src/modules/zhihu/zhihu/allianceVersionPolicy.ts`        |
| `server/src/zhihu/allianceXlsx.ts`                 | `server/src/modules/zhihu/zhihu/allianceXlsx.ts`                 |
| `server/src/zhihu/client.ts`                       | `server/src/modules/zhihu/zhihu/client.ts`                       |
| `server/src/zhihu/composition.ts`                  | `server/src/modules/zhihu/zhihu/composition.ts`                  |
| `server/src/zhihu/json.ts`                         | `server/src/modules/zhihu/zhihu/json.ts`                         |

另为知乎旧项目参数契约保留模块内 projects 路由/服务，公共项目服务只处理平台无关字段。知乎配置、权限、任务封装、站点状态与工具路由也已移入模块。

## 前端迁移

业务页位于各端 `src/modules/zhihu/views`，模块自行定义 routes/context/ModuleLayout，包含功能菜单、数据客户端和旧 URL 重定向。公共 `src/views` 中无引用的 75 个旧转接文件已移除；公共管理页面仍在原目录。

## 公共增量

- 后端：core/contracts、module-runtime、app/start、routes/accounts/demo，以及 composition/modules/static。
- 前端：公共工作台、模块目录、账号/项目关联、财务入口；公共认证、工作区状态和组合入口。
- 契约：shared-contracts 的 core/zhihu 分离出口，shared-services 的 core-api/platform/zhihu 分离出口。
- schema：core、extensions、legacy-core、zhihu；原 migrations 保留历史记录。
- 验收：server/tests/opc、server/tests/opc-ui、API 示例模块，无真实平台网络或资金写入测试。

## 保留的兼容部分

旧 npm 包名和 Compose 资源名称、后端源码转接、启用知乎时的旧 HTTP 路由、旧数据库业务字段与 ID 保留。公共源码运行依赖已切断；物理删除旧数据库字段、重算历史账目不属于本次公共骨架工作。
