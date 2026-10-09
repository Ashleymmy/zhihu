# OPC 平台聚合系统

OPC 提供公共身份、组织、项目、模块接入和统一工作台。知乎是可选业务模块，邮件/Excel 数据处理及历史财务均属于知乎；后续平台可以通过自己的 API 直接提供数据。

- 统一入口：`/app/`（旧 `/admin/`、`/leader/`、`/creator/` 地址会自动跳转）；源码按角色复用三端页面。
- 登录与注册共用一个入口；公开注册创建未入团达人账号，管理员、团长身份由现有账号管理分配，登录后依据服务端当前角色和权限加载工作台。
- 公共后端：`server/src/core` 及公共身份/组织服务；组合入口在 `server/src/composition`。
- 知乎实现：后端 `server/src/modules/zhihu`，前端各端 `src/modules/zhihu`。

**运行、迁移和验收以 [OPC 公共核心重构说明](docs/OPC公共核心重构.md) 为准。** `OPC_MODULES` 默认空；已有知乎部署升级必须显式设置 `OPC_MODULES=zhihu`。公共核心不要求知乎凭证。当前整改要求以根目录 `AGENTS.md` 指向的任务书和规范为准。

`pnpm verify:opc` 执行公共核心与统一前端构建、类型检查和隔离数据库验收；旧单测的 13 项既有失败见上述说明。

## 平台任务与待办

模块契约版本 2 增加可选的 `todoProvider`、`taskProvider` 和 `rateProvider`，运行时仍接受版本 1。平台任务页与任务大厅统一调用 `/api/v1/core/tasks`，按项目和用户权限聚合；详情和动作分别使用 `/:moduleId/:accountId/:taskId` 与其 `/actions/:action` 子路径。项目提供器负责真实业务权限、使用权和动作校验，公共核心不读取项目表。

`server/examples/sample-api` 演示第二个 API 型项目接入同一任务与待办页面，仅连接本地模拟服务，不注册到生产。验证命令：`cd server && npx vitest run --config vitest.opc.config.ts tests/opc/tasks.integration.spec.ts tests/opc/boundaries.spec.ts`；知乎适配器验证为 `npx vitest run --config vitest.attribution.config.ts tests/attribution/platform-tasks.spec.ts`。真实页面回归为 `node tests/attribution-ui/platform-tasks.cjs`，使用隔离数据库与模拟上游，需先完成 Web 构建并配置本机 Playwright。

## 平台收益数据

平台迁移 `015_earning_lines.sql` 新增收益来源和按收款人保存的收益明细。模块在自己的计算事务内调用 `core/earnings.ts` 的 `writeEarningLines(connection, scope, input)`，提交任务名称、业务日期、业绩类型、本人数量与单价、金额、阻塞原因和下一步。没有金额时传 `null`；管理员业绩标记为 `internal`。财务确认通过 `confirmEarningSource` 从这些明细生成公共资金分配，确认后的收益行不再修改，更正生成新行和资金差额。

平台读取使用 `GET /api/v1/core/earnings/mine`，支持日期、项目、账号、业绩类型、本人作品/团队分成、搜索与分页；收款人始终来自登录身份，运营岗位无金额权限。返回 `scopes`、当前页 `list`、按项目及类型的 `groups` 和 `summary`。`GET /api/v1/core/earnings/:id/history` 只返回本人的确认与更正凭据。关闭模块后不返回其收益入口或数据；这些接口不查询任何项目专属表。

`016_earning_source_actions.sql` 为当前来源状态补充可空的下一步指引，可重复执行；模块调用 `blockIncome` 时可同时提供处理人和动作。发生争议时平台显示最新处理指引，解除后再由财务核对，原确认收益行及资金行不改写。升级 API 前先执行平台迁移；旧版忽略该新增字段，回退保留字段及数据。

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

原始拉活 Excel 的闭环复验：Web 构建后，在仓库根目录设置 `OPC_REVIEW_ORIGINAL_ACTIVATION=1`、`OPC_ACTIVATION_SAMPLE=本机原件绝对路径`、`OPC_PLAYWRIGHT_MODULE=本机Playwright模块路径`，运行 `node server/tests/attribution-ui/remediation-smoke.cjs`。该专项针对本次四行、五个拉活量的原始样本，使用自动回收的 MySQL 容器和演示成员完成类型纠正、历史登记、作品核验、财务确认及六角色隔离检查。原件始终在仓库外，脚本校验上传前后及下载内容一致；含业务名称的截图只写入被忽略的 `.opc-work/remediation-review/original-activation`，不要纳入提交。

## 历史账目

平台 `/finance` 按有权访问的项目显示统一财务页面。`GET /api/v1/core/finance/workspace` 提供项目范围，`/entries` 只读平台确认资金和对应收益明细，按项目、账号和日期分页；运营及成员不可访问。模块可在前端组合层注册现有业务面板，知乎继续提供上传、分析及账单确认；没有专用面板的项目直接使用共享已确认账目、款项开放和提现付款组件，无需改页面。公共接口不生成账单、不越过模块的确认条件，也不查询项目专属表。

隔离验证：Web 构建后运行 `node server/tests/attribution-ui/platform-isolation.cjs`；设置 `OPC_REVIEW_SAMPLE=1` 时启用两个示例项目，否则关闭所有模块。脚本使用本机 Docker 的独立 MySQL，六角色检查首页、任务、收益及财务在 1440/375 宽度的显示，示例模式还实际完成任务领取、两个项目分别开放资金及同一达人分别申请提现；不注册生产示例项目，也不发送实际付款。

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
- 本次包含角色计价切换，先用 `deploy/pause_timo_api.py --state paused` 预览，再加 `--apply` 短暂暂停两处入口的 `/api/` 请求（含小程序网关），返回“系统正在更新，请稍后重试”；静态页面和健康检查继续可用。随后暂停公共 `opc-jobs` 队列并等待在途请求和任务完成。新旧计算实例不能并行处理来源。
- 在暂停期间更新两处 Nginx 入口、检查配置并平滑加载，停止旧实例并保留其容器和镜像。由候选版本依次预览/执行开始日期修复、未确认拉新角色价转换和平台收益补录，核对原确认账及资金不变；只执行经过备份副本演练的脚本。
- 单独启动同一新镜像的后台实例（`RUN_BACKGROUND_JOBS=true`，不映射公网端口，直接运行服务、不再次迁移），恢复队列。Web 实例继续禁用后台任务；后续切换必须同时跟踪 API 和后台实例的版本。
- 新后台及最终 API 就绪后，用 `deploy/pause_timo_api.py --state open --apply` 恢复接口；它只删除自己的暂停标记，保留最新候选端口，不把入口切回旧版。暂停工具也默认仅预览，每次变更备份两份配置并验证 Nginx，失败时恢复原配置。暂停期间不要结束发布任务，若发生异常先修复或按兼容回退步骤恢复服务。
- 保留上一版静态资源供已打开的页面加载，切换后核验公网页面、认证、财务权限、队列进度及错误日志。回退应用不回灌旧数据库、不删新增业务数据。若旧版无法理解新增业绩类型，产生此类数据后不能直接恢复旧消费者，必须使用兼容版本或向前修复。

发布镜像在候选镜像构建完成后用 `deploy/Dockerfile.release` 合并上一版静态资源：

```bash
docker build -f deploy/Dockerfile.release --build-arg CANDIDATE_IMAGE=zhihu-koc:<新提交号>-build --build-arg PREVIOUS_IMAGE=zhihu-koc:<当前在线提交号> -t zhihu-koc:<新提交号> .
```

只合并 `assets/`：入口 HTML 和运行命令仍来自候选镜像，重名资源使用候选文件。执行前从在线容器核实上一版镜像，不把示例标签直接用于生产。蓝绿候选和后台实例均显式覆盖命令为 `node dist/src/index.js`。 2026-10-09 已用独立合成镜像实测旧资源保留、新入口保留、重名资源以新版为准、候选运行配置保留及非 root 读取通过；演练镜像已清理，未重启线上服务。

后台开关回归：`cd server && npx vitest run tests/unit/background-runtime.spec.ts`。

应用退出先停调度、等待 HTTP 请求结束，再等待 Bull 活动任务完成，最后释放模块连接和公共数据库连接。模块的 `dispose()` 不得提前关闭在途任务使用的资源。关闭未使用的懒连接 Redis 时直接断开，避免 `QUIT` 反而建立新连接。2026-10-09 隔离完整镜像演练中，候选业务接口返回预期状态，退出从超时 20 秒被强制结束修复为约 0.2 秒、退出码 0；实际 Bull 活动任务在退出期间等待 2.5 秒并成功读取数据库后，后台容器才以 0 退出。请求/任务完成顺序、重复退出信号和模块清理失败的回归已通过。演练使用生产备份副本及专用 Redis，未修改生产入口或数据。

拉活写入由 `ZHIHU_ACTIVATION_ENABLED` 控制，默认关闭。 首次启用采用两步切换：先把流量切到该开关仍为 `false` 的新版 API，停止旧应用及旧后台；新版后台就绪后，再把两处入口切到同镜像、开关为 `true` 的另一个 API 实例。两个 API 均为 `RUN_BACKGROUND_JOBS=false`，使用不同的预留端口；第二次切换前核验新后台已接管。这样启用新类型之前，旧消费者已退出，同时 API 持续可用。只有拉活计价、隔离迁移与角色验收全部通过、旧版后台消费者停止并换成兼容版本后，才可在新 API 和后台实例中设为 `true`。迁移 `029_metric_types.sql` 保留旧插入的 `new_user` 默认值，并原子替换同日同词的唯一键；它可重复执行。产生拉活数据后，不能把处理这些数据的后台实例退回不识别类型的版本。

新版财务 Web 请求和确认 `/workbench` 时携带 `viewVersion=2`。未传版本的客户端继续使用拉新账单，`entries` 只含已算出金额的行，不能确认隐藏的拉活记录；未计价行保留在 `pendingEntries`，避免旧小程序把空金额显示成零。小程序完成分类型和空金额展示改造后再升级到版本 2。

拉活计价使用平台迁移 `013_rate_rules.sql` 和知乎种价迁移 `030_activation_rates.sql`。029 已可独立发布，因此不向已执行的 029 追加种价。新安装在项目关联建立后补执行同一份幂等种价 SQL；已有规则不会被覆盖。服务层 `summary.byType.new_user` 经现有响应序列化后为 HTTP 字段 `summary.byType.newUser`，`metricType` 的值仍为 `new_user`；拉活使用 `activation`。旧的 `summary.orders`、`payable`、`receivable` 及对应确认金额仍只统计拉新。管理员业绩不计入应付、收款分配和公共资金记录。

入口切换工具为 `deploy/switch_timo_upstream.py`（ECS 的 Python 3，无额外依赖）。先执行预览，完成上面的迁移、队列和角色验证后再加 `--apply`：

```bash
python3 deploy/switch_timo_upstream.py --from-port 3202 --to-port 3212 --candidate-container zhihu-green-<提交号>
```

工具核对指定容器发布的端口、应用健康、知乎业务路由确已启动（未认证请求应返回 401，不能是模块未加载的 404），以及两个入口到候选实例的可达性；只替换 Timo 配置中原端口对应的地址。实际切换会备份原配置、校验两处 Nginx 并平滑加载，校验或加载失败时恢复原入口配置。不会自动运行迁移、切换消费者或删除旧容器。备份和操作回执保存在 ECS 的 `/home/ecsdiag/zhihu-app/bluegreen/`。切流后仍需独立验证实际域名请求与业务接口。镜像演练必须带齐线上已有的配额策略等必要配置；隔离演练只使用测试密钥、测试 Redis 和无外网数据库副本。

工具回归：`python3 -m unittest discover -s deploy -p 'test_switch*.py'`。2026-10-09 已在独立测试容器演练默认预览不切流、两入口切换及反向切换；演练未改动生产入口。

计价交接工具回归：`python3 -m unittest discover -s deploy -p 'test_*.py'` 共 10 条通过。隔离双入口实际演练预览不变、API 与小程序网关暂停、静态/健康可用、暂停中切候选、恢复后仍保留候选、重复恢复不修改配置。最初的 Nginx 指令位置错误在隔离演练中被拦截并自动恢复；修正后完整流程通过，生产配置指纹不变。

### 2026-10-09 已执行的生产更新

北京时间 12:22 完成 Web/API 与后台交接，运行代码为 `7a106e3`，镜像 `zhihu-koc:7a106e3`，摘要 `sha256:966f3d65c589e12d7bed4fb08fb01c461c0e0071d6f36a5648792cdef954b17f`。HTTP/HTTPS 两处入口均转到 `zhihu-green-7a106e3-b` 的 3213 端口；同镜像后台为 `zhihu-worker-7a106e3`，仅后台启动消费者和定时任务。两个实例均已开放拉活类型。旧 `zhihu-final-app-1` 已停止，数据库、Redis 和上传目录沿用原实例。

接口暂停 20.46 秒，完成队列排空、旧实例退出、开始日期修复 1 条、未确认角色价转换 0 条、平台收益补录 9 条，三项重复执行均为 0 条。原确认账、资金、提现和旧价格证据校验不变；队列恢复后待处理和执行中均为 0，历史失败任务 36 条与切换前一致，没有重放或清除。公网页面及健康检查返回 200，受保护的业务接口未登录返回 401，API/后台无新增错误日志、重启次数为 0。旧版 163 个静态资源全部保留，新镜像合计 314 个资源。

切换前完整备份、两处入口配置和回执位于 ECS 的 `/home/ecsdiag/zhihu-app/bluegreen/precutover-20261009T042242Z/`，回执为 `cutover-receipt.json`。该目录含私有配置，只在服务器受限目录保留，不提交仓库。发布前已用最新备份在无外网数据库中演练最终镜像的迁移、修复及幂等性。

兼容备用实例 `zhihu-green-7a106e3-a` 保留在 3212，代码相同、拉活入口关闭、后台关闭。需要切换时先检查健康，再沿用入口工具和同版本后台；不能重新启动 `5ff5794` 的旧计算程序，也不能恢复旧数据库覆盖新记录。用户提供的拉活原件仅用于隔离验收，本次没有将该文件导入生产或执行实际付款。此记录只代表 Web/后端已上线，小程序另行完成工具验收、云函数部署及版本上传。

北京时间 13:15 补发只读收益提示修复 `4bcfdec`：当前 HTTP/HTTPS 入口均为 `zhihu-green-4bcfdec`（3214），后台 `zhihu-worker-4bcfdec`，镜像摘要 `sha256:95ace1d7a668887ff53489d5377db642b9cf8c54bbe15e3b9554ee7cf546f78c`。已确认且没有待处理问题的收益不再提示财务重复确认；争议和待重新核对指引继续优先。没有新增迁移、计价或写账变更，此次未暂停 API，仅排空队列后交接后台。原 314 个静态资源全部保留，公共健康/页面与权限检查通过，队列失败数仍为既有 36 条，API/后台均无重启。

补发前备份在 `precutover-20261009T051521Z/`，回执在 `guidance-cutover-20261009T051551Z/receipt.json`（均位于上述 bluegreen 目录）。`7a106e3-b` 的 3213 入口实例保留，`zhihu-worker-7a106e3` 已停止；它们可以作为本次只读修复的兼容回退版本。回退时仍只运行一个后台消费者实例，保留当前数据库，不恢复 `5ff5794`。

北京时间 16:45 发布用户反馈修复 `c15487a`（实施提交 `31aeeff`）：当前 HTTP/HTTPS 入口均为 `zhihu-green-c15487a`（3215），后台 `zhihu-worker-c15487a`，镜像摘要 `sha256:a39bfb0faead7e4956aa1e773084253413fdb0dea77d11045652f8ea10381483`。原同名计划与执行人可在报表分析中核对沿用，历史开始日期和作品可从明细处理，保存后更新状态、金额及待办。本次无迁移或自动数据修复，未暂停 API；旧 314 个静态资源全部保留，新包共 446 个。公网页面/健康 200、受保护接口未登录 401、API/后台零重启，队列恢复且失败仍为既有 36 条。

本次备份为 `precutover-20261009T084456Z/`（SQL 2227477 字节，SHA-256 `7e71076075167ee50aa1eb27503d2ab6450e4527200fee5ef5a869e1f979140d`），回执为 `feedback-cutover-20261009T084532Z/receipt.json`。兼容回退保留 `zhihu-green-4bcfdec`（3214）及已停止的 `zhihu-worker-4bcfdec`；回退仍沿用现有数据库并确保仅一个后台消费者。发布包从提交归档构建，明确排除本地尚在验证的小程序页面及新业绩接口。

北京时间 17:29 发布 `2fc2fd8`（报表清理与重分析 `22234da` 合入，同时包含只读业绩及作品筛选 `b3c917b`）：当前 HTTP/HTTPS 入口为 `zhihu-green-2fc2fd8`（3216），后台 `zhihu-worker-2fc2fd8`，镜像摘要 `sha256:f4a9cf7f4555647a56dd37e85a9c4f04ba5ef4f31ce990fdc128832c93222a11`。先备份，再执行纯加表迁移 `037_import_history.sql`，既有报表、账目和资金记录逐行指纹一致。候选及公网健康/页面 200，受保护接口未登录 401，API/后台零重启；仅交接队列后台，API 未暂停，历史失败数仍 36。旧 446 个静态资源全部保留，现 578 个。

备份为 `precutover-20261009T092831Z/`（SQL 2245202 字节，SHA-256 `09dcbbac7ebb49c0a6a81f8c803f3b51c4734eb051c9f162c1710e5e08d06ee9`），迁移回执 `migration-037-2fc2fd8.json`，切换回执 `feedback-cutover-20261009T092920Z/receipt.json`。保留兼容回退 API `zhihu-green-c15487a`（3215），其后台 `zhihu-worker-c15487a` 已停止；回退可保留新表和现有数据，仍仅运行一个消费者。发布包来自干净提交归档，不含本地未完成验收的小程序页面。

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

### 报表旧记录与执行进度修复（2026-10-09）

报表确认关键词时优先查找同项目、同渠道的同名旧计划，展示原执行人和作品数量，由运营选择“沿用原记录与执行人”；原计划号、作品、上传原文与已确认金额保留。同名旧记录存在时不再推荐相似的新关键词，短词的相似候选只容许一个字的差异，候选仍需人工确认。多执行人或多接入来源的旧记录继续阻止合并。

数据待办的操作资格统一为布尔值，避免 MySQL 返回字符串 `0` 导致“尚未登记代理名称”误显示“指定执行人”。金额明细新增“核对执行与作品”入口：运营可以给现有执行人补实际开始日期与历史作品，随后就地进入作品核验，自动更新未确认报表；不允许借此变更执行人或越权处理。财务可查看进度，不能补录执行资料。已读取但仍需处理的报表、暂未生成的账单、结果更新时间都有明确反馈；上传和保存后同时刷新分析、金额与数据待办。

专项运行：Web 构建后，设置 `OPC_REVIEW_FEEDBACK_ONLY=1` 和可选的 `OPC_PLAYWRIGHT_MODULE`，在 `server` 下运行 `node tests/attribution-ui/remediation-smoke.cjs`。隔离数据库会自动回收，不访问生产；截图留在 `.opc-work/remediation-review/feedback-*`。

### 报表记录清理与重新分析（2026-10-09）

财务页在上传框下提供“上传记录”，可查看全部分页记录、重新分析原文件、选择修正文件重新上传、清理和恢复；当前分析也提供同样入口及“收起分析”。清理只将记录移入“已清理”，不撤销业绩、不删除待办或原文件、不改已确认账单，操作前说明实际后果。正在读取的报表须先处理完成。

上线先执行模块迁移 `037_import_history.sql`，只增加 `zh_import_history_archive` 表，重复执行保留全部数据。重新分析仅重试未匹配行并刷新未确认结果，保留人工选择；同文件重传恢复记录并重新检查，不新增同份报表或重复计账。更正文件仍进入原值与新值核对流程。清理、恢复及重新分析仅财务或完整管理员可操作，服务端校验岗位和项目范围。

专项运行：`cd server && npx vitest run --config vitest.attribution.config.ts tests/attribution/import-history.spec.ts`。Web 构建后，设置 `OPC_REVIEW_IMPORT_HISTORY_ONLY=1`、可选 `OPC_PLAYWRIGHT_MODULE`，运行 `node tests/attribution-ui/remediation-smoke.cjs`，在隔离数据库中检查六角色、1440/375 页面和实际上传操作。

2026-10-09 财务旧作品衔接修复：`server/scripts/reconcile-registered-works.ts` 为显式发布修复工具。使用 `npx tsx scripts/reconcile-registered-works.ts --project 1 --account 1 --actor 财务人员ID` 先预览，备份与隔离验证后追加 `--apply` 更新已有作品相关的未确认记录。重复执行不重复记账，不确认账单、不指定缺失执行人、不修改已确认账或调用知乎。原件页面演练：设置 `OPC_NEW_USER_SAMPLE`、`OPC_ACTIVATION_SAMPLE` 为本机两份文件路径，`OPC_PLAYWRIGHT_MODULE` 为可用 Playwright 路径，然后在 server 运行 `node tests/attribution-ui/reconciliation-flow.cjs`；脚本创建并回收独立 MySQL，截图含原件关键词，仅保存在忽略目录。
