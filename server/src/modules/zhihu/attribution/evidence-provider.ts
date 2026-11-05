import { withTransaction } from '../../../db';
import type { AuthUser } from '../../../types';
import type { DataScope, EvidenceFilter, EvidenceResult } from '../../../core/contracts';
import { assertEvidenceAccess, evidenceQuerySchema } from '../../../core/evidence';
import { fail } from './domain';
import { readEvidence } from './evidence';

export async function evidence(scope: DataScope, user: AuthUser, filter: EvidenceFilter): Promise<EvidenceResult> {
  evidenceQuerySchema.parse({ ...scope, ...filter, moduleId: 'zhihu' });
  if (filter.metricType && !['new_user', 'activation'].includes(filter.metricType)) fail('请选择拉新或拉活资料');
  return withTransaction(async c => {
    const actor = await assertEvidenceAccess(c, user, scope, 'zhihu');
    return readEvidence(c, scope, actor, filter);
  });
}
