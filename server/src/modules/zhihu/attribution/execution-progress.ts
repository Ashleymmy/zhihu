import type { AuthUser } from '../../../types';
import { isStaffRole } from '../../../auth/roles';
import { assertDuty, dutyAllows } from '../../../core/duties';
import { withTransaction } from '../../../db';
import { fail, type Scope } from './domain';
import { authorize, select, ownBinding, mutate, bindingLock, audit } from './store';
import { refreshUnconfirmedKeyword } from './automatic-repair';
import { rejectedWork } from './work-receipts';

export async function executionProgress(user: AuthUser, scope: Scope, keywordId: string) {
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const [word] = await select(
      c,
      `SELECT k.id,k.keyword,k.plan_id,k.current_binding_id,b.executor_id,b.leader_id,
      b.verification_status,b.used_at,b.released_at,b.stop_new_use_at,b.release_status,DATE_FORMAT(b.activated_on,'%Y-%m-%d') from_date,u.display_name executor_name
      FROM zh_keywords k LEFT JOIN zh_keyword_bindings b ON b.id=k.current_binding_id LEFT JOIN users u ON u.id=b.executor_id
      WHERE k.id=? AND k.account_id=? AND k.project_id=?`,
      [keywordId, scope.accountId, scope.projectId],
    );
    if (!word) fail('这条关键词不存在', 404);
    ownBinding(user, word);
    const canReview =
      (isStaffRole(user.role)
        ? dutyAllows(user, 'operations')
        : user.role === 'leader' && String(word.leader_id) === user.sub && String(word.executor_id) !== user.sub) &&
      word.verification_status === 'pending';
    const works = await select(
      c,
      `SELECT CAST(co.id AS CHAR) id,co.promo_url url,co.title,
      DATE_FORMAT(co.release_time,'%Y-%m-%d %H:%i') published_at,co.sync_status,co.status,co.sync_error,
      co.zhihu_status_json,co.reject_reason,CAST(co.owner_id AS CHAR) owner_id,u.display_name owner_name
      FROM compositions co LEFT JOIN users u ON u.id=co.owner_id WHERE co.plan_id=?
      AND (?=1 OR co.owner_id=?) ORDER BY co.release_time DESC,co.id DESC LIMIT 100`,
      [word.plan_id, Number(isStaffRole(user.role)), word.executor_id],
    );
    const evidence = await select(
      c,
      `SELECT CAST(id AS CHAR) id,work_url url,description,status,reason
      FROM zh_evidence WHERE binding_id=? ORDER BY id DESC LIMIT 100`,
      [word.current_binding_id],
    );
    return {
      keyword: String(word.keyword),
      planId: String(word.plan_id),
      bindingId: word.current_binding_id ? String(word.current_binding_id) : null,
      executorName: word.executor_name ?? null,
      fromDate: word.from_date ?? null,
      verificationStatus: word.verification_status ?? null,
      canResolve: word.verification_status === 'disputed' && dutyAllows(user, 'operations'),
      canSubmit:
        !!word.used_at &&
        !word.released_at &&
        !word.stop_new_use_at &&
        word.release_status !== 'requested' &&
        (isStaffRole(user.role)
          ? dutyAllows(user, 'operations')
          : String(word.executor_id) === user.sub || String(word.leader_id) === user.sub),
      works: works.map((w) => ({
        ...w,
        canReview: canReview && String(w.owner_id) === String(word.executor_id) && !rejectedWork(w),
      })),
      evidence: evidence.map((e) => ({ ...e, canReview: canReview && e.status === 'pending' })),
    };
  });
}

/** Review an already registered URL in place; no second work submission. */
export async function reviewRegisteredWork(
  user: AuthUser,
  scope: Scope,
  keywordId: string,
  key: string,
  input: { bindingId: string; compositionId: string },
) {
  if (isStaffRole(user.role)) assertDuty(user, 'operations');
  return mutate(user, scope, 'work.review-existing', key, { keywordId, ...input }, async (c) => {
    const { word, binding } = await bindingLock(c, scope, input.bindingId);
    if (String(word.id) !== keywordId || String(word.current_binding_id) !== input.bindingId)
      fail('执行归属已更新，请重新查看', 409);
    if (
      !isStaffRole(user.role) &&
      (user.role !== 'leader' || String(binding.leader_id) !== user.sub || String(binding.executor_id) === user.sub)
    )
      fail('仅运营或所属团长可核验作品', 403);
    if (binding.verification_status !== 'pending' || binding.released_at || !binding.used_at)
      fail('执行状态已更新，请重新查看', 409);
    const [work] = await select(
      c,
      "SELECT * FROM compositions WHERE id=? AND plan_id=? AND owner_id=? AND status<>'ended' FOR UPDATE",
      [input.compositionId, word.plan_id, binding.executor_id],
    );
    if (!work) fail('没有找到这位执行人的原作品', 404);
    if (rejectedWork(work)) fail('作品已被退回，请先更正原作品后再核验', 409);
    await c.query("UPDATE zh_keyword_bindings SET verification_status='passed',version=version+1 WHERE id=?", [
      binding.id,
    ]);
    await audit(c, user, 'work.review-existing', String(work.id), {
      bindingId: input.bindingId,
      url: work.promo_url,
      reason: '已核对原作品和当前执行归属',
    });
    await refreshUnconfirmedKeyword(c, scope, keywordId);
    return { keywordId, compositionId: input.compositionId };
  });
}
