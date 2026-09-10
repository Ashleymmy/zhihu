import { createCoreApp } from './core/app';
import { loadModules } from './composition/modules';
import { mountStatic } from './composition/static';
export function createApp() {
  const runtime = loadModules();
  const app = createCoreApp(runtime, mountStatic);
  app.locals.moduleRuntime = runtime;
  return app;
}
