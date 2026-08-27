import { RowDataPacket } from 'mysql2/promise';
import { db } from '../db';
import { zhihuGet } from '../zhihu/client';
import { config } from '../config';

interface ZhihuPlan {
  plan_id?: string;
  planId?: string;
  keyword: string;
  status?: string;
  audit_status?: string;
  auditStatus?: string;
  reject_reason?: string;
  rejectReason?: string;
}

interface LocalPlan extends RowDataPacket {
  id: string;
  zhihu_plan_id: string;
  keyword: string;
}

/**
 * 从知乎 API 拉取推广计划列表，同步审核状态和拒绝原因
 * 官方反馈：不论什么状态都应该有返回参数（待审核、已通过、已拒绝等）
 */
export async function syncPlanStatus() {
  // 1. 获取本地所有已同步的推广计划（有 zhihu_plan_id 的）
  const [localPlans] = await db.query<LocalPlan[]>(
    `SELECT id, zhihu_plan_id, keyword FROM plans
     WHERE zhihu_plan_id IS NOT NULL AND status <> 'ended'`,
  );

  if (localPlans.length === 0) {
    console.log('syncPlanStatus: 无已同步的推广计划');
    return;
  }

  // 2. 调用知乎 API 获取推广计划列表
  // 注意：知乎可能不提供按 plan_id 批量查询的接口，这里假设用分页列表
  try {
    const response = await zhihuGet<unknown>('/alliance/api/popularize_plans', {
      page: 1,
      page_size: 100
    });
    const body = response as Record<string, unknown>;
    const zhihuPlans = ((body.data as Record<string, unknown>)?.list ?? body.list ?? body.data ?? []) as ZhihuPlan[];

    // 3. 建立知�hu_plan_id -> 知乎计划状态的映射
    const statusMap = new Map<string, { status?: string; auditStatus?: string; rejectReason?: string }>();
    for (const zp of zhihuPlans) {
      const pid = String(zp.plan_id ?? zp.planId ?? '');
      if (!pid) continue;
      statusMap.set(pid, {
        status: zp.status,
        auditStatus: zp.audit_status ?? zp.auditStatus,
        rejectReason: zp.reject_reason ?? zp.rejectReason,
      });
    }

    // 4. 更新本地计划的知乎状态字段
    let updated = 0;
    for (const local of localPlans) {
      const remote = statusMap.get(local.zhihu_plan_id);
      if (!remote) continue;

      // 将知乎状态同步到 plans.zhihu_status_json
      await db.query(
        `UPDATE plans
         SET zhihu_status_json = ?, updated_at = NOW()
         WHERE id = ?`,
        [JSON.stringify(remote), local.id],
      );
      updated++;
    }

    console.log(`syncPlanStatus: 更新了 ${updated}/${localPlans.length} 个推广计划状态`);
  } catch (error) {
    console.error('syncPlanStatus 失败:', error instanceof Error ? error.message : String(error));
  }
}
