# 微信小程序 UI 基础设计方向

版本：v5（版式仿同类小程序 + 游客模式） · 适用范围：`weixin-app/miniprogram` 全部页面

> v5 变更：**只借鉴同类小程序的版式结构，配色维持 v4 白底品牌绿**。
> 产品定位为多渠道 OPC 业务平台（暂名 **TIMO**，知乎是已开通的首个渠道模块）。
> 首页版式：`.brand-row` 品牌区（logo + TIMO）→ `.banner` 广告位 →
> `.notice-bar` 消息通知条 → `.channel-grid` **渠道方块矩阵**
> （知乎已开通可进入业务；番茄/抖音/小红书等为占位"敬请期待"）→
> 业务范围卡 / 余额卡 / 快捷宫格。首页不再放刷新按钮。
> 登录页改为居中 logo + 内联标签输入框 + 大胶囊按钮 + 返回首页。
> 路由逻辑改为**游客模式**：未登录可直接进入 app 浏览首页/我的，
> 业务页显示登录引导态，点击具体功能（open/toLogin/openChannel）才跳登录页；
> 已登录用户的 mustChangePwd 强制改密、无权限 denied 态保持不变。

> v4 变更：参照同类 OPC 分销小程序产品图，整体从"深色渐变 hero"收敛为
> **白底为主的干净商业风**——品牌绿只出现在渐变金额卡、徽标、选中态和 CTA；
> 页面层次靠留白与轻投影。我的页从宫格改为单元格列表菜单，列表页推荐
> "文字页签 + 左图右价卡片"版式。
>
> v3 变更：结构从"顶部胶囊 role-nav"改为原生 **tabBar 五栏**（首页/任务/作品/
> 数据/我的）。

## 1. 方向定位

小程序**只沿用 Web 端主设计的品牌色（forest 绿）与业务气质，视觉表达按移动端
习惯重设计**：浅灰底、白色浮起卡片、无衬线粗标题、填充式圆角按钮。
v1 曾整体移植 Web 的 Editorial 编辑部主题（暖纸底、硬投影、衬线标题），
在小屏上显脏显重，已废弃。

- 底色不用米色/深色，用极浅暖灰 `#f5f6f5`，卡片纯白浮起，层次靠投影不靠边框
- 标题不用衬线，用系统无衬线 + 字重拉开层次；等宽字体只留给金额/编号/链接
- 按钮默认浅灰填充无边框，主操作才用品牌绿实底 + 轻投影
- 重边框、硬投影、大写字距标签全部取消

样式复用策略不变：**保留既有 class 契约**（.page/.card/.title/.tag/.metric/
.menu-grid 等），只重写 `app.wxss` 与组件 WXSS，11 个已迁移页面不改 WXML 即换肤。

## 2. 设计令牌（Design Tokens）

### 2.1 色彩

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--paper` | `#f5f6f5` | 页面底色（极浅暖灰） |
| `--paper-deep` | `#eef0ee` | 凹陷区块、默认按钮、分段页签轨道 |
| `--white` | `#ffffff` | 卡片/弹层纸面 |
| `--ink` | `#1d2723` | 正文、标题 |
| `--ink-soft` | `#7c8883` | 次要文字、说明、占位 |
| `--line` | `#e5e8e5` | 列表分隔线（卡片不用边框） |
| `--forest` | `#214239` | 品牌主色：主按钮、选中态、链接 |
| `--forest-deep` | `#17352e` | 主色按压态 |
| `--forest-tint` | `#e9f0ed` | 主色浅底（tag、notice） |
| `--moss` | `#5f7f6f` | 辅助文字/标签 |
| `--clay` / `--clay-tint` | `#d05a43` / `#fbeeea` | 危险/驳回/错误 |
| `--sun` / `--sun-tint` | `#c98f1b` / `#faf3e1` | 提醒/待办/金额强调 |

导航栏：白色 + 黑字（`app.json`），品牌绿只出现在内容区，不再做深绿导航栏。

### 2.2 形状与投影

- 圆角：卡片/弹层 `20-24rpx`，输入框/按钮 `14rpx`，胶囊 `999rpx`
- 投影（柔和弥散，透明度 ≤0.08）：
  - 卡片：`0 6rpx 20rpx rgba(29,39,35,.05)`
  - 主按钮/选中胶囊：`0 8rpx 18rpx rgba(33,66,57,.22)`
  - 弹层：`0 20rpx 48rpx rgba(29,39,35,.18)`
- 卡片不用边框；分隔线仅用于卡内列表（`--line` 极浅）

### 2.3 字体

| 角色 | 字体栈 | 场景 |
| --- | --- | --- |
| 正文 sans | `-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif` | 全部正文/标题/按钮 |
| 等宽 mono | `"DM Mono", "Courier New", monospace` | 金额、编号、日期、链接 |

标题靠字重（600/700）拉开层次，不再使用衬线展示字体。

### 2.4 字号 / 间距（rpx，750 设计稿）

- 页面大标题 38 / 区块标题 31 / 条目标题 30 / 正文 28 / 次要 24-25 / eyebrow 22
- 页面边距 24×28，卡片内边距 30×28，卡片间距 22，列表项上下 26
- 触摸目标最小 80rpx 高（输入框 88，胶囊按钮 60+）

## 3. 基础组件规范（app.wxss 已实现）

| class | 说明 |
| --- | --- |
| `.page` | 页面容器，底部预留 safe-area |
| `.card` | 白色浮起卡片：无边框 + 柔和投影 |
| `.title / .section-title / .item-title` | 三级标题，无衬线、字重递进 |
| `.eyebrow` | mono 大写小标签，moss 色 |
| `.muted / .subtitle` | 次要文字 |
| `button` / `.primary` / `.danger` / `.text-button` | 默认纸面按钮；主按钮 forest；危险 clay；文字按钮 |
| `.tag` | 状态胶囊，默认 forest 浅底；配合 `.tag-clay/.tag-sun` 变体 |
| `.metric / .metric-label / .metric-value` | 指标块，mono 大数字 |
| `.field / .field-label` + `input/textarea/picker` | 表单 |
| `.error / .notice / .empty / .loading` | 状态反馈 |
| `.list-item` | 卡内分隔列表行 |
| `.menu-grid` | 工作台入口宫格，白色浮起卡片按钮 |
| `.tabs` | 分段页签（对应 Web 的 work-tabs）：灰底轨道 + 白色浮起选中块 |
| `.status-tabs` | 文字状态页签（全部/待审核/已完成…）：下划线选中 |
| `.cell-card / .cell / .cell-icon / .cell-arrow` | 单元格列表菜单（我的页、设置页） |
| `.balance-card / .balance-label / .balance-value` | 品牌绿渐变金额卡，内置白色 CTA |
| `.stats-row / .stat / .stat-num / .stat-label` | 三列均分统计行，mono 大数字 |
| `.amount / .amount-pos` | 金额数字（mono），正收益 clay 强调 |
| `.badge` | 角色/等级小徽标 |
| `.modal-mask / .modal` | 半屏弹层 |
| `.footer-nav` | 底部固定操作栏（safe-area） |
| `.pager` | 分页条 |
| `.mono` | 等宽数字工具类 |

## 4. 页面布局模式（Web → 小程序重设计）

### 4.0 路由与登录门槛（v5）

- 未登录（游客）可进入 app 浏览首页与我的页；`screen.js` 不再强制 reLaunch
  到登录页，页面以 `guest=true` 渲染。
- 游客点击任何具体功能（`open()`/快捷入口/业务按钮）→ `wx.navigateTo` 登录页；
  业务页（任务/作品/数据等）主体显示 `shared.wxml` 的登录引导卡。
- 登录成功后按 `auth.entryPath(user)` reLaunch；登出仍 reLaunch 登录页；
  会话中 401（`app.js handleUnauthorized`）仍强制回登录页。
- 登录页提供"返回首页"（switchTab），游客可自由返回。

### 4.1 导航（v3 重构）

- **原生底部 tabBar 五栏**：首页(home) / 任务(keywords) / 作品(works) /
  数据(wallet) / 我的(mine)。图标为本地 PNG（`images/tabs/`，由
  `scripts/gen-tab-icons.ps1` 生成，常态灰 #9aa8a2、选中品牌绿 #214239）。
- 所有跳转统一走 `utils/nav.js` 的 `go(path)`：tab 页用 `wx.switchTab`，
  其余页用 `wx.navigateTo`；任何代码不得直接对 tab 页 navigateTo/redirectTo。
- 角色差异入口不再做顶部导航条：tab 页覆盖主流程，其余角色功能
  （团队/定价/运营/提现记录/修改密码）收进"我的"页 `.func-grid` 宫格；
  无权限角色进入对应 tab 时沿用 denied 空态。
- 顶部 `.hero` **浅色头部区**（白底、底部 28rpx 圆角），承载问候语/角色徽标/
  范围说明；品牌渐变只用于 `.balance-card` 金额强调卡（收益、余额场景）。
- 页面标题区 `.page-heading`：左粗体大标题 + eyebrow 角色/范围说明，
  右侧一个 mini 主操作（刷新/新建）。
- 主流程页底部 `.footer-nav` 固定主按钮（如"提交作品""申请提现"），
  避开 safe-area。

### 4.2 数据展示

- Web 宽表格 → 小程序**卡片列表**：每条记录一张 `.card`，
  首行条目标题 + 状态 tag，中间 mono 关键字段（金额/日期/单号），
  次要说明 `.muted`，操作收敛到行尾文字按钮或 ActionSheet。
- 只读宽表（账单明细等）保留表格时用横向 `scroll-view` + mono 右对齐数字。
- 指标汇总用 `.metric` 双列宫格，大数字 serif/mono。

### 4.3 交互映射

| Web 模式 | 小程序替代 |
| --- | --- |
| hover 显示操作 | 点击行 → `wx.showActionSheet` |
| 下拉菜单 / details 浮层 | `picker` 原生选择器 / 半屏 `.modal` |
| 表格行内按钮组 | 行尾一个"操作"文字按钮 → ActionSheet |
| 多标签页切换 | 顶部 `.tabs` 胶囊组（可横向滚动） |
| 表单行内多列 | 单列纵向表单，底部固定提交按钮 |
| 危险确认弹窗 | `wx.showModal`，确认按钮 clay 色文案 |

### 4.4 反馈与状态

- 加载用 `.loading` 文案 + `wx.showNavigationBarLoading`，不用骨架屏重设计（后续再加）。
- 空态 `.empty`：一行说明 + 一个引导按钮（如"前往工作台"）。
- 错误 `.error`（clay 浅底）带"重新加载"；成功 `.notice`（forest 浅底）。
- 无权限/未选项目沿用 `templates/shared.wxml` 的 status 模板。

## 5. 已落地文件

- `miniprogram/app.wxss`：令牌 + 基础组件 + hero/cell/balance/stats（v4）
- `miniprogram/app.json`：白色导航栏 + tabBar 五栏配置
- `miniprogram/utils/nav.js`：tab 页路由统一出口（switchTab/navigateTo）
- `pages/mine`：我的页（资料头 + 单元格列表菜单 + 退出登录，v4 重排）
- `pages/home`：浅色 hero 问候区 + 项目选择卡 + 宫格快捷入口（已剔除 tab 项）
- `pages/keywords|works|wallet`：移除顶部 role-nav，由 tabBar 接管；
  wallet 已按 v4 重排（`.balance-card` 可提现卡 + `.stats-row` 汇总 +
  明细列表状态徽标），列表状态 tag 已按语义着色（tag-clay/tag-sun/tag-moss）
- `components/role-nav`：保留给非 tab 子页使用，跳转已切 nav.go
- `images/tabs/*.png`：tabBar 图标，生成脚本 `scripts/gen-tab-icons.ps1`
  （注意：该 ps1 必须保持纯 ASCII，powershell 5.1 对无 BOM 的 UTF-8 中文注释
  会按 GBK 误读并吞掉下一行代码，已踩过坑）
- `components/project-picker`、`components/state`：跟随令牌

## 6. 后续建议（不在本版）

1. 任务/作品/提现列表的操作按钮组收敛为单 CTA + ActionSheet（参考 OPC 分销
   订单卡片），需要筛选时引入 `.status-tabs` 文字页签。
2. 首页接入待办计数/收益汇总，用 `.metric` 或 `.balance-card` 呈现（当前仅有达人/团长的可提现余额摘要）。
3. 关键词/作品长列表加触底加载更多替代翻页器的评估。
4. cell 与宫格图标从单字块升级为线性图标（复用 gen-tab-icons.ps1 生成）。
5. 深色模式：令牌已集中在 `page{}`，后续按 `prefers-color-scheme` 覆盖即可。

## 7. 全局交互基建（v6，2026-09 落地）

- **反馈统一出口** `utils/feedback.js`：`toast/success/fail/loading/confirm/haptic`。
  页面不再直接调 `wx.showToast`/`wx.showModal`；成功操作 = toast + 轻震动。
- **危险操作确认**：`components/confirm-sheet` iOS 半屏 ActionSheet（圆角分组面板 +
  分离取消键 + 上滑入场/下滑退场），页面挂 `<confirm-sheet id="confirmSheet" />` 后
  由 `feedback.confirm(page, { title, message, confirmText, danger })` 驱动；
  未挂组件时自动降级原生 `showModal`（回调/Promise 两种实现都兼容）。
- **下拉刷新**：`screen.js` 统一提供 `onPullDownRefresh`（无限滚动页自动重置回第 1 页，
  结束自动 `stopPullDownRefresh`），主页面 json 均已开 `enablePullDownRefresh`。
- **触底加载**：`screen.js` 的 `onReachBottom → more()`。`infinite: true` 的页面默认按
  `listKeys`（默认 `['list']`）合并并按 `id` 去重；嵌套列表（`view.withdrawals`）或
  需派生过滤（keywords 页签）的页面提供 `config.merge(result)` 接管。失败回滚页码、
  toast 提示、可重试。收尾条用 `templates/shared.wxml` 的 `loadmore` 模板。
- **骨架屏**：`components/skeleton`（`type: page/cards/stats` + `rows`），灰块 + shimmer
  扫光。页面给 status 模板传 `skeleton: true` 可关闭「正在加载…」文案。
- **动效工具类**（app.wxss）：`.rise`(+`.rise-d1~d3` stagger) 入场、`.press`
  （hover-class 按压回弹，channel-card/func-item/cell/menu-grid 已带 transition）、
  `.modal-mask/.modal` 改为底部半屏弹层（遮罩渐显 + 面板上滑）。
- **空态**：`components/state` 升级为插画圆标（呼吸动画）+ 说明 + 可选
  `guide-text/guide-path` 引导按钮。
- **文本工具类**：`.truncate` 单行省略、`.clamp2` 两行截断；`.link-text` 改为单行省略。
- **状态语义色**：`.text-forest/.text-clay/.text-sun/.text-moss`（绿正常/黄待处理/
  红异常/灰停用），与 `.tag-*` 变体同口径。
- 行为契约测试：`tests/interaction.test.cjs`（14 项）。

## 8. 页面级重设计（v7，2026-09 落地）

- **首页工作台化**：搜索入口（跳关键词页）+ banner 轮播（`images/banners/` 占位海报，
  `scripts/gen-placeholders.cjs` 生成，运营图就绪后替换）+ 真实公告条
  （`GET /core/announcements/active`，点开半屏弹层看全文）+ 三列工作台摘要卡
  （今日预估/进行中任务/待审核，来自新接口 `GET /modules/zhihu/home-summary`，
  按角色归属口径统计）+ 渠道矩阵（知乎/番茄/抖音/小红书官方品牌 logo，
  `images/channels/`，白底圆角框统一承载）。
- **收益页**：期间筛选（快捷 本月/上月 + 自定义起止，from>to 本地拦截），
  hero 金额卡（本期收益+已确认/待确认副指标），推广记录带状态 tag，
  邀请奖励按本期口径筛选。删除了写死的「内容分成 ¥0.00」假分类。
- **学院页**：后端 `courses.js` 重写为 `opc_courses` 集合驱动（种子课程兜底，
  运营经 `POST/PATCH /core/courses`、`POST /core/courses/:id/status` 上架后自动切换）；
  前端课程卡（封面 `images/courses/` 占位图 + 简介 + 时长/学习人数）+ 详情半屏弹层。
- **图标系统**：`scripts/gen-icons.cjs` 生成 14 枚线性 PNG 图标（`images/icons/`），
  首页快捷入口、我的页、知乎工作台、工具页全部替换单字块；无官方 logo 的渠道
  保留文字块兜底（`icon` 与 `iconImg` 二选一，WXML 双分支）。
- **状态语义色统一**：收益金额从 clay 红改为 `.amount-income` 品牌绿
  （红色只留给驳回/错误）；关键词页「申请释放待审」从红改黄（`.text-sun`），
  同步异常保持红（`.text-clay`）。
