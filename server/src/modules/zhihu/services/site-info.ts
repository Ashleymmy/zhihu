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
  const accessToken = process.env.ZHIHU_ACCESS_TOKEN ?? '';
  const secretKey = process.env.ZHIHU_SECRET_KEY ?? '';
  const isPlaceholderCredential =
    accessToken === 'mock_access_token' ||
    secretKey === 'mock_secret_key' ||
    accessToken === 'local_attribution_test_token' ||
    secretKey === 'local_attribution_test_secret';
  return {
    node: process.version,
    uptimeSec: Math.floor(process.uptime()),
    zhihuApiBase: process.env.ZHIHU_API_BASE ?? '',
    zhihuCredentialMode: accessToken && !isPlaceholderCredential ? 'real' : 'mock',
    sync: {
      channels: channelSync?.latest ?? null,
      tasks: taskSync?.latest ?? null,
      metrics: metricSync?.latest ?? null,
    },
  };
}