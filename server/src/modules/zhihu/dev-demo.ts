import crypto from 'node:crypto';
import { permissionsFor } from './permissions';
import { RefreshSession } from '../../auth/tokenSessions';
import { config } from './config';
import { AppError } from '../../middleware/errors';
import { AuthUser, Role } from '../../types';

export const DEV_DEMO_USER_IDS = {
  admin: '900000000000000001',
  leader: '900000000000000002',
  creator: '900000000000000003',
} as const;

export const DEV_DEMO_USER_ID = DEV_DEMO_USER_IDS.admin;

type DemoUser = {
  id: string;
  role: Role;
  username: string;
  password: string;
  displayName: string;
  parentId: string | null;
  phone: string | null;
};

type DemoPlan = {
  id: string;
  taskId: string;
  channelId: string;
  channelName: string;
  secondChannelId: string | null;
  keyword: string;
  landingUrl: string;
  popularizeType: number;
  name: string | null;
  dailyBudget: number | null;
  startDate: string | null;
  endDate: string | null;
  ownerId: string;
  ownerName: string;
  status: 'pending' | 'active' | 'paused' | 'rejected' | 'ended';
  syncStatus: 'local' | 'syncing' | 'synced' | 'failed';
  syncError: string | null;
  zhihuPlanId: string | null;
  zhihuStatusJson: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type DemoTask = {
  id: string;
  projectId: string;
  zhihuTaskId: string;
  name: string;
  popularizeType: number | null;
  settleType: string | null;
  unitPrice: number | null;
  startTime: string | null;
  endTime: string | null;
  status: string | null;
  syncedAt: string;
};

type DemoMcnAccount = {
  id: string;
  accountKey: string;
  accountName: string;
  ownerUserId: string;
  status: 'active' | 'suspended' | 'archived';
  createdAt: string;
  updatedAt: string;
};

type DemoWithdrawalStatus = 'pending' | 'leader_approved' | 'approved' | 'rejected' | 'cancelled';
type DemoAppealStatus = 'pending' | 'leader_approved' | 'approved' | 'rejected' | 'cancelled';
type DemoAppealKind = '补款' | '扣款' | '结算异议' | '其他';

type DemoWithdrawal = {
  id: string;
  userId: string;
  amount: number;
  settleType: 'personal' | 'corporate';
  payMethod: 'alipay' | 'wechat' | 'bank_transfer';
  payAccount: string;
  companyName: string | null;
  bankName: string | null;
  bankAccount: string | null;
  taxId: string | null;
  invoiceName: string | null;
  invoiceUploadedAt: string | null;
  status: DemoWithdrawalStatus;
  remark: string | null;
  leaderId: string | null;
  leaderRemark: string | null;
  leaderHandledAt: string | null;
  handledBy: string | null;
  handledAt: string | null;
  riskFlags: string[] | null;
  createdAt: string;
  updatedAt: string;
};

type DemoAppeal = {
  id: string;
  userId: string;
  kind: DemoAppealKind;
  title: string;
  content: string;
  evidence: string | null;
  status: DemoAppealStatus;
  remark: string | null;
  leaderId: string | null;
  leaderRemark: string | null;
  leaderHandledAt: string | null;
  handledBy: string | null;
  handledAt: string | null;
  adjustAmount: number | null;
  createdAt: string;
};

type DemoEarningRecord = {
  id: string;
  date: string;
  planId: string;
  keyword: string;
  channelId: string;
  channelName: string;
  ownerId: string;
  ownerName: string;
  amount: number;
  status: 'pending' | 'confirmed' | 'paid';
};

const DAY_MS = 86_400_000;
const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
const dateDaysAgo = (days: number) => isoDaysAgo(days).slice(0, 10);
let demoIdSequence = Date.now();
const nextDemoId = () => String(++demoIdSequence);

export function isDevDemoEnabled() {
  return config.nodeEnv === 'development' && process.env.DEV_DEMO_AUTH === '1';
}

export function demoUsers(): DemoUser[] {
  const leaderId = DEV_DEMO_USER_IDS.leader;
  return [
    {
      id: DEV_DEMO_USER_IDS.admin,
      role: 'admin',
      username: process.env.DEV_DEMO_USERNAME ?? 'admin',
      password: process.env.DEV_DEMO_PASSWORD ?? 'admin123456',
      displayName: process.env.DEV_DEMO_DISPLAY_NAME ?? '本地管理员',
      parentId: null,
      phone: null,
    },
    {
      id: leaderId,
      role: 'leader',
      username: process.env.DEV_DEMO_LEADER_USERNAME ?? 'leader',
      password: process.env.DEV_DEMO_LEADER_PASSWORD ?? 'leader123456',
      displayName: process.env.DEV_DEMO_LEADER_DISPLAY_NAME ?? '本地团长',
      parentId: null,
      phone: null,
    },
    {
      id: DEV_DEMO_USER_IDS.creator,
      role: 'creator',
      username: process.env.DEV_DEMO_CREATOR_USERNAME ?? 'creator',
      password: process.env.DEV_DEMO_CREATOR_PASSWORD ?? 'creator123456',
      displayName: process.env.DEV_DEMO_CREATOR_DISPLAY_NAME ?? '本地达人',
      parentId: leaderId,
      phone: null,
    },
  ];
}

export function devDemoCredentials() {
  return demoUsers()[0];
}

export function devDemoLoginUser(username: string, password: string) {
  if (!isDevDemoEnabled()) return null;
  return demoUsers().find((user) => user.username === username && user.password === password) ?? null;
}

export function devDemoUserById(id: string) {
  if (!isDevDemoEnabled()) return null;
  return demoUsers().find((user) => user.id === id) ?? null;
}

export function isDevDemoRefreshToken(token: string | null | undefined) {
  return isDevDemoEnabled() && Boolean(token?.startsWith('dev-demo.'));
}

export function devDemoUserFromRefreshToken(token: string | null | undefined) {
  if (!isDevDemoRefreshToken(token)) return null;
  const parts = String(token).split('.');
  return devDemoUserById(parts[1] ?? DEV_DEMO_USER_ID) ?? devDemoCredentials();
}

export function devDemoUserFromAuth(auth: AuthUser) {
  return devDemoUserById(auth.sub);
}

export function isDevDemoAuthUser(user: AuthUser) {
  return Boolean(devDemoUserFromAuth(user));
}

export function devDemoTokenUser(user = devDemoCredentials()) {
  return {
    id: user.id,
    role: user.role,
    parentId: user.parentId,
    username: user.username,
    displayName: user.displayName,
  };
}

export function devDemoPublicUser(user = devDemoCredentials()) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    parentId: user.parentId,
    phone: user.phone,
    permissions: permissionsFor(user.role),
  };
}

export function issueDevDemoRefreshSession(userId: string = DEV_DEMO_USER_ID): RefreshSession {
  return {
    userId,
    familyId: `dev-demo-${userId}`,
    refreshToken: `dev-demo.${userId}.${crypto.randomUUID()}`,
    expiresAt: new Date(Date.now() + config.auth.refreshTtlDays * DAY_MS),
  };
}

function demoUserProfile(userId: string) {
  const user = demoUsers().find((item) => item.id === userId);
  return {
    username: user?.username ?? 'unknown',
    name: user?.displayName ?? '未知用户',
    parentId: user?.parentId ?? null,
  };
}

function canViewOwner(viewer: AuthUser, ownerId: string) {
  if (viewer.role === 'admin') return true;
  if (viewer.role === 'creator') return ownerId === viewer.sub;
  const owner = demoUserProfile(ownerId);
  return ownerId === viewer.sub || owner.parentId === viewer.sub;
}

function paginateDemoList<T>(list: T[], query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page ?? 1));
  const pageSize = Math.max(1, Number(query.pageSize ?? 20));
  const start = (page - 1) * pageSize;
  return { list: list.slice(start, start + pageSize), total: list.length, page, pageSize };
}

export function devDemoMetricsOverview() {
  return {
    totalImpressions: 128400,
    totalClicks: 8420,
    totalConversions: 936,
    totalSpend: 326800,
    totalEarnings: 584200,
    ctr: 0.0656,
    cvr: 0.1112,
    cpc: 388,
  };
}

export function devDemoTrend() {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.now() - (6 - index) * DAY_MS).toISOString().slice(0, 10);
    const scale = index + 1;
    return {
      date,
      impressions: 9800 + scale * 1250,
      clicks: 620 + scale * 88,
      conversions: 61 + scale * 13,
      spend: 31800 + scale * 4200,
      earnings: 52600 + scale * 6800,
    };
  });
}

export function devDemoMetricsByKeyword(query: Record<string, unknown>) {
  const list = [
    { channelId: '20001', keyword: '知乎故事推广', impressions: 68400, clicks: 4120, conversions: 466, earning: 286000 },
    { channelId: '20002', keyword: '盐选内容推荐', impressions: 42100, clicks: 2910, conversions: 328, earning: 214000 },
    { channelId: '20002', keyword: '有声书转化', impressions: 17900, clicks: 1390, conversions: 142, earning: 84200 },
  ];
  return paginateDemoList(list, query);
}

export function devDemoMetricsByMember(user: AuthUser) {
  const users = demoUsers().filter((item) => canViewOwner(user, item.id));
  return users.map((item, index) => ({
    ownerId: item.id,
    displayName: item.displayName,
    impressions: 36000 + index * 18000,
    clicks: 2100 + index * 900,
    conversions: 220 + index * 80,
    earning: 128000 + index * 56000,
  }));
}

const demoTasks: DemoTask[] = [
  {
    id: '30001',
    projectId: '1',
    zhihuTaskId: '1900000000000000001',
    name: '知乎故事推广任务',
    popularizeType: 0,
    settleType: 'cps',
    unitPrice: 8.8,
    startTime: isoDaysAgo(7),
    endTime: null,
    status: '开启',
    syncedAt: new Date().toISOString(),
  },
  {
    id: '30002',
    projectId: '1',
    zhihuTaskId: '1900000000000000002',
    name: '盐选内容推荐任务',
    popularizeType: 0,
    settleType: 'cps',
    unitPrice: 12,
    startTime: isoDaysAgo(3),
    endTime: null,
    status: '开启',
    syncedAt: new Date().toISOString(),
  },
];

const demoPlans: DemoPlan[] = [
  {
    id: '10001',
    taskId: '1900000000000000001',
    channelId: '1800000000000000001',
    channelName: '知乎故事一代渠道',
    secondChannelId: '1800000000000000101',
    keyword: '知乎故事推广',
    landingUrl: 'https://www.zhihu.com/market/paid_column/demo/section/1',
    popularizeType: 0,
    name: '本地演示计划 A',
    dailyBudget: 30000,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: null,
    ownerId: DEV_DEMO_USER_IDS.creator,
    ownerName: demoUserProfile(DEV_DEMO_USER_IDS.creator).name,
    status: 'active',
    syncStatus: 'synced',
    syncError: null,
    zhihuPlanId: '1700000000000000001',
    zhihuStatusJson: { auditStatus: 'approved', rejectReason: null },
    createdAt: isoDaysAgo(2),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '10002',
    taskId: '1900000000000000002',
    channelId: '1800000000000000001',
    channelName: '知乎故事一代渠道',
    secondChannelId: '1800000000000000102',
    keyword: '盐选内容推荐',
    landingUrl: 'https://www.zhihu.com/market/paid_column/demo/section/2',
    popularizeType: 0,
    name: '本地演示计划 B',
    dailyBudget: 18000,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: null,
    ownerId: DEV_DEMO_USER_IDS.leader,
    ownerName: demoUserProfile(DEV_DEMO_USER_IDS.leader).name,
    status: 'pending',
    syncStatus: 'syncing',
    syncError: null,
    zhihuPlanId: null,
    zhihuStatusJson: { auditStatus: 'pending', rejectReason: null },
    createdAt: isoDaysAgo(1),
    updatedAt: new Date().toISOString(),
  },
];

export function listDevDemoPlans(user: AuthUser, query: Record<string, unknown>) {
  let list = demoPlans.filter((plan) => plan.status !== 'ended' && canViewOwner(user, plan.ownerId));
  if (query.taskId) list = list.filter((plan) => plan.taskId === String(query.taskId));
  if (query.channelId) list = list.filter((plan) => plan.channelId === String(query.channelId));
  if (query.status) list = list.filter((plan) => plan.status === String(query.status));
  if (query.keyword) list = list.filter((plan) => plan.keyword.includes(String(query.keyword)));
  return paginateDemoList(list, query);
}

export function getDevDemoPlan(user: AuthUser, id: string) {
  const plan = demoPlans.find((item) => item.id === id && item.status !== 'ended' && canViewOwner(user, item.ownerId));
  if (!plan) throw new AppError(404, 40401, '推广计划不存在');
  return plan;
}

export function checkDevDemoKeyword(user: AuthUser, channelId: string, keyword: string) {
  const plan = demoPlans.find((item) => item.channelId === channelId && item.keyword === keyword && item.status !== 'ended');
  if (!plan) return { available: true };
  return {
    available: false,
    occupiedBy: demoUserProfile(plan.ownerId).name,
    occupiedByMe: plan.ownerId === user.sub,
    planId: plan.ownerId === user.sub ? plan.id : null,
  };
}

export function createDevDemoPlan(user: AuthUser, input: Record<string, unknown>) {
  const now = new Date().toISOString();
  const ownerId = user.role === 'admin' && input.ownerId ? String(input.ownerId) : user.sub;
  const owner = demoUserProfile(ownerId);
  const plan: DemoPlan = {
    id: nextDemoId(),
    taskId: String(input.taskId),
    channelId: String(input.channelId),
    channelName: '知乎故事一代渠道',
    secondChannelId: input.secondChannelId ? String(input.secondChannelId) : null,
    keyword: String(input.keyword),
    landingUrl: String(input.landingUrl),
    popularizeType: Number(input.popularizeType ?? 0),
    name: input.name === undefined ? null : (input.name as string | null),
    dailyBudget: input.dailyBudget === undefined ? null : Number(input.dailyBudget),
    startDate: input.startDate === undefined ? null : (input.startDate as string | null),
    endDate: input.endDate === undefined ? null : (input.endDate as string | null),
    ownerId,
    ownerName: owner.name,
    status: 'pending',
    syncStatus: 'local',
    syncError: null,
    zhihuPlanId: null,
    zhihuStatusJson: { auditStatus: 'pending', rejectReason: null },
    createdAt: now,
    updatedAt: now,
  };
  demoPlans.unshift(plan);
  return plan;
}

export function updateDevDemoPlan(user: AuthUser, id: string, patch: Record<string, unknown>) {
  const plan = getDevDemoPlan(user, id);
  Object.assign(plan, {
    keyword: patch.keyword ?? plan.keyword,
    landingUrl: patch.landingUrl ?? plan.landingUrl,
    name: patch.name !== undefined ? patch.name : plan.name,
    dailyBudget: patch.dailyBudget !== undefined ? patch.dailyBudget : plan.dailyBudget,
    updatedAt: new Date().toISOString(),
  });
  return plan;
}

export function deleteDevDemoPlan(user: AuthUser, id: string) {
  const plan = getDevDemoPlan(user, id);
  plan.status = 'ended';
  plan.updatedAt = new Date().toISOString();
}

export function retryDevDemoPlan(user: AuthUser, id: string) {
  const plan = getDevDemoPlan(user, id);
  plan.syncStatus = 'local';
  plan.syncError = null;
  plan.updatedAt = new Date().toISOString();
  return { id, syncStatus: 'local' };
}

export function listDevDemoChannels(query: Record<string, unknown>) {
  const list = [
    {
      id: '20001',
      projectId: '1',
      zhihuChannelId: '1800000000000000001',
      parentChannelId: null,
      generation: 1,
      name: '知乎故事一代渠道',
      ownerId: DEV_DEMO_USER_IDS.admin,
      commissionRate: '0.1500',
      isEnabled: true,
      syncedAt: new Date().toISOString(),
      createdAt: isoDaysAgo(7),
    },
    {
      id: '20002',
      projectId: '1',
      zhihuChannelId: '1800000000000000101',
      parentChannelId: '1800000000000000001',
      generation: 2,
      name: '团长演示二代渠道',
      ownerId: DEV_DEMO_USER_IDS.leader,
      commissionRate: '0.1000',
      isEnabled: true,
      syncedAt: new Date().toISOString(),
      createdAt: isoDaysAgo(5),
    },
  ];
  return paginateDemoList(list, query);
}

export function listDevDemoTasks(query: Record<string, unknown>) {
  let list = [...demoTasks];
  if (query.status) list = list.filter((task) => task.status === String(query.status));
  if (query.keyword) list = list.filter((task) => task.name.includes(String(query.keyword)));
  return paginateDemoList(list, query);
}

export function getDevDemoTask(id: string) {
  const task = demoTasks.find((item) => item.id === id || item.zhihuTaskId === id);
  if (!task) throw new AppError(404, 40401, '推广任务不存在');
  return task;
}

const demoMcnAccounts: DemoMcnAccount[] = [
  {
    id: '50001',
    accountKey: 'local-opc',
    accountName: '本地 OPC MCN',
    ownerUserId: DEV_DEMO_USER_IDS.admin,
    status: 'active',
    createdAt: isoDaysAgo(18),
    updatedAt: isoDaysAgo(1),
  },
  {
    id: '50002',
    accountKey: 'leader-growth',
    accountName: '团长增长演示 MCN',
    ownerUserId: DEV_DEMO_USER_IDS.leader,
    status: 'active',
    createdAt: isoDaysAgo(12),
    updatedAt: isoDaysAgo(2),
  },
];

export function listDevDemoMcnAccounts() {
  return [...demoMcnAccounts];
}

export function createDevDemoMcnAccount(input: { accountKey: string; accountName: string; ownerUserId: string }) {
  if (!devDemoUserById(input.ownerUserId)) throw new AppError(422, 42206, '账户负责人不存在或已停用');
  if (demoMcnAccounts.some((account) => account.accountKey === input.accountKey)) {
    throw new AppError(409, 40902, 'MCN 账户标识已存在');
  }
  const now = new Date().toISOString();
  const account: DemoMcnAccount = {
    id: nextDemoId(),
    accountKey: input.accountKey,
    accountName: input.accountName,
    ownerUserId: input.ownerUserId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  demoMcnAccounts.unshift(account);
  return account;
}

const demoEarnings: DemoEarningRecord[] = [
  {
    id: '60001',
    date: dateDaysAgo(1),
    planId: '10001',
    keyword: '知乎故事推广',
    channelId: '20001',
    channelName: '知乎故事一代渠道',
    ownerId: DEV_DEMO_USER_IDS.creator,
    ownerName: demoUserProfile(DEV_DEMO_USER_IDS.creator).name,
    amount: 260000,
    status: 'confirmed',
  },
  {
    id: '60002',
    date: dateDaysAgo(2),
    planId: '10002',
    keyword: '盐选内容推荐',
    channelId: '20002',
    channelName: '团长演示二代渠道',
    ownerId: DEV_DEMO_USER_IDS.creator,
    ownerName: demoUserProfile(DEV_DEMO_USER_IDS.creator).name,
    amount: 48000,
    status: 'pending',
  },
  {
    id: '60003',
    date: dateDaysAgo(8),
    planId: '10001',
    keyword: '知乎故事推广',
    channelId: '20001',
    channelName: '知乎故事一代渠道',
    ownerId: DEV_DEMO_USER_IDS.creator,
    ownerName: demoUserProfile(DEV_DEMO_USER_IDS.creator).name,
    amount: 68000,
    status: 'paid',
  },
  {
    id: '60004',
    date: dateDaysAgo(1),
    planId: '10001',
    keyword: '团队分佣',
    channelId: '20001',
    channelName: '知乎故事一代渠道',
    ownerId: DEV_DEMO_USER_IDS.leader,
    ownerName: demoUserProfile(DEV_DEMO_USER_IDS.leader).name,
    amount: 160000,
    status: 'confirmed',
  },
  {
    id: '60005',
    date: dateDaysAgo(6),
    planId: '10002',
    keyword: '盐选内容推荐团队分佣',
    channelId: '20002',
    channelName: '团长演示二代渠道',
    ownerId: DEV_DEMO_USER_IDS.leader,
    ownerName: demoUserProfile(DEV_DEMO_USER_IDS.leader).name,
    amount: 36000,
    status: 'paid',
  },
];

export function listDevDemoEarnings(user: AuthUser, query: Record<string, unknown>) {
  let list = demoEarnings.filter((earning) => canViewOwner(user, earning.ownerId));
  if (query.status) list = list.filter((earning) => earning.status === String(query.status));
  list = list.sort((left, right) => right.date.localeCompare(left.date) || Number(right.id) - Number(left.id));
  return paginateDemoList(list, query);
}

export function devDemoEarningsSummary(user: AuthUser) {
  const summary: { pending: number; confirmed: number; paid: number; total: number } = {
    pending: 0,
    confirmed: 0,
    paid: 0,
    total: 0,
  };
  for (const item of demoEarnings.filter((earning) => canViewOwner(user, earning.ownerId))) {
    summary[item.status] += item.amount;
    summary.total += item.amount;
  }
  const withdrawn = demoWithdrawals
    .filter((withdrawal) => canViewOwner(user, withdrawal.userId) && withdrawal.status === 'approved')
    .reduce((sum, item) => sum + item.amount, 0);
  return { ...summary, withdrawn };
}

const demoWithdrawals: DemoWithdrawal[] = [
  {
    id: '70001',
    userId: DEV_DEMO_USER_IDS.creator,
    amount: 36000,
    settleType: 'personal',
    payMethod: 'alipay',
    payAccount: 'creator@demo.local',
    companyName: null,
    bankName: null,
    bankAccount: null,
    taxId: null,
    invoiceName: null,
    invoiceUploadedAt: null,
    status: 'pending',
    remark: null,
    leaderId: null,
    leaderRemark: null,
    leaderHandledAt: null,
    handledBy: null,
    handledAt: null,
    riskFlags: null,
    createdAt: isoDaysAgo(1),
    updatedAt: isoDaysAgo(1),
  },
  {
    id: '70002',
    userId: DEV_DEMO_USER_IDS.creator,
    amount: 58000,
    settleType: 'personal',
    payMethod: 'wechat',
    payAccount: 'wx_creator_demo',
    companyName: null,
    bankName: null,
    bankAccount: null,
    taxId: null,
    invoiceName: null,
    invoiceUploadedAt: null,
    status: 'leader_approved',
    remark: null,
    leaderId: DEV_DEMO_USER_IDS.leader,
    leaderRemark: '团队数据核对无误',
    leaderHandledAt: isoDaysAgo(1),
    handledBy: null,
    handledAt: null,
    riskFlags: ['new_account_large'],
    createdAt: isoDaysAgo(2),
    updatedAt: isoDaysAgo(1),
  },
  {
    id: '70003',
    userId: DEV_DEMO_USER_IDS.leader,
    amount: 82000,
    settleType: 'personal',
    payMethod: 'alipay',
    payAccount: 'leader@demo.local',
    companyName: null,
    bankName: null,
    bankAccount: null,
    taxId: null,
    invoiceName: null,
    invoiceUploadedAt: null,
    status: 'leader_approved',
    remark: null,
    leaderId: null,
    leaderRemark: null,
    leaderHandledAt: null,
    handledBy: null,
    handledAt: null,
    riskFlags: null,
    createdAt: isoDaysAgo(3),
    updatedAt: isoDaysAgo(3),
  },
  {
    id: '70004',
    userId: DEV_DEMO_USER_IDS.creator,
    amount: 42000,
    settleType: 'personal',
    payMethod: 'alipay',
    payAccount: 'creator@demo.local',
    companyName: null,
    bankName: null,
    bankAccount: null,
    taxId: null,
    invoiceName: null,
    invoiceUploadedAt: null,
    status: 'approved',
    remark: '本地演示已放款',
    leaderId: DEV_DEMO_USER_IDS.leader,
    leaderRemark: '通过',
    leaderHandledAt: isoDaysAgo(5),
    handledBy: DEV_DEMO_USER_IDS.admin,
    handledAt: isoDaysAgo(4),
    riskFlags: null,
    createdAt: isoDaysAgo(6),
    updatedAt: isoDaysAgo(4),
  },
];

function publicDevDemoWithdrawal(item: DemoWithdrawal) {
  const applicant = demoUserProfile(item.userId);
  const leader = item.leaderId ? demoUserProfile(item.leaderId) : null;
  return {
    id: item.id,
    amount: item.amount,
    settleType: item.settleType,
    payMethod: item.payMethod,
    payAccount: item.payAccount,
    companyName: item.companyName,
    bankName: item.bankName,
    bankAccount: item.bankAccount,
    taxId: item.taxId,
    invoiceName: item.invoiceName,
    invoiceUploadedAt: item.invoiceUploadedAt,
    status: item.status,
    remark: item.remark,
    leaderRemark: item.leaderRemark,
    riskFlags: item.riskFlags,
    applicantUsername: applicant.username,
    applicantName: applicant.name,
    leaderName: leader?.name ?? null,
    leaderHandledAt: item.leaderHandledAt,
    handledAt: item.handledAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function findWithdrawal(user: AuthUser, id: string) {
  const item = demoWithdrawals.find((withdrawal) => withdrawal.id === id);
  if (!item) throw new AppError(404, 40401, '提现申请不存在');
  if (!canViewOwner(user, item.userId)) throw new AppError(403, 40301, '无权查看该提现申请');
  return item;
}

function devDemoAvailableBalance(userId: string) {
  const confirmed = demoEarnings
    .filter((earning) => earning.ownerId === userId && earning.status === 'confirmed')
    .reduce((sum, item) => sum + item.amount, 0);
  const reserved = demoWithdrawals
    .filter((withdrawal) =>
      withdrawal.userId === userId && ['pending', 'leader_approved', 'approved'].includes(withdrawal.status),
    )
    .reduce((sum, item) => sum + item.amount, 0);
  return confirmed - reserved;
}

export function listDevDemoWithdrawals(user: AuthUser, query: Record<string, unknown>) {
  let list = demoWithdrawals.filter((withdrawal) => canViewOwner(user, withdrawal.userId));
  if (query.status) list = list.filter((withdrawal) => withdrawal.status === String(query.status));
  list = list.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  return paginateDemoList(list.map(publicDevDemoWithdrawal), query);
}

export function applyDevDemoWithdrawal(
  user: AuthUser,
  input: {
    amount: number;
    settleType: 'personal' | 'corporate';
    payMethod: 'alipay' | 'wechat' | 'bank_transfer';
    payAccount: string;
    companyName?: string;
    bankName?: string;
    bankAccount?: string;
    taxId?: string;
  },
) {
  if (input.settleType === 'corporate') {
    if (!input.companyName?.trim() || !input.bankName?.trim() || !input.bankAccount?.trim() || !input.taxId?.trim()) {
      throw new AppError(422, 42200, '对公结算必须完整填写公司名称、开户行、银行账号和纳税人识别号');
    }
  }
  if (input.amount > devDemoAvailableBalance(user.sub)) throw new AppError(422, 42206, '可提现余额不足');
  const now = new Date().toISOString();
  const initialStatus: DemoWithdrawalStatus = user.role === 'leader' ? 'leader_approved' : 'pending';
  const riskFlags = input.amount >= 100000 ? ['new_account_large'] : null;
  const item: DemoWithdrawal = {
    id: nextDemoId(),
    userId: user.sub,
    amount: input.amount,
    settleType: input.settleType,
    payMethod: input.payMethod,
    payAccount: input.payAccount,
    companyName: input.settleType === 'corporate' ? input.companyName!.trim() : null,
    bankName: input.settleType === 'corporate' ? input.bankName!.trim() : null,
    bankAccount: input.settleType === 'corporate' ? input.bankAccount!.trim() : null,
    taxId: input.settleType === 'corporate' ? input.taxId!.trim() : null,
    invoiceName: null,
    invoiceUploadedAt: null,
    status: initialStatus,
    remark: null,
    leaderId: null,
    leaderRemark: null,
    leaderHandledAt: null,
    handledBy: null,
    handledAt: null,
    riskFlags,
    createdAt: now,
    updatedAt: now,
  };
  demoWithdrawals.unshift(item);
  return { id: item.id, status: initialStatus, riskFlags: riskFlags ?? [] };
}

export function cancelDevDemoWithdrawal(user: AuthUser, id: string) {
  const item = findWithdrawal(user, id);
  if (item.userId !== user.sub || item.status !== 'pending') throw new AppError(409, 40903, '只有待初审的申请可以撤销');
  item.status = 'cancelled';
  item.updatedAt = new Date().toISOString();
}

export function reviewDevDemoWithdrawal(user: AuthUser, id: string, action: 'approve' | 'reject', remark: string | null) {
  const item = findWithdrawal(user, id);
  if (item.status !== 'pending') throw new AppError(409, 40903, '该申请不在待初审状态');
  if (demoUserProfile(item.userId).parentId !== user.sub) throw new AppError(403, 40301, '只能初审本团队成员的申请');
  const now = new Date().toISOString();
  item.status = action === 'approve' ? 'leader_approved' : 'rejected';
  item.leaderId = user.sub;
  item.leaderRemark = remark;
  item.leaderHandledAt = now;
  item.updatedAt = now;
}

export function decideDevDemoWithdrawal(user: AuthUser, id: string, action: 'approve' | 'reject', remark: string | null) {
  const item = findWithdrawal(user, id);
  if (item.status !== 'leader_approved') throw new AppError(409, 40903, '只有初审通过的申请可以终审');
  const now = new Date().toISOString();
  item.status = action === 'approve' ? 'approved' : 'rejected';
  item.remark = remark;
  item.handledBy = user.sub;
  item.handledAt = now;
  item.updatedAt = now;
}

export function uploadDevDemoInvoice(user: AuthUser, id: string, originalName: string) {
  const item = findWithdrawal(user, id);
  if (item.userId !== user.sub) throw new AppError(403, 40301, '只能给自己的申请上传发票');
  if (item.settleType !== 'corporate') throw new AppError(422, 42200, '只有对公结算的申请需要上传发票');
  if (item.status === 'approved' || item.status === 'cancelled') throw new AppError(409, 40903, '该申请已完结，不能再上传发票');
  item.invoiceName = originalName.slice(0, 255);
  item.invoiceUploadedAt = new Date().toISOString();
  item.updatedAt = item.invoiceUploadedAt;
  return { name: item.invoiceName };
}

export function getDevDemoInvoiceMeta(user: AuthUser, id: string) {
  const item = findWithdrawal(user, id);
  if (!item.invoiceName) throw new AppError(404, 40401, '该申请没有上传发票');
  return { name: item.invoiceName, withdrawal: publicDevDemoWithdrawal(item) };
}

export function getDevDemoStatement(user: AuthUser, id: string) {
  const item = findWithdrawal(user, id);
  const applicant = demoUserProfile(item.userId);
  const leader = item.leaderId ? demoUserProfile(item.leaderId) : null;
  const final = item.handledBy ? demoUserProfile(item.handledBy) : null;
  return {
    statementNo: `WD-${item.id.padStart(8, '0')}`,
    amount: item.amount,
    status: item.status,
    settleType: item.settleType,
    payMethod: item.payMethod,
    payAccount: item.payAccount,
    corporate: item.settleType === 'corporate'
      ? { companyName: item.companyName!, bankName: item.bankName!, bankAccount: item.bankAccount!, taxId: item.taxId! }
      : null,
    applicant: { username: applicant.username, name: applicant.name },
    leader: leader ? { name: leader.name, remark: item.leaderRemark, at: item.leaderHandledAt ?? item.updatedAt } : null,
    final: final ? { name: final.name, remark: item.remark, at: item.handledAt ?? item.updatedAt } : null,
    riskFlags: item.riskFlags,
    invoice: item.invoiceName && item.invoiceUploadedAt ? { name: item.invoiceName, uploadedAt: item.invoiceUploadedAt } : null,
    createdAt: item.createdAt,
    issuedAt: new Date().toISOString(),
  };
}

const demoAppeals: DemoAppeal[] = [
  {
    id: '80001',
    userId: DEV_DEMO_USER_IDS.creator,
    kind: '结算异议',
    title: '8 月 30 日推广订单疑似漏算',
    content: '本地演示：达人提交后先进入团长初审，团长确认属实后再交给管理员终审。',
    evidence: '演示截图编号 DEMO-001',
    status: 'pending',
    remark: null,
    leaderId: null,
    leaderRemark: null,
    leaderHandledAt: null,
    handledBy: null,
    handledAt: null,
    adjustAmount: null,
    createdAt: isoDaysAgo(1),
  },
  {
    id: '80002',
    userId: DEV_DEMO_USER_IDS.creator,
    kind: '补款',
    title: '盐选内容推广补款申请',
    content: '团长已初审通过，管理员可在终审时填写调账金额。',
    evidence: '任务：盐选内容推荐任务；关键词：盐选内容推荐',
    status: 'leader_approved',
    remark: null,
    leaderId: DEV_DEMO_USER_IDS.leader,
    leaderRemark: '已核对团队台账，建议补发',
    leaderHandledAt: isoDaysAgo(1),
    handledBy: null,
    handledAt: null,
    adjustAmount: null,
    createdAt: isoDaysAgo(3),
  },
  {
    id: '80003',
    userId: DEV_DEMO_USER_IDS.creator,
    kind: '扣款',
    title: '重复结算扣回',
    content: '终审已处理，用于展示已完成申诉记录。',
    evidence: null,
    status: 'approved',
    remark: '已完成调账',
    leaderId: DEV_DEMO_USER_IDS.leader,
    leaderRemark: '确认重复',
    leaderHandledAt: isoDaysAgo(6),
    handledBy: DEV_DEMO_USER_IDS.admin,
    handledAt: isoDaysAgo(5),
    adjustAmount: -6000,
    createdAt: isoDaysAgo(7),
  },
];

function publicDevDemoAppeal(item: DemoAppeal) {
  const applicant = demoUserProfile(item.userId);
  const leader = item.leaderId ? demoUserProfile(item.leaderId) : null;
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    content: item.content,
    evidence: item.evidence,
    status: item.status,
    remark: item.remark,
    leaderRemark: item.leaderRemark,
    adjustAmount: item.adjustAmount,
    applicantUsername: applicant.username,
    applicantName: applicant.name,
    leaderName: leader?.name ?? null,
    leaderHandledAt: item.leaderHandledAt,
    handledAt: item.handledAt,
    createdAt: item.createdAt,
  };
}

function findAppeal(user: AuthUser, id: string) {
  const item = demoAppeals.find((appeal) => appeal.id === id);
  if (!item) throw new AppError(404, 40401, '申诉不存在');
  if (!canViewOwner(user, item.userId)) throw new AppError(403, 40301, '无权查看该申诉');
  return item;
}

export function listDevDemoAppeals(user: AuthUser, query: Record<string, unknown>) {
  let list = demoAppeals.filter((appeal) => canViewOwner(user, appeal.userId));
  if (query.status) list = list.filter((appeal) => appeal.status === String(query.status));
  list = list.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  return paginateDemoList(list.map(publicDevDemoAppeal), query);
}

export function submitDevDemoAppeal(user: AuthUser, input: { kind: string; title: string; content: string; evidence?: string | null }) {
  const item: DemoAppeal = {
    id: nextDemoId(),
    userId: user.sub,
    kind: input.kind as DemoAppealKind,
    title: input.title,
    content: input.content,
    evidence: input.evidence ?? null,
    status: 'pending',
    remark: null,
    leaderId: null,
    leaderRemark: null,
    leaderHandledAt: null,
    handledBy: null,
    handledAt: null,
    adjustAmount: null,
    createdAt: new Date().toISOString(),
  };
  demoAppeals.unshift(item);
  return { id: item.id };
}

export function cancelDevDemoAppeal(user: AuthUser, id: string) {
  const item = findAppeal(user, id);
  if (item.userId !== user.sub || item.status !== 'pending') throw new AppError(409, 40903, '只有待初审的申诉可以撤销');
  item.status = 'cancelled';
}

export function reviewDevDemoAppeal(user: AuthUser, id: string, action: 'approve' | 'reject', remark: string | null) {
  const item = findAppeal(user, id);
  if (item.status !== 'pending') throw new AppError(409, 40903, '该申诉不在待初审状态');
  if (demoUserProfile(item.userId).parentId !== user.sub) throw new AppError(403, 40301, '只能初审本团队成员的申诉');
  const now = new Date().toISOString();
  item.status = action === 'approve' ? 'leader_approved' : 'rejected';
  item.leaderId = user.sub;
  item.leaderRemark = remark;
  item.leaderHandledAt = now;
}

export function decideDevDemoAppeal(
  user: AuthUser,
  id: string,
  action: 'approve' | 'reject',
  remark: string | null,
  adjustAmount: number | null,
) {
  const item = findAppeal(user, id);
  if (item.status !== 'leader_approved') throw new AppError(409, 40903, '只有初审通过的申诉可以终审');
  const now = new Date().toISOString();
  item.status = action === 'approve' ? 'approved' : 'rejected';
  item.remark = remark;
  item.handledBy = user.sub;
  item.handledAt = now;
  item.adjustAmount = action === 'approve' ? adjustAmount : null;
  if (action === 'approve' && adjustAmount !== null && adjustAmount !== 0) {
    const applicant = demoUserProfile(item.userId);
    demoEarnings.unshift({
      id: nextDemoId(),
      date: new Date().toISOString().slice(0, 10),
      planId: '10001',
      keyword: `申诉调账：${item.title}`,
      channelId: '20001',
      channelName: '知乎故事一代渠道',
      ownerId: item.userId,
      ownerName: applicant.name,
      amount: adjustAmount,
      status: 'confirmed',
    });
  }
}

export function activeDevDemoAnnouncements() {
  return [
    {
      id: 'ann-demo-1',
      title: '本地演示模式',
      content: '当前使用本地演示账号和演示数据，适合快速查看三端页面与流程。',
      createdAt: new Date().toISOString(),
    },
  ];
}

export function devDemoSiteInfo() {
  return {
    node: process.version,
    uptimeSec: Math.floor(process.uptime()),
    zhihuApiBase: config.zhihu.apiBase,
    zhihuCredentialMode: 'mock',
    sync: {
      channels: new Date().toISOString(),
      tasks: new Date().toISOString(),
      metrics: new Date().toISOString(),
    },
  };
}
