import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ModuleRuntime } from '../../src/core/module-runtime';
import { sampleManifest, createSampleModule } from '../../examples/sample-api/module';
import { parseEnvironment } from '../../src/config';
const root = path.resolve(__dirname, '../..');
function resolve(from: string, ref: string) {
  const base = path.resolve(path.dirname(from), ref);
  return [base + '.ts', path.join(base, 'index.ts')].find((p) => fs.existsSync(p));
}
function graph(entry: string, seen = new Set<string>()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = fs.readFileSync(entry, 'utf8'),
    file = ts.createSourceFile(entry, source, ts.ScriptTarget.Latest, true);
  for (const node of file.statements) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const ref = node.moduleSpecifier.text;
      if (ref.startsWith('.')) {
        const next = resolve(entry, ref);
        if (next) graph(next, seen);
      }
    }
  }
  return seen;
}
describe('core boundaries', () => {
  it('public entry cannot reach provider code, configuration or tables', () => {
    const files = [...graph(path.join(root, 'src/core/start.ts'))];
    expect(files.some((f) => /[\\/]modules[\\/]/.test(f))).toBe(false);
    for (const file of files) {
      const s = fs.readFileSync(file, 'utf8');
      expect(s, file).not.toMatch(/ZHIHU_|DEFAULT_PROJECT_ID|config\.zhihu|config\.defaultProjectId/);
      expect(s, file).not.toMatch(
        /\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:plans|channels|compositions|daily_metrics|earnings|data_import_batches|attribution_tasks)\b/i,
      );
    }
  });
  it('production core does not need optional provider keys', () => {
    expect(() =>
      parseEnvironment({ NODE_ENV: 'production', JWT_SECRET: 'production_core_test_secret_long_enough' }),
    ).not.toThrow();
    expect(() => parseEnvironment({ NODE_ENV: 'production' })).toThrow();
    expect(() => parseEnvironment({ OPC_MODULES: 'sample-api,sample-api' })).toThrow();
  });
  it('duplicate and incompatible modules cannot register', () => {
    const runtime = new ModuleRuntime([sampleManifest]);
    runtime.register(createSampleModule('http://127.0.0.1:1234'));
    expect(() => runtime.register(createSampleModule('http://127.0.0.1:1234'))).toThrow();
    expect(() => new ModuleRuntime([{ ...sampleManifest, contractVersion: 999 }])).toThrow();
  });
});
