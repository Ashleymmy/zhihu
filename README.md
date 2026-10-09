# OPC 平台聚合系统

OPC 提供公共身份、组织、项目、模块接入和统一工作台。知乎是可选业务模块，邮件/Excel 数据处理及历史财务均属于知乎；后续平台可以通过自己的 API 直接提供数据。

- 统一入口：`/app/`（旧 `/admin/`、`/leader/`、`/creator/` 地址会自动跳转）；源码按角色复用三端页面。
- 登录与注册共用一个入口；公开注册创建未入团达人账号，管理员、团长身份由现有账号管理分配，登录后依据服务端当前角色和权限加载工作台。
- 公共后端：`server/src/core` 及公共身份/组织服务；组合入口在 `server/src/composition`。
- 知乎实现：后端 `server/src/modules/zhihu`，前端各端 `src/modules/zhihu`。

**运行、迁移和验收以 [OPC 公共核心重构说明](docs/OPC公共核心重构.md) 为准。** `OPC_MODULES` 默认空；已有知乎部署升级必须显式设置 `OPC_MODULES=zhihu`。公共核心不要求知乎凭证。公共财务本期只建独立入口和契约。

`pnpm verify:opc` 执行公共核心与统一前端构建、类型检查和隔离数据库验收；旧单测的 13 项既有失败见上述说明。

## 平台任务与待办

模块契约版本 2 增加可选的 `todoProvider`、`taskProvider` 和 `rateProvider`，运行时仍接受版本 1。平台任务页与任务大厅统一调用 `/api/v1/core/tasks`，按项目和用户权限聚合；详情和动作分别使用 `/:moduleId/:accountId/:taskId` 与其 `/actions/:action` 子路径。项目提供器负责真实业务权限、使用权和动作校验，公共核心不读取项目表。

`server/examples/sample-api` 演示第二个 API 型项目接入同一任务与待办页面，仅连接本地模拟服务，不注册到生产。验证命令：`cd server && npx vitest run --config vitest.opc.config.ts tests/opc/tasks.integration.spec.ts tests/opc/boundaries.spec.ts`；知乎适配器验证为 `npx vitest run --config vitest.attribution.config.ts tests/attribution/platform-tasks.spec.ts`。真实页面回归为 `node tests/attribution-ui/platform-tasks.cjs`，使用隔离数据库与模拟上游，需先完成 Web 构建并配置本机 Playwright。

## 平台收益数据

平台迁移 `015_earning_lines.sql` 新增收益来源和按收款人保存的收益明细。模块在自己的计算事务内调用 `core/earnings.ts` 的 `writeEarningLines(connection, scope, input)`，提交任务名称、业务日期、业绩类型、本人数量与单价、金额、阻塞原因和下一步。没有金额时传 `null`；管理员业绩标记为 `internal`。财务确认通过 `confirmEarningSource` 从这些明细生成公共资金分配，确认后的收益行不再修改，更正生成新行和资金差额。

平台读取使用 `GET /api/v1/core/earnings/mine`，支持日期、项目、账号、业绩类型、本人作品/团队分成、搜索与分页；收款人始终来自登录身份，运营岗位无金额权限。返回 `scopes`、当前页 `list`、按项目及类型的 `groups` 和 `summary`。`GET /api/v1/core/earnings/:id/history` 只返回本人的确认与更正凭据。关闭模块后不返回其收益入口或数据；这些接口不查询任何项目专属表。

已有知乎计算结果在发布时需要补入新收益表。在已配置目标数据库的服务目录运行 `npx tsx scripts/backfill-earning-lines.ts --project 项目ID --account 账号ID --actor 财务人员ID`，默认只预览；检查后增加 `--apply`。每个项目账号分别执行，整个范围在同一事务并使用业务锁；补录不重新计算，不改原报表、确认账和资金行，重复执行没有新增工作。先在备份隔离副本演练，再由发布流程执行。旧版本不会更新新收益表，因此切换收益页面前应退出旧计算实例、补齐已有记录，并保持 API 与后台使用同一兼容版本；回退保留新表和数据。

收益后端验证：`cd server && npx vitest run tests/opc/earnings.integration.spec.ts tests/attribution/workbench.spec.ts tests/attribution/staff-self.spec.ts tests/opc/boundaries.spec.ts`。平台 `/income` 汇总各项目的本人收益，支持查看计算过程、确认与更正凭据，并进入项目任务和提现。

## 拉新角色计价切换

P2 后，新计算使用平台 `opc_rate_rules`：达人取 `creator`，团长本人取 `leader_self`，团队分成取 `leader_override`，管理员本人取 `staff_self` 并只记录内部业绩。平台 `quoteRate` 使用字符串数量和整数金额运算。成员报价旧表保留作历史证据，旧写接口停用，旧页面引导到平台计费规则；已确认来源的数量更正始终使用原收款关系、单价及价格版本。

已有未确认拉新数据使用独立脚本转换。在配置好隔离副本数据库的 `server` 目录运行：

```bash
npx tsx scripts/migrate-new-user-role-rates.ts --project 项目ID --account 账号ID --actor 财务人员ID
```

默认仅输出原分配、新分配和缺价问题；增加 `--apply` 才在一个事务内重新计算该项目账号的未确认拉新。已确认来源、原确认账、公共资金和拉活不会被迁移；缺单价保持待处理，不当作零元。重复执行已转换范围返回零条，失败时全范围回滚。脚本要求财务权限，不能代替审核金额或开放资金。

发布前先在备份副本运行预览与执行演练。切换时暂停来源导入和财务写操作、等待在途请求及队列完成，退出所有旧计价 API/消费者，再由同一兼容版本执行角色价迁移及收益补录，核对后恢复处理。不能让新旧计价实例同时处理同一来源；产生角色分成记录后，回退须使用理解 `leader_override` 和冻结原价规则的兼容版本，不能直接恢复旧计价程序。原确认账和新增表均保留。本脚本不会连接上游或执行发布。

专项验证：`cd server && npx vitest run tests/attribution/new-user-rates.spec.ts tests/attribution/workbench.spec.ts tests/attribution/engine.spec.ts`；Web 构建后设置 `OPC_REVIEW_ROLE_PRICES_ONLY=1`，运行 `node tests/attribution-ui/remediation-smoke.cjs`，实际检查六角色的角色单价、旧入口和手机页面。

## 历史账目

模块可用可选 `financeHistoryPath` 声明只读历史入口；共享 `FinanceHistoryLinks` 从模块目录生成折叠入口。知乎旧收益、提现、申诉、结算及邮件 / Excel 页面保留原地址，统一显示只读记录、详情和去新财务入口。历史金额只按原存储单位显示，不重算或写回；团长及达人只读本人金额，运营岗位不能读取资金记录。历史发票仍可由本人或财务下载。

旧资金写接口（包括兼容地址）、旧导入确认和手工结算返回 410，历史账目停止新增；队列中残留的旧结算任务只记录停用结果，不生成旧收益，定时调度也不再投递它。当前平台资金接口与新报表处理不受影响。测试：`cd server && npx vitest run --config vitest.attribution.config.ts tests/attribution/legacy-finance.spec.ts`；真实角色页面验收 `node tests/attribution-ui/finance-history.cjs`。

## Docker 快速启动

```bash
cp .env.docker.example .env
# 编辑 .env，填入公共运行配置；仅启用知乎时填写其模块配置
docker compose up -d --build
docker compose ps
curl http://127.0.0.1/healthz
```

数据库迁移会在后端容器启动时自动执行。首次管理员初始化、云服务器安全组、HTTPS、备份和升级步骤见 [Docker 云端部署文档](docs/10-Docker云端部署.md)。

## 现有 ECS 蓝绿更新

Web 与后端先完成角色、金额和旧小程序接口回归，再发布；小程序在 Web 验收后更新。生产入口沿用现有 HTTP/HTTPS Nginx，两处必须切向同一个已验证实例，不重建数据库、Redis 或上传文件卷。

- 默认 `RUN_BACKGROUND_JOBS=true` 保持现有行为。候选 Web 实例使用 `RUN_BACKGROUND_JOBS=false` 和 `QUEUE_DRIVER=bull`：API 仍将任务写入持久队列，但不注册消费者、不启动定时任务和恢复扫描。不能搭配内存队列。
- 先记录在线镜像摘要、入口配置、环境文件和上传目录，备份数据库。新镜像先在隔离数据库演练迁移与回归；检查新增结构与旧版读写是否兼容，再单独执行生产迁移。候选容器覆盖启动命令为 `node dist/src/index.js`，避免每次启动重复迁移或初始化账号。
- 候选实例使用原有应用网络和上传目录，在未对外转发的端口完成健康、静态资源、登录和只读权限检查。验证期间不消费线上任务、不造演示数据、不向知乎发送测试业务。
- 切换前暂停公共 `opc-jobs` 队列并等待运行中的任务完成。确认新旧版财务读写兼容后，更新两处 Nginx 入口、检查配置并平滑加载；新入口验证成功后停止旧实例，保留旧容器和镜像。
- 单独启动同一新镜像的后台实例（`RUN_BACKGROUND_JOBS=true`，不映射公网端口，直接运行服务、不再次迁移），恢复队列。Web 实例继续禁用后台任务；后续切换必须同时跟踪 API 和后台实例的版本。
- 保留上一版静态资源供已打开的页面加载，切换后核验公网页面、认证、财务权限、队列进度及错误日志。回退应用不回灌旧数据库、不删新增业务数据。若旧版无法理解新增业绩类型，产生此类数据后不能直接恢复旧消费者，必须使用兼容版本或向前修复。

后台开关回归：`cd server && npx vitest run tests/unit/background-runtime.spec.ts`。

应用退出先停调度、等待 HTTP 请求结束，再等待 Bull 活动任务完成，最后释放模块连接和公共数据库连接。模块的 `dispose()` 不得提前关闭在途任务使用的资源。关闭未使用的懒连接 Redis 时直接断开，避免 `QUIT` 反而建立新连接。2026-10-09 隔离完整镜像演练中，候选业务接口返回预期状态，退出从超时 20 秒被强制结束修复为约 0.2 秒、退出码 0；实际 Bull 活动任务在退出期间等待 2.5 秒并成功读取数据库后，后台容器才以 0 退出。请求/任务完成顺序、重复退出信号和模块清理失败的回归已通过。演练使用生产备份副本及专用 Redis，未修改生产入口或数据。

拉活写入由 `ZHIHU_ACTIVATION_ENABLED` 控制，默认关闭。 首次启用采用两步切换：先把流量切到该开关仍为 `false` 的新版 API，停止旧应用及旧后台；新版后台就绪后，再把两处入口切到同镜像、开关为 `true` 的另一个 API 实例。两个 API 均为 `RUN_BACKGROUND_JOBS=false`，使用不同的预留端口；第二次切换前核验新后台已接管。这样启用新类型之前，旧消费者已退出，同时 API 持续可用。只有拉活计价、隔离迁移与角色验收全部通过、旧版后台消费者停止并换成兼容版本后，才可在新 API 和后台实例中设为 `true`。迁移 `029_metric_types.sql` 保留旧插入的 `new_user` 默认值，并原子替换同日同词的唯一键；它可重复执行。产生拉活数据后，不能把处理这些数据的后台实例退回不识别类型的版本。

新版财务 Web 请求和确认 `/workbench` 时携带 `viewVersion=2`。未传版本的客户端继续使用拉新账单，`entries` 只含已算出金额的行，不能确认隐藏的拉活记录；未计价行保留在 `pendingEntries`，避免旧小程序把空金额显示成零。小程序完成分类型和空金额展示改造后再升级到版本 2。

拉活计价使用平台迁移 `013_rate_rules.sql` 和知乎种价迁移 `030_activation_rates.sql`。029 已可独立发布，因此不向已执行的 029 追加种价。新安装在项目关联建立后补执行同一份幂等种价 SQL；已有规则不会被覆盖。服务层 `summary.byType.new_user` 经现有响应序列化后为 HTTP 字段 `summary.byType.newUser`，`metricType` 的值仍为 `new_user`；拉活使用 `activation`。旧的 `summary.orders`、`payable`、`receivable` 及对应确认金额仍只统计拉新。管理员业绩不计入应付、收款分配和公共资金记录。

入口切换工具为 `deploy/switch_timo_upstream.py`（ECS 的 Python 3，无额外依赖）。先执行预览，完成上面的迁移、队列和角色验证后再加 `--apply`：

```bash
python3 deploy/switch_timo_upstream.py --from-port 3202 --to-port 3212 --candidate-container zhihu-green-<提交号>
```

工具核对指定容器发布的端口、应用健康，以及两个入口到候选实例的可达性；只替换 Timo 配置中原端口对应的地址。实际切换会备份原配置、校验两处 Nginx 并平滑加载，校验或加载失败时恢复原入口配置。不会自动运行迁移、切换消费者或删除旧容器。备份和操作回执保存在 ECS 的 `/home/ecsdiag/zhihu-app/bluegreen/`。切流后仍需独立验证实际域名请求与业务接口。

工具回归：`python3 -m unittest discover -s deploy -p 'test_switch*.py'`。2026-10-09 已在独立测试容器演练默认预览不切流、两入口切换及反向切换；演练未改动生产入口。

## 知乎模块历史功能说明

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

### 拉活代理名称

运营或财务在项目设置、报表分析或数据待办填写本项目实际代理名称。提供了代理名称的拉活报表须与项目登记一致；名称未登记或不一致的行暂停计费，保存后自动核对未确认记录。名称列仍选填，不影响无该列的旧报表或拉新。设置按项目与账户隔离，迁移 `035_project_agencies.sql` 不改写已有账目；不要直接按外部报表内容替换项目实际签约名称。


### 平台模块隔离检查

`server/tests/attribution-ui/platform-isolation.cjs` 启动只含平台表的隔离 MySQL 和真实 Web 服务；`OPC_REVIEW_SAMPLE=0` 检查全部模块停用，设为 `1` 检查同一套首页/任务页面接入两个示例项目。脚本不连接生产或上游，启动要求内部 `REMEDIATION_REVIEW=1`，生产环境会拒绝。可通过 `OPC_PLAYWRIGHT_MODULE` 指定已有 Playwright 安装，浏览器使用 Edge。
