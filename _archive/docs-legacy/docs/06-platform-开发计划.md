# ⚠️ 已废弃 — OPC 平台 Web 预览 — 开发计划

> **本文档于 2026-08-06 废弃，不要参照。**
>
> 废弃原因：本文描述的是 Vant4 移动端 375px 方案，而 `platform/` 磁盘上的实际实现是
> Ant Design Vue 4.2.3 暗色**桌面端**（12 个页面已完成 UI）。同时 PRD 已明确
> 「暂不要求移动端支持」，移动端方向本身也不再成立。
>
> **`platform/` 的现行开发基准：[08-BFF接口契约.md](./08-BFF接口契约.md)**
> —— 真实进度见 §2.1，建表见 §3，接口契约见 §4，分工边界见 §8。
>
> 以下内容仅作历史留档。

---

> ~~目标：先用 Web 模拟移动端 UI（参考右豹 APP），验证交互与视觉；后期迁移为微信小程序。~~
> ~~数据：阶段一使用 Mock，阶段二对接知乎联盟 OpenAPI（规范见 `docs/03-接口文档.md`）。~~

---

## 一、项目概览

| 项目 | 说明 |
|------|------|
| 目录 | `zhihu-app/platform/` |
| 框架 | Vue 3.4 + Vite 5 + TypeScript 5 |
| UI | Vant 4（移动端组件库） |
| 图表 | ECharts 5 |
| 状态 | Pinia 2 |
| 路由 | Vue Router 4 |
| 数据 | 阶段一：Mock；阶段二：Axios + 知乎 OpenAPI |
| 宽度 | 375px（模拟手机视口） |

---

## 二、页面清单

| 路由 | 页面 | 对应截图 | 核心内容 |
|------|------|----------|----------|
| `/` | 首页 | 截图 1、6 | 平台项目榜、OPC经营数据榜、右豹动态、OPC服务机构 |
| `/monetize` | 变现 | 截图 2、7 | 国内/海外切换、项目赛道分类网格、Banner、特色项目 |
| `/tools` | 工具市场 | 截图 3、8 | 工具列表、搜索、分类筛选、工具详情弹窗 |
| `/data` | 数据 | 截图 4、10 | 收益统计卡片、ECharts 折线图、登录引导 |
| `/profile` | 我的 | 截图 5 | 用户信息、钱包、功能入口、更多功能 |

---

## 三、UI 设计规范

### 色彩
```
主色（橙红）：#E84035
渐变：linear-gradient(135deg, #E84035, #FF6B3D)
首页头部背景：#FFE0D5（暖粉）
文字主色：#333333
文字辅色：#666666
文字三级：#999999
背景色：#F5F5F5
卡片色：#FFFFFF
```

### 布局
- 容器最大宽度：375px，居中显示
- 底部 TabBar 高度：50px，固定在底部
- 页面内容区距底：50px（避免被 TabBar 遮挡）

---

## 四、开发阶段

### Phase 1：项目搭建（当前）
- [x] 初始化 Vite + Vue3 + TypeScript
- [x] 安装 Vant4、ECharts、Pinia、Vue Router
- [x] 全局样式（CSS 变量、移动端适配）
- [x] App.vue 底部导航 TabBar
- [x] Router 配置（5 个路由）

### Phase 2：页面开发（Mock 数据）
- [x] Mock 数据层（`src/mock/data.ts`）
- [x] 首页（项目榜 + 动态 + 机构）
- [x] 变现页（国内/海外、项目赛道、Banner）
- [x] 工具市场（列表、搜索、详情弹窗）
- [x] 数据页（统计卡片、ECharts 图表）
- [x] 我的页（用户信息、钱包、功能入口）

### Phase 3：接口对接
- [ ] 封装 Axios + 签名拦截器（复用 `web/src/infra/`）
- [ ] 数据报表页对接 `§ 八` 实时数据接口
- [ ] 作品/计划数据对接 `§ 四` 接口
- [ ] 渠道、任务数据对接

### Phase 4：迁移小程序
- [ ] 参考 `app/` 目录，将 Vue3 组件迁移为原生小程序/uni-app 组件

---

## 五、Mock 数据说明

所有 Mock 数据位于 `src/mock/data.ts`，结构与接口文档保持一致，便于后续直接替换真实接口。

主要 Mock 模块：
- `mockProjects`：项目榜单数据
- `mockCategories`：项目赛道分类
- `mockTools`：工具市场列表
- `mockEarnings`：收益图表数据
- `mockNews`：右豹动态列表
- `mockInstitutions`：OPC服务机构

---

## 六、目录结构

```
platform/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── App.vue                 # 根组件 + TabBar
    ├── main.ts
    ├── router/index.ts
    ├── styles/
    │   ├── variables.css       # CSS 变量
    │   └── base.css            # 全局重置
    ├── mock/data.ts            # Mock 数据
    ├── types/index.ts          # 公共类型
    ├── stores/
    │   ├── user.store.ts
    │   └── data.store.ts
    └── views/
        ├── HomeView.vue
        ├── MonetizeView.vue
        ├── ToolsView.vue
        ├── DataView.vue
        └── ProfileView.vue
```
