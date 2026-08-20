/**
 * 业务枚举字典
 * 来源：docs/03-接口文档.md § 二
 *
 * 规则：禁止在业务代码里散落魔法数字，所有枚举值从此文件导入。
 */

// ─── § 2.1  媒体类型 media_type ──────────────────────────────────────────────
/** 媒体类型，传中文原文字符串 */
export const MEDIA_TYPES = [
  'KOC视频号', 'KOC百家号', 'KOC抖音', 'KOC快手', 'KOC微博',
  'KOC小红书', 'KOC定向', 'KOC头条号', 'KOC哔哩哔哩', 'KOC公众号',
] as const

export type MediaType = typeof MEDIA_TYPES[number]

// ─── § 2.2  作品一级分类 composition_type ───────────────────────────────────
/** 作品一级分类（v2 接口，取消了 v1 的 3-截图） */
export enum CompositionType {
  Other     = 0, // 其他
  ImageText = 1, // 图文
  Video     = 2, // 视频
}

export const COMPOSITION_TYPE_LABELS: Record<CompositionType, string> = {
  [CompositionType.Other]:     '其他',
  [CompositionType.ImageText]: '图文',
  [CompositionType.Video]:     '视频',
}

// ─── § 2.3  作品二级分类 composition_sub_type ────────────────────────────────
/** 作品二级分类，必须与一级分类合法组合 */
export enum CompositionSubType {
  RealShot           = 1,  // 实拍（图文）
  LivePhoto          = 2,  // live图（图文）
  Screenshot         = 3,  // 截屏（图文）
  Comic              = 4,  // 漫画（图文）
  StickerCommentary  = 5,  // 表情包解说（视频）
  RealPerson         = 6,  // 真人演绎（视频）
  CatMeme            = 7,  // 猫meme（视频）
  ComicDrama         = 8,  // 漫剧（视频）
  Relaxing           = 9,  // 解压（视频）
  ScrollScreen       = 10, // 滚屏（视频）
  Other              = 11, // 其他（其他）
}

export const COMPOSITION_SUB_TYPE_LABELS: Record<CompositionSubType, string> = {
  1: '实拍', 2: 'live图', 3: '截屏', 4: '漫画',
  5: '表情包解说', 6: '真人演绎', 7: '猫meme', 8: '漫剧', 9: '解压', 10: '滚屏',
  11: '其他',
}

/** 一级分类 → 合法二级分类的映射，用于级联选择器与提交前校验 */
export const VALID_SUB_TYPE_MAP: Record<CompositionType, CompositionSubType[]> = {
  [CompositionType.ImageText]: [1, 2, 3, 4],
  [CompositionType.Video]:     [5, 6, 7, 8, 9, 10],
  [CompositionType.Other]:     [11],
}

/** 校验一二级分类组合是否合法 */
export function isValidCompositionTypeCombo(
  type: CompositionType,
  subType: CompositionSubType,
): boolean {
  return VALID_SUB_TYPE_MAP[type]?.includes(subType) ?? false
}

// ─── § 2.4  推广方式 popularize_type ────────────────────────────────────────
/** 目前固定传 0（koc搜索词），UI 禁用选择 */
export enum PopularizeType {
  KocSearch = 0, // koc搜索词
}

// ─── § 2.5  批量绑定类型 bind_type ──────────────────────────────────────────
/** 批量创建推广作品时 Excel 第一列的语义 */
export enum BindType {
  PlanId  = 1, // 第一列填计划 id
  Keyword = 2, // 第一列填关键词
}

// ─── § 2.6  文件类型 file_type ───────────────────────────────────────────────
export enum FileType {
  Image = 1, // 图片（jpeg/png，2 MB 以内）
}

// ─── § 2.7  风险类型 risk_type ───────────────────────────────────────────────
export enum RiskType {
  InterceptWord = 1, // 截流词（risk_url 可选）
  Plagiarism    = 2, // 搬运词（risk_url 必填）
}

// ─── § 2.8  举报数据视角 type ─────────────────────────────────────────────────
export enum ReportDataView {
  Reported  = 0, // 被举报方数据（默认）
  Reporter  = 1, // 举报方数据
}

// ─── § 2.9  举报审核状态 status ──────────────────────────────────────────────
/**
 * ⚠️ 请求参数用 1/2/3，返回结果用 0/1/2，两者相差 1。
 * 服务层必须做映射，不能混用。
 */
/** 查询参数（筛选时传入）*/
export enum AuditStatusQuery {
  Reviewing = 1, // 审核中
  Violation = 2, // 判定违规
  Normal    = 3, // 判定正常
}

/** 返回结果（响应中解析）*/
export enum AuditStatusResponse {
  Reviewing = 0, // 审核中
  Violation = 1, // 判定违规
  Normal    = 2, // 判定正常
}

export const AUDIT_STATUS_LABELS: Record<AuditStatusResponse, string> = {
  [AuditStatusResponse.Reviewing]: '审核中',
  [AuditStatusResponse.Violation]: '判定违规',
  [AuditStatusResponse.Normal]:    '判定正常',
}

/** 返回值 → 对应的查询参数值（服务层做映射时使用）*/
export function auditResponseToQuery(v: AuditStatusResponse): AuditStatusQuery {
  return (v + 1) as AuditStatusQuery
}

// ─── § 2.10 榜单类型 type（盐选内容）────────────────────────────────────────
export enum RankingType {
  Regular     = 1, // 常规书单
  Recommended = 2, // 推荐书单（有内容等级/领域/兴趣/消费价值字段）
}

// ─── § 2.11 数据报表参数（§ 8.1 专用）─────────────────────────────────────
export enum ReportDataType {
  Keyword = 1, // 关键词维度数据（目前唯一值）
}

export enum ReportTimeScale {
  Day = 1, // 天级（目前唯一值）
}

export const REPORT_FIELDS = ['search_num', 'order_num', 'created_at'] as const
export type ReportField = typeof REPORT_FIELDS[number]

// ─── § 2.12 内容标签枚举 tags（§ 13.1 专用）────────────────────────────────
export enum ContentTagType {
  Interest      = 1, // 兴趣
  FirstCategory = 2, // 一级领域
  ContentLevel  = 3, // 内容等级
}

// ─── § 2.13 推广任务状态（§ 7.1 返回值）─────────────────────────────────────
/** STRING 类型，取值为中文，不要 parseInt */
export type PopularizeTaskStatus = '开启' | '过期' | '暂停'
