# OPC 公共核心重构：实现与运行说明

更新日期：2026-09-07。本文说明本次已实现的公共核心、知乎模块边界和验收方式；旧文档中的“系统必须接入知乎”“邮件是所有平台统一入口”等设定不再作为公共架构要求。

## 1. 当前结果与归属

OPC 是单运营组织下的平台聚合系统，保留管理员、团长、达人三个工作台。公共系统管理身份、组织、项目和业务模块；各平台自行取得并解释数据，再按公共契约提供给 OPC。

| 归属     | 负责内容                                                                            | 主要位置                                                        |
| -------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 公共核心 | 登录、会话、权限、团队、项目、项目成员、运营账户、公告、审计、接入账号和项目关联    | `server/src/core`、`server/src/auth`、公共 routes/services      |
| 公共页面 | 三端壳、工作台、模块目录、公共财务入口、公共管理页                                  | `apps/platform-*/src`、`packages/shared-components`             |
| 知乎模块 | 推广计划、作品、渠道、数据同步、签名回传、邮件/Excel 导入及归因、历史收益/结算/提现 | `server/src/modules/zhihu`、`apps/platform-*/src/modules/zhihu` |
| 组合入口 | 按明确配置加载模块、挂载兼容入口、托管三端静态文件                                  | `server/src/composition`、各端 `src/composition`                |
| 后续平台 | 自己的 API/Webhook/文件适配和业务规则；可只提供数据接口                             | 新增独立模块，不依赖知乎导入流水线                              |

公共核心的依赖方向是“模块使用公共能力”。公共登录、项目、团队、财务入口不得反向导入知乎实现，不得查询知乎业务表。业务间也不得通过公共兼容导出互相调用实现。

公共项目只保存名称、标识和启用状态，不再要求填写知乎 API 地址或签名方式。公共接入账号用 `(module_id, account_key)` 唯一标识，同一个外部账号字符串可以属于不同平台；项目通过 `project_integrations` 关联账号。

## 2. 模块契约与接入方式

契约定义见 `server/src/core/contracts.ts`，当前契约版本为 `1`。模块声明唯一 ID、版本、可见角色、能力、入口、权限和接入账号创建方式，提供路由及可选的启动/停止钩子、数据提供器、财务提供器。注册采用代码中的明确清单，仍为模块化单体；不引入动态插件市场、微服务或企业租户。

- 权限名称在模块内声明，公开后自动增加模块前缀，例如 `zhihu.data.import`。
- `accountCreation=self_service` 允许管理员创建接入账号；`managed` 表示由模块安装/配置流程管理，并向用户显示原因。
- 数据汇总必须携带 `moduleId/accountId/projectId/from/to`，返回查询范围、更新时间、状态、指标名、单位和值。公共层先检查项目成员和账号关联，再调用提供器；不匹配范围、提供器报错或超过 5 秒，返回该模块 `unavailable`。
- 没有数据使用 `empty` 或空值；不同平台、账号、单位的数据分别展示，不擅自相加成收入或余额。
- 初始化或同步启动钩子失败会使模块不可用；公共应用仍可启动，失败模块的规范入口、兼容入口和原始请求入口均不对外服务。异步任务失败仍由任务队列处理，模块提供器应自行实现请求取消和重试策略。
- 模块启停在进程启动时确定，变更后重启；本期没有后台热安装/热卸载。

`server/examples/sample-api/module.ts` 演示不经过邮件的 HTTP 数据适配：从本地模拟 API 获取计数、校验结果、转为公共汇总。它仅用于示例和隔离验收，未加入生产模块清单，也没有假装连接某个真实平台。

接入下一平台时：新增模块及自己的 schema；在后端组合清单和迁移安装分派中注册；在需要独立业务页面的前端注册路由；实现账号凭证管理和数据提供器；执行公共边界及隔离验收。仅做只读数据接入时，不要求复刻知乎页面和导入流程。

## 3. 公共 API

统一响应沿用 `{code, data, message}`。除健康检查外，下列接口均需登录；金额、外部 ID 使用字符串，保持精度和来源语义。

| 入口                                                              | 用途/约束                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| `GET /healthz`                                                    | 公共应用存活检查，不代表模块或数据库均健康               |
| `/api/v1/core/auth/*`                                             | 登录、刷新、当前用户、退出；刷新 Cookie 路径为 `/api/v1` |
| `/api/v1/core/projects/*`                                         | 公共项目、项目成员和课程信息                             |
| `/api/v1/core/team/*`                                             | 团队成员和入团流程                                       |
| `/api/v1/core/mcn-accounts`                                       | 现有运营账户管理，保留兼容数据模型                       |
| `/api/v1/core/admin-tools/*`                                      | 公共站点/运行信息和原有公共管理能力                      |
| `/api/v1/core/announcements/*`、`/api/v1/core/audit-logs`         | 公告、审计                                               |
| `GET /api/v1/core/modules`                                        | 当前角色可见的模块及 enabled/disabled/unavailable 状态   |
| `GET/POST /api/v1/core/integrations`                              | 查看/创建账号；创建需要 `module.manage`                  |
| `PATCH /api/v1/core/integrations/:id`                             | `{status: active或disabled}`；需要 `module.manage`       |
| `GET /api/v1/core/projects/:projectId/integrations`               | 该项目的账号关联                                         |
| `POST /api/v1/core/projects/:projectId/integrations`              | `{accountId}`；需要 `project.manage`                     |
| `DELETE /api/v1/core/projects/:projectId/integrations/:accountId` | 移除项目关联；保留账号和业务数据                         |
| `GET /api/v1/core/modules/:moduleId/summary`                      | 必填 `projectId/accountId/from/to`；日期为 `YYYY-MM-DD`  |
| `GET /api/v1/core/finance`                                        | 返回 `not_connected` 与能力声明，不返回虚构余额          |
| `/api/v1/core/finance/*`                                          | 本期无资金写入实现，返回 501                             |
| `/api/v1/modules/zhihu/*`                                         | 已启用知乎模块的规范入口                                 |

旧 `/api/v1/plans`、`/api/v1/data-import` 等业务入口及 `/api/alliance/api` 只在知乎启用时挂载。旧 `/api/v1/projects` 在知乎启用时保留旧项目参数契约，新页面始终调用 `/api/v1/core/projects`。后端旧源码路径只保留兼容再导出；新增代码应直接使用所属核心/模块路径。

## 4. 运行与构建

现有包名 `@zhihu-koc/*`、数据库/Compose 名称保留用于部署兼容，名称不代表公共核心依赖知乎。前端沿用 pnpm 工作区，后端在 `server` 下由 npm 管理。

公共环境变量：数据库 `DB_*`、安全的 `JWT_SECRET`、`PORT` 等。`OPC_MODULES` 默认为空，表示不加载任何业务模块。公共核心不要求知乎凭证或回调加密密钥。生产 JWT 仍必须安全配置。

在 PowerShell 中，独立 API 核心：

```powershell
cd D:\zhihu\server
$env:OPC_MODULES=''
npm run migrate
npm run build:core
npm run start:core
```

`start:core` 只启动公共 API，不加载业务组合或三端静态页面。迁移前应使用目标环境的正确数据库配置。迁移只建立 schema。首次空库需先设置 ADMIN_USERNAME/ADMIN_PASSWORD，再执行 npm run bootstrap:admin；密码少于 8 位会拒绝初始化。已有用户的库不会被 bootstrap 重置。

托管三端并按需加载业务模块：先在仓库根目录执行 `pnpm build`，再在 `server` 下执行 `npm run build`、`npm run migrate` 和 `npm start`。三个工作台地址分别为 `/admin/`、`/leader/`、`/creator/`。生产 Docker 两个构建入口均已包含新 `schema` 目录。

只构建公共前端：

```powershell
cd D:\zhihu
$env:VITE_OPC_CORE_ONLY='1'
pnpm --filter 'platform-*' exec vite build --outDir dist-core
Remove-Item Env:VITE_OPC_CORE_ONLY
```

该命令生成各端 `dist-core`，需按静态托管目录约定部署；默认托管目录仍是 `dist`。使用纯公共前端时同步关闭后端业务模块。常规 `pnpm build` 支持按后端模块状态加载知乎的独立页面块。

已有知乎部署升级时必须显式设置 `OPC_MODULES=zhihu`，继续提供模块所需 `ZHIHU_*`、回调加密密钥和生产联盟配额配置。`DEFAULT_PROJECT_ID` 必须指向实际的知乎业务项目 ID；不要假设在已有公共项目的新库中它必然为 1。首次管理员初始化不再自动同步知乎目录，数据同步从知乎模块主动发起。

## 5. 数据升级与回退

入口：`server/scripts/opcMigrations.ts`。新的 schema 分为 `core`、`extensions`、`legacy-core`、`zhihu`，原 `server/migrations` 历史文件保留。

1. 空库先建公共表及扩展表；不启用知乎时不创建渠道、计划、收益或导入批次表。
2. 旧库必须已有迁移记录，缺失时停止自动升级；按历史记录补公共迁移，增加模块/账号/关联表。
3. 只有启用知乎时才安装知乎 schema，生成 `legacy` 历史接入账号，并关联知乎项目以及存在渠道、任务、计划、指标或收益历史的项目。旧用户、项目及金额原样保留。
4. 旧项目 API/签名字段放宽为空，供兼容业务使用；另存 `zhihu_account_settings` 作为配置快照。本期公共接口已不读这些字段；快照尚不是旧知乎服务的唯一配置来源。
5. 关闭模块不会删表、删账号或清空收益。再次启用可重复执行迁移，保留原 ID。

生产升级前备份并在副本演练，暂停旧实例的业务写入。MySQL DDL 不保证整批事务回滚，部分失败必须按迁移记录诊断后继续，不能靠回滚应用代码撤销数据库变更。

队列名称改为 `opc-jobs`，知乎任务及去重键包含模块、任务名、账号和项目。升级前先排空并确认旧 `zhihu-bff` 队列（以旧部署配置为准）的未完成任务；不自动搬运或重新播放金融任务。回退应用时保留数据库和卷，保持新表，不执行 down/清库；已创建仅公共字段的项目不一定被旧版本兼容，回退应使用已演练的兼容版本或停写备份恢复流程。

## 6. 本期边界

- 知乎完整业务实现已经归入模块，但旧适配仍使用历史单连接凭证。公共骨架支持多平台、多账号；本期没有把知乎改为真正多套独立凭证运行，界面和 API 均阻止创建不可用的额外知乎账号。
- 知乎暂未提供经过口径验证的公共汇总，工作台会明确显示未提供/不可用，历史数据仍在知乎模块查看。
- 公共财务只建立独立入口和接口契约。旧知乎资金流程与 Gate 原样保留，不进行重算、迁账或开放新提现能力。旧 relay 和 settleEarnings 的分成算法差异仍需独立财务专项处理。
- 保留原有未提交开发成果，包括邮件/Excel 导入和归因相关迁移；本次未提交 Git、未操作实际生产部署，也未对真实业务库执行升级。
- 本地演示模式用于页面浏览，原有部分演示写操作不持久化；真实数据行为以隔离 MySQL 验收为准。

## 7. 验收记录与复现

```powershell
# 仓库根目录：后端类型/独立构建 + 前端类型/构建 + OPC 隔离验收
pnpm verify:opc
# server 目录：旧单测基线（目前包含已知失败）
npm run test:unit
```

OPC 验收使用自行创建和清理的 MySQL 测试容器及本地 HTTP 模拟上游，不清理既有业务库。覆盖空库独立运行、登录与 Cookie 兼容、无知乎配置创建项目、模块关闭无接口、账号/项目隔离、API 数据转换、模块故障隔离、非法日期、范围不匹配、公共财务拒绝写入、重复安装与旧金额/ID 保留。

浏览器验收脚本为 `server/tests/opc-ui/smoke.cjs`，需要 Playwright 与可用浏览器。先运行 `pnpm build`，再指定可选 `OPC_PLAYWRIGHT_MODULE`（已安装模块路径）和 `OPC_BROWSER_CHANNEL`（默认 msedge）后执行 `node server/tests/opc-ui/smoke.cjs`。脚本为每个角色开启独立演示服务，只绑定回环地址，数据库端口设为 1，阻止浏览器外部请求，不启动业务调度器。

本次验收结果：后端类型检查、独立核心构建、前端 11 个类型检查任务、三端常规构建和三端纯公共构建通过；OPC 13 项验收通过；浏览器 6 个组合（3 角色 × 知乎开/关）通过，含退出重登、业务导航、邮件入口与移动端无横向溢出。

旧单测仍为 **174 通过 / 13 失败**，与重构前基线一致，没有通过删除旧测试掩盖：

| 旧测试文件                 | 失败数 | 既有问题                                   |
| -------------------------- | ------ | ------------------------------------------ |
| `a001-spec.spec.ts`        | 6      | 规范证据/生成产物与字节稳定性漂移          |
| `catalog-scope.spec.ts`    | 1      | 旧渠道可见性预期与共享目录实现不一致       |
| `withdrawals-gate.spec.ts` | 6      | 旧路由、角色和 mock/数据库依赖未与现状对齐 |

源码归属迁移清单另见 `OPC源码迁移清单.md`。本次运行的截图和原始结果保存在本地忽略目录 `.opc-work/ui`、`.opc-work/legacy-unit-final.json`，不作为产品数据提交。
