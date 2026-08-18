import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GENERATED_DIR,
  REGISTRY_FILE,
  REQUIRED_PACKAGE_SCRIPTS,
  bootstrapRegistry,
  checkArtifacts,
  fileSha256,
  generateArtifacts,
  joinBase,
  lintRegistry,
  readRegistry,
  resolveRepoRoot,
  scanDocument,
  scanPlatformCalls,
  scanServerRoutes,
} from '../../scripts/contracts/operation-inventory';
import { parseRegistry, registrySchema } from '../../scripts/contracts/operation-registry.schema';

const repositoryRoot = resolveRepoRoot();
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  }
});

function copyFile(root: string, relativePath: string): void {
  const source = path.join(repositoryRoot, relativePath);
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp060-operation-registry-'));
  temporaryRoots.push(root);
  for (const relativePath of [
    'server/package.json',
    'server/tsconfig.json',
    'server/vitest.config.ts',
    'platform/tsconfig.json',
    'docs/重构文档/02-API接口契约.md',
    'server/src/app.ts',
    'server/tests/integration/api.integration.spec.ts',
    'server/tests/support/databaseSafety.ts',
    'server/tests/support/env.ts',
  ]) {
    copyFile(root, relativePath);
  }
  for (const file of fs.readdirSync(path.join(repositoryRoot, 'server/src/routes'))) {
    copyFile(root, path.posix.join('server/src/routes', file));
  }
  for (const file of fs.readdirSync(path.join(repositoryRoot, 'platform/src/api'))) {
    copyFile(root, path.posix.join('platform/src/api', file));
  }
  return root;
}

function hashes(root: string, relativePaths: string[]): Record<string, string> {
  return Object.fromEntries(relativePaths.map((relativePath) => [relativePath, fileSha256(root, relativePath)]));
}

function generatedPaths(): string[] {
  return [
    GENERATED_DIR + '/doc-candidates.json',
    GENERATED_DIR + '/server-routes.json',
    GENERATED_DIR + '/platform-calls.json',
    GENERATED_DIR + '/inventory-summary.json',
  ];
}

function contractDirectoryEntries(root: string): string[] {
  const contractsRoot = path.join(root, 'contracts');
  const entries: string[] = [];
  const visit = (directory: string, relativeDirectory: string): void => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      entries.push(entry.isDirectory() ? relativePath + '/' : relativePath);
      if (entry.isDirectory()) visit(path.join(directory, entry.name), relativePath);
    }
  };
  visit(contractsRoot, 'contracts');
  return entries.sort();
}

interface FixturePackage {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  [key: string]: unknown;
}

function fixturePackage(root: string): FixturePackage {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(root, 'server/package.json'), 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as { scripts?: unknown }).scripts !== 'object' ||
    (parsed as { scripts?: unknown }).scripts === null ||
    Array.isArray((parsed as { scripts?: unknown }).scripts) ||
    typeof (parsed as { devDependencies?: unknown }).devDependencies !== 'object' ||
    (parsed as { devDependencies?: unknown }).devDependencies === null ||
    Array.isArray((parsed as { devDependencies?: unknown }).devDependencies)
  ) {
    throw new Error('fixture package has an invalid script or devDependency object');
  }
  return parsed as FixturePackage;
}

function writeFixturePackage(root: string, packageJson: FixturePackage): void {
  fs.writeFileSync(path.join(root, 'server/package.json'), JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
}

function mutateRequiredScript(root: string, name: string, mode: 'delete' | 'rewrite'): void {
  const packageJson = fixturePackage(root);
  if (mode === 'delete') delete packageJson.scripts[name];
  else packageJson.scripts[name] = packageJson.scripts[name] + ' --drift';
  writeFixturePackage(root, packageJson);
}

function findTransientFiles(root: string): string[] {
  const result: string[] = [];
  const visit = (directory: string): void => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      if (
        entry.name.includes('.inventory-stage-') ||
        entry.name.includes('.backup-') ||
        entry.name.includes('.tmp-operation-registry-') ||
        entry.name === '.operation-registry-bootstrap.lock'
      ) {
        result.push(absolute);
      }
    }
  };
  visit(path.join(root, 'contracts'));
  return result;
}

function runCli(
  root: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number | null; output: string }> {
  const tsxCli = path.join(repositoryRoot, 'server/node_modules/tsx/dist/cli.mjs');
  const script = path.join(repositoryRoot, 'server/scripts/contracts/operation-inventory.ts');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, script, ...args, '--repo-root', root], {
      cwd: os.tmpdir(),
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output }));
  });
}

function noNetworkEnvironment(root: string): { environment: NodeJS.ProcessEnv; callsPath: string } {
  const preloadPath = path.join(root, 'no-network-preload.cjs');
  const callsPath = path.join(root, 'network-calls.log');
  const preload = [
    'const fs = require("node:fs");',
    'const calls = process.env.WP060_NETWORK_CALLS;',
    'const deny = (name) => () => { fs.appendFileSync(calls, name + "\\n"); throw new Error("network disabled: " + name); };',
    'const allowIpc = (args) => typeof args[0] === "string" || Boolean(args[0] && typeof args[0] === "object" && typeof args[0].path === "string");',
    'const denyExternal = (name, original) => (...args) => { if (allowIpc(args)) return original(...args); return deny(name)(); };',
    'const readFileSync = fs.readFileSync; fs.readFileSync = (...args) => { if (String(args[0]).endsWith(".env")) { fs.appendFileSync(calls, "env.read\\n"); throw new Error("environment file read"); } return readFileSync(...args); };',
    'const net = require("node:net"); net.connect = denyExternal("net.connect", net.connect); net.createConnection = denyExternal("net.createConnection", net.createConnection);',
    'const tls = require("node:tls"); tls.connect = deny("tls.connect");',
    'const dns = require("node:dns"); dns.lookup = deny("dns.lookup"); dns.resolve = deny("dns.resolve");',
    'const http = require("node:http"); http.get = deny("http.get"); http.request = deny("http.request");',
    'const https = require("node:https"); https.get = deny("https.get"); https.request = deny("https.request");',
    'global.fetch = deny("fetch");',
  ].join('\n');
  fs.writeFileSync(preloadPath, preload, 'utf8');
  return {
    environment: {
      ...process.env,
      NODE_OPTIONS: '--require=' + preloadPath,
      WP060_NETWORK_CALLS: callsPath,
      CI: '1',
      NODE_ENV: 'test',
      RUN_DB_TESTS: '0',
      ALLOW_DESTRUCTIVE_TEST_DB: 'false',
      DB_HOST: '127.0.0.1',
      DB_PORT: '1',
      DB_NAME: 'zhihu_koc_wp060_test',
      QUEUE_DRIVER: 'memory',
      REDIS_URL: 'redis://127.0.0.1:1',
      HTTP_PROXY: 'http://127.0.0.1:1',
      HTTPS_PROXY: 'http://127.0.0.1:1',
      ALL_PROXY: 'http://127.0.0.1:1',
      NO_PROXY: '',
      TEST_DB_HOST_ALLOWLIST: undefined,
    },
    callsPath,
  };
}

describe('Operation Registry', () => {
  it('A001-REG-001 validates strict Registry state, IDs, and tombstone rules', () => {
    const root = fixtureRoot();
    bootstrapRegistry(root, 'A-001');
    const registry = readRegistry(root);

    expect(registry.operations).toHaveLength(176);
    expect(registry.operations.filter((operation) => operation.surface === 'public-bff')).toHaveLength(169);
    expect(registry.operations.filter((operation) => operation.surface === 'upstream-adapter')).toHaveLength(7);
    expect(registry.operations.every((operation) => operation.targetDecision === 'candidate')).toBe(true);
    expect(registry.operations.every((operation) => operation.operationId === null)).toBe(true);
    expect(registry.operations.every((operation) => operation.implementationStatus === 'planned')).toBe(true);
    expect(registry.operations.every((operation) => operation.implementationEvidence === null)).toBe(true);
    expect(registry.operations.every((operation) => operation.featureIds.length === 0)).toBe(true);
    expect(registry.operations.every((operation) => operation.previousOperationKeys.length === 0)).toBe(true);
    expect(() => registrySchema.parse({ ...registry, unexpected: true })).toThrow();

    const selfMerge = structuredClone(registry);
    selfMerge.operations[0].targetDecision = 'merge';
    selfMerge.operations[0].decisionReason = 'same resource';
    selfMerge.operations[0].mergedInto = selfMerge.operations[0].candidateId;
    expect(() => parseRegistry(selfMerge)).toThrow(/merge self-reference/);

    const duplicatePrevious = structuredClone(registry);
    duplicatePrevious.operations[0].previousOperationKeys = [
      duplicatePrevious.operations[1].surface +
        '|' +
        duplicatePrevious.operations[1].method +
        ' ' +
        duplicatePrevious.operations[1].path,
    ];
    expect(() => parseRegistry(duplicatePrevious)).toThrow(/conflicts with current key/);

    const mergeCycle = structuredClone(registry);
    mergeCycle.operations[0].targetDecision = 'merge';
    mergeCycle.operations[0].decisionReason = 'merge one';
    mergeCycle.operations[0].mergedInto = mergeCycle.operations[1].candidateId;
    mergeCycle.operations[1].targetDecision = 'merge';
    mergeCycle.operations[1].decisionReason = 'merge two';
    mergeCycle.operations[1].mergedInto = mergeCycle.operations[0].candidateId;
    expect(() => parseRegistry(mergeCycle)).toThrow(/merge cycle/);

    const removedTarget = structuredClone(registry);
    removedTarget.operations[0].targetDecision = 'merge';
    removedTarget.operations[0].decisionReason = 'merge into removed';
    removedTarget.operations[0].mergedInto = removedTarget.operations[1].candidateId;
    removedTarget.operations[1].targetDecision = 'remove';
    removedTarget.operations[1].decisionReason = 'tombstone';
    expect(() => parseRegistry(removedTarget)).toThrow(/invalid merge target/);
  });

  it('A001-REG-002 parses 169 plus 7 with source-specific semantic hashes and detects input drift', () => {
    const root = fixtureRoot();
    const document = scanDocument(root);
    expect(document.unsupportedSyntax).toEqual([]);
    expect(document.operations).toHaveLength(176);
    expect(document.operations.filter((operation) => operation.role === 'admin')).toHaveLength(94);
    expect(document.operations.filter((operation) => operation.role === 'leader')).toHaveLength(39);
    expect(document.operations.filter((operation) => operation.role === 'creator')).toHaveLength(30);
    expect(document.operations.filter((operation) => operation.role === 'public')).toHaveLength(6);
    expect(document.operations.filter((operation) => operation.role === 'adapter')).toHaveLength(7);
    expect(document.operations.filter((operation) => operation.method === 'GET')).toHaveLength(89);
    expect(document.operations.filter((operation) => operation.method === 'POST')).toHaveLength(56);
    expect(document.operations.filter((operation) => operation.method === 'PUT')).toHaveLength(9);
    expect(document.operations.filter((operation) => operation.method === 'PATCH')).toHaveLength(3);
    expect(document.operations.filter((operation) => operation.method === 'DELETE')).toHaveLength(19);
    expect(document.operations.filter((operation) => operation.pathKind === 'static')).toHaveLength(96);
    expect(document.operations.filter((operation) => operation.pathKind === 'parameterized')).toHaveLength(80);
    expect(document.sources[0].semanticSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.sources[1].semanticSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.sources[0].semanticSha256).not.toBe(document.sources[1].semanticSha256);
  });

  it('A001-REG-003 inventories only proven Express route bindings and fails closed on unsupported syntax', () => {
    const root = fixtureRoot();
    const scan = scanServerRoutes(root);
    expect(scan.unsupportedSyntax).toEqual([]);
    expect(scan.mounts.length).toBeGreaterThan(0);
    expect(new Set(scan.records.map((record) => record.operationKey)).size).toBe(scan.records.length);
    expect(scan.records.filter((record) => record.pathKind === 'wildcard')).toHaveLength(0);
    expect(scan.records.some((record) => record.path === '/api/v1/auth/login')).toBe(true);
    expect(scan.records.find((record) => record.path === '/api/v1/auth/login')?.mount).toBe('/api/v1/auth');
    expect(scan.records.some((record) => record.path === '/api/v1/mcn-accounts')).toBe(true);
    expect(scan.records.some((record) => record.path === '/api/v1/projects/{projectId}/members')).toBe(true);
    expect(
      scan.records
        .filter((record) => record.path.startsWith('/api/alliance/api/'))
        .map((record) => record.operationKey)
        .sort(),
    ).toEqual([
      'GET /api/alliance/api/data_report/real_time_data',
      'GET /api/alliance/api/popularize_compositions',
      'POST /api/alliance/api/popularize_composition/v2',
      'POST /api/alliance/api/popularize_compositions/v2',
      'POST /api/alliance/api/popularize_plan',
      'POST /api/alliance/api/popularize_plans',
      'PUT /api/alliance/api/popularize_composition/v2/{composition_id}',
    ]);
    expect(joinBase('/api/v1/auth', '/')).toBe('/api/v1/auth');

    const routeFile = path.join(root, 'server/src/routes/auth.ts');
    fs.appendFileSync(
      routeFile,
      '\nconst notARouter = { get: (_path: string) => undefined };\nnotARouter.get(\"/ignored\");\nauthRouter[\"get\"](\"/unsupported\", () => undefined);\nauthRouter.get(\"/:probe\", () => undefined);\nauthRouter.get(\"/fixed-after-param\", () => undefined);\n',
      'utf8',
    );
    const mutated = scanServerRoutes(root);
    expect(mutated.records.some((record) => record.path.endsWith('/ignored'))).toBe(false);
    expect(mutated.unsupportedSyntax.some((item) => item.kind === 'computed-route-method')).toBe(true);
    expect(mutated.unsupportedSyntax.some((item) => item.kind === 'route-shadowing')).toBe(true);
  });

  it('A001-REG-004 inventories import-proven Platform calls, resolves constants, and rejects dynamic paths', () => {
    const root = fixtureRoot();
    const scan = scanPlatformCalls(root);
    expect(scan.unsupportedSyntax).toEqual([]);
    expect(scan.records).toHaveLength(60);
    expect(scan.records.filter((record) => record.platformSurface === 'standard-bff')).toHaveLength(41);
    expect(scan.records.filter((record) => record.platformSurface === 'alliance')).toHaveLength(19);
    expect(scan.records.some((record) => record.path === '/api/alliance/api/get_agent_channels')).toBe(true);
    expect(
      scan.records.some(
        (record) => record.method === 'GET' && record.path === '/api/alliance/api/popularize_compositions',
      ),
    ).toBe(false);
    expect(
      scan.records.some(
        (record) => record.method === 'GET' && record.path === '/api/alliance/api/popularize_compositions/v2',
      ),
    ).toBe(false);
    expect(
      scan.records.some(
        (record) => record.method === 'POST' && record.path === '/api/alliance/api/popularize_compositions/v2',
      ),
    ).toBe(false);

    const apiFile = path.join(root, 'platform/src/api/auth.ts');
    const templateDelimiter = String.fromCharCode(96);
    fs.appendFileSync(
      apiFile,
      '\nfunction shadow(http: { get(path: string): void }) { http.get(\"/ignored-shadow\"); }\nfunction multiple(first: string, second: string) { return http.get(' +
        templateDelimiter +
        '/multi/\${first}/\${second}' +
        templateDelimiter +
        '); }\nhttp.get(makeDynamicPath());\n',
      'utf8',
    );
    const mutated = scanPlatformCalls(root);
    expect(mutated.records.some((record) => record.path.endsWith('/ignored-shadow'))).toBe(false);
    expect(mutated.records.some((record) => record.path === '/api/v1/multi/{first}/{second}')).toBe(true);
    expect(mutated.unsupportedSyntax.some((item) => item.kind === 'dynamic-http-path')).toBe(true);
  });

  it('A001-REG-005 produces strict deterministic artifacts with only observed joins and zero implementation counts', () => {
    const root = fixtureRoot();
    bootstrapRegistry(root, 'A-001');
    const generated = generateArtifacts(root);
    const summary = JSON.parse(generated.summary.toString('utf8')) as {
      declaredImplementedCount: number;
      derivedImplementedCount: number;
      counts: {
        apiV1: { server: number; platform: number; observedExact: number; serverOnly: number; platformOnly: number };
      };
      joins: {
        publicTargetServer: { observedExact: string[] };
        publicTargetPlatform: { observedExact: string[] };
        publicTargetServerPlatform: { observedExact: string[] };
        upstreamPlatformAdapter: {
          observedExact: string[];
          shapeOnlyMatch: unknown[];
          upstreamOnly: string[];
          platformOnly: string[];
        };
        serverWildcardCoverage: { transportCoveredByWildcard: unknown[] };
      };
    };

    expect(summary.declaredImplementedCount).toBe(0);
    expect(summary.derivedImplementedCount).toBe(0);
    // 数量随实现演进，只校验算术一致性与安全不变式，不冻结快照。
    const apiV1 = summary.counts.apiV1;
    expect(apiV1.server).toBe(apiV1.observedExact + apiV1.serverOnly);
    expect(apiV1.platform).toBe(apiV1.observedExact + apiV1.platformOnly);
    expect(summary.joins.upstreamPlatformAdapter.observedExact).toHaveLength(0);
    expect(summary.joins.upstreamPlatformAdapter.shapeOnlyMatch).toHaveLength(0);
    expect(summary.joins.serverWildcardCoverage.transportCoveredByWildcard).toHaveLength(0);
    expect(() => checkArtifacts(root)).not.toThrow();
  });

  it('A001-REG-006 keeps bootstrap and publication fail closed without network or partial artifacts', async () => {
    const root = fixtureRoot();
    expect(() => bootstrapRegistry(root, '')).toThrow(/acknowledge-new-registry/);

    const noNetwork = noNetworkEnvironment(root);
    fs.writeFileSync(path.join(root, '.env'), 'SHOULD_NOT_BE_READ=1\n', 'utf8');
    const first = await runCli(root, ['bootstrap', '--acknowledge-new-registry', 'A-001'], noNetwork.environment);
    expect(first.code, first.output).toBe(0);
    const generatedByChild = await runCli(root, ['generate'], noNetwork.environment);
    expect(generatedByChild.code, generatedByChild.output).toBe(0);
    expect(fs.existsSync(noNetwork.callsPath) ? fs.readFileSync(noNetwork.callsPath, 'utf8') : '').toBe('');
    const registryHash = fileSha256(root, REGISTRY_FILE);
    const second = await runCli(root, ['bootstrap', '--acknowledge-new-registry', 'A-001'], noNetwork.environment);
    expect(second.code).not.toBe(0);
    expect(fileSha256(root, REGISTRY_FILE)).toBe(registryHash);

    const initialPublicationRoot = fixtureRoot();
    bootstrapRegistry(initialPublicationRoot, 'A-001');
    for (let boundary = 1; boundary <= 4; boundary += 1) {
      expect(() => generateArtifacts(initialPublicationRoot, { failRenameAt: boundary })).toThrow(
        /injected rename failure/,
      );
      expect(
        generatedPaths().some((relativePath) => fs.existsSync(path.join(initialPublicationRoot, relativePath))),
      ).toBe(false);
      expect(findTransientFiles(initialPublicationRoot)).toEqual([]);
    }

    const concurrentRoot = fixtureRoot();
    const [concurrentLeft, concurrentRight] = await Promise.all([
      runCli(concurrentRoot, ['bootstrap', '--acknowledge-new-registry', 'A-001']),
      runCli(concurrentRoot, ['bootstrap', '--acknowledge-new-registry', 'A-001']),
    ]);
    expect([concurrentLeft.code, concurrentRight.code].filter((code) => code === 0)).toHaveLength(1);
    expect(fileSha256(concurrentRoot, REGISTRY_FILE)).toMatch(/^[0-9a-f]{64}$/);
    expect(findTransientFiles(concurrentRoot)).toEqual([]);

    generateArtifacts(root);
    const before = hashes(root, [REGISTRY_FILE, ...generatedPaths()]);
    for (let boundary = 1; boundary <= 8; boundary += 1) {
      expect(() => generateArtifacts(root, { failRenameAt: boundary })).toThrow(/injected rename failure/);
      expect(hashes(root, [REGISTRY_FILE, ...generatedPaths()])).toEqual(before);
      expect(findTransientFiles(root)).toEqual([]);
    }
    const unchanged = hashes(root, [REGISTRY_FILE, ...generatedPaths()]);
    expect(() => checkArtifacts(root)).not.toThrow();
    expect(() => lintRegistry(root)).not.toThrow();
    expect(hashes(root, [REGISTRY_FILE, ...generatedPaths()])).toEqual(unchanged);

    const detailPath = path.join(root, GENERATED_DIR, 'doc-candidates.json');
    const original = fs.readFileSync(detailPath);
    fs.writeFileSync(detailPath, Buffer.concat([original, Buffer.from(' ', 'utf8')]));
    expect(() => checkArtifacts(root)).toThrow(/not deterministic|commit marker/);
    fs.writeFileSync(detailPath, original);
    expect(findTransientFiles(root)).toEqual([]);
  });

  it('A001-PKG-001 permits unrelated package extensions without changing Contract artifacts', () => {
    const root = fixtureRoot();
    bootstrapRegistry(root, 'A-001');
    generateArtifacts(root);
    const artifactPaths = [REGISTRY_FILE, ...generatedPaths()];
    const before = hashes(root, artifactPaths);
    const packageJson = fixturePackage(root);
    packageJson.scripts['unrelated:script'] = 'node -e "process.exit(0)"';
    packageJson.devDependencies['unrelated-dev-dependency'] = '1.0.0';
    packageJson.metadata = { changedBy: 'A001-PKG-001' };
    writeFixturePackage(root, packageJson);

    expect(() => generateArtifacts(root)).not.toThrow();
    expect(() => checkArtifacts(root)).not.toThrow();
    expect(() => lintRegistry(root)).not.toThrow();
    expect(hashes(root, artifactPaths)).toEqual(before);
  });

  it('A001-PKG-002 rejects missing or changed required scripts without Contract writes', () => {
    for (const name of Object.keys(REQUIRED_PACKAGE_SCRIPTS)) {
      for (const mode of ['delete', 'rewrite'] as const) {
        const bootstrapRoot = fixtureRoot();
        mutateRequiredScript(bootstrapRoot, name, mode);
        expect(() => bootstrapRegistry(bootstrapRoot, 'A-001')).toThrow(
          `required Contract package script mismatch: ${name}`,
        );
        expect(contractDirectoryEntries(bootstrapRoot)).toEqual([]);

        const root = fixtureRoot();
        bootstrapRegistry(root, 'A-001');
        generateArtifacts(root);
        const artifactPaths = [REGISTRY_FILE, ...generatedPaths()];
        const beforeHashes = hashes(root, artifactPaths);
        const beforeEntries = contractDirectoryEntries(root);
        mutateRequiredScript(root, name, mode);

        expect(() => generateArtifacts(root)).toThrow(`required Contract package script mismatch: ${name}`);
        expect(() => checkArtifacts(root)).toThrow(`required Contract package script mismatch: ${name}`);
        expect(() => lintRegistry(root)).toThrow(`required Contract package script mismatch: ${name}`);
        expect(hashes(root, artifactPaths)).toEqual(beforeHashes);
        expect(contractDirectoryEntries(root)).toEqual(beforeEntries);
        expect(findTransientFiles(root)).toEqual([]);
      }
    }
  });
});
