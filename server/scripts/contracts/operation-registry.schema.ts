import { z } from 'zod';

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type Method = (typeof METHODS)[number];

export const SURFACES = ['public-bff', 'upstream-adapter'] as const;
export type Surface = (typeof SURFACES)[number];

const methodSchema = z.enum(METHODS);
const surfaceSchema = z.enum(SURFACES);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const positiveIntSchema = z.number().int().min(1);
const countSchema = z.number().int().min(0);
const nullableTextSchema = z.string().min(1).nullable();
const featureIdsSchema = z.array(z.string().min(1)).refine((items) => new Set(items).size === items.length);
const previousKeysSchema = z
  .array(z.string().regex(/^(public-bff|upstream-adapter)\|[A-Z]+ \/.+$/))
  .refine((items) => new Set(items).size === items.length);

const canonicalPathSchema = z
  .string()
  .regex(/^\/(?:[A-Za-z0-9._~:@!$&'()*+,;=%{}\-*]+(?:\/[A-Za-z0-9._~:@!$&'()*+,;=%{}\-*]+)*)?$/)
  .refine((value) => !value.includes('?') && !value.includes('\\') && !value.includes('//'))
  .refine((value) => value === '/' || !value.endsWith('/'));

const shapePathSchema = z
  .string()
  .regex(/^\/(?:[A-Za-z0-9._~:@!$&'()*+,;=%\-*{}]+(?:\/[A-Za-z0-9._~:@!$&'()*+,;=%\-*{}]+)*)?$/)
  .refine((value) => !value.includes('?') && !value.includes('\\') && !value.includes('//'))
  .refine((value) => value === '/' || !value.endsWith('/'));

export const registrySourceSchema = z
  .object({
    surface: surfaceSchema,
    file: z.literal('docs/重构文档/02-API接口契约.md'),
    section: z.enum(['2.2-public-bff', '7.1-upstream-adapter']),
    baselineCount: positiveIntSchema,
    semanticSha256: sha256Schema,
    state: z.literal('candidate-inventory-frozen'),
  })
  .strict();

export type RegistrySource = z.infer<typeof registrySourceSchema>;

export const registryOperationSourceSchema = z
  .object({
    file: z.literal('docs/重构文档/02-API接口契约.md'),
    section: z.enum(['2.2-public-bff', '7.1-upstream-adapter']),
    line: positiveIntSchema,
  })
  .strict();

export const registryOperationSchema = z
  .object({
    candidateId: z.string().regex(/^A001-(?:PUB|UP)-[0-9]{4}$/),
    surface: surfaceSchema,
    method: methodSchema,
    path: canonicalPathSchema,
    pathKind: z.enum(['static', 'parameterized']),
    shapePath: shapePathSchema,
    role: z.enum(['admin', 'leader', 'creator', 'public', 'adapter']),
    group: z.string().min(1),
    featureIds: featureIdsSchema,
    source: registryOperationSourceSchema,
    targetDecision: z.enum(['candidate', 'retain', 'remove', 'merge']),
    decisionReason: nullableTextSchema,
    mergedInto: z
      .string()
      .regex(/^A001-(?:PUB|UP)-[0-9]{4}$/)
      .nullable(),
    operationId: z.null(),
    specTestId: z.string().regex(/^A001-SPEC-(?:PUB|UP)-[0-9]{4}$/),
    previousOperationKeys: previousKeysSchema,
    implementationStatus: z.literal('planned'),
    implementationEvidence: z.null(),
    notes: nullableTextSchema,
  })
  .strict();

export type RegistryOperation = z.infer<typeof registryOperationSchema>;

export const registrySchema = z
  .object({
    schemaVersion: z.literal(1),
    registryId: z.literal('A-001'),
    inventoryState: z.literal('candidate-inventory-frozen'),
    sources: z.array(registrySourceSchema).min(1),
    operations: z.array(registryOperationSchema).min(1),
  })
  .strict();

export type Registry = z.infer<typeof registrySchema>;

const sourceLocationSchema = z
  .object({
    file: z.string().min(1),
    line: positiveIntSchema,
    column: positiveIntSchema,
  })
  .strict();

const docSourceLocationSchema = z
  .object({
    file: z.literal('docs/重构文档/02-API接口契约.md'),
    section: z.enum(['2.2-public-bff', '7.1-upstream-adapter']),
    line: positiveIntSchema,
  })
  .strict();

const unsupportedSourceLocationSchema = z
  .object({
    file: z.string().min(1),
    line: positiveIntSchema,
    column: positiveIntSchema,
    kind: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

const unsupportedDocLocationSchema = z
  .object({
    file: z.literal('docs/重构文档/02-API接口契约.md'),
    line: positiveIntSchema,
    kind: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

const docRecordSchema = z
  .object({
    candidateId: z.string().regex(/^A001-(?:PUB|UP)-[0-9]{4}$/),
    surface: surfaceSchema,
    method: methodSchema,
    path: canonicalPathSchema,
    pathKind: z.enum(['static', 'parameterized']),
    shapePath: shapePathSchema,
    role: z.enum(['admin', 'leader', 'creator', 'public', 'adapter']),
    group: z.string().min(1),
    notes: nullableTextSchema,
    source: docSourceLocationSchema,
  })
  .strict();

export const docCandidatesSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatorId: z.literal('A-001-INVENTORY'),
    inputManifestSha256: sha256Schema,
    registrySha256: sha256Schema,
    sources: z.array(registrySourceSchema),
    records: z.array(docRecordSchema),
    unsupportedSyntax: z.array(unsupportedDocLocationSchema),
  })
  .strict();

export type DocCandidatesArtifact = z.infer<typeof docCandidatesSchema>;

const serverRecordSchema = z
  .object({
    method: methodSchema,
    path: canonicalPathSchema,
    pathKind: z.enum(['static', 'parameterized', 'wildcard']),
    shapePath: shapePathSchema,
    operationKey: z.string().regex(/^[A-Z]+ \/.+$/),
    shapeKey: z.string().regex(/^[A-Z]+ \/.+$/),
    receiver: z.string().min(1),
    mount: z.string().min(1),
    source: sourceLocationSchema,
  })
  .strict();

export const serverRoutesSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatorId: z.literal('A-001-INVENTORY'),
    inputManifestSha256: sha256Schema,
    records: z.array(serverRecordSchema),
    unsupportedSyntax: z.array(unsupportedSourceLocationSchema),
  })
  .strict();

export type ServerRoutesArtifact = z.infer<typeof serverRoutesSchema>;
export type ServerRouteRecord = z.infer<typeof serverRecordSchema>;

const platformRecordSchema = z
  .object({
    method: methodSchema,
    path: canonicalPathSchema,
    pathKind: z.enum(['static', 'parameterized']),
    shapePath: shapePathSchema,
    operationKey: z.string().regex(/^[A-Z]+ \/.+$/),
    shapeKey: z.string().regex(/^[A-Z]+ \/.+$/),
    platformSurface: z.enum(['standard-bff', 'alliance']),
    helper: z.string().min(1),
    basePath: z.string().min(1),
    source: sourceLocationSchema,
  })
  .strict();

export const platformCallsSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatorId: z.literal('A-001-INVENTORY'),
    inputManifestSha256: sha256Schema,
    records: z.array(platformRecordSchema),
    unsupportedSyntax: z.array(unsupportedSourceLocationSchema),
  })
  .strict();

export type PlatformCallsArtifact = z.infer<typeof platformCallsSchema>;
export type PlatformCallRecord = z.infer<typeof platformRecordSchema>;

const methodCountsSchema = z
  .object({
    GET: countSchema,
    POST: countSchema,
    PUT: countSchema,
    PATCH: countSchema,
    DELETE: countSchema,
    HEAD: countSchema,
    OPTIONS: countSchema,
  })
  .strict();

const roleCountsSchema = z
  .object({
    admin: countSchema,
    leader: countSchema,
    creator: countSchema,
    public: countSchema,
    adapter: countSchema,
  })
  .strict();

const documentCountsSchema = z
  .object({
    publicBff: countSchema,
    upstreamAdapter: countSchema,
    total: countSchema,
    byRole: roleCountsSchema,
    byMethod: methodCountsSchema,
    byPathKind: z.object({ static: countSchema, parameterized: countSchema }).strict(),
  })
  .strict();

const serverCountsSchema = z
  .object({
    mounts: countSchema,
    callSites: countSchema,
    uniqueOperations: countSchema,
    byMethod: methodCountsSchema,
    byPathKind: z.object({ static: countSchema, parameterized: countSchema, wildcard: countSchema }).strict(),
  })
  .strict();

const platformCountsSchema = z
  .object({
    callSites: countSchema,
    uniqueOperations: countSchema,
    standardBff: countSchema,
    alliance: countSchema,
    byMethod: methodCountsSchema,
    byPathKind: z.object({ static: countSchema, parameterized: countSchema }).strict(),
  })
  .strict();

const apiV1CountsSchema = z
  .object({
    server: countSchema,
    platform: countSchema,
    observedExact: countSchema,
    serverOnly: countSchema,
    platformOnly: countSchema,
  })
  .strict();

const countsSchema = z
  .object({
    registry: z.object({ publicBff: countSchema, upstreamAdapter: countSchema, total: countSchema }).strict(),
    document: documentCountsSchema,
    server: serverCountsSchema,
    platform: platformCountsSchema,
    apiV1: apiV1CountsSchema,
  })
  .strict();

const shapePairSchema = z
  .object({
    leftOperationKey: z.string().regex(/^[A-Z]+ \/.+$/),
    rightOperationKey: z.string().regex(/^[A-Z]+ \/.+$/),
    shapeKey: z.string().regex(/^[A-Z]+ \/.+$/),
  })
  .strict();

const wildcardPairSchema = z
  .object({
    wildcardOperationKey: z.string().regex(/^[A-Z]+ \/.+$/),
    platformOperationKey: z.string().regex(/^[A-Z]+ \/.+$/),
  })
  .strict();

const publicJoinSchema = z
  .object({
    observedExact: z.array(z.string().regex(/^[A-Z]+ \/.+$/)),
    shapeOnlyMatch: z.array(shapePairSchema),
    targetOnly: z.array(z.string().regex(/^[A-Z]+ \/.+$/)),
    serverOnly: z.array(z.string().regex(/^[A-Z]+ \/.+$/)),
  })
  .strict();

const publicPlatformJoinSchema = z
  .object({
    observedExact: z.array(z.string().regex(/^[A-Z]+ \/.+$/)),
    shapeOnlyMatch: z.array(shapePairSchema),
    targetOnly: z.array(z.string().regex(/^[A-Z]+ \/.+$/)),
    platformOnly: z.array(z.string().regex(/^[A-Z]+ \/.+$/)),
  })
  .strict();

const upstreamJoinSchema = z
  .object({
    observedExact: z.array(z.string().regex(/^[A-Z]+ \/.+$/)),
    shapeOnlyMatch: z.array(shapePairSchema),
    upstreamOnly: z.array(z.string().regex(/^[A-Z]+ \/.+$/)),
    platformOnly: z.array(z.string().regex(/^[A-Z]+ \/.+$/)),
  })
  .strict();

const wildcardJoinSchema = z
  .object({
    transportCoveredByWildcard: z.array(wildcardPairSchema),
  })
  .strict();

const joinsSchema = z
  .object({
    publicTargetServer: publicJoinSchema,
    publicTargetPlatform: publicPlatformJoinSchema,
    publicTargetServerPlatform: z.object({ observedExact: z.array(z.string().regex(/^[A-Z]+ \/.+$/)) }).strict(),
    upstreamPlatformAdapter: upstreamJoinSchema,
    serverWildcardCoverage: wildcardJoinSchema,
  })
  .strict();

const artifactShaSchema = z
  .object({
    docCandidates: sha256Schema,
    serverRoutes: sha256Schema,
    platformCalls: sha256Schema,
  })
  .strict();

const unsupportedCountsSchema = z
  .object({
    doc: countSchema,
    server: countSchema,
    platform: countSchema,
  })
  .strict();

export const inventorySummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    generatorId: z.literal('A-001-INVENTORY'),
    inputManifestSha256: sha256Schema,
    registrySha256: sha256Schema,
    artifactSha256: artifactShaSchema,
    declaredImplementedCount: z.literal(0),
    derivedImplementedCount: z.literal(0),
    counts: countsSchema,
    joins: joinsSchema,
    unsupportedSyntaxCounts: unsupportedCountsSchema,
  })
  .strict();

export type InventorySummary = z.infer<typeof inventorySummarySchema>;

function addIssue(issues: string[], message: string): void {
  issues.push(message);
}

function expectedShape(path: string): string {
  return path.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '{}');
}

export function parseRegistry(input: unknown): Registry {
  const registry = registrySchema.parse(input);
  const issues: string[] = [];
  const sourceByKey = new Map<string, RegistrySource>();
  const candidateIds = new Set<string>();
  const specTestIds = new Set<string>();
  const currentKeys = new Set<string>();
  const previousKeys = new Set<string>();
  const operationById = new Map<string, RegistryOperation>();

  for (const source of registry.sources) {
    const key = source.surface;
    if (sourceByKey.has(key)) addIssue(issues, 'duplicate registry source: ' + key);
    sourceByKey.set(key, source);
    const expectedCount = source.surface === 'public-bff' ? 169 : 7;
    if (source.file !== 'docs/重构文档/02-API接口契约.md' || source.baselineCount !== expectedCount) {
      addIssue(issues, 'invalid source baseline: ' + key);
    }
    if (
      (source.surface === 'public-bff' && source.section !== '2.2-public-bff') ||
      (source.surface === 'upstream-adapter' && source.section !== '7.1-upstream-adapter')
    ) {
      addIssue(issues, 'source section does not match surface: ' + key);
    }
  }
  if (sourceByKey.size !== 2 || !sourceByKey.has('public-bff') || !sourceByKey.has('upstream-adapter')) {
    addIssue(issues, 'registry must contain exactly one public-bff and one upstream-adapter source');
  }

  for (const operation of registry.operations) {
    const idSuffix = operation.candidateId.slice(-4);
    const idPrefix = operation.surface === 'public-bff' ? 'A001-PUB-' : 'A001-UP-';
    const testPrefix = operation.surface === 'public-bff' ? 'A001-SPEC-PUB-' : 'A001-SPEC-UP-';
    if (operation.candidateId !== idPrefix + idSuffix)
      addIssue(issues, 'candidateId surface mismatch: ' + operation.candidateId);
    if (operation.specTestId !== testPrefix + idSuffix)
      addIssue(issues, 'specTestId mismatch: ' + operation.candidateId);
    if (candidateIds.has(operation.candidateId)) addIssue(issues, 'duplicate candidateId: ' + operation.candidateId);
    if (specTestIds.has(operation.specTestId)) addIssue(issues, 'duplicate specTestId: ' + operation.specTestId);
    candidateIds.add(operation.candidateId);
    specTestIds.add(operation.specTestId);
    operationById.set(operation.candidateId, operation);

    const expectedSection = operation.surface === 'public-bff' ? '2.2-public-bff' : '7.1-upstream-adapter';
    if (operation.source.section !== expectedSection) {
      addIssue(issues, 'operation source mismatch: ' + operation.candidateId);
    }
    if (operation.surface === 'upstream-adapter' && operation.role !== 'adapter') {
      addIssue(issues, 'upstream operation must use adapter role: ' + operation.candidateId);
    }
    if (operation.surface === 'public-bff' && operation.role === 'adapter') {
      addIssue(issues, 'public operation cannot use adapter role: ' + operation.candidateId);
    }
    if (operation.pathKind !== (operation.path.includes('{') ? 'parameterized' : 'static')) {
      addIssue(issues, 'pathKind mismatch: ' + operation.candidateId);
    }
    if (operation.shapePath !== expectedShape(operation.path)) {
      addIssue(issues, 'shapePath mismatch: ' + operation.candidateId);
    }
    if (
      operation.targetDecision === 'candidate' &&
      (operation.decisionReason !== null || operation.mergedInto !== null)
    ) {
      addIssue(issues, 'candidate decision must not have reason or mergedInto: ' + operation.candidateId);
    }
    if (
      (operation.targetDecision === 'retain' || operation.targetDecision === 'remove') &&
      (!operation.decisionReason || operation.mergedInto !== null)
    ) {
      addIssue(issues, 'retain/remove decision matrix violation: ' + operation.candidateId);
    }
    if (operation.targetDecision === 'merge' && (!operation.decisionReason || operation.mergedInto === null)) {
      addIssue(issues, 'merge decision matrix violation: ' + operation.candidateId);
    }
    if (operation.targetDecision === 'merge' && operation.mergedInto === operation.candidateId) {
      addIssue(issues, 'merge self-reference: ' + operation.candidateId);
    }
    if (
      operation.implementationStatus !== 'planned' ||
      operation.operationId !== null ||
      operation.implementationEvidence !== null
    ) {
      addIssue(issues, 'implementation fields are not frozen initial values: ' + operation.candidateId);
    }
    const currentKey = operation.surface + '|' + operation.method + ' ' + operation.path;
    if (currentKeys.has(currentKey)) addIssue(issues, 'duplicate current operation key: ' + currentKey);
    currentKeys.add(currentKey);
    for (const previousKey of operation.previousOperationKeys) {
      if (previousKeys.has(previousKey)) addIssue(issues, 'duplicate previous operation key: ' + previousKey);
      previousKeys.add(previousKey);
    }
  }
  for (const previousKey of previousKeys) {
    if (currentKeys.has(previousKey))
      addIssue(issues, 'previous operation key conflicts with current key: ' + previousKey);
  }

  if (registry.operations.length !== 176) addIssue(issues, 'registry operation count must be 176');
  if (registry.operations.filter((item) => item.surface === 'public-bff').length !== 169) {
    addIssue(issues, 'public-bff operation count must be 169');
  }
  if (registry.operations.filter((item) => item.surface === 'upstream-adapter').length !== 7) {
    addIssue(issues, 'upstream-adapter operation count must be 7');
  }
  for (const operation of registry.operations) {
    if (operation.targetDecision !== 'merge') continue;
    const target = operation.mergedInto ? operationById.get(operation.mergedInto) : undefined;
    if (
      !target ||
      target.surface !== operation.surface ||
      (target.targetDecision !== 'candidate' && target.targetDecision !== 'retain')
    ) {
      addIssue(issues, 'invalid merge target: ' + operation.candidateId);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      addIssue(issues, 'merge cycle detected at: ' + id);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const operation = operationById.get(id);
    if (operation?.targetDecision === 'merge' && operation.mergedInto) visit(operation.mergedInto);
    visiting.delete(id);
    visited.add(id);
  };
  for (const operation of registry.operations) visit(operation.candidateId);

  if (issues.length > 0) throw new Error('Registry validation failed:\n- ' + issues.join('\n- '));
  return registry;
}

export function assertFixedObjectKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(label + ' field order mismatch: expected ' + expected.join(',') + ', got ' + actual.join(','));
  }
}

export const REGISTRY_KEYS = ['schemaVersion', 'registryId', 'inventoryState', 'sources', 'operations'] as const;

export const REGISTRY_OPERATION_KEYS = [
  'candidateId',
  'surface',
  'method',
  'path',
  'pathKind',
  'shapePath',
  'role',
  'group',
  'featureIds',
  'source',
  'targetDecision',
  'decisionReason',
  'mergedInto',
  'operationId',
  'specTestId',
  'previousOperationKeys',
  'implementationStatus',
  'implementationEvidence',
  'notes',
] as const;

export const REGISTRY_SOURCE_KEYS = ['surface', 'file', 'section', 'baselineCount', 'semanticSha256', 'state'] as const;
