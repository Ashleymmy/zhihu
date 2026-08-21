import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import {
  assertFixedObjectKeys,
  docCandidatesSchema,
  inventorySummarySchema,
  parseRegistry,
  platformCallsSchema,
  registrySchema,
  serverRoutesSchema,
  type DocCandidatesArtifact,
  type InventorySummary,
  type Method,
  type PlatformCallRecord,
  type PlatformCallsArtifact,
  type Registry,
  type RegistryOperation,
  type RegistrySource,
  type ServerRouteRecord,
  type ServerRoutesArtifact,
} from './operation-registry.schema';

export const GENERATOR_ID = 'A-001-INVENTORY';
export const DOC_FILE = 'docs/重构文档/02-API接口契约.md';
export const REGISTRY_FILE = 'contracts/operations/operation-registry.json';
export const GENERATED_DIR = 'contracts/operations/generated';
export const REQUIRED_PACKAGE_SCRIPTS = Object.freeze({
  'contract:inventory:generate': 'tsx scripts/contracts/operation-inventory.ts generate',
  'contract:inventory:check': 'tsx scripts/contracts/operation-inventory.ts check',
  'contract:registry:lint': 'tsx scripts/contracts/operation-inventory.ts lint',
  'test:contract-registry': 'vitest run --dir tests/unit operation-registry.spec.ts',
});

// 语义输入文件清单：仅用于计算 provenance 指纹写入生成产物。
// 输入变更后重新 generate 即可；check 通过产物字节比对发现过期产物。
const SEMANTIC_INPUT_FILES: ReadonlyArray<string> = [
  'docs/重构文档/02-API接口契约.md',
  'platform/src/api/alliance.ts',
  'platform/src/api/auth.ts',
  'platform/src/api/callbacks.ts',
  'platform/src/api/channels.ts',
  'platform/src/api/compositions.ts',
  'platform/src/api/earnings.ts',
  'platform/src/api/http.ts',
  'platform/src/api/index.ts',
  'platform/src/api/meta.ts',
  'platform/src/api/metrics.ts',
  'platform/src/api/plans.ts',
  'platform/src/api/tasks.ts',
  'platform/src/api/team.ts',
  'platform/src/api/withdrawals.ts',
  'platform/src/api/zhihu-http.ts',
  'server/src/app.ts',
  'server/src/routes/alliance.ts',
  'server/src/routes/auth.ts',
  'server/src/routes/callbacks.ts',
  'server/src/routes/channels.ts',
  'server/src/routes/compositions.ts',
  'server/src/routes/earnings.ts',
  'server/src/routes/mcn.ts',
  'server/src/routes/meta.ts',
  'server/src/routes/metrics.ts',
  'server/src/routes/plans.ts',
  'server/src/routes/projects.ts',
  'server/src/routes/tasks.ts',
  'server/src/routes/team.ts',
  'server/src/routes/withdrawals.ts',
];

const METHOD_SET = new Set<string>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const ROUTE_METHODS = new Set<string>(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const DOC_ROLE_BY_HEADING: Record<string, 'admin' | 'leader' | 'creator' | 'public'> = {
  Admin: 'admin',
  团长: 'leader',
  达人: 'creator',
  公共: 'public',
};

type DocRecord = DocCandidatesArtifact['records'][number];
type UnsupportedDoc = DocCandidatesArtifact['unsupportedSyntax'][number];
type UnsupportedSource = ServerRoutesArtifact['unsupportedSyntax'][number];
type SourceLocation = ServerRouteRecord['source'];

export interface ImmutableManifest {
  entries: Array<{ path: string; sha256: string }>;
  byteLength: number;
  sha256: string;
}

export interface DocumentScan {
  sources: RegistrySource[];
  operations: RegistryOperation[];
  records: DocRecord[];
  unsupportedSyntax: UnsupportedDoc[];
}

export interface ServerScan {
  records: ServerRouteRecord[];
  unsupportedSyntax: UnsupportedSource[];
  mounts: string[];
}

export interface PlatformScan {
  records: PlatformCallRecord[];
  unsupportedSyntax: UnsupportedSource[];
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function stableJson(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function formattedJsonText(value: unknown, depth = 0): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.length === 1 && ['string', 'number', 'boolean'].includes(typeof value[0])) {
      const inline = '[' + JSON.stringify(value[0]) + ']';
      if (depth * 2 + inline.length <= 80) return inline;
    }
    const indent = '  '.repeat(depth);
    const childIndent = '  '.repeat(depth + 1);
    return (
      '[\n' + value.map((item) => childIndent + formattedJsonText(item, depth + 1)).join(',\n') + '\n' + indent + ']'
    );
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const indent = '  '.repeat(depth);
    const childIndent = '  '.repeat(depth + 1);
    return (
      '{\n' +
      entries
        .map(([key, item]) => childIndent + JSON.stringify(key) + ': ' + formattedJsonText(item, depth + 1))
        .join(',\n') +
      '\n' +
      indent +
      '}'
    );
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('artifact JSON contains undefined');
  return serialized;
}

function artifactJson(value: unknown): Buffer {
  return Buffer.from(formattedJsonText(value) + '\n', 'utf8');
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function repoRelative(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

function readUtf8(repoRoot: string, relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function location(sourceFile: ts.SourceFile, node: ts.Node, repoRoot: string): SourceLocation {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: repoRelative(repoRoot, sourceFile.fileName),
    line: position.line + 1,
    column: position.character + 1,
  };
}

function docLocation(line: number, section: '2.2-public-bff' | '7.1-upstream-adapter'): DocRecord['source'] {
  return { file: DOC_FILE, section, line };
}

function unsupportedDoc(line: number, kind: string, detail: string): UnsupportedDoc {
  return { file: DOC_FILE, line, kind, detail };
}

function unsupportedSource(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  repoRoot: string,
  kind: string,
  detail: string,
): UnsupportedSource {
  return { ...location(sourceFile, node, repoRoot), kind, detail };
}

function assertCanonicalPath(value: string, label: string): string {
  if (
    !value.startsWith('/') ||
    value.includes('?') ||
    value.includes('\\') ||
    value.includes('//') ||
    (value !== '/' && value.endsWith('/'))
  ) {
    throw new Error(label + ' is not canonical: ' + value);
  }
  if (!/^\/(?:[A-Za-z0-9._~:@!$&'()*+,;=%{}\-*]+(?:\/[A-Za-z0-9._~:@!$&'()*+,;=%{}\-*]+)*)?$/.test(value)) {
    throw new Error(label + ' contains an illegal path token: ' + value);
  }
  return value;
}

export function joinBase(base: string, routePath: string): string {
  if (base !== '') assertCanonicalPath(base, 'base');
  assertCanonicalPath(routePath, 'route');
  if (base === '') return routePath;
  if (base === '/') return routePath;
  if (routePath === '/') return base;
  return assertCanonicalPath(base + routePath, 'joined path');
}

function normalizeServerRoutePath(raw: string): string {
  const normalized = raw.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
  return assertCanonicalPath(normalized, 'route');
}

function pathKind(value: string): 'static' | 'parameterized' | 'wildcard' {
  if (value.endsWith('/*')) return 'wildcard';
  return value.includes('{') ? 'parameterized' : 'static';
}

function shapePath(value: string): string {
  return value.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '{}');
}

function operationKey(method: string, value: string): string {
  return method.toUpperCase() + ' ' + value;
}

function ensureMethod(value: string, label: string): Method {
  const method = value.toUpperCase();
  if (!METHOD_SET.has(method)) throw new Error(label + ' has unsupported method: ' + value);
  return method as Method;
}

function findRepoRoot(start: string): string {
  let current = path.resolve(start);
  for (;;) {
    if (
      fs.existsSync(path.join(current, DOC_FILE)) &&
      fs.existsSync(path.join(current, 'server', 'package.json')) &&
      fs.existsSync(path.join(current, 'apps', 'platform-admin', 'tsconfig.json'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('Unable to locate repository root from ' + start);
}

export function resolveRepoRoot(start = __dirname): string {
  return findRepoRoot(start);
}

function getPathArgument(args: readonly string[]): string | undefined {
  const index = args.indexOf('--repo-root');
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error('--repo-root requires a path');
  return path.resolve(value);
}

export function computeImmutableManifest(repoRoot: string): ImmutableManifest {
  const entries = SEMANTIC_INPUT_FILES.map((relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error('semantic input missing: ' + relativePath);
    return { path: relativePath, sha256: sha256(fs.readFileSync(absolutePath)) };
  }).sort((left, right) => compareOrdinal(left.path, right.path));
  const canonical = Buffer.from(entries.map((entry) => entry.path + '\t' + entry.sha256 + '\n').join(''), 'utf8');
  return { entries, byteLength: canonical.length, sha256: sha256(canonical) };
}

export function fileSha256(repoRoot: string, relativePath: string): string {
  return sha256(fs.readFileSync(path.join(repoRoot, relativePath)));
}

function lineNumberedText(text: string): string[] {
  return text.split(/\r?\n/);
}

function semanticProjection(operations: RegistryOperation[], surface: 'public-bff' | 'upstream-adapter'): unknown[] {
  return operations
    .filter((operation) => operation.surface === surface)
    .map((operation) => ({
      surface: operation.surface,
      method: operation.method,
      path: operation.path,
      pathKind: operation.pathKind,
      shapePath: operation.shapePath,
      role: operation.role,
      group: operation.group,
      featureIds: operation.featureIds,
      notes: operation.notes,
    }))
    .sort((left, right) => {
      const a = left as { surface: string; method: string; path: string };
      const b = right as { surface: string; method: string; path: string };
      return (
        compareOrdinal(a.surface, b.surface) || compareOrdinal(a.method, b.method) || compareOrdinal(a.path, b.path)
      );
    });
}

function semanticHash(operations: RegistryOperation[], surface: 'public-bff' | 'upstream-adapter'): string {
  return sha256(stableJson(semanticProjection(operations, surface)));
}

function makeOperation(
  index: number,
  surface: 'public-bff' | 'upstream-adapter',
  method: Method,
  rawPath: string,
  role: RegistryOperation['role'],
  group: string,
  notes: string | null,
  source: RegistryOperation['source'],
): RegistryOperation {
  const pathValue = normalizeServerRoutePath(rawPath);
  const suffix = String(index).padStart(4, '0');
  const candidateId = surface === 'public-bff' ? 'A001-PUB-' + suffix : 'A001-UP-' + suffix;
  const specTestId = surface === 'public-bff' ? 'A001-SPEC-PUB-' + suffix : 'A001-SPEC-UP-' + suffix;
  const kind = pathKind(pathValue);
  return {
    candidateId,
    surface,
    method,
    path: pathValue,
    pathKind: kind === 'wildcard' ? 'static' : kind,
    shapePath: shapePath(pathValue),
    role,
    group: group.trim(),
    featureIds: [],
    source,
    targetDecision: 'candidate',
    decisionReason: null,
    mergedInto: null,
    operationId: null,
    specTestId,
    previousOperationKeys: [],
    implementationStatus: 'planned',
    implementationEvidence: null,
    notes: notes?.trim() || null,
  };
}

function parseRouteLine(line: string): { method: Method; path: string; notes: string | null } | undefined {
  const match = line.match(/^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)(?:\s+#\s?(.*))?\s*$/);
  if (!match) return undefined;
  return {
    method: ensureMethod(match[1], 'document route'),
    path: match[2],
    notes: match[3]?.trim() || null,
  };
}

function parseUpstreamRow(line: string): { method: Method; path: string } | undefined {
  const match = line.match(
    /^\|\s*[\x60]?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)[\x60]?\s*\|\s*[\x60]?([^|\x60]+?)[\x60]?\s*\|/,
  );
  if (!match) return undefined;
  return { method: ensureMethod(match[1], 'upstream row'), path: match[2].trim() };
}

export function scanDocument(repoRoot: string): DocumentScan {
  const lines = lineNumberedText(readUtf8(repoRoot, DOC_FILE));
  const publicStart = lines.findIndex((line) => line.trim() === '### 2.2 接口 URL 规划');
  const publicEnd = lines.findIndex((line, index) => index > publicStart && line.trim() === '## 三、认证与鉴权');
  const upstreamStart = lines.findIndex((line) => line.trim() === '### 7.1 官方基线与 allowlist');
  const upstreamEnd = lines.findIndex((line, index) => index > upstreamStart && line.startsWith('### 7.2 '));
  if (publicStart < 0 || publicEnd < 0 || upstreamStart < 0 || upstreamEnd < 0) {
    throw new Error('required document sections are missing');
  }

  const operations: RegistryOperation[] = [];
  const records: DocRecord[] = [];
  const unsupportedSyntax: UnsupportedDoc[] = [];
  const publicItems: Array<{
    method: Method;
    path: string;
    role: 'admin' | 'leader' | 'creator' | 'public';
    group: string;
    notes: string | null;
    line: number;
  }> = [];
  let role: 'admin' | 'leader' | 'creator' | 'public' | undefined;
  let group = 'ungrouped';
  let inFence = false;
  for (let index = publicStart + 1; index < publicEnd; index += 1) {
    const line = lines[index];
    const heading = line.match(/^####\s+(.+?)\s*接口\s*$/);
    if (heading) {
      role = DOC_ROLE_BY_HEADING[heading[1]];
      if (!role) unsupportedSyntax.push(unsupportedDoc(index + 1, 'unknown-role', heading[1]));
      group = 'ungrouped';
      continue;
    }
    if (line.trim().startsWith(String.fromCharCode(96).repeat(3))) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) continue;
    const comment = line.match(/^\s*#\s+(.+?)\s*$/);
    if (comment) {
      group = comment[1].trim();
      continue;
    }
    const parsed = parseRouteLine(line);
    if (!parsed) {
      if (/^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(line)) {
        unsupportedSyntax.push(unsupportedDoc(index + 1, 'invalid-route-line', line.trim()));
      }
      continue;
    }
    if (!role) {
      unsupportedSyntax.push(unsupportedDoc(index + 1, 'route-without-role', line.trim()));
      continue;
    }
    publicItems.push({ ...parsed, role, group, line: index + 1 });
  }
  if (inFence) unsupportedSyntax.push(unsupportedDoc(publicEnd, 'unclosed-fence', 'public-bff section'));

  const upstreamItems: Array<{ method: Method; path: string; line: number }> = [];
  for (let index = upstreamStart + 1; index < upstreamEnd; index += 1) {
    const parsed = parseUpstreamRow(lines[index]);
    if (parsed) upstreamItems.push({ ...parsed, line: index + 1 });
  }

  if (publicItems.length !== 169) {
    unsupportedSyntax.push(unsupportedDoc(publicStart + 1, 'public-count', 'expected 169, got ' + publicItems.length));
  }
  if (upstreamItems.length !== 7) {
    unsupportedSyntax.push(
      unsupportedDoc(upstreamStart + 1, 'upstream-count', 'expected 7, got ' + upstreamItems.length),
    );
  }

  const seen = new Set<string>();
  publicItems.forEach((item, index) => {
    const operation = makeOperation(
      index + 1,
      'public-bff',
      item.method,
      item.path,
      item.role,
      item.group,
      item.notes,
      docLocation(item.line, '2.2-public-bff'),
    );
    const key = operation.surface + '|' + operationKey(operation.method, operation.path);
    if (seen.has(key)) unsupportedSyntax.push(unsupportedDoc(item.line, 'duplicate-operation', key));
    seen.add(key);
    operations.push(operation);
  });
  upstreamItems.forEach((item, index) => {
    const operation = makeOperation(
      index + 1,
      'upstream-adapter',
      item.method,
      item.path,
      'adapter',
      'upstream-allowlist',
      null,
      docLocation(item.line, '7.1-upstream-adapter'),
    );
    const key = operation.surface + '|' + operationKey(operation.method, operation.path);
    if (seen.has(key)) unsupportedSyntax.push(unsupportedDoc(item.line, 'duplicate-operation', key));
    seen.add(key);
    operations.push(operation);
  });

  const sources: RegistrySource[] = [
    {
      surface: 'public-bff',
      file: DOC_FILE,
      section: '2.2-public-bff',
      baselineCount: 169,
      semanticSha256: semanticHash(operations, 'public-bff'),
      state: 'candidate-inventory-frozen',
    },
    {
      surface: 'upstream-adapter',
      file: DOC_FILE,
      section: '7.1-upstream-adapter',
      baselineCount: 7,
      semanticSha256: semanticHash(operations, 'upstream-adapter'),
      state: 'candidate-inventory-frozen',
    },
  ];
  const registry: Registry = parseRegistry({
    schemaVersion: 1,
    registryId: 'A-001',
    inventoryState: 'candidate-inventory-frozen',
    sources,
    operations,
  });
  for (const operation of registry.operations) {
    records.push({
      candidateId: operation.candidateId,
      surface: operation.surface,
      method: operation.method,
      path: operation.path,
      pathKind: operation.pathKind,
      shapePath: operation.shapePath,
      role: operation.role,
      group: operation.group,
      notes: operation.notes,
      source: operation.source,
    });
  }
  return { sources, operations: registry.operations, records, unsupportedSyntax };
}

function sourceFileFor(repoRoot: string, relativePath: string): ts.SourceFile {
  const absolutePath = path.join(repoRoot, relativePath);
  return ts.createSourceFile(
    absolutePath,
    fs.readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function identifierText(node: ts.Node | undefined): string | undefined {
  return node && ts.isIdentifier(node) ? node.text : undefined;
}

function importedLocalNames(sourceFile: ts.SourceFile, moduleName: string, importedName: string): Set<string> {
  const result = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== moduleName) continue;
    const clause = statement.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      if (element.propertyName?.text === importedName || element.name.text === importedName) {
        result.add(element.name.text);
      }
    }
  }
  return result;
}

function defaultImportName(sourceFile: ts.SourceFile, moduleName: string): string | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text === moduleName && statement.importClause?.name) {
      return statement.importClause.name.text;
    }
  }
  return undefined;
}

function callProperty(
  node: ts.CallExpression,
): { receiver: ts.Expression; name?: string; computed: boolean } | undefined {
  if (ts.isPropertyAccessExpression(node.expression)) {
    return { receiver: node.expression.expression, name: node.expression.name.text, computed: false };
  }
  if (ts.isElementAccessExpression(node.expression)) {
    return { receiver: node.expression.expression, computed: true };
  }
  return undefined;
}

function literalString(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function isCallTo(node: ts.Expression, names: Set<string>): boolean {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text);
}

interface RouterBinding {
  sourceFile: ts.SourceFile;
  name: string;
  declaration: ts.VariableDeclaration;
}

interface RouteMount {
  router: RouterBinding;
  prefix: string;
  source: SourceLocation;
}

function routeBindings(sourceFile: ts.SourceFile): RouterBinding[] {
  const routerImports = importedLocalNames(sourceFile, 'express', 'Router');
  const bindings: RouterBinding[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const name = identifierText(declaration.name);
      if (!name || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
      if (
        !ts.isIdentifier(declaration.initializer.expression) ||
        !routerImports.has(declaration.initializer.expression.text)
      )
        continue;
      bindings.push({ sourceFile, name, declaration });
    }
  }
  return bindings;
}

function routeImportBindings(sourceFile: ts.SourceFile): Map<string, string> {
  const result = new Map<string, string>();
  const sourceDir = path.dirname(sourceFile.fileName);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    if (!moduleName.startsWith('./') && !moduleName.startsWith('../')) continue;
    const resolvedPath = path.resolve(sourceDir, moduleName + '.ts');
    const normalizedPath = resolvedPath.replace(/\\/g, '/');
    if (!normalizedPath.includes('/server/src/routes/')) continue;
    const relativePath = normalizedPath.substring(normalizedPath.indexOf('server/src/'));
    const clause = statement.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      result.set(element.name.text, relativePath);
    }
  }
  return result;
}

function appBindingName(sourceFile: ts.SourceFile): string | undefined {
  const expressName = defaultImportName(sourceFile, 'express');
  if (!expressName) return undefined;
  let result: string | undefined;
  const visit = (node: ts.Node): void => {
    if (result) return;
    if (ts.isVariableDeclaration(node)) {
      const name = identifierText(node.name);
      if (
        name &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        isCallTo(node.initializer, new Set([expressName]))
      ) {
        if (node.initializer.arguments.length === 0) {
          result = name;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function routePathFromCall(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  repoRoot: string,
  unsupported: UnsupportedSource[],
): string | undefined {
  if (call.arguments.length === 0) {
    unsupported.push(
      unsupportedSource(sourceFile, call, repoRoot, 'missing-route-path', 'route method has no path argument'),
    );
    return undefined;
  }
  const value = literalString(call.arguments[0]);
  if (value === undefined) {
    unsupported.push(
      unsupportedSource(
        sourceFile,
        call.arguments[0],
        repoRoot,
        'dynamic-route-path',
        call.arguments[0].getText(sourceFile),
      ),
    );
    return undefined;
  }
  try {
    return normalizeServerRoutePath(value);
  } catch (error) {
    unsupported.push(unsupportedSource(sourceFile, call.arguments[0], repoRoot, 'invalid-route-path', String(error)));
    return undefined;
  }
}

function sortSourceRecords<T extends { source: SourceLocation }>(records: T[]): T[] {
  return records.sort(
    (left, right) =>
      compareOrdinal(left.source.file, right.source.file) ||
      left.source.line - right.source.line ||
      left.source.column - right.source.column,
  );
}

function sortUnsupportedRecords(records: UnsupportedSource[]): UnsupportedSource[] {
  return records.sort(
    (left, right) =>
      compareOrdinal(left.file, right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      compareOrdinal(left.kind, right.kind),
  );
}

function routeMayShadow(earlier: string, later: string): boolean {
  if (earlier.endsWith('/*')) return true;
  if (!earlier.includes('{')) return false;
  const a = earlier.split('/').filter(Boolean);
  const b = later.split('/').filter(Boolean);
  if (a.length > b.length) return false;
  return a.every((segment, index) => segment.startsWith('{') || segment === b[index]);
}

export function scanServerRoutes(repoRoot: string): ServerScan {
  const appFile = sourceFileFor(repoRoot, 'server/src/app.ts');
  const routeRelativePaths = fs
    .readdirSync(path.join(repoRoot, 'server/src/routes'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => 'server/src/routes/' + entry.name)
    .sort(compareOrdinal);
  const routeFiles = routeRelativePaths.map((relativePath) => sourceFileFor(repoRoot, relativePath));
  const routerBindings = routeFiles.flatMap(routeBindings);
  const routerByFileAndName = new Map<string, RouterBinding>();
  for (const binding of routerBindings) {
    routerByFileAndName.set(repoRelative(repoRoot, binding.sourceFile.fileName) + '|' + binding.name, binding);
  }
  const routeImports = routeImportBindings(appFile);
  const appName = appBindingName(appFile);
  const unsupportedSyntax: UnsupportedSource[] = [];
  const mounts: RouteMount[] = [];
  const appRecords: ServerRouteRecord[] = [];
  if (!appName) {
    unsupportedSyntax.push(
      unsupportedSource(appFile, appFile, repoRoot, 'express-binding', 'express application binding not proven'),
    );
  }

  function visitApp(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const property = callProperty(node);
      const receiver = property && identifierText(property.receiver);
      if (receiver === appName && property && !property.computed && property.name === 'use') {
        if (node.arguments.length >= 2) {
          const prefix = literalString(node.arguments[0]);
          const routerName = identifierText(node.arguments[1]);
          if (prefix === undefined || !routerName) {
            unsupportedSyntax.push(unsupportedSource(appFile, node, repoRoot, 'dynamic-mount', node.getText(appFile)));
          } else {
            try {
              const normalizedPrefix = normalizeServerRoutePath(prefix);
              const relativeRoute = routeImports.get(routerName);
              const binding = relativeRoute ? routerByFileAndName.get(relativeRoute + '|' + routerName) : undefined;
              if (!binding) {
                unsupportedSyntax.push(unsupportedSource(appFile, node, repoRoot, 'unproven-router-mount', routerName));
              } else {
                if (mounts.some((mount) => mount.router === binding)) {
                  unsupportedSyntax.push(
                    unsupportedSource(appFile, node, repoRoot, 'multiple-router-mount', routerName),
                  );
                }
                mounts.push({ router: binding, prefix: normalizedPrefix, source: location(appFile, node, repoRoot) });
              }
            } catch (error) {
              unsupportedSyntax.push(unsupportedSource(appFile, node, repoRoot, 'invalid-mount', String(error)));
            }
          }
        } else if (node.arguments.length > 0) {
          const first = node.arguments[0];
          if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) {
            unsupportedSyntax.push(
              unsupportedSource(appFile, node, repoRoot, 'mount-without-router', node.getText(appFile)),
            );
          }
        }
      }
      if (receiver === appName && property && !property.computed && ROUTE_METHODS.has(property.name ?? '')) {
        const routePath = routePathFromCall(appFile, node, repoRoot, unsupportedSyntax);
        if (routePath) {
          const method = ensureMethod(property.name ?? '', 'server route');
          const kind = pathKind(routePath);
          const source = location(appFile, node, repoRoot);
          appRecords.push({
            method,
            path: routePath,
            pathKind: kind,
            shapePath: shapePath(routePath),
            operationKey: operationKey(method, routePath),
            shapeKey: operationKey(method, shapePath(routePath)),
            receiver: appName ?? 'app',
            mount: '/',
            source,
          });
        }
      }
      if (receiver === appName && property?.computed) {
        unsupportedSyntax.push(
          unsupportedSource(appFile, node, repoRoot, 'computed-route-method', node.getText(appFile)),
        );
      }
    }
    ts.forEachChild(node, visitApp);
  }
  visitApp(appFile);

  for (const mount of mounts) {
    const sourceFile = mount.router.sourceFile;
    function visitRoute(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const property = callProperty(node);
        const receiver = property && identifierText(property.receiver);
        if (receiver === mount.router.name && property) {
          if (property.computed) {
            unsupportedSyntax.push(
              unsupportedSource(sourceFile, node, repoRoot, 'computed-route-method', node.getText(sourceFile)),
            );
          } else if (property.name === 'use') {
            if (node.arguments.length >= 2) {
              const prefix = literalString(node.arguments[0]);
              const childRouterName = identifierText(node.arguments[1]);
              if (prefix === undefined || !childRouterName) {
                unsupportedSyntax.push(
                  unsupportedSource(sourceFile, node, repoRoot, 'dynamic-nested-mount', node.getText(sourceFile)),
                );
              } else {
                try {
                  const normalizedPrefix = normalizeServerRoutePath(prefix);
                  const childImports = routeImportBindings(sourceFile);
                  const relativeRoute = childImports.get(childRouterName);
                  const childBinding = relativeRoute ? routerByFileAndName.get(relativeRoute + '|' + childRouterName) : undefined;
                  if (!childBinding) {
                    unsupportedSyntax.push(
                      unsupportedSource(sourceFile, node, repoRoot, 'unproven-nested-router', childRouterName),
                    );
                  } else {
                    const combinedPrefix = joinBase(mount.prefix, normalizedPrefix);
                    if (mounts.some((m) => m.router === childBinding)) {
                      unsupportedSyntax.push(
                        unsupportedSource(sourceFile, node, repoRoot, 'multiple-nested-mount', childRouterName),
                      );
                    } else {
                      mounts.push({ router: childBinding, prefix: combinedPrefix, source: location(sourceFile, node, repoRoot) });
                    }
                  }
                } catch (error) {
                  unsupportedSyntax.push(unsupportedSource(sourceFile, node, repoRoot, 'invalid-nested-mount', String(error)));
                }
              }
            }
          } else if (property.name === 'route') {
            unsupportedSyntax.push(
              unsupportedSource(sourceFile, node, repoRoot, 'route-builder', node.getText(sourceFile)),
            );
          } else if (ROUTE_METHODS.has(property.name ?? '')) {
            const routePath = routePathFromCall(sourceFile, node, repoRoot, unsupportedSyntax);
            if (routePath) {
              const method = ensureMethod(property.name ?? '', 'server route');
              const canonical = joinBase(mount.prefix, routePath);
              const kind = pathKind(canonical);
              const source = location(sourceFile, node, repoRoot);
              appRecords.push({
                method,
                path: canonical,
                pathKind: kind,
                shapePath: shapePath(canonical),
                operationKey: operationKey(method, canonical),
                shapeKey: operationKey(method, shapePath(canonical)),
                receiver: mount.router.name,
                mount: mount.prefix,
                source,
              });
            }
          }
        }
      }
      ts.forEachChild(node, visitRoute);
    }
    visitRoute(sourceFile);
  }

  const records = appRecords.sort(
    (left, right) =>
      compareOrdinal(left.method, right.method) ||
      compareOrdinal(left.path, right.path) ||
      compareOrdinal(left.source.file, right.source.file) ||
      left.source.line - right.source.line ||
      left.source.column - right.source.column,
  );
  const duplicateKeys = new Set<string>();
  for (const record of records) {
    if (duplicateKeys.has(record.operationKey)) {
      unsupportedSyntax.push({
        file: record.source.file,
        line: record.source.line,
        column: record.source.column,
        kind: 'duplicate-operation',
        detail: record.operationKey,
      });
    }
    duplicateKeys.add(record.operationKey);
  }
  for (const mount of mounts) {
    const routerRecords = records
      .filter(
        (record) =>
          record.receiver === mount.router.name &&
          record.source.file === repoRelative(repoRoot, mount.router.sourceFile.fileName),
      )
      .sort(
        (left, right) =>
          compareOrdinal(left.source.file, right.source.file) ||
          left.source.line - right.source.line ||
          left.source.column - right.source.column,
      );
    for (let index = 0; index < routerRecords.length; index += 1) {
      for (let next = index + 1; next < routerRecords.length; next += 1) {
        if (
          routerRecords[index].method === routerRecords[next].method &&
          routeMayShadow(
            routerRecords[index].path.slice(mount.prefix.length) || '/',
            routerRecords[next].path.slice(mount.prefix.length) || '/',
          )
        ) {
          unsupportedSyntax.push({
            ...routerRecords[next].source,
            kind: 'route-shadowing',
            detail: routerRecords[index].operationKey + ' before ' + routerRecords[next].operationKey,
          });
        }
      }
    }
  }
  return {
    records,
    unsupportedSyntax: sortUnsupportedRecords(unsupportedSyntax),
    mounts: mounts.map((mount) => mount.prefix).sort(compareOrdinal),
  };
}

type HttpBindingKind = 'standard' | 'alliance-wrapper' | 'alliance-instance';

interface HttpBinding {
  name: string;
  kind: HttpBindingKind;
}

function httpBindings(sourceFile: ts.SourceFile): Map<string, HttpBinding> {
  const result = new Map<string, HttpBinding>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    if (moduleName === './http' && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === 'http') {
          result.set(element.name.text, { name: element.name.text, kind: 'standard' });
        }
      }
    }
    if (moduleName === '@/api/zhihu-http') {
      if (clause.name) result.set(clause.name.text, { name: clause.name.text, kind: 'alliance-instance' });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (imported === 'zhGet' || imported === 'zhPost' || imported === 'zhPut') {
            result.set(element.name.text, { name: element.name.text, kind: 'alliance-wrapper' });
          }
        }
      }
    }
  }
  return result;
}

function isShadowedIdentifier(identifier: ts.Identifier, name: string): boolean {
  let current: ts.Node | undefined = identifier.parent;
  while (current) {
    if (ts.isFunctionLike(current)) {
      for (const parameter of current.parameters) {
        if (identifierText(parameter.name) === name) return true;
      }
    }
    if (ts.isBlock(current) || ts.isSourceFile(current)) {
      for (const statement of current.statements) {
        if (statement.getStart() >= identifier.getStart()) break;
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (identifierText(declaration.name) === name) return true;
        }
      }
    }
    current = current.parent;
  }
  return false;
}

function enclosingParameters(node: ts.Node): Set<string> {
  const result = new Set<string>();
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) {
      for (const parameter of current.parameters) {
        const name = identifierText(parameter.name);
        if (name) result.add(name);
      }
    }
    current = current.parent;
  }
  return result;
}

interface StringConstant {
  declaration: ts.VariableDeclaration;
  value?: string;
  resolving: boolean;
}

function topLevelStringConstants(sourceFile: ts.SourceFile): Map<string, StringConstant> {
  const result = new Map<string, StringConstant>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const name = identifierText(declaration.name);
      if (name) result.set(name, { declaration, resolving: false });
    }
  }
  return result;
}

function staticStringExpression(
  node: ts.Expression,
  constants: Map<string, StringConstant>,
  parameters: Set<string>,
): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return staticStringExpression(node.expression, constants, parameters);
  if (ts.isIdentifier(node)) {
    if (parameters.has(node.text)) return undefined;
    const constant = constants.get(node.text);
    if (!constant || constant.resolving || !constant.declaration.initializer) return undefined;
    constant.resolving = true;
    const value = staticStringExpression(constant.declaration.initializer, constants, parameters);
    constant.resolving = false;
    return value;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStringExpression(node.left, constants, parameters);
    const right = staticStringExpression(node.right, constants, parameters);
    return left !== undefined && right !== undefined ? left + right : undefined;
  }
  return undefined;
}

function pathExpression(
  node: ts.Expression,
  constants: Map<string, StringConstant>,
  parameters: Set<string>,
): { value?: string; dynamic: boolean } {
  const staticValue = staticStringExpression(node, constants, parameters);
  if (staticValue !== undefined) return { value: staticValue, dynamic: false };
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = span.expression;
      if (ts.isIdentifier(expression) && parameters.has(expression.text)) {
        value += '{' + expression.text + '}';
      } else {
        const expanded = staticStringExpression(expression, constants, parameters);
        if (expanded === undefined) return { dynamic: true };
        value += expanded;
      }
      value += span.literal.text;
    }
    return { value, dynamic: false };
  }
  return { dynamic: true };
}

function platformFiles(repoRoot: string): string[] {
  const root = path.join(repoRoot, 'platform/src/api');
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(absolute);
    }
  };
  visit(root);
  return result.sort(compareOrdinal);
}

function platformMethod(property: string, kind: HttpBindingKind): Method | undefined {
  if (kind === 'standard') {
    if (property === 'get') return 'GET';
    if (property === 'post') return 'POST';
    if (property === 'put') return 'PUT';
    if (property === 'patch') return 'PATCH';
    if (property === 'del' || property === 'delete') return 'DELETE';
  } else {
    if (property === 'get') return 'GET';
    if (property === 'post') return 'POST';
    if (property === 'put') return 'PUT';
    if (property === 'patch') return 'PATCH';
    if (property === 'delete') return 'DELETE';
  }
  return undefined;
}

function platformPath(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  constants: Map<string, StringConstant>,
  repoRoot: string,
  unsupported: UnsupportedSource[],
): string | undefined {
  if (call.arguments.length === 0) {
    unsupported.push(
      unsupportedSource(sourceFile, call, repoRoot, 'missing-http-path', 'HTTP helper has no path argument'),
    );
    return undefined;
  }
  const argument = call.arguments[0];
  const result = pathExpression(argument, constants, enclosingParameters(call));
  if (result.value === undefined) {
    unsupported.push(
      unsupportedSource(sourceFile, argument, repoRoot, 'dynamic-http-path', argument.getText(sourceFile)),
    );
    return undefined;
  }
  try {
    return assertCanonicalPath(result.value, 'platform path');
  } catch (error) {
    unsupported.push(unsupportedSource(sourceFile, argument, repoRoot, 'invalid-http-path', String(error)));
    return undefined;
  }
}

export function scanPlatformCalls(repoRoot: string): PlatformScan {
  const records: PlatformCallRecord[] = [];
  const unsupportedSyntax: UnsupportedSource[] = [];
  for (const absolutePath of platformFiles(repoRoot)) {
    const relativePath = repoRelative(repoRoot, absolutePath);
    if (relativePath.endsWith('/http.ts') || relativePath.endsWith('/zhihu-http.ts')) continue;
    const sourceFile = sourceFileFor(repoRoot, relativePath);
    const bindings = httpBindings(sourceFile);
    const constants = topLevelStringConstants(sourceFile);
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const property = callProperty(node);
        let binding: HttpBinding | undefined;
        let method: Method | undefined;
        let helper = '';
        if (property && !property.computed) {
          const receiverName = identifierText(property.receiver);
          if (receiverName && !isShadowedIdentifier(property.receiver as ts.Identifier, receiverName)) {
            binding = bindings.get(receiverName);
            if (binding) {
              method = platformMethod(property.name ?? '', binding.kind);
              helper = receiverName + '.' + (property.name ?? '');
            }
          }
        } else if (property?.computed) {
          const receiverName = identifierText(property.receiver);
          if (receiverName && bindings.has(receiverName)) {
            unsupportedSyntax.push(
              unsupportedSource(sourceFile, node, repoRoot, 'computed-http-method', node.getText(sourceFile)),
            );
          }
        } else if (ts.isIdentifier(node.expression)) {
          binding = bindings.get(node.expression.text);
          if (binding && !isShadowedIdentifier(node.expression, node.expression.text)) {
            method =
              binding.name === node.expression.text && binding.kind === 'alliance-wrapper'
                ? binding.name === 'zhGet'
                  ? 'GET'
                  : binding.name === 'zhPost'
                    ? 'POST'
                    : 'PUT'
                : undefined;
            helper = node.expression.text;
          }
        }
        if (binding && method) {
          const rawPath = platformPath(sourceFile, node, constants, repoRoot, unsupportedSyntax);
          if (rawPath) {
            const base = binding.kind === 'standard' ? '/api/v1' : '/api';
            const canonical = joinBase(base, rawPath);
            const kind = pathKind(canonical);
            if (kind === 'wildcard') {
              unsupportedSyntax.push(
                unsupportedSource(sourceFile, node, repoRoot, 'wildcard-platform-path', canonical),
              );
            } else {
              const source = location(sourceFile, node, repoRoot);
              records.push({
                method,
                path: canonical,
                pathKind: kind,
                shapePath: shapePath(canonical),
                operationKey: operationKey(method, canonical),
                shapeKey: operationKey(method, shapePath(canonical)),
                platformSurface: binding.kind === 'standard' ? 'standard-bff' : 'alliance',
                helper,
                basePath: binding.kind === 'standard' ? '/api/v1' : '/api/alliance/api',
                source,
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  const duplicateKeys = new Set<string>();
  for (const record of records) {
    if (duplicateKeys.has(record.operationKey)) {
      unsupportedSyntax.push({
        ...record.source,
        kind: 'duplicate-operation',
        detail: record.operationKey,
      });
    }
    duplicateKeys.add(record.operationKey);
  }
  records.sort(
    (left, right) =>
      compareOrdinal(left.method, right.method) ||
      compareOrdinal(left.path, right.path) ||
      compareOrdinal(left.source.file, right.source.file) ||
      left.source.line - right.source.line ||
      left.source.column - right.source.column,
  );
  return { records, unsupportedSyntax: sortUnsupportedRecords(unsupportedSyntax) };
}

function methodCounts(items: Array<{ method: Method }>): Record<Method, number> {
  const result: Record<Method, number> = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0, HEAD: 0, OPTIONS: 0 };
  for (const item of items) result[item.method] += 1;
  return result;
}

function roleCounts(items: Array<{ role: RegistryOperation['role'] }>): Record<RegistryOperation['role'], number> {
  const result: Record<RegistryOperation['role'], number> = { admin: 0, leader: 0, creator: 0, public: 0, adapter: 0 };
  for (const item of items) result[item.role] += 1;
  return result;
}

function documentPathCounts(items: Array<{ pathKind: 'static' | 'parameterized' }>): {
  static: number;
  parameterized: number;
} {
  return {
    static: items.filter((item) => item.pathKind === 'static').length,
    parameterized: items.filter((item) => item.pathKind === 'parameterized').length,
  };
}

function serverPathCounts(items: ServerRouteRecord[]): { static: number; parameterized: number; wildcard: number } {
  return {
    static: items.filter((item) => item.pathKind === 'static').length,
    parameterized: items.filter((item) => item.pathKind === 'parameterized').length,
    wildcard: items.filter((item) => item.pathKind === 'wildcard').length,
  };
}

function keySet(items: Array<{ operationKey: string }>): Set<string> {
  return new Set(items.map((item) => item.operationKey));
}

function sortStrings(values: Iterable<string>): string[] {
  return Array.from(values).sort(compareOrdinal);
}

interface Joinable {
  operationKey: string;
  shapeKey: string;
}

interface GenericJoin {
  observedExact: string[];
  shapeOnlyMatch: Array<{ leftOperationKey: string; rightOperationKey: string; shapeKey: string }>;
  leftOnly: string[];
  rightOnly: string[];
}

function joinOperations(left: Joinable[], right: Joinable[]): GenericJoin {
  const rightByKey = new Map(right.map((item) => [item.operationKey, item]));
  const exact = new Set<string>();
  const unmatchedLeft: Joinable[] = [];
  for (const item of left) {
    if (rightByKey.has(item.operationKey)) exact.add(item.operationKey);
    else unmatchedLeft.push(item);
  }
  const unmatchedRight = right.filter((item) => !exact.has(item.operationKey));
  const rightByShape = new Map<string, Joinable[]>();
  for (const item of unmatchedRight) {
    const list = rightByShape.get(item.shapeKey) ?? [];
    list.push(item);
    rightByShape.set(item.shapeKey, list);
  }
  const usedRight = new Set<string>();
  const pairs: Array<{ leftOperationKey: string; rightOperationKey: string; shapeKey: string }> = [];
  const leftOnly: string[] = [];
  for (const item of unmatchedLeft.sort((a, b) => compareOrdinal(a.operationKey, b.operationKey))) {
    const candidate = (rightByShape.get(item.shapeKey) ?? [])
      .filter((entry) => !usedRight.has(entry.operationKey))
      .sort((a, b) => compareOrdinal(a.operationKey, b.operationKey))[0];
    if (candidate) {
      usedRight.add(candidate.operationKey);
      pairs.push({
        leftOperationKey: item.operationKey,
        rightOperationKey: candidate.operationKey,
        shapeKey: item.shapeKey,
      });
    } else {
      leftOnly.push(item.operationKey);
    }
  }
  const rightOnly = unmatchedRight.filter((item) => !usedRight.has(item.operationKey)).map((item) => item.operationKey);
  pairs.sort(
    (a, b) =>
      compareOrdinal(a.leftOperationKey, b.leftOperationKey) ||
      compareOrdinal(a.rightOperationKey, b.rightOperationKey) ||
      compareOrdinal(a.shapeKey, b.shapeKey),
  );
  return {
    observedExact: sortStrings(exact),
    shapeOnlyMatch: pairs,
    leftOnly: leftOnly.sort(compareOrdinal),
    rightOnly: rightOnly.sort(compareOrdinal),
  };
}

function documentJoinable(operations: RegistryOperation[]): Joinable[] {
  return operations.map((operation) => ({
    operationKey: operationKey(operation.method, operation.path),
    shapeKey: operationKey(operation.method, operation.shapePath),
  }));
}

function stripAllianceMount(record: PlatformCallRecord): Joinable {
  const prefix = '/api/alliance/api';
  if (!record.path.startsWith(prefix))
    throw new Error('alliance platform path is missing internal mount: ' + record.path);
  const value = record.path.slice(prefix.length) || '/';
  const canonical = assertCanonicalPath(value, 'adapter join path');
  return {
    operationKey: operationKey(record.method, canonical),
    shapeKey: operationKey(record.method, shapePath(canonical)),
  };
}

function wildcardCoverage(
  serverRecords: ServerRouteRecord[],
  platformRecords: PlatformCallRecord[],
): Array<{
  wildcardOperationKey: string;
  platformOperationKey: string;
}> {
  const pairs: Array<{ wildcardOperationKey: string; platformOperationKey: string }> = [];
  for (const platformRecord of platformRecords.filter((record) => record.platformSurface === 'alliance')) {
    const wildcard = serverRecords
      .filter(
        (record) =>
          record.pathKind === 'wildcard' &&
          record.method === platformRecord.method &&
          platformRecord.path.startsWith(record.path.slice(0, -1)),
      )
      .sort((a, b) => compareOrdinal(a.operationKey, b.operationKey))[0];
    if (wildcard) {
      pairs.push({
        wildcardOperationKey: wildcard.operationKey,
        platformOperationKey: platformRecord.operationKey,
      });
    }
  }
  return pairs.sort(
    (left, right) =>
      compareOrdinal(left.wildcardOperationKey, right.wildcardOperationKey) ||
      compareOrdinal(left.platformOperationKey, right.platformOperationKey),
  );
}

function assertInventoryCounts(document: DocumentScan, server: ServerScan, platform: PlatformScan): void {
  if (document.unsupportedSyntax.length > 0) {
    throw new Error('document unsupported syntax: ' + JSON.stringify(document.unsupportedSyntax));
  }
  if (server.unsupportedSyntax.length > 0) {
    throw new Error('server unsupported syntax: ' + JSON.stringify(server.unsupportedSyntax));
  }
  if (platform.unsupportedSyntax.length > 0) {
    throw new Error('platform unsupported syntax: ' + JSON.stringify(platform.unsupportedSyntax));
  }
  const documentRoles = roleCounts(document.operations);
  const documentMethods = methodCounts(document.operations);
  const documentKinds = documentPathCounts(document.operations);
  if (
    document.operations.filter((item) => item.surface === 'public-bff').length !== 169 ||
    document.operations.filter((item) => item.surface === 'upstream-adapter').length !== 7 ||
    documentRoles.admin !== 94 ||
    documentRoles.leader !== 39 ||
    documentRoles.creator !== 30 ||
    documentRoles.public !== 6 ||
    documentRoles.adapter !== 7 ||
    documentMethods.GET !== 89 ||
    documentMethods.POST !== 56 ||
    documentMethods.PUT !== 9 ||
    documentMethods.PATCH !== 3 ||
    documentMethods.DELETE !== 19 ||
    documentKinds.static !== 96 ||
    documentKinds.parameterized !== 80
  ) {
    throw new Error('document baseline distribution mismatch');
  }
  // server/platform 侧只做结构校验（禁止 wildcard 路由、operationKey 唯一），
  // 不冻结数量快照：实现随里程碑演进，产物由 generate/check 保持同步。
  const serverKinds = serverPathCounts(server.records);
  if (
    new Set(server.records.map((item) => item.operationKey)).size !== server.records.length ||
    serverKinds.wildcard !== 0
  ) {
    throw new Error('server route structure invalid: duplicate operationKey or wildcard route');
  }
  if (new Set(platform.records.map((item) => item.operationKey)).size !== platform.records.length) {
    throw new Error('platform call structure invalid: duplicate operationKey');
  }
}

function assertRegistryMatchesDocument(registry: Registry, document: DocumentScan): void {
  const expectedSources = new Map(document.sources.map((source) => [source.surface, source]));
  for (const source of registry.sources) {
    const expected = expectedSources.get(source.surface);
    if (
      !expected ||
      source.semanticSha256 !== expected.semanticSha256 ||
      source.baselineCount !== expected.baselineCount
    ) {
      throw new Error('registry source does not match current document: ' + source.surface);
    }
  }
  const registryByKey = new Map(
    registry.operations.map((operation) => [
      operation.surface + '|' + operationKey(operation.method, operation.path),
      operation,
    ]),
  );
  for (const operation of document.operations) {
    const key = operation.surface + '|' + operationKey(operation.method, operation.path);
    const existing = registryByKey.get(key);
    if (!existing) throw new Error('document operation is missing from registry: ' + key);
    if (
      existing.candidateId !== operation.candidateId ||
      existing.specTestId !== operation.specTestId ||
      existing.role !== operation.role ||
      existing.group !== operation.group ||
      existing.notes !== operation.notes
    ) {
      throw new Error('registry operation diverges from document baseline: ' + key);
    }
  }
}

function parseJsonFile<T>(absolutePath: string, parser: { parse(value: unknown): T }): T {
  return parser.parse(JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as unknown);
}

export function readRegistry(repoRoot: string): Registry {
  const absolutePath = path.join(repoRoot, REGISTRY_FILE);
  if (!fs.existsSync(absolutePath)) throw new Error('registry is missing: ' + REGISTRY_FILE);
  return parseRegistry(parseJsonFile(absolutePath, registrySchema));
}

function assertArtifactFieldOrder(
  docArtifact: DocCandidatesArtifact,
  serverArtifact: ServerRoutesArtifact,
  platformArtifact: PlatformCallsArtifact,
  summary: InventorySummary,
): void {
  assertFixedObjectKeys(
    docArtifact,
    [
      'schemaVersion',
      'generatorId',
      'inputManifestSha256',
      'registrySha256',
      'sources',
      'records',
      'unsupportedSyntax',
    ],
    'doc candidates artifact',
  );
  assertFixedObjectKeys(
    serverArtifact,
    ['schemaVersion', 'generatorId', 'inputManifestSha256', 'records', 'unsupportedSyntax'],
    'server routes artifact',
  );
  assertFixedObjectKeys(
    platformArtifact,
    ['schemaVersion', 'generatorId', 'inputManifestSha256', 'records', 'unsupportedSyntax'],
    'platform calls artifact',
  );
  assertFixedObjectKeys(
    summary,
    [
      'schemaVersion',
      'generatorId',
      'inputManifestSha256',
      'registrySha256',
      'artifactSha256',
      'declaredImplementedCount',
      'derivedImplementedCount',
      'counts',
      'joins',
      'unsupportedSyntaxCounts',
    ],
    'inventory summary artifact',
  );
  for (const record of docArtifact.records) {
    assertFixedObjectKeys(
      record,
      ['candidateId', 'surface', 'method', 'path', 'pathKind', 'shapePath', 'role', 'group', 'notes', 'source'],
      'document record',
    );
  }
  for (const record of serverArtifact.records) {
    assertFixedObjectKeys(
      record,
      ['method', 'path', 'pathKind', 'shapePath', 'operationKey', 'shapeKey', 'receiver', 'mount', 'source'],
      'server record',
    );
  }
  for (const record of platformArtifact.records) {
    assertFixedObjectKeys(
      record,
      [
        'method',
        'path',
        'pathKind',
        'shapePath',
        'operationKey',
        'shapeKey',
        'platformSurface',
        'helper',
        'basePath',
        'source',
      ],
      'platform record',
    );
  }
}

export interface InventoryArtifacts {
  document: DocumentScan;
  server: ServerScan;
  platform: PlatformScan;
  registry: Registry;
  registrySha256: string;
  manifest: ImmutableManifest;
  docCandidates: Buffer;
  serverRoutes: Buffer;
  platformCalls: Buffer;
  summary: Buffer;
}

export function buildInventoryArtifacts(repoRoot: string): InventoryArtifacts {
  const manifest = computeImmutableManifest(repoRoot);
  const document = scanDocument(repoRoot);
  const registry = readRegistry(repoRoot);
  assertRegistryMatchesDocument(registry, document);
  const server = scanServerRoutes(repoRoot);
  const platform = scanPlatformCalls(repoRoot);
  assertInventoryCounts(document, server, platform);

  const registrySha256 = fileSha256(repoRoot, REGISTRY_FILE);
  const docArtifact = docCandidatesSchema.parse({
    schemaVersion: 1,
    generatorId: GENERATOR_ID,
    inputManifestSha256: manifest.sha256,
    registrySha256,
    sources: registry.sources,
    records: [...document.records].sort(
      (left, right) =>
        compareOrdinal(left.surface, right.surface) || compareOrdinal(left.candidateId, right.candidateId),
    ),
    unsupportedSyntax: [...document.unsupportedSyntax],
  });
  const serverArtifact = serverRoutesSchema.parse({
    schemaVersion: 1,
    generatorId: GENERATOR_ID,
    inputManifestSha256: manifest.sha256,
    records: [...server.records],
    unsupportedSyntax: [...server.unsupportedSyntax],
  });
  const platformArtifact = platformCallsSchema.parse({
    schemaVersion: 1,
    generatorId: GENERATOR_ID,
    inputManifestSha256: manifest.sha256,
    records: [...platform.records],
    unsupportedSyntax: [...platform.unsupportedSyntax],
  });
  const docCandidates = artifactJson(docArtifact);
  const serverRoutes = artifactJson(serverArtifact);
  const platformCalls = artifactJson(platformArtifact);

  const publicTargets = documentJoinable(registry.operations.filter((operation) => operation.surface === 'public-bff'));
  const adapterTargets = documentJoinable(
    registry.operations.filter((operation) => operation.surface === 'upstream-adapter'),
  );
  const standardPlatform = platform.records.filter((record) => record.platformSurface === 'standard-bff');
  const alliancePlatform = platform.records.filter((record) => record.platformSurface === 'alliance');
  const targetServer = joinOperations(publicTargets, server.records);
  const targetPlatform = joinOperations(publicTargets, standardPlatform);
  const adapterJoin = joinOperations(adapterTargets, alliancePlatform.map(stripAllianceMount));
  const serverKeys = keySet(server.records);
  const platformKeys = keySet(standardPlatform);
  const triple = publicTargets
    .map((item) => item.operationKey)
    .filter((key) => serverKeys.has(key) && platformKeys.has(key))
    .sort(compareOrdinal);
  const apiV1Server = server.records.filter((record) => record.path.startsWith('/api/v1'));
  const apiV1Platform = standardPlatform;
  const apiV1Join = joinOperations(apiV1Server, apiV1Platform);
  const counts = {
    registry: {
      publicBff: registry.operations.filter((operation) => operation.surface === 'public-bff').length,
      upstreamAdapter: registry.operations.filter((operation) => operation.surface === 'upstream-adapter').length,
      total: registry.operations.length,
    },
    document: {
      publicBff: document.operations.filter((operation) => operation.surface === 'public-bff').length,
      upstreamAdapter: document.operations.filter((operation) => operation.surface === 'upstream-adapter').length,
      total: document.operations.length,
      byRole: roleCounts(document.operations),
      byMethod: methodCounts(document.operations),
      byPathKind: documentPathCounts(document.operations),
    },
    server: {
      mounts: server.mounts.length,
      callSites: server.records.length,
      uniqueOperations: new Set(server.records.map((record) => record.operationKey)).size,
      byMethod: methodCounts(server.records),
      byPathKind: serverPathCounts(server.records),
    },
    platform: {
      callSites: platform.records.length,
      uniqueOperations: new Set(platform.records.map((record) => record.operationKey)).size,
      standardBff: standardPlatform.length,
      alliance: alliancePlatform.length,
      byMethod: methodCounts(platform.records),
      byPathKind: documentPathCounts(platform.records),
    },
    apiV1: {
      server: apiV1Server.length,
      platform: apiV1Platform.length,
      observedExact: apiV1Join.observedExact.length,
      serverOnly: apiV1Join.leftOnly.length,
      platformOnly: apiV1Join.rightOnly.length,
    },
  };
  const summary = inventorySummarySchema.parse({
    schemaVersion: 1,
    generatorId: GENERATOR_ID,
    inputManifestSha256: manifest.sha256,
    registrySha256,
    artifactSha256: {
      docCandidates: sha256(docCandidates),
      serverRoutes: sha256(serverRoutes),
      platformCalls: sha256(platformCalls),
    },
    declaredImplementedCount: 0,
    derivedImplementedCount: 0,
    counts,
    joins: {
      publicTargetServer: {
        observedExact: targetServer.observedExact,
        shapeOnlyMatch: targetServer.shapeOnlyMatch,
        targetOnly: targetServer.leftOnly,
        serverOnly: targetServer.rightOnly,
      },
      publicTargetPlatform: {
        observedExact: targetPlatform.observedExact,
        shapeOnlyMatch: targetPlatform.shapeOnlyMatch,
        targetOnly: targetPlatform.leftOnly,
        platformOnly: targetPlatform.rightOnly,
      },
      publicTargetServerPlatform: { observedExact: triple },
      upstreamPlatformAdapter: {
        observedExact: adapterJoin.observedExact,
        shapeOnlyMatch: adapterJoin.shapeOnlyMatch,
        upstreamOnly: adapterJoin.leftOnly,
        platformOnly: adapterJoin.rightOnly,
      },
      serverWildcardCoverage: {
        transportCoveredByWildcard: wildcardCoverage(server.records, platform.records),
      },
    },
    unsupportedSyntaxCounts: {
      doc: document.unsupportedSyntax.length,
      server: server.unsupportedSyntax.length,
      platform: platform.unsupportedSyntax.length,
    },
  });
  assertArtifactFieldOrder(docArtifact, serverArtifact, platformArtifact, summary);
  assertExpectedJoinCounts(summary);
  return {
    document,
    server,
    platform,
    registry,
    registrySha256,
    manifest,
    docCandidates,
    serverRoutes,
    platformCalls,
    summary: artifactJson(summary),
  };
}

function assertExpectedJoinCounts(summary: InventorySummary): void {
  // join 统计随实现演进，完整数据保留在 inventory-summary.json 中供审计；
  // 这里只保证 wildcard 路由不出现在传输层覆盖里。
  if (summary.joins.serverWildcardCoverage.transportCoveredByWildcard.length !== 0) {
    throw new Error('inventory join invalid: wildcard transport coverage');
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRequiredPackageScripts(repoRoot: string): void {
  const packagePath = path.join(repoRoot, 'server/package.json');
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error('server/package.json is not valid JSON', { cause: error });
  }

  if (!isJsonObject(packageJson) || !isJsonObject(packageJson.scripts)) {
    throw new Error('server/package.json scripts must be an object');
  }

  for (const [name, command] of Object.entries(REQUIRED_PACKAGE_SCRIPTS)) {
    if (packageJson.scripts[name] !== command) {
      throw new Error('required Contract package script mismatch: ' + name);
    }
  }
}

function removeIfPresent(absolutePath: string): void {
  if (fs.existsSync(absolutePath)) fs.rmSync(absolutePath, { recursive: true, force: false });
}

function removeEmptyDirectories(start: string, stopBefore: string): void {
  let current = start;
  while (current !== stopBefore && fs.existsSync(current)) {
    if (fs.readdirSync(current).length !== 0) break;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

export interface BootstrapResult {
  registrySha256: string;
  operationCount: number;
}

export function bootstrapRegistry(repoRoot: string, acknowledgement: string): BootstrapResult {
  assertRequiredPackageScripts(repoRoot);
  if (acknowledgement !== 'A-001') throw new Error('bootstrap requires --acknowledge-new-registry A-001');
  const registryPath = path.join(repoRoot, REGISTRY_FILE);
  if (fs.existsSync(registryPath)) throw new Error('bootstrap refused: Registry already exists');

  const document = scanDocument(repoRoot);
  if (document.unsupportedSyntax.length > 0) {
    throw new Error('bootstrap refused: document parser reported unsupported syntax');
  }
  const registry = parseRegistry({
    schemaVersion: 1,
    registryId: 'A-001',
    inventoryState: 'candidate-inventory-frozen',
    sources: document.sources,
    operations: document.operations,
  });
  assertFixedObjectKeys(
    registry,
    ['schemaVersion', 'registryId', 'inventoryState', 'sources', 'operations'],
    'registry',
  );
  const registryBytes = stableJson(registry);
  const parent = path.dirname(registryPath);
  const contractsRoot = path.join(repoRoot, 'contracts');
  const parentExisted = fs.existsSync(parent);
  if (!parentExisted) fs.mkdirSync(parent, { recursive: true });
  const runId = crypto.randomUUID();
  const lockPath = path.join(parent, '.operation-registry-bootstrap.lock');
  const temporaryPath = path.join(parent, '.tmp-operation-registry-' + runId);
  let lockOpened = false;
  let published = false;
  try {
    const descriptor = fs.openSync(lockPath, 'wx');
    fs.closeSync(descriptor);
    lockOpened = true;
    if (fs.existsSync(registryPath)) throw new Error('bootstrap refused: Registry already exists');
    fs.writeFileSync(temporaryPath, registryBytes, { encoding: 'utf8', flag: 'wx' });
    parseRegistry(JSON.parse(fs.readFileSync(temporaryPath, 'utf8')) as unknown);
    fs.renameSync(temporaryPath, registryPath);
    published = true;
    return { registrySha256: sha256(registryBytes), operationCount: registry.operations.length };
  } finally {
    removeIfPresent(temporaryPath);
    if (lockOpened) removeIfPresent(lockPath);
    if (!published && !parentExisted) removeEmptyDirectories(parent, contractsRoot);
  }
}

export interface GenerateOptions {
  failRenameAt?: number;
  rename?: (from: string, to: string) => void;
}

interface PublishEntry {
  target: string;
  staged: string;
  backup?: string;
  published: boolean;
}

function publishArtifactSnapshot(repoRoot: string, artifacts: InventoryArtifacts, options: GenerateOptions = {}): void {
  const generatedPath = path.join(repoRoot, GENERATED_DIR);
  const parent = path.dirname(generatedPath);
  fs.mkdirSync(parent, { recursive: true });
  const runId = crypto.randomUUID();
  const stagePath = path.join(parent, '.inventory-stage-' + runId);
  fs.mkdirSync(stagePath, { recursive: false });
  const files: Array<{ name: string; contents: Buffer }> = [
    { name: 'doc-candidates.json', contents: artifacts.docCandidates },
    { name: 'server-routes.json', contents: artifacts.serverRoutes },
    { name: 'platform-calls.json', contents: artifacts.platformCalls },
    { name: 'inventory-summary.json', contents: artifacts.summary },
  ];
  const entries: PublishEntry[] = [];
  let renameCount = 0;
  const rename = (from: string, to: string): void => {
    renameCount += 1;
    if (options.failRenameAt === renameCount) throw new Error('injected rename failure at boundary ' + renameCount);
    if (options.rename) options.rename(from, to);
    else fs.renameSync(from, to);
  };
  try {
    for (const file of files) {
      const staged = path.join(stagePath, file.name);
      fs.writeFileSync(staged, file.contents, { encoding: 'utf8', flag: 'wx' });
      if (file.name !== 'inventory-summary.json') {
        const parser =
          file.name === 'doc-candidates.json'
            ? docCandidatesSchema
            : file.name === 'server-routes.json'
              ? serverRoutesSchema
              : platformCallsSchema;
        parser.parse(JSON.parse(fs.readFileSync(staged, 'utf8')) as unknown);
      } else {
        inventorySummarySchema.parse(JSON.parse(fs.readFileSync(staged, 'utf8')) as unknown);
      }
      entries.push({
        target: path.join(generatedPath, file.name),
        staged,
        published: false,
      });
    }
    fs.mkdirSync(generatedPath, { recursive: true });
    for (const entry of entries) {
      if (fs.existsSync(entry.target)) {
        entry.backup = entry.target + '.backup-' + runId;
        rename(entry.target, entry.backup);
      }
      rename(entry.staged, entry.target);
      entry.published = true;
    }
    for (const entry of entries) {
      if (entry.backup) removeIfPresent(entry.backup);
    }
  } catch (error) {
    for (const entry of [...entries].reverse()) {
      if (entry.published && fs.existsSync(entry.target)) removeIfPresent(entry.target);
      if (entry.backup && fs.existsSync(entry.backup)) fs.renameSync(entry.backup, entry.target);
    }
    throw error;
  } finally {
    removeIfPresent(stagePath);
    for (const entry of entries) {
      if (entry.backup && fs.existsSync(entry.backup)) removeIfPresent(entry.backup);
    }
  }
}

function expectedGeneratedFiles(artifacts: InventoryArtifacts): Array<{ relativePath: string; contents: Buffer }> {
  return [
    { relativePath: GENERATED_DIR + '/doc-candidates.json', contents: artifacts.docCandidates },
    { relativePath: GENERATED_DIR + '/server-routes.json', contents: artifacts.serverRoutes },
    { relativePath: GENERATED_DIR + '/platform-calls.json', contents: artifacts.platformCalls },
    { relativePath: GENERATED_DIR + '/inventory-summary.json', contents: artifacts.summary },
  ];
}

export function generateArtifacts(repoRoot: string, options: GenerateOptions = {}): InventoryArtifacts {
  assertRequiredPackageScripts(repoRoot);
  const artifacts = buildInventoryArtifacts(repoRoot);
  if (fileSha256(repoRoot, REGISTRY_FILE) !== artifacts.registrySha256) {
    throw new Error('Registry changed while inventory was being generated');
  }
  publishArtifactSnapshot(repoRoot, artifacts, options);
  return artifacts;
}

function parseGeneratedArtifacts(repoRoot: string): {
  doc: DocCandidatesArtifact;
  server: ServerRoutesArtifact;
  platform: PlatformCallsArtifact;
  summary: InventorySummary;
} {
  const doc = parseJsonFile(path.join(repoRoot, GENERATED_DIR, 'doc-candidates.json'), docCandidatesSchema);
  const server = parseJsonFile(path.join(repoRoot, GENERATED_DIR, 'server-routes.json'), serverRoutesSchema);
  const platform = parseJsonFile(path.join(repoRoot, GENERATED_DIR, 'platform-calls.json'), platformCallsSchema);
  const summary = parseJsonFile(path.join(repoRoot, GENERATED_DIR, 'inventory-summary.json'), inventorySummarySchema);
  assertArtifactFieldOrder(doc, server, platform, summary);
  return { doc, server, platform, summary };
}

export function checkArtifacts(repoRoot: string): InventoryArtifacts {
  assertRequiredPackageScripts(repoRoot);
  const artifacts = buildInventoryArtifacts(repoRoot);
  const actual = parseGeneratedArtifacts(repoRoot);
  const actualFiles = expectedGeneratedFiles(artifacts);
  for (const expected of actualFiles) {
    const absolutePath = path.join(repoRoot, expected.relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error('generated artifact is missing: ' + expected.relativePath);
    const actualBytes = fs.readFileSync(absolutePath);
    if (!actualBytes.equals(expected.contents))
      throw new Error('generated artifact is not deterministic: ' + expected.relativePath);
  }
  const actualDetailHashes = {
    docCandidates: fileSha256(repoRoot, GENERATED_DIR + '/doc-candidates.json'),
    serverRoutes: fileSha256(repoRoot, GENERATED_DIR + '/server-routes.json'),
    platformCalls: fileSha256(repoRoot, GENERATED_DIR + '/platform-calls.json'),
  };
  if (
    actual.summary.registrySha256 !== fileSha256(repoRoot, REGISTRY_FILE) ||
    actual.summary.artifactSha256.docCandidates !== actualDetailHashes.docCandidates ||
    actual.summary.artifactSha256.serverRoutes !== actualDetailHashes.serverRoutes ||
    actual.summary.artifactSha256.platformCalls !== actualDetailHashes.platformCalls
  ) {
    throw new Error('summary commit marker does not match detail artifacts');
  }
  return artifacts;
}

export function lintRegistry(repoRoot: string): Registry {
  assertRequiredPackageScripts(repoRoot);
  const registry = readRegistry(repoRoot);
  const document = scanDocument(repoRoot);
  if (document.unsupportedSyntax.length > 0) throw new Error('document parser found unsupported syntax');
  assertRegistryMatchesDocument(registry, document);
  if (
    registry.operations.some(
      (operation) =>
        operation.implementationStatus !== 'planned' ||
        operation.operationId !== null ||
        operation.implementationEvidence !== null,
    )
  ) {
    throw new Error('Registry implementation fields must remain planned/null in WP-060');
  }
  return registry;
}

function commandResult(command: string, repoRoot: string): string {
  if (command === 'bootstrap') {
    const acknowledgementIndex = process.argv.indexOf('--acknowledge-new-registry');
    const acknowledgement = acknowledgementIndex >= 0 ? process.argv[acknowledgementIndex + 1] : '';
    const result = bootstrapRegistry(repoRoot, acknowledgement);
    return 'bootstrap ok registrySha256=' + result.registrySha256 + ' operations=' + result.operationCount;
  }
  if (command === 'generate') {
    const result = generateArtifacts(repoRoot);
    return (
      'generate ok registrySha256=' +
      result.registrySha256 +
      ' doc=' +
      sha256(result.docCandidates) +
      ' server=' +
      sha256(result.serverRoutes) +
      ' platform=' +
      sha256(result.platformCalls) +
      ' summary=' +
      sha256(result.summary)
    );
  }
  if (command === 'check') {
    const result = checkArtifacts(repoRoot);
    return 'check ok registrySha256=' + result.registrySha256;
  }
  if (command === 'lint') {
    const registry = lintRegistry(repoRoot);
    return 'lint ok operations=' + registry.operations.length;
  }
  throw new Error('usage: operation-inventory.ts bootstrap|generate|check|lint [--repo-root path]');
}

function runCli(): void {
  const command = process.argv[2];
  const explicitRoot = getPathArgument(process.argv.slice(3));
  const repoRoot = explicitRoot ? findRepoRoot(explicitRoot) : resolveRepoRoot(__dirname);
  if (!command) throw new Error('missing inventory command');
  process.stdout.write(commandResult(command, repoRoot) + '\n');
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write('operation inventory failed: ' + message + '\n');
    process.exitCode = 1;
  }
}
