import { rows } from '../../../db';
import { RowDataPacket } from 'mysql2/promise';
import { isDevDemoEnabled, devDemoSiteInfo } from '../dev-demo';
export async function siteInfo() {
  if (isDevDemoEnabled()) return devDemoSiteInfo();

  const [channelSync] = await rows<RowDataPacket & { latest: string | null }>(
    'SELECT MAX(synced_at) AS latest FROM channels',
  );
  const [taskSync] = await rows<RowDataPacket & { latest: string | null }>(
    'SELECT MAX(synced_at) AS latest FROM tasks',
  );
  const [metricSync] = await rows<RowDataPacket & { latest: string | null }>(
    'SELECT MAX(fetched_at) AS latest FROM daily_metrics',
  );
  return {
    node: process.version,
    uptimeSec: Math.floor(process.uptime()),
    zhihuApiBase: process.env.ZHIHU_API_BASE ?? '',
    zhihuCredentialMode:
      process.env.ZHIHU_ACCESS_TOKEN && !process.env.ZHIHU_ACCESS_TOKEN.startsWith('mock') ? 'real' : 'mock',
    sync: {
      channels: channelSync?.latest ?? null,
      tasks: taskSync?.latest ?? null,
      metrics: metricSync?.latest ?? null,
    },
  };
}
