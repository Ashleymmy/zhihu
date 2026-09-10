import { MODULE_CONTRACT_VERSION, type BusinessModule, type ModuleManifest } from './contracts';
import type { Role } from '../types';
export class ModuleRuntime {
  private entries = new Map<string, BusinessModule>();
  readonly failures = new Map<string, string>();
  constructor(readonly catalog: ModuleManifest[] = []) {
    const ids = new Set<string>();
    for (const manifest of catalog) {
      if (ids.has(manifest.id) || manifest.contractVersion !== MODULE_CONTRACT_VERSION)
        throw new Error('模块重复或契约版本不兼容');
      ids.add(manifest.id);
    }
  }
  register(module: BusinessModule) {
    if (this.entries.has(module.manifest.id) || module.manifest.contractVersion !== MODULE_CONTRACT_VERSION)
      throw new Error('模块重复或契约版本不兼容');
    this.entries.set(module.manifest.id, module);
  }
  get(id: string) {
    return this.entries.get(id);
  }
  all() {
    return [...this.entries.values()];
  }
  list(role: Role) {
    return this.catalog
      .filter((m) => m.roles.includes(role))
      .map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        entryPath: m.entryPath,
        capabilities: m.capabilities,
        accountCreation: m.accountCreation ?? 'self_service',
        accountMessage: m.accountMessage ?? null,
        status: this.entries.has(m.id) ? 'enabled' : this.failures.has(m.id) ? 'unavailable' : 'disabled',
        message: this.failures.has(m.id) ? '模块配置或初始化失败，请管理员检查服务日志' : null,
      }));
  }
  start() {
    for (const module of this.all()) {
      try {
        module.start?.();
      } catch {
        this.failures.set(module.manifest.id, 'start_failed');
        this.entries.delete(module.manifest.id);
        try {
          module.stop?.();
        } catch {}
      }
    }
  }
  stop() {
    for (const module of this.all()) {
      try {
        module.stop?.();
      } catch {
        this.failures.set(module.manifest.id, 'stop_failed');
      }
    }
  }
}
