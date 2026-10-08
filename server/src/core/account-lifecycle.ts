import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { ModuleRuntime } from './module-runtime';
import type { ModuleAccountLifecycle } from './contracts';
import { AppError } from '../middleware/errors';

export async function lifecycleProviders(c: PoolConnection, runtime: ModuleRuntime) {
  const [installed] = await c.query<RowDataPacket[]>('SELECT module_id FROM module_installations ORDER BY module_id');
  const providers: ModuleAccountLifecycle[] = [];
  for (const row of installed) {
    const module = runtime.get(String(row.module_id));
    // Disabled or failed modules can still hold work and private profile data.
    if (!module) throw new AppError(503, 50300, '项目资料暂时无法核对，请在项目服务恢复后重试');
    if (module.accountLifecycle) providers.push(module.accountLifecycle);
  }
  return providers;
}
