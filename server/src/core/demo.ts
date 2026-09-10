import crypto from 'node:crypto';
import { permissionsFor } from '../auth/permissions';
import { RefreshSession } from '../auth/tokenSessions';
import { config } from '../config';
import { AppError } from '../middleware/errors';
import { AuthUser, Role } from '../types';

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

const DAY_MS = 86_400_000;
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

export function activeDevDemoAnnouncements() {
  return [{ id: '1', title: 'OPC 本地演示', content: '公共工作台演示数据', createdAt: new Date().toISOString() }];
}
export function devDemoSiteInfo() {
  return { node: process.version, uptimeSec: Math.floor(process.uptime()), name: 'OPC' };
}
const accounts: Array<{ id: string; accountKey: string; accountName: string; ownerUserId: string; status: string }> =
  [];
export function listDevDemoMcnAccounts() {
  return accounts;
}
export function createDevDemoMcnAccount(input: { accountKey: string; accountName: string; ownerUserId: string }) {
  const row = { ...input, id: String(Date.now()), status: 'active' };
  accounts.push(row);
  return row;
}
