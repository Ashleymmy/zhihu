import type { JobOptions } from 'bull';
import { enqueue as enqueueCore, registerJob as registerCore, type JobHandler } from '../../queue';
import { config } from './config';
import { rows } from '../../db';
import type { RowDataPacket } from 'mysql2/promise';
import { isDevDemoEnabled } from './dev-demo';
export async function enqueue(name: string, data: Record<string, unknown>, options: JobOptions = {}) {
  const projectId = String(data.projectId ?? config.defaultProjectId);
  const accountId = String(data.accountId ?? 'legacy');
  return enqueueCore(
    'zhihu.' + name,
    { ...data, moduleId: 'zhihu', projectId, accountId },
    { ...options, jobId: 'zhihu-' + name + '-' + accountId + '-' + projectId + '-' + (options.jobId ?? Date.now()) },
  );
}
export function registerJob(name: string, handler: JobHandler) {
  registerCore('zhihu.' + name, async (data) => {
    if (process.env.NODE_ENV !== 'test' && !isDevDemoEnabled()) {
      const links = await rows<RowDataPacket>(
        "SELECT a.id FROM integration_accounts a JOIN project_integrations pi ON pi.account_id=a.id WHERE a.module_id='zhihu' AND a.status='active' AND pi.project_id=? AND (?='legacy' OR a.id=?)",
        [data.projectId, data.accountId, data.accountId],
      );
      if (!links.length) throw new Error('知乎接入账号未关联或已停用');
    }
    await handler(data);
  });
}
