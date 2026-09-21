import { AppError } from '../../../middleware/errors';

// V1.4.17 documents POST /popularize_plans (batch creation), not a plan-list GET.
// Do not invent its pagination/signature contract or report local counts as official totals.
export const PLAN_READ_UNAVAILABLE = '尚未接通知乎官方计划查询，无法读取官方总数或审核状态；请先取得知乎提供的计划查询接口与授权。';
export const officialPlanReadCapability = Object.freeze({
  available: false,
  reason: PLAN_READ_UNAVAILABLE,
});

export function requireOfficialPlanRead(): never {
  throw new AppError(503, 50312, PLAN_READ_UNAVAILABLE);
}
