import { createCoreApp } from '../../src/core/app';
import { ModuleRuntime } from '../../src/core/module-runtime';
import { createZhihuModule } from '../../src/modules/zhihu/module';
import { zhihuManifest } from '../../src/modules/zhihu/manifest';
/** Legacy suites explicitly opt into the module; Vite can then apply its module mocks. */
export function createApp() {
  const runtime = new ModuleRuntime([zhihuManifest]);
  runtime.register(createZhihuModule());
  return createCoreApp(runtime);
}
