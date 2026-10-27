import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { AuthUser } from '../types';
import { rows, withTransaction } from '../db';
import { effectiveDuty, isStaffRole, normalizeRole } from '../auth/roles';
import { AppError } from '../middleware/errors';
import type { ModuleRuntime } from '../core/module-runtime';
import { canManageMember, updateMemberAccessInTransaction, type MemberAccessPatch } from './member-access.service';
import { writeAudit } from './audit.service';
import { resolveUserIdentifier } from '../auth/user-id';

export type MemberChangeOperation =
  | {
      kind: 'edit';
      displayName: string;
      phone: string | null;
      role: 'creator' | 'leader';
      isActive: boolean;
      parentId?: string | null;
      projectIds?: string[];
      childrenParentId?: string | null;
    }
  | { kind: 'team'; parentId: string | null }
  | { kind: 'role'; role: 'creator' | 'leader'; parentId?: string | null; childrenParentId?: string | null }
  | { kind: 'projects'; mode: 'add' | 'remove'; projectIds: string[] }
  | { kind: 'active'; isActive: boolean };
type State = {
  id: string;
  name: string;
  username: string;
  phone?: string | null;
  role: string;
  parentId: string | null;
  parentName: string | null;
  active: boolean;
  duty: string;
  projects: { id: string; name: string; role: string; leftAt: string | null }[];
};
type Preview = { before: State[]; after: State[]; tasks: { id: string; label: string; projectId: string }[] };
type Item = RowDataPacket & {
  ordinal: number;
  user_id: string | null;
  reference: string;
  status: string;
  message: string;
  preview_json: Preview | null;
};
type Run = RowDataPacket & {
  id: string;
  actor_id: string;
  review_hash: string;
  operation_json: MemberChangeOperation;
  status: string;
};
// MySQL JSON normalizes object key order; hashes must survive a storage round trip.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}
const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const parse = <T>(v: T | string): T => (typeof v === 'string' ? JSON.parse(v) : v);
const denied = () => new AppError(403, 40301, '只有具备成员管理权限的运营管理人员可以处理此操作');
export function assertMemberChangeAccess(actor: AuthUser) {
  if (!isStaffRole(actor.role) || effectiveDuty(actor) === 'finance') throw denied();
}
async function liveActor(c: PoolConnection, actor: AuthUser) {
  const [[row]] = await c.query<RowDataPacket[]>(
    'SELECT role,admin_duty,is_active,closed_at FROM users WHERE id=? FOR UPDATE',
    [actor.sub],
  );
  const role = normalizeRole(row?.role);
  if (!row?.is_active || row.closed_at || !role) throw denied();
  const current = { ...actor, role, adminDuty: row.admin_duty };
  assertMemberChangeAccess(current);
  return current;
}
async function state(c: PoolConnection, id: string, includePhone = false): Promise<State> {
  const [[u]] = await c.query<RowDataPacket[]>(
    `SELECT u.*,p.display_name parent_name FROM users u LEFT JOIN users p ON p.id=u.parent_id WHERE u.id=?`,
    [id],
  );
  if (!u) throw new AppError(404, 40401, '成员已不存在，请重新选择');
  const [projects] = await c.query<RowDataPacket[]>(
    `SELECT pm.project_id,p.name,pm.member_role,pm.left_at FROM project_members pm JOIN projects p ON p.id=pm.project_id WHERE pm.user_id=? ORDER BY pm.project_id FOR UPDATE`,
    [id],
  );
  return {
    id,
    name: u.display_name,
    username: u.username,
    ...(includePhone ? { phone: u.phone ?? null } : {}),
    role: u.role,
    parentId: u.parent_id == null ? null : String(u.parent_id),
    parentName: u.parent_name,
    active: Boolean(u.is_active),
    duty: u.admin_duty,
    projects: projects.map((p) => ({
      id: String(p.project_id),
      name: String(p.name),
      role: String(p.member_role),
      leftAt: p.left_at ? 'removed' : null,
    })),
  };
}
async function applyUnit(
  c: PoolConnection,
  actor: AuthUser,
  id: string,
  op: MemberChangeOperation,
  runtime: ModuleRuntime,
  selectedIds: Set<string>,
  expected?: Preview,
): Promise<Preview> {
  const related = [
    actor.sub,
    id,
    ...(op.kind === 'team'
      ? [op.parentId]
      : op.kind === 'role' || op.kind === 'edit'
        ? [op.parentId, op.childrenParentId]
        : []),
  ].filter(Boolean);
  // Lock affected identities and descendants before checking or changing any of them.
  const [users] = await c.query<RowDataPacket[]>(
    `SELECT * FROM users WHERE id IN (${related.map(() => '?').join(',')}) OR parent_id=? OR role='developer' ORDER BY id FOR UPDATE`,
    [...related, id],
  );
  const current = await liveActor(c, actor);
  const member = users.find((u) => String(u.id) === id);
  if (
    !member ||
    !canManageMember(current, {
      id: member.id,
      role: member.role,
      parent_id: member.parent_id,
      closed_at: member.closed_at,
    }) ||
    !['leader', 'creator'].includes(member.role)
  )
    throw new AppError(403, 40301, '此成员不在可批量管理范围内；管理身份请使用专门的授权入口');
  const children =
    (op.kind === 'role' || op.kind === 'edit') && op.role === 'creator' && member.role === 'leader'
      ? users.filter((u) => String(u.parent_id) === id)
      : [];
  if (children.length && (op.kind === 'role' || op.kind === 'edit') && op.childrenParentId === undefined)
    throw new AppError(409, 40900, '请在本页选择下属成员的新归属后重新预览');
  if (children.some((u) => selectedIds.has(String(u.id))))
    throw new AppError(409, 40900, '该团长的下属已单独选中，请取消下属勾选后重新预览；下属会随团长安置一起处理');
  if (
    (op.kind === 'role' || op.kind === 'edit') &&
    children.length &&
    op.childrenParentId &&
    selectedIds.has(op.childrenParentId)
  )
    throw new AppError(409, 40900, '接收成员的团长也在此次角色调整范围内，请选择其他团长');
  if (
    (op.kind === 'role' || op.kind === 'edit') &&
    op.role === 'creator' &&
    op.parentId &&
    selectedIds.has(op.parentId)
  )
    throw new AppError(409, 40900, '目标团长也在此次角色调整范围内，请选择其他团长');
  const ids = [id, ...children.map((u) => String(u.id))];
  const before: State[] = [];
  for (const target of ids) before.push(await state(c, target, op.kind === 'edit'));
  if (expected && digest(before) !== digest(expected.before))
    throw new AppError(409, 40900, '成员、项目或下属名单已变化，请重新预览后再确认');
  let patch: MemberAccessPatch;
  if (op.kind === 'edit') {
    // Keep the whole single-member edit in the same previewed transaction.
    const { kind, childrenParentId, ...access } = op;
    patch = access;
  } else if (op.kind === 'team') {
    if (member.role !== 'creator')
      throw new AppError(422, 42200, '团队归属只适用于达人；团长改任达人请使用调整业务角色');
    patch = { parentId: op.parentId };
  } else if (op.kind === 'role')
    // Selecting an already-matching role must not silently detach that creator.
    patch =
      member.role === op.role
        ? {}
        : { role: op.role, ...(op.role === 'creator' && op.parentId !== undefined ? { parentId: op.parentId } : {}) };
  else if (op.kind === 'active') patch = { isActive: op.isActive };
  else {
    const active = before[0].projects.filter((p) => !p.leftAt).map((p) => p.id);
    patch = {
      projectIds:
        op.mode === 'add'
          ? [...new Set([...active, ...op.projectIds])]
          : active.filter((p) => !op.projectIds.includes(p)),
    };
  }
  const tasks: Preview['tasks'] = [];
  // A leader and all dependent relocations form one transaction, never partial success.
  for (const child of children)
    tasks.push(
      ...(await updateMemberAccessInTransaction(
        c,
        current,
        String(child.id),
        { parentId: op.kind === 'role' || op.kind === 'edit' ? op.childrenParentId! : null },
        runtime,
        true,
      )),
    );
  tasks.push(...(await updateMemberAccessInTransaction(c, current, id, patch, runtime, true)));
  const after: State[] = [];
  for (const target of ids) after.push(await state(c, target, op.kind === 'edit'));
  const uniqueTasks = [...new Map(tasks.map((t) => [t.projectId + ':' + t.id, t])).values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  if (expected && (digest(after) !== digest(expected.after) || digest(uniqueTasks) !== digest(expected.tasks)))
    throw new AppError(409, 40900, '任务或可开通项目已变化，请重新预览后再确认');
  return { before, after, tasks: uniqueTasks };
}
function publicItem(item: Item) {
  return {
    ordinal: item.ordinal,
    reference: item.reference,
    userId: item.user_id == null ? null : String(item.user_id),
    status: item.status,
    message: item.message,
    preview: item.preview_json ? parse(item.preview_json) : null,
  };
}
function message(error: unknown) {
  return error instanceof AppError ? error.message.slice(0, 1000) : '处理暂未完成，请重新预览后重试';
}
async function findMember(c: PoolConnection, reference: string): Promise<string | null> {
  const explicit = reference.match(/^id:([1-9]\d*)$/i);
  const id = explicit?.[1] ?? (/^[1-9]\d*$/.test(reference) ? reference : null);
  const resolved = explicit ? undefined : await resolveUserIdentifier(c, reference);
  const [[internal]] = id ? await c.query<RowDataPacket[]>('SELECT id FROM users WHERE id=?', [id]) : [[]];
  if (resolved && internal && resolved !== String(internal.id)) throw new AppError(422, 42200, '账号与数字 ID 匹配到不同成员，请使用固定 timo ID');
  return resolved ?? (internal ? String(internal.id) : null);
}
export async function previewMemberChanges(
  actor: AuthUser,
  references: string[],
  operation: MemberChangeOperation,
  runtime: ModuleRuntime,
) {
  assertMemberChangeAccess(actor);
  if (operation.kind === 'edit' && references.length !== 1)
    throw new AppError(422, 42200, '单人编辑每次只能处理一位成员，请返回成员列表重新选择');
  // Separate short transactions per member keep large selections from holding all account locks.
  const id = randomUUID(),
    items: { reference: string; userId: string | null; status: string; message: string; preview: Preview | null }[] =
      [];
  const resolved = await withTransaction(async (c) => {
    await liveActor(c, actor);
    const result: { reference: string; id: string | null; error?: string }[] = [];
    for (const reference of references) {
      try {
        result.push({ reference, id: await findMember(c, reference) });
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        result.push({ reference, id: null, error: message(e) });
      }
    }
    return result;
  });
  const allIds = new Set(resolved.flatMap((r) => (r.id ? [r.id] : []))),
    seen = new Set<string>();
  for (const row of resolved) {
    const item = {
      reference: row.reference,
      userId: row.id,
      status: 'blocked',
      message: row.error ?? '',
      preview: null as Preview | null,
    };
    if (!row.id) item.message ||= '未找到该成员，请核对账号或固定 ID';
    else if (seen.has(row.id)) item.message = '重复选择，已保留前面的成员记录';
    else {
      seen.add(row.id);
      try {
        item.preview = await withTransaction(async (c) => {
          await c.query('SAVEPOINT member_preview');
          const result = await applyUnit(c, actor, row.id!, operation, runtime, allIds);
          await c.query('ROLLBACK TO SAVEPOINT member_preview');
          return result;
        });
        item.status = digest(item.preview.before) === digest(item.preview.after) ? 'unchanged' : 'ready';
        item.message = item.status === 'unchanged' ? '已是目标状态，无需变更' : '可执行；旧任务及收益保留原归属';
      } catch (e) {
        item.message = message(e);
      }
    }
    items.push(item);
  }
  const reviewHash = digest({ id, operation, items });
  await withTransaction(async (c) => {
    await liveActor(c, actor);
    await c.query('INSERT INTO member_change_runs(id,actor_id,operation_json,review_hash) VALUES(?,?,?,?)', [
      id,
      actor.sub,
      JSON.stringify(operation),
      reviewHash,
    ]);
    for (const [ordinal, item] of items.entries())
      await c.query(
        'INSERT INTO member_change_items(run_id,ordinal,reference,user_id,status,message,preview_json) VALUES(?,?,?,?,?,?,?)',
        [
          id,
          ordinal,
          item.reference,
          item.userId,
          item.status,
          item.message,
          item.preview ? JSON.stringify(item.preview) : null,
        ],
      );
  });
  return getMemberChangeRun(actor, id);
}
export async function getMemberChangeRun(actor: AuthUser, id: string) {
  assertMemberChangeAccess(actor);
  const [run] = await rows<Run>('SELECT * FROM member_change_runs WHERE id=? AND actor_id=?', [id, actor.sub]);
  if (!run) throw new AppError(404, 40401, '找不到这次操作，请返回成员列表');
  const items = await rows<Item>('SELECT * FROM member_change_items WHERE run_id=? ORDER BY ordinal', [id]);
  return {
    id: run.id,
    status: run.status,
    operation: parse(run.operation_json),
    reviewHash: run.review_hash,
    createdAt: run.created_at,
    items: items.map(publicItem),
  };
}
export async function listMemberChangeRuns(actor: AuthUser) {
  assertMemberChangeAccess(actor);
  return rows<RowDataPacket>(
    `SELECT r.id,r.status,r.created_at,COUNT(i.ordinal) total,SUM(i.status='succeeded') succeeded,SUM(i.status IN ('ready','pending')) remaining FROM member_change_runs r LEFT JOIN member_change_items i ON i.run_id=r.id WHERE r.actor_id=? GROUP BY r.id ORDER BY r.created_at DESC LIMIT 20`,
    [actor.sub],
  );
}
export async function executeMemberChanges(actor: AuthUser, id: string, reviewHash: string, runtime: ModuleRuntime) {
  assertMemberChangeAccess(actor);
  // Each call handles at most ten units. The persisted run is the idempotency key;
  // concurrent/retried requests can never execute a successful item twice.
  for (let i = 0; i < 10; i++) {
    const more = await withTransaction(async (c) => {
      const [[run]] = await c.query<Run[]>('SELECT * FROM member_change_runs WHERE id=? AND actor_id=? FOR UPDATE', [
        id,
        actor.sub,
      ]);
      if (!run) throw new AppError(404, 40401, '找不到这次操作');
      if (run.review_hash !== reviewHash) throw new AppError(409, 40900, '确认内容不一致，请重新打开预览');
      await liveActor(c, actor);
      if (run.status === 'done') return false;
      if (run.status === 'preview') {
        await c.query("UPDATE member_change_items SET status='pending' WHERE run_id=? AND status='ready'", [id]);
        await c.query("UPDATE member_change_runs SET status='running' WHERE id=?", [id]);
        await writeAudit(
          {
            userId: actor.sub,
            action: 'user.batch_confirm',
            resourceType: 'member_change',
            resourceId: id,
            detail: { operation: parse(run.operation_json) },
          },
          c,
        );
      }
      const [[item]] = await c.query<Item[]>(
        "SELECT * FROM member_change_items WHERE run_id=? AND status='pending' ORDER BY ordinal LIMIT 1 FOR UPDATE",
        [id],
      );
      if (!item) {
        await c.query("UPDATE member_change_runs SET status='done' WHERE id=?", [id]);
        return false;
      }
      const [selected] = await c.query<RowDataPacket[]>(
        'SELECT user_id FROM member_change_items WHERE run_id=? AND user_id IS NOT NULL',
        [id],
      );
      await c.query('SAVEPOINT member_execute');
      try {
        const change = await applyUnit(
          c,
          actor,
          String(item.user_id),
          parse(run.operation_json),
          runtime,
          new Set(selected.map((r) => String(r.user_id))),
          parse(item.preview_json!),
        );
        await writeAudit(
          {
            userId: actor.sub,
            action: 'user.batch_change',
            resourceType: 'member_change',
            resourceId: id,
            detail: { userId: String(item.user_id), ...change },
          },
          c,
        );
        await c.query(
          "UPDATE member_change_items SET status='succeeded',message='变更完成；相关成员重新登录后生效' WHERE run_id=? AND ordinal=?",
          [id, item.ordinal],
        );
      } catch (e) {
        // Deadlocks abort the entire transaction; callers can safely resume this run.
        if ((e as { code?: string }).code === 'ER_LOCK_DEADLOCK') throw e;
        await c.query('ROLLBACK TO SAVEPOINT member_execute');
        await c.query("UPDATE member_change_items SET status='failed',message=? WHERE run_id=? AND ordinal=?", [
          message(e),
          id,
          item.ordinal,
        ]);
        await writeAudit(
          {
            userId: actor.sub,
            action: 'user.batch_failed',
            resourceType: 'member_change',
            resourceId: id,
            detail: { userId: String(item.user_id), message: message(e) },
          },
          c,
        );
      }
      return true;
    });
    if (!more) break;
  }
  return getMemberChangeRun(actor, id);
}
