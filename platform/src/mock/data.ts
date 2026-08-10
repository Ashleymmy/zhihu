import type { RankProject, TrackCategory, Project, Tool, PromotionLink, EarningsRecord, ChartPoint, UserProfile, Campaign, KeywordEntry, CallbackConfig, CallbackLog } from '@/types'

// ─── 首页统计 ────────────────────────────────────────────────
export const mockSiteStats = {
  projects: '1,200+',
  affiliates: '50万+',
  totalEarnings: '¥2亿+',
  settleRate: '98%',
}

// ─── 平台项目榜 ──────────────────────────────────────────────
export const mockRankProjects: RankProject[] = [
  { rank: 1, id: 'p1', name: '夸克网盘', category: '网盘工具', bgColor: '#4A90E2', shortName: '夸克', earnings7d: '127,844.34', change: 'up', changeVal: 3 },
  { rank: 2, id: 'p2', name: '红果短剧-漫剧', category: '短剧推广', bgColor: '#E84035', shortName: '红果', earnings7d: '125,710.50', change: 'up', changeVal: 1 },
  { rank: 3, id: 'p3', name: '番茄小说', category: '小说推文', bgColor: '#FF6B3D', shortName: '番茄', earnings7d: '98,320.00', change: 'same' },
  { rank: 4, id: 'p4', name: '抖音极速版', category: '视频推广', bgColor: '#333', shortName: '抖速', earnings7d: '87,654.21', change: 'down', changeVal: 1 },
  { rank: 5, id: 'p5', name: '全民K歌', category: '音乐社交', bgColor: '#7B68EE', shortName: 'K歌', earnings7d: '76,234.00', change: 'new' },
]

// ─── 赛道分类 ────────────────────────────────────────────────
export const mockCategories: TrackCategory[] = [
  { id: 'c1', name: '小说推文', count: 26, icon: '📚', color: '#F57C00' },
  { id: 'c2', name: '短剧推广', count: 9,  icon: '🎬', color: '#E91E63' },
  { id: 'c3', name: '有声书',   count: 12, icon: '🎙️', color: '#43A047' },
  { id: 'c4', name: '网盘工具', count: 5,  icon: '☁️', color: '#1976D2' },
  { id: 'c5', name: '视频平台', count: 8,  icon: '▶️', color: '#8E24AA' },
  { id: 'c6', name: '游戏推广', count: 14, icon: '🎮', color: '#00897B' },
  { id: 'c7', name: '教育学习', count: 11, icon: '🎓', color: '#F9A825' },
  { id: 'c8', name: '工具应用', count: 19, icon: '🔧', color: '#5D4037' },
]

// ─── 推广项目 ────────────────────────────────────────────────
export const mockProjects: Project[] = [
  {
    id: 'proj1', name: '番茄小说', platform: '字节跳动', category: '小说推文',
    commissionRate: '30%', commissionDesc: '最高 30%，按CPS结算',
    desc: '免费小说阅读平台，用户基数庞大，暑期流量高峰，适合推文博主批量推广。',
    tags: ['高佣金', '爆款', '日结'], bgColor: '#FF6B3D', shortName: '番茄',
    hot: true, status: 'active', joinCount: 12480,
  },
  {
    id: 'proj2', name: '夸克网盘', platform: '阿里巴巴', category: '网盘工具',
    commissionRate: '25%', commissionDesc: '新用户CPA + 续费CPS',
    desc: '超大容量网盘，AI搜题功能，学生群体渗透率极高，转化率稳定可期。',
    tags: ['稳定', '长效', '高转化'], bgColor: '#4A90E2', shortName: '夸克',
    hot: true, status: 'active', joinCount: 9870,
  },
  {
    id: 'proj3', name: '红果短剧', platform: '字节跳动', category: '短剧推广',
    commissionRate: '40%', commissionDesc: '最高 40%，限时激励',
    desc: '国内最大短剧平台之一，内容丰富，用户留存率高，佣金上限本月解除。',
    tags: ['新品', '高佣金', '爆量'], bgColor: '#E84035', shortName: '红果',
    hot: false, status: 'new', joinCount: 3420,
  },
  {
    id: 'proj4', name: '七猫免费小说', platform: '七猫', category: '小说推文',
    commissionRate: '28%', commissionDesc: '按激活量结算，T+1日结',
    desc: '主打免费阅读，用户下沉市场渗透力强，适合微信/抖音等社交流量。',
    tags: ['日结', '长效', '下沉市场'], bgColor: '#9B59B6', shortName: '七猫',
    hot: false, status: 'active', joinCount: 7650,
  },
  {
    id: 'proj5', name: '宝宝玩英语', platform: '宝宝玩英语', category: '教育学习',
    commissionRate: '35%', commissionDesc: '付费课程高比例佣金',
    desc: '0-8岁儿童英语启蒙，家长付费意愿强，客单价高，转化链路清晰。',
    tags: ['高客单', '高佣金', '教育'], bgColor: '#F39C12', shortName: '宝英',
    hot: false, status: 'active', joinCount: 5230,
  },
  {
    id: 'proj6', name: '得物APP', platform: '得物', category: '电商购物',
    commissionRate: '15%', commissionDesc: '按GMV比例，月结',
    desc: '潮流电商平台，Z世代用户活跃，球鞋/潮牌品类转化率极高。',
    tags: ['电商', '潮流', '月结'], bgColor: '#2ECC71', shortName: '得物',
    hot: false, status: 'active', joinCount: 4120,
  },
]

// ─── 工具列表 ────────────────────────────────────────────────
export const mockTools: Tool[] = [
  {
    id: 't1', name: '豹赞数据', category: 'AI数据',
    rating: 5, heatLevel: 5, freeTrials: 3,
    brief: '帮你盯数据的智能助手', price: '免费试用',
    desc: '实时监控推广数据，AI智能分析趋势，自动推送收益异常预警。',
    bgColor: '#E84035', icon: '📊',
  },
  {
    id: 't2', name: '选品雷达', category: '选品工具',
    rating: 5, heatLevel: 4, freeTrials: 5,
    brief: '找爆款项目从未如此简单', price: '¥29/月',
    desc: '基于大数据算法，扫描全网热门项目，提前3天预测爆款。',
    bgColor: '#FF6B3D', icon: '🎯',
  },
  {
    id: 't3', name: '文案魔方', category: 'AI创作',
    rating: 4, heatLevel: 5, freeTrials: 10,
    brief: 'AI一键生成爆款推广文案', price: '¥19/月',
    desc: 'GPT驱动的推广文案生成，支持小红书/抖音/微信多平台风格。',
    bgColor: '#9B59B6', icon: '✍️',
  },
  {
    id: 't4', name: '落地页工厂', category: '建站工具',
    rating: 4, heatLevel: 3, freeTrials: 2,
    brief: '拖拽式落地页制作神器', price: '¥49/月',
    desc: '无需代码，拖拽完成专业落地页。内置50+高转化模板，A/B测试一键启用。',
    bgColor: '#2ECC71', icon: '🏗️',
  },
  {
    id: 't5', name: '违规检测仪', category: '合规工具',
    rating: 5, heatLevel: 2, freeTrials: 20,
    brief: '发布前必查，杜绝封号风险', price: '免费',
    desc: '基于最新规则库，自动扫描内容中的违禁词、敏感词及诱导性表述。',
    bgColor: '#E74C3C', icon: '🛡️',
  },
]

// ─── 推广链接 ────────────────────────────────────────────────
export const mockLinks: PromotionLink[] = [
  { id: 'l1', projectName: '夸克网盘', projectId: 'proj2', channel: '抖音', url: 'https://opc.io/l/abc123', clicks: 2840, installs: 312, conversionRate: 11.0, earnings: '1,248.00', createdAt: '2026-07-15', status: 'active' },
  { id: 'l2', projectName: '番茄小说', projectId: 'proj1', channel: '微信', url: 'https://opc.io/l/def456', clicks: 1560, installs: 208, conversionRate: 13.3, earnings: '832.00', createdAt: '2026-07-20', status: 'active' },
  { id: 'l3', projectName: '红果短剧', projectId: 'proj3', channel: '小红书', url: 'https://opc.io/l/ghi789', clicks: 890, installs: 97, conversionRate: 10.9, earnings: '388.00', createdAt: '2026-07-28', status: 'active' },
]

// ─── 收益记录 ────────────────────────────────────────────────
export const mockEarnings: EarningsRecord[] = [
  { id: 'e1', date: '2026-08-03', projectName: '夸克网盘', type: '激活佣金', amount: '+124.80', status: 'settled' },
  { id: 'e2', date: '2026-08-03', projectName: '番茄小说', type: '注册佣金', amount: '+83.20', status: 'settled' },
  { id: 'e3', date: '2026-08-02', projectName: '红果短剧', type: '付费佣金', amount: '+38.80', status: 'pending' },
  { id: 'e4', date: '2026-08-02', projectName: '夸克网盘', type: '激活佣金', amount: '+96.00', status: 'settled' },
  { id: 'e5', date: '2026-08-01', projectName: '番茄小说', type: '注册佣金', amount: '+62.40', status: 'settled' },
  { id: 'e6', date: '2026-07-31', projectName: '宝宝玩英语', type: '付费佣金', amount: '+175.00', status: 'settled' },
]

// ─── 近7日收益图表 ──────────────────────────────────────────
export const mockChartPoints: ChartPoint[] = [
  { date: '07.28', value: 320 },
  { date: '07.29', value: 480 },
  { date: '07.30', value: 390 },
  { date: '07.31', value: 610 },
  { date: '08.01', value: 520 },
  { date: '08.02', value: 740 },
  { date: '08.03', value: 580 },
]

// ─── Mock 用户 ──────────────────────────────────────────────
export const mockUser: UserProfile = {
  id: 'u001',
  nickname: '豹赞达人',
  avatar: '',
  role: 'affiliate',
  level: 'Lv.3 · 成长达人',
  walletBalance: '1,248.00',
  pendingEarnings: '580.00',
  totalEarnings: '12,480.00',
  isLoggedIn: true,
}

// ─── 推广计划 ────────────────────────────────────────────────
export const mockCampaigns: Campaign[] = [
  {
    id: 'c1', name: '夸克网盘暑期推广', status: 'active',
    startDate: '2026-07-01', endDate: '2026-08-31',
    budget: 50000, spent: 32480,
    targetApp: '夸克网盘', keywordCount: 28,
    impressions: 284000, clicks: 12800, conversions: 1248,
    ctr: 4.5, cvr: 9.75, createdAt: '2026-06-25',
  },
  {
    id: 'c2', name: '番茄小说信息流投放', status: 'active',
    startDate: '2026-07-15', endDate: '2026-09-15',
    budget: 80000, spent: 18600,
    targetApp: '番茄小说', keywordCount: 42,
    impressions: 520000, clicks: 18200, conversions: 2184,
    ctr: 3.5, cvr: 12.0, createdAt: '2026-07-10',
  },
  {
    id: 'c3', name: '红果短剧测试计划', status: 'paused',
    startDate: '2026-07-20', endDate: '2026-08-20',
    budget: 20000, spent: 8400,
    targetApp: '红果短剧', keywordCount: 15,
    impressions: 96000, clicks: 4200, conversions: 420,
    ctr: 4.375, cvr: 10.0, createdAt: '2026-07-18',
  },
  {
    id: 'c4', name: '得物秋季大促', status: 'draft',
    startDate: '2026-09-01', endDate: '2026-09-30',
    budget: 120000, spent: 0,
    targetApp: '得物APP', keywordCount: 0,
    impressions: 0, clicks: 0, conversions: 0,
    ctr: 0, cvr: 0, createdAt: '2026-07-28',
  },
]

// ─── 词条数据 ────────────────────────────────────────────────
export const mockKeywords: KeywordEntry[] = [
  {
    id: 'k1', keyword: '网盘资源下载', campaignId: 'c1', campaignName: '夸克网盘暑期推广',
    bindStatus: 'bound', contentUrl: 'https://zhihu.com/question/12345',
    impressions: 48000, clicks: 2160, conversions: 216,
    ctr: 4.5, cvr: 10.0, cpc: 1.2, cost: 2592, updatedAt: '2026-08-04 06:20',
  },
  {
    id: 'k2', keyword: '免费小说阅读APP', campaignId: 'c2', campaignName: '番茄小说信息流投放',
    bindStatus: 'bound', contentUrl: 'https://zhihu.com/question/23456',
    impressions: 92000, clicks: 3220, conversions: 386,
    ctr: 3.5, cvr: 12.0, cpc: 0.9, cost: 2898, updatedAt: '2026-08-04 05:50',
  },
  {
    id: 'k3', keyword: '短剧哪个平台好看', campaignId: 'c3', campaignName: '红果短剧测试计划',
    bindStatus: 'pending', contentUrl: 'https://zhihu.com/question/34567',
    impressions: 24000, clicks: 1050, conversions: 105,
    ctr: 4.375, cvr: 10.0, cpc: 1.6, cost: 1680, updatedAt: '2026-08-03 14:30',
  },
  {
    id: 'k4', keyword: '学生党必备网盘', campaignId: 'c1', campaignName: '夸克网盘暑期推广',
    bindStatus: 'bound', contentUrl: 'https://zhihu.com/question/45678',
    impressions: 36000, clicks: 1620, conversions: 162,
    ctr: 4.5, cvr: 10.0, cpc: 1.15, cost: 1863, updatedAt: '2026-08-04 07:10',
  },
  {
    id: 'k5', keyword: '看小说赚钱软件', campaignId: 'c2', campaignName: '番茄小说信息流投放',
    bindStatus: 'failed', contentUrl: 'https://zhihu.com/question/56789',
    impressions: 12000, clicks: 420, conversions: 0,
    ctr: 3.5, cvr: 0, cpc: 0.88, cost: 370, updatedAt: '2026-08-03 22:40',
  },
]

// ─── 回传配置 ────────────────────────────────────────────────
export const mockCallbackConfigs: CallbackConfig[] = [
  {
    id: 'cb1', campaignId: 'c1', campaignName: '夸克网盘暑期推广',
    callbackUrl: 'https://api.partner.quark.cn/callback',
    events: ['install', 'register', 'first_open'],
    signKey: '••••••••••••', status: 'active',
    lastPingAt: '2026-08-04 07:58', successRate: 99.2, totalCalls: 12480,
  },
  {
    id: 'cb2', campaignId: 'c2', campaignName: '番茄小说信息流投放',
    callbackUrl: 'https://api.fanqienovel.com/opc/callback',
    events: ['install', 'register', 'purchase'],
    signKey: '••••••••••••', status: 'active',
    lastPingAt: '2026-08-04 07:45', successRate: 98.7, totalCalls: 18200,
  },
  {
    id: 'cb3', campaignId: 'c3', campaignName: '红果短剧测试计划',
    callbackUrl: 'https://api.hongguo.com/callback/zhihu',
    events: ['install', 'first_open'],
    signKey: '••••••••••••', status: 'inactive',
    lastPingAt: '2026-08-02 18:30', successRate: 95.5, totalCalls: 4200,
  },
]

// ─── 回传日志 ────────────────────────────────────────────────
export const mockCallbackLogs: CallbackLog[] = [
  { id: 'log1', timestamp: '2026-08-04 07:58:23', event: 'install', keyword: '网盘资源下载', status: 'success', responseCode: 200, latency: 142 },
  { id: 'log2', timestamp: '2026-08-04 07:56:18', event: 'register', keyword: '免费小说阅读APP', status: 'success', responseCode: 200, latency: 98 },
  { id: 'log3', timestamp: '2026-08-04 07:55:04', event: 'install', keyword: '学生党必备网盘', status: 'success', responseCode: 200, latency: 156 },
  { id: 'log4', timestamp: '2026-08-04 07:52:39', event: 'first_open', keyword: '网盘资源下载', status: 'failed', responseCode: 504, latency: 5020, errorMsg: 'Gateway timeout' },
  { id: 'log5', timestamp: '2026-08-04 07:50:11', event: 'purchase', keyword: '免费小说阅读APP', status: 'success', responseCode: 200, latency: 210 },
  { id: 'log6', timestamp: '2026-08-04 07:48:56', event: 'register', keyword: '学生党必备网盘', status: 'retry', responseCode: 503, latency: 3040, errorMsg: 'Service unavailable' },
]
