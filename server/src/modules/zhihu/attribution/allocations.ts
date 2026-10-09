import type { AttributionSnapshot } from './facts';
import { money, moneyText, fail } from './domain';
import { internalPerformance } from './executor';
export function allocations(snapshot: AttributionSnapshot) {
  const values = new Map<string, bigint>();
  let total = 0n,
    staffAmount = 0n;
  for (const o of snapshot.obligations) {
    const amount = money(o.amount);
    if (internalPerformance(o.relation)) {
      staffAmount += amount;
      continue;
    }
    if (o.relation === 'agency_leader' || o.relation === 'agency_creator' || o.relation === 'leader_override' || o.relation.startsWith('activation:')) {
      values.set(o.payeeId, (values.get(o.payeeId) ?? 0n) + amount);
      total += amount;
    } else if (o.relation === 'leader_creator') {
      values.set(o.payeeId, (values.get(o.payeeId) ?? 0n) + amount);
      values.set(o.payerId, (values.get(o.payerId) ?? 0n) - amount);
    }
  }
  if ([...values.values()].some((v) => v < 0n)) fail('团队分配超过平台应付，请核对定价规则', 409);
  return {
    total: moneyText(total),
    staffAmount: moneyText(staffAmount),
    list: [...values].map(([userId, amount]) => ({ userId, amount: moneyText(amount) })),
  };
}
