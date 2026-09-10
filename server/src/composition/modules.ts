import { config } from '../config';
import { ModuleRuntime } from '../core/module-runtime';
import { setModulePermissions } from '../auth/permissions';
import { zhihuManifest } from '../modules/zhihu/manifest';
export function loadModules() {
  const runtime = new ModuleRuntime([zhihuManifest]);
  for (const id of config.enabledModules) {
    if (id !== zhihuManifest.id) throw new Error('未知模块: ' + id);
    try {
      const { createZhihuModule } = require('../modules/zhihu/module') as typeof import('../modules/zhihu/module');
      runtime.register(createZhihuModule());
    } catch (error) {
      runtime.failures.set(id, 'initialization_failed');
      console.error('module_initialization_failed', id, error instanceof Error ? error.message : 'unknown');
    }
  }
  setModulePermissions(runtime.all().map((m) => m.manifest));
  return runtime;
}
