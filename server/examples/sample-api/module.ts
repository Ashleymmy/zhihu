import { Router } from 'express';
import { z } from 'zod';
import type { BusinessModule, ModuleManifest } from '../../src/core/contracts';
export const sampleManifest: ModuleManifest = {
  id: 'sample-api',
  name: '示例 API',
  version: '1.0.0',
  contractVersion: 1,
  roles: ['admin', 'leader', 'creator'],
  capabilities: ['summary'],
  permissions: {},
  entryPath: '/modules/sample-api',
};
/** Demonstrates a platform-owned HTTP adapter. Not registered in production. */
export function createSampleModule(endpoint: string): BusinessModule {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('示例模块只允许本地模拟服务');
  return {
    manifest: sampleManifest,
    router: Router(),
    dataProvider: {
      async summary(scope) {
        const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (!response.ok) throw new Error('upstream_failed');
        const data = z.object({ count: z.number().int().nonnegative() }).parse(await response.json());
        return {
          ...scope,
          moduleId: sampleManifest.id,
          status: 'ready',
          updatedAt: new Date().toISOString(),
          metrics: [{ key: 'sample.orders', label: '订单', unit: 'count', value: String(data.count) }],
        };
      },
    },
  };
}
