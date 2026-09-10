import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { AuthUser } from '../types';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { assertProjectMembership } from '../services/projectMembers.service';
import { writeAudit } from '../services/audit.service';
import { isDevDemoAuthUser } from './demo';
export interface IntegrationAccount {
  id: string;
  moduleId: string;
  accountKey: string;
  name: string;
  status: 'active' | 'disabled';
}
interface AccountRow extends RowDataPacket {
  id: string;
  module_id: string;
  account_key: string;
  name: string;
  status: 'active' | 'disabled';
}
const publicAccount = (r: AccountRow): IntegrationAccount => ({
  id: String(r.id),
  moduleId: r.module_id,
  accountKey: r.account_key,
  name: r.name,
  status: r.status,
});
const demoAccounts: IntegrationAccount[] = [];
const demoLinks = new Set<string>();
export async function listAccounts(user: AuthUser) {
  if (isDevDemoAuthUser(user)) return user.role === 'admin' ? demoAccounts : [];
  const filter =
    user.role === 'admin'
      ? '1=1'
      : 'EXISTS (SELECT 1 FROM project_integrations pi JOIN project_members pm ON pm.project_id=pi.project_id WHERE pi.account_id=a.id AND pm.user_id=? AND pm.left_at IS NULL)';
  return (
    await rows<AccountRow>(
      'SELECT a.id,a.module_id,a.account_key,a.name,a.status FROM integration_accounts a WHERE ' + filter,
      user.role === 'admin' ? [] : [user.sub],
    )
  ).map(publicAccount);
}
export async function createAccount(user: AuthUser, input: { moduleId: string; accountKey: string; name: string }) {
  if (isDevDemoAuthUser(user)) {
    const a = { ...input, id: String(Date.now()), status: 'active' as const };
    demoAccounts.push(a);
    return a;
  }
  return withTransaction(async (c) => {
    const [r] = await c.query<ResultSetHeader>(
      'INSERT INTO integration_accounts(module_id,account_key,name,created_by) VALUES (?,?,?,?)',
      [input.moduleId, input.accountKey, input.name, user.sub],
    );
    await writeAudit(
      { userId: user.sub, action: 'integration.create', resourceType: 'integration', resourceId: String(r.insertId) },
      c,
    );
    return { ...input, id: String(r.insertId), status: 'active' as const };
  });
}
export async function setAccountStatus(user: AuthUser, id: string, status: 'active' | 'disabled') {
  if (isDevDemoAuthUser(user)) {
    const a = demoAccounts.find((a) => a.id === id);
    if (!a) throw new AppError(404, 40401, '接入账号不存在');
    a.status = status;
    return;
  }
  await withTransaction(async (c) => {
    const [r] = await c.query<ResultSetHeader>('UPDATE integration_accounts SET status=? WHERE id=?', [status, id]);
    if (!r.affectedRows) throw new AppError(404, 40401, '接入账号不存在');
    await writeAudit(
      {
        userId: user.sub,
        action: 'integration.status',
        resourceType: 'integration',
        resourceId: id,
        detail: { status },
      },
      c,
    );
  });
}
export async function linkAccount(user: AuthUser, projectId: string, accountId: string, remove = false) {
  await assertProjectMembership(user, projectId);
  if (isDevDemoAuthUser(user)) {
    const key = projectId + ':' + accountId;
    if (remove) demoLinks.delete(key);
    else demoLinks.add(key);
    return;
  }
  await withTransaction(async (c) => {
    if (remove)
      await c.query('DELETE FROM project_integrations WHERE project_id=? AND account_id=?', [projectId, accountId]);
    else
      await c.query(
        'INSERT INTO project_integrations(project_id,account_id) VALUES (?,?) ON DUPLICATE KEY UPDATE account_id=VALUES(account_id)',
        [projectId, accountId],
      );
    await writeAudit(
      {
        userId: user.sub,
        action: remove ? 'project.integration_remove' : 'project.integration_add',
        resourceType: 'project',
        resourceId: projectId,
        detail: { accountId },
      },
      c,
    );
  });
}
export async function projectAccounts(user: AuthUser, projectId: string) {
  await assertProjectMembership(user, projectId);
  if (isDevDemoAuthUser(user)) return demoAccounts.filter((a) => demoLinks.has(projectId + ':' + a.id));
  return (
    await rows<AccountRow>(
      'SELECT a.id,a.module_id,a.account_key,a.name,a.status FROM integration_accounts a JOIN project_integrations pi ON pi.account_id=a.id WHERE pi.project_id=?',
      [projectId],
    )
  ).map(publicAccount);
}
export async function assertDataScope(user: AuthUser, projectId: string, accountId: string, moduleId: string) {
  const accounts = await projectAccounts(user, projectId);
  const account = accounts.find((a) => a.id === accountId && a.moduleId === moduleId && a.status === 'active');
  if (!account) throw new AppError(403, 40304, '接入账号不属于该项目或已停用');
  return account;
}
