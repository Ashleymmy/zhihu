import { Router } from 'express';
import { ModuleRuntime } from '../../src/core/module-runtime';
import { zhihuManifest } from '../../src/modules/zhihu/manifest';
import { zhihuAccountLifecycle } from '../../src/modules/zhihu/services/account-lifecycle';

// Exercise module account hooks without starting background workers.
export function accountRuntime() {
  const runtime = new ModuleRuntime([zhihuManifest]);
  runtime.register({ manifest: zhihuManifest, router: Router(), accountLifecycle: zhihuAccountLifecycle });
  return runtime;
}
