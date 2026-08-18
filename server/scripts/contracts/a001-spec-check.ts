import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { scanDocument } from './operation-inventory';

type MissingField =
  | 'path'
  | 'query'
  | 'header'
  | 'body'
  | 'success'
  | 'errors'
  | 'security'
  | 'scope'
  | 'idempotency'
  | 'audit'
  | 'mockFixture';

type Operation = {
  candidateId: string;
  surface: 'public-bff' | 'upstream-adapter';
  method: string;
  path: string;
  role: string;
  group: string;
  specTestId: string;
  implementationStatus: string;
  implementationEvidence: unknown;
  source: { file: string; section: string; line: number };
};
type EvidenceRef = { file: string; sectionOrSymbol: string; line: number; fields: MissingField[] };
type FieldState = 'complete' | 'partial' | 'missing' | 'explicit-none';
type AuditedOperation = Operation & {
  operationId: string;
  retentionState: 'retained';
  freezeState: 'evidence-complete' | 'retained-unfrozen';
  fieldStates: Record<MissingField, FieldState>;
  specState: 'evidence-complete' | 'missing-evidence';
  evidenceRefs: EvidenceRef[];
  missingFields: MissingField[];
  policyAssignment: {
    policyId: 'A-001-CROSSCUT-TECHNICAL';
    policyVersion: '2026-08-18.r1';
    pendingBusinessCoverage: MissingField[];
  };
};

const root = path.resolve(__dirname, '..', '..', '..');
const candidateFile = path.join(root, 'contracts/operations/operation-registry.json');
const specFile = path.join(root, 'contracts/operations/a001-spec-registry.json');
const sharedSchemaFile = path.join(root, 'contracts/openapi/schemas/shared-target-schemas.json');
const policyFile = path.join(root, 'contracts/openapi/policies/a001-crosscut-policies.json');
const documentationFile = path.join(root, 'docs/重构文档/02-API接口契约.md');
const publicHash = '78a1983a0c6e0d1ce9081544d4412de0aadf651a731d9f992f6c93f601c5e87f';
const upstreamHash = 'b38c2d7a151b312813fbfa8f2220c56322071a0294cf38cf962973b2e569a061';
const candidateHash = '2544b308c36dca5b50afe2cc042eebbb270fffbef8fe91cec99d7119e7999e1e';
const missingFieldOrder: MissingField[] = [
  'path',
  'query',
  'header',
  'body',
  'success',
  'errors',
  'security',
  'scope',
  'idempotency',
  'audit',
  'mockFixture',
];
const evidenceSourceAllowlist = [
  'docs/重构文档/02-API接口契约.md',
  'server/src/zhihu/allianceContracts.ts',
  'server/src/zhihu/allianceEndpointRegistry.ts',
  'server/src/zhihu/allianceAudit.ts',
  'server/src/zhihu/allianceQuota.ts',
  'server/tests/support/allianceQuotaFixture.ts',
  'server/tests/support/allianceAuditFixture.ts',
];

const positiveInteger = z.number().int().positive();
const finiteTimestamp = z.number().int().nonnegative().finite();
const requestId = z.string().min(1);

export const paginationMetaSchema = z
  .object({
    page: positiveInteger,
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const apiEnvelopeSchema = z
  .object({
    code: z.literal(0),
    message: z.string(),
    data: z.unknown(),
    requestId,
    timestamp: finiteTimestamp,
  })
  .strict();

export const pageResponseSchema = apiEnvelopeSchema
  .extend({
    data: z.array(z.unknown()),
    meta: paginationMetaSchema,
  })
  .strict();

export const errorResponseSchema = z
  .object({
    code: z
      .number()
      .int()
      .refine((value) => value !== 0),
    message: z.string(),
    details: z.record(z.array(z.string())).optional(),
    requestId,
    timestamp: finiteTimestamp,
  })
  .strict();

export const financeFailedGateSchema = z.enum(['D-001-DECISION', 'D-001-READINESS', 'P0-008', 'M6']);
export const financeGateRejectedErrorResponseSchema = errorResponseSchema
  .extend({
    code: z.literal(50310),
    failedGates: z
      .array(financeFailedGateSchema)
      .min(1)
      .superRefine((gates, context) => {
        const order = financeFailedGateSchema.options;
        if (new Set(gates).size !== gates.length)
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'failedGates must be unique' });
        if (gates.some((gate, index) => index > 0 && order.indexOf(gates[index - 1]) >= order.indexOf(gate)))
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'failedGates must be ordered' });
      }),
  })
  .strict();

export const globalRoleSchema = z.enum(['admin', 'leader', 'creator']);
export const projectMemberRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export const httpMethodSchema = z.enum(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE', 'OTHER']);
export const authorizationHeaderSchema = z.string().regex(/^Bearer\s+\S+$/u);
export const idempotencyKeySchema = z.string().min(1);
export const refreshCookieSchema = z
  .object({
    name: z.literal('refreshToken'),
    secure: z.literal(true),
    httpOnly: z.literal(true),
    sameSite: z.literal('Lax'),
    path: z.literal('/api/v1/auth'),
  })
  .strict();
export const errorBaselineStageSchema = z.enum([
  'parser',
  'auth',
  'scope',
  'permission',
  'quota',
  'upstream',
  'internal',
]);
const sensitiveAuditKey =
  /token|cookie|authorization|signature|secret|password|raw.?body|file.?content|upstream.?response|id.?card|bank.?account/iu;

function hasSensitiveAuditKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSensitiveAuditKey);
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(([key, child]) => sensitiveAuditKey.test(key) || hasSensitiveAuditKey(child));
}

export const auditEventSchema = z
  .object({
    eventId: z.string().min(1),
    schemaVersion: z.literal(1),
    requestId,
    timestamp: finiteTimestamp,
    actor: z.object({ kind: z.enum(['user', 'system', 'service']), id: z.string().min(1) }).strict(),
    projectId: z.string().min(1).nullable(),
    operationId: z.string().min(1),
    method: httpMethodSchema,
    resource: z.object({ type: z.string().min(1), id: z.string().min(1).nullable() }).strict(),
    outcome: z.enum(['success', 'rejected', 'failed']),
    stage: errorBaselineStageSchema,
    httpStatus: z.number().int().min(100).max(599),
    code: z.number().int(),
    metadata: z.record(z.unknown()),
    retentionClass: z.string().min(1),
  })
  .strict()
  .superRefine((event, context) => {
    if (hasSensitiveAuditKey(event.metadata))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'audit metadata contains sensitive key' });
  });

export const mockFixtureSchema = z
  .object({
    fixtureId: z.string().min(1),
    operationId: z.string().min(1),
    specTestId: z.string().min(1),
    actor: z.object({ kind: z.enum(['user', 'system', 'service']), id: z.string().min(1) }).strict(),
    projectId: z.string().min(1).nullable(),
    clock: finiteTimestamp,
    request: z.object({ method: httpMethodSchema, headers: z.record(z.string()), body: z.unknown() }).strict(),
    response: z.object({ status: z.number().int().min(100).max(599), body: z.unknown() }).strict(),
    expectedSideEffects: z.array(z.string()),
    expectedAudit: auditEventSchema,
    redactionAssertions: z.array(z.string().min(1)).min(1),
  })
  .strict();

const policyId = 'A-001-CROSSCUT-TECHNICAL' as const;
const policyVersion = '2026-08-18.r1' as const;

function crosscutPolicyArtifact(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    policyId,
    policyVersion,
    state: 'target-reusable/not-operation-bound',
    envelope: {
      bffJson: {
        success: ['code', 'message', 'data', 'requestId', 'timestamp'],
        listMeta: ['page', 'pageSize', 'total'],
        error: ['code', 'message', 'details?', 'requestId', 'timestamp'],
      },
      exceptionsRequireOperationDeclaration: ['health', 'binary'],
    },
    authentication: {
      accessToken: { scheme: 'Bearer', header: 'Authorization' },
      refreshCookie: { secure: true, httpOnly: true, sameSite: 'Lax', path: '/api/v1/auth' },
      globalRoles: [...globalRoleSchema.options],
      projectMemberRoles: [...projectMemberRoleSchema.options],
    },
    projectScope: {
      source: ['authenticatedSubject', 'project_members'],
      clientValuesDoNotGrantAuthority: ['X-Project-Id', 'tokenClaim', 'role'],
      pathAndHeaderProjectMustMatch: true,
      verifiedProjectIdPropagatesTo: ['sql', 'cache', 'queue', 'export'],
    },
    pagination: {
      defaults: { page: 1, pageSize: 20 },
      limits: { page: [1, 100], pageSize: [1, 100] },
      sortOrder: ['asc', 'desc'],
      sortBy: 'operation-allowlist-only',
      stableTieBreaker: 'id',
      emptyPage: { httpStatus: 200, data: [], metaTotalRequired: true },
    },
    idempotency: {
      safeMethods: ['GET', 'HEAD', 'OPTIONS'],
      idempotentMethods: ['PUT', 'DELETE'],
      retryableMutationMethods: ['POST', 'PATCH'],
      requiredHeader: 'Idempotency-Key',
      keyScope: ['projectOrTenant', 'actor', 'operationId', 'targetResource'],
      canonicalRequestHash: {
        algorithm: 'SHA-256',
        encoding: 'UTF-8',
        excludesHeaders: ['Idempotency-Key'],
        applicationJson: {
          canonicalization: 'recursive-lexicographic-object-keys',
          arrayOrder: 'preserved',
          contentType: 'application/json',
        },
        multipartFormData: {
          canonicalization: 'lexicographic-field-name-and-file-part-order',
          fileDigest: 'SHA-256',
          contentType: 'multipart/form-data',
        },
      },
      replay: {
        sameKeySameHash: 'return-original-status-body-requestId-timestamp',
        sameKeyDifferentHash: { code: 40910, zeroSideEffect: true },
      },
      versionConflict: { code: 40920, name: 'VERSION_CONFLICT' },
      retention: { nonFinanceMinimumHours: 24, financePurge: 'prohibited-until-business-retention-decision' },
    },
    errorBaseline: {
      stages: [...errorBaselineStageSchema.options],
      unknownException: { code: 50000, upstreamBodyOrStack: 'never-transmit' },
      explicitNone: 'only-operation-specific-error-not-global-baseline',
      financeGate: { code: 50310, failedGates: [...financeFailedGateSchema.options] },
    },
    audit: {
      schemaVersion: 1,
      actorKinds: ['user', 'system', 'service'],
      methodEnum: [...httpMethodSchema.options],
      exactlyOnceKey: ['requestId', 'eventKind'],
      appendOnly: true,
      sensitiveKeyMatching: 'recursive-case-insensitive',
      prohibitedKeys: [
        'token',
        'cookie',
        'authorization',
        'signature',
        'secret',
        'password',
        'rawBody',
        'fileContent',
        'upstreamRawResponse',
        'idCard',
        'bankAccount',
      ],
      purge: 'prohibited-until-retention-and-legal-hold-decision',
    },
    sharedFixture: {
      required: [
        'fixtureId',
        'operationId',
        'specTestId',
        'actor',
        'projectId',
        'clock',
        'request',
        'response',
        'expectedSideEffects',
        'expectedAudit',
        'redactionAssertions',
      ],
      syntheticOnly: true,
      conformanceBoundary: 'planned-static-only; real-route-evidence-is-A-001-CONFORMANCE',
    },
    operationPolicyAssignment: {
      onlyReferenceAndPendingBusinessCoverage: true,
      cannotChangeFieldStatesOrMissingFields: true,
    },
  };
}

function sharedTargetSchemasArtifact(): Record<string, unknown> {
  const strictObject = (properties: Record<string, unknown>, required: string[]) => ({
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  });
  const stringSchema = { type: 'string' };
  const requestIdSchema = { type: 'string', minLength: 1 };
  const timestampSchema = { type: 'integer', minimum: 0 };
  const pagination = strictObject(
    {
      page: { type: 'integer', minimum: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      total: { type: 'integer', minimum: 0 },
    },
    ['page', 'pageSize', 'total'],
  );
  const error = strictObject(
    {
      code: { type: 'integer', not: { const: 0 } },
      message: stringSchema,
      details: { type: 'object', additionalProperties: { type: 'array', items: stringSchema } },
      requestId: requestIdSchema,
      timestamp: timestampSchema,
    },
    ['code', 'message', 'requestId', 'timestamp'],
  );
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://zhihu.local/contracts/a001/shared-target-schemas.json',
    title: 'A-001 reusable target schemas',
    'x-a001-state': 'target-reusable/not-operation-bound',
    $defs: {
      ApiEnvelope: strictObject(
        { code: { const: 0 }, message: stringSchema, data: {}, requestId: requestIdSchema, timestamp: timestampSchema },
        ['code', 'message', 'data', 'requestId', 'timestamp'],
      ),
      PaginationMeta: pagination,
      PageResponse: strictObject(
        {
          code: { const: 0 },
          message: stringSchema,
          data: { type: 'array' },
          meta: { $ref: '#/$defs/PaginationMeta' },
          requestId: requestIdSchema,
          timestamp: timestampSchema,
        },
        ['code', 'message', 'data', 'meta', 'requestId', 'timestamp'],
      ),
      ErrorResponse: error,
      FinanceGateRejectedErrorResponse: strictObject(
        {
          code: { const: 50310 },
          message: stringSchema,
          details: { type: 'object', additionalProperties: { type: 'array', items: stringSchema } },
          requestId: requestIdSchema,
          timestamp: timestampSchema,
          failedGates: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { enum: [...financeFailedGateSchema.options] },
            'x-a001-order': [...financeFailedGateSchema.options],
          },
        },
        ['code', 'message', 'requestId', 'timestamp', 'failedGates'],
      ),
      GlobalRole: { type: 'string', enum: [...globalRoleSchema.options] },
      ProjectMemberRole: { type: 'string', enum: [...projectMemberRoleSchema.options] },
      AuthorizationHeader: { type: 'string', pattern: '^Bearer\\s+\\S+$' },
      RefreshCookieAttributes: strictObject(
        {
          name: { const: 'refreshToken' },
          secure: { const: true },
          httpOnly: { const: true },
          sameSite: { const: 'Lax' },
          path: { const: '/api/v1/auth' },
        },
        ['name', 'secure', 'httpOnly', 'sameSite', 'path'],
      ),
      IdempotencyKey: { type: 'string', minLength: 1 },
      ErrorBaselineStage: { type: 'string', enum: [...errorBaselineStageSchema.options] },
      AuditEvent: strictObject(
        {
          eventId: { type: 'string', minLength: 1 },
          schemaVersion: { const: 1 },
          requestId: requestIdSchema,
          timestamp: timestampSchema,
          actor: strictObject({ kind: { enum: ['user', 'system', 'service'] }, id: { type: 'string', minLength: 1 } }, [
            'kind',
            'id',
          ]),
          projectId: { type: ['string', 'null'], minLength: 1 },
          operationId: { type: 'string', minLength: 1 },
          method: { enum: [...httpMethodSchema.options] },
          resource: strictObject(
            { type: { type: 'string', minLength: 1 }, id: { type: ['string', 'null'], minLength: 1 } },
            ['type', 'id'],
          ),
          outcome: { enum: ['success', 'rejected', 'failed'] },
          stage: { $ref: '#/$defs/ErrorBaselineStage' },
          httpStatus: { type: 'integer', minimum: 100, maximum: 599 },
          code: { type: 'integer' },
          metadata: { type: 'object' },
          retentionClass: { type: 'string', minLength: 1 },
        },
        [
          'eventId',
          'schemaVersion',
          'requestId',
          'timestamp',
          'actor',
          'projectId',
          'operationId',
          'method',
          'resource',
          'outcome',
          'stage',
          'httpStatus',
          'code',
          'metadata',
          'retentionClass',
        ],
      ),
      SharedMockFixture: strictObject(
        {
          fixtureId: { type: 'string', minLength: 1 },
          operationId: { type: 'string', minLength: 1 },
          specTestId: { type: 'string', minLength: 1 },
          actor: { $ref: '#/$defs/AuditEvent/properties/actor' },
          projectId: { type: ['string', 'null'], minLength: 1 },
          clock: timestampSchema,
          request: strictObject(
            {
              method: { enum: [...httpMethodSchema.options] },
              headers: { type: 'object', additionalProperties: stringSchema },
              body: {},
            },
            ['method', 'headers', 'body'],
          ),
          response: strictObject({ status: { type: 'integer', minimum: 100, maximum: 599 }, body: {} }, [
            'status',
            'body',
          ]),
          expectedSideEffects: { type: 'array', items: stringSchema },
          expectedAudit: { $ref: '#/$defs/AuditEvent' },
          redactionAssertions: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
        },
        [
          'fixtureId',
          'operationId',
          'specTestId',
          'actor',
          'projectId',
          'clock',
          'request',
          'response',
          'expectedSideEffects',
          'expectedAudit',
          'redactionAssertions',
        ],
      ),
    },
    $comment: 'All definitions are target-reusable and not operation-bound.',
  };
}

export function validateSharedTargetSchemasArtifact(input: unknown): void {
  if (
    canonicalJsonForFile(input, sharedSchemaFile) !==
    canonicalJsonForFile(sharedTargetSchemasArtifact(), sharedSchemaFile)
  )
    throw new Error('A001-SPEC-DRIFT-001: shared target schema artifact');
}

export function validateReusableTargetSchemas(): void {
  apiEnvelopeSchema.parse({ code: 0, message: 'ok', data: {}, requestId: 'r-1', timestamp: 0 });
  pageResponseSchema.parse({
    code: 0,
    message: 'ok',
    data: [],
    meta: { page: 1, pageSize: 20, total: 0 },
    requestId: 'r-1',
    timestamp: 0,
  });
  financeGateRejectedErrorResponseSchema.parse({
    code: 50310,
    message: 'blocked',
    requestId: 'r-1',
    timestamp: 0,
    failedGates: ['D-001-DECISION', 'M6'],
  });
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function canonicalJsonForFile(value: unknown, filepath: string): string {
  const prettierCli = path.join(root, 'server/node_modules/prettier/bin/prettier.cjs');
  return execFileSync(process.execPath, [prettierCli, '--parser', 'json', '--stdin-filepath', filepath], {
    input: JSON.stringify(value, null, 2),
    encoding: 'utf8',
  });
}

export function validateCrosscutPolicyArtifact(input: unknown): void {
  if (canonicalJsonForFile(input, policyFile) !== canonicalJsonForFile(crosscutPolicyArtifact(), policyFile))
    throw new Error('A001-SPEC-DRIFT-001: crosscut policy artifact');
}

function ensureCrosscutPolicyArtifact(): {
  policyId: typeof policyId;
  policyVersion: typeof policyVersion;
  sha256: string;
} {
  const expected = canonicalJsonForFile(crosscutPolicyArtifact(), policyFile);
  if (fs.existsSync(policyFile)) {
    if (fs.readFileSync(policyFile, 'utf8') !== expected)
      throw new Error('A001-SPEC-DRIFT-001: crosscut policy artifact');
  } else {
    fs.mkdirSync(path.dirname(policyFile), { recursive: true });
    fs.writeFileSync(policyFile, expected);
  }
  return { policyId, policyVersion, sha256: sha256File(policyFile) };
}

function validatePolicyReference(input: unknown): void {
  if (typeof input !== 'object' || input === null) throw new Error('A001-SPEC-POLICY-001: missing policy reference');
  const reference = input as Record<string, unknown>;
  const expected = ensureCrosscutPolicyArtifact();
  if (
    reference.policyId !== expected.policyId ||
    reference.policyVersion !== expected.policyVersion ||
    reference.sha256 !== expected.sha256
  )
    throw new Error('A001-SPEC-DRIFT-001: crosscut policy reference');
}

function operationId(operation: Operation): string {
  return `a001_${operation.surface === 'public-bff' ? 'pub' : 'up'}_${operation.candidateId.slice(-4)}`;
}

function normalizePath(value: string): string {
  return value.replace(/:[A-Za-z_][A-Za-z0-9_]*/gu, '{}').replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/gu, '{}');
}

function sectionForLine(lines: string[], index: number): string {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const heading = /^#{2,4}\s+(.+)$/u.exec(lines[cursor]);
    if (heading) return heading[1];
  }
  return 'unsectioned';
}

function endpointBoundary(lines: string[], start: number): string[] {
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,4}\s+/u.test(lines[index]) || /\*\*接口\*\*/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end);
}

function explicitFields(lines: string[], start: number): MissingField[] {
  const window = endpointBoundary(lines, start).join('\n');
  const fields: MissingField[] = ['path'];
  if (/查询参数|query 参数/iu.test(window)) fields.push('query');
  if (/请求头|header|X-Project-Id|Idempotency-Key/iu.test(window)) fields.push('header');
  if (/请求体/u.test(window)) fields.push('body');
  if (/响应体|响应示例/iu.test(window)) fields.push('success');
  if (/错误码|错误响应|\b4\d\d\b|\b5\d\d\b/u.test(window)) fields.push('errors');
  if (/权限|认证|JWT|Bearer/iu.test(window)) fields.push('security');
  if (/project_id|projectId|scope/iu.test(window)) fields.push('scope');
  if (/幂等|Idempotency-Key/iu.test(window)) fields.push('idempotency');
  if (/审计/iu.test(window)) fields.push('audit');
  if (/Mock|fixture|样例/iu.test(window)) fields.push('mockFixture');
  return [...new Set(fields)];
}

export function markerOperationKey(line: string): { method: string; path: string } | null {
  const marker = /\*\*接口\*\*：\s*`?(GET|POST|PUT|PATCH|DELETE)\s+([^`\s]+)/u.exec(line);
  return marker ? { method: marker[1], path: normalizePath(marker[2]) } : null;
}

export function matchesEndpointMarker(operation: Pick<Operation, 'method' | 'path'>, line: string): boolean {
  const marker = markerOperationKey(line);
  return marker !== null && marker.method === operation.method && marker.path === normalizePath(operation.path);
}

function upstreamEvidence(operation: Operation): EvidenceRef[] {
  if (operation.surface !== 'upstream-adapter') return [];
  const key = `${operation.method} ${normalizePath(operation.path)}`;
  const contractLine =
    key === 'POST /popularize_plan'
      ? 495
      : key === 'POST /popularize_plans'
        ? 504
        : key === 'POST /popularize_composition/v2'
          ? 513
          : key === 'POST /popularize_compositions/v2'
            ? 523
            : key.includes('popularize_composition/v2/{}')
              ? 533
              : key === 'GET /popularize_compositions'
                ? 546
                : 556;
  const fields: MissingField[] = ['path', operation.method === 'GET' ? 'query' : 'body'];
  return [
    {
      file: 'server/src/zhihu/allianceContracts.ts',
      sectionOrSymbol: `ALLIANCE_OPERATION_CONTRACTS[${key}]`,
      line: contractLine,
      fields,
    },
  ];
}

function auditOperation(operation: Operation, lines: string[]): AuditedOperation {
  const evidenceRefs: EvidenceRef[] = upstreamEvidence(operation);
  lines.forEach((line, index) => {
    if (!matchesEndpointMarker(operation, line)) return;
    const fields = explicitFields(lines, index);
    if (fields.length > 1)
      evidenceRefs.push({
        file: 'docs/重构文档/02-API接口契约.md',
        sectionOrSymbol: sectionForLine(lines, index),
        line: index + 1,
        fields,
      });
  });
  const observed = new Set(evidenceRefs.flatMap((reference) => reference.fields));
  const fieldStates = Object.fromEntries(
    missingFieldOrder.map((field) => [field, observed.has(field) ? 'partial' : 'missing']),
  ) as Record<MissingField, FieldState>;
  return {
    ...operation,
    operationId: operationId(operation),
    retentionState: 'retained',
    freezeState: 'retained-unfrozen',
    fieldStates,
    specState: 'missing-evidence',
    evidenceRefs,
    missingFields: [...missingFieldOrder],
    policyAssignment: {
      policyId,
      policyVersion,
      pendingBusinessCoverage: [...missingFieldOrder],
    },
  };
}

function sourceProjection(): {
  publicBff: { count: number; semanticSha256: string };
  upstreamAdapter: { count: number; semanticSha256: string };
} {
  const sources = scanDocument(root).sources;
  const publicBff = sources.find((source) => source.surface === 'public-bff');
  const upstreamAdapter = sources.find((source) => source.surface === 'upstream-adapter');
  if (!publicBff || !upstreamAdapter) throw new Error('A001-SPEC-DRIFT-001: source projection missing');
  if (
    publicBff.baselineCount !== 169 ||
    publicBff.semanticSha256 !== publicHash ||
    upstreamAdapter.baselineCount !== 7 ||
    upstreamAdapter.semanticSha256 !== upstreamHash
  )
    throw new Error('A001-SPEC-DRIFT-001: frozen semantic projection');
  return {
    publicBff: { count: publicBff.baselineCount, semanticSha256: publicBff.semanticSha256 },
    upstreamAdapter: { count: upstreamAdapter.baselineCount, semanticSha256: upstreamAdapter.semanticSha256 },
  };
}

export function generate(): void {
  const crosscutPolicy = ensureCrosscutPolicyArtifact();
  const candidate = readJson<{ operations: Operation[] }>(candidateFile);
  if (candidate.operations.length !== 176) throw new Error('A001-SPEC-COUNT-001: expected 176 candidates');
  const lines = fs.readFileSync(documentationFile, 'utf8').split(/\r?\n/u);
  const operations = candidate.operations.map((operation) => {
    if (operation.implementationStatus !== 'planned' || operation.implementationEvidence !== null)
      throw new Error(`A001-SPEC-ID-001: unexpected implementation state ${operation.candidateId}`);
    return auditOperation(operation, lines);
  });
  const registry = {
    schemaVersion: 3,
    registryId: 'A-001-SPEC-EVIDENCE-AUDIT',
    version: '2026-08-18.m0-evidence-audit',
    state: 'not-publishable',
    candidateRegistrySha256: sha256File(candidateFile),
    crosscutPolicy,
    sourceProjection: { algorithm: 'WP-060 scanDocument semanticProjection stableJson', ...sourceProjection() },
    evidenceSourceAllowlist,
    missingFieldOrder,
    operations,
  };
  fs.writeFileSync(specFile, canonicalJsonForFile(registry, specFile));
  fs.mkdirSync(path.dirname(sharedSchemaFile), { recursive: true });
  fs.writeFileSync(sharedSchemaFile, canonicalJsonForFile(sharedTargetSchemasArtifact(), sharedSchemaFile));
}

export function auditSummary(): { count: number; complete: number; incomplete: number; candidateIds: string[] } {
  const spec = readJson<{ operations: AuditedOperation[]; crosscutPolicy: unknown }>(specFile);
  validateCrosscutPolicyArtifact(readJson(policyFile));
  validatePolicyReference(spec.crosscutPolicy);
  const incomplete = spec.operations.filter((operation) => operation.specState === 'missing-evidence');
  return {
    count: spec.operations.length,
    complete: spec.operations.length - incomplete.length,
    incomplete: incomplete.length,
    candidateIds: incomplete.map((operation) => operation.candidateId),
  };
}

export function expectedRegistry(): unknown {
  const crosscutPolicy = ensureCrosscutPolicyArtifact();
  const candidate = readJson<{ operations: Operation[] }>(candidateFile);
  const lines = fs.readFileSync(documentationFile, 'utf8').split(/\r?\n/u);
  const operations = candidate.operations.map((operation) => auditOperation(operation, lines));
  return {
    schemaVersion: 3,
    registryId: 'A-001-SPEC-EVIDENCE-AUDIT',
    version: '2026-08-18.m0-evidence-audit',
    state: 'not-publishable',
    candidateRegistrySha256: sha256File(candidateFile),
    crosscutPolicy,
    sourceProjection: { algorithm: 'WP-060 scanDocument semanticProjection stableJson', ...sourceProjection() },
    evidenceSourceAllowlist,
    missingFieldOrder,
    operations,
  };
}

export function validateRegistryObject(input: unknown): void {
  const expected = canonicalJsonForFile(expectedRegistry(), specFile);
  if (canonicalJsonForFile(input, specFile) !== expected)
    throw new Error('A001-SPEC-DRIFT-001: registry differs from deterministic reconstruction');
}

function parseContractState(input: unknown): AuditedOperation {
  if (typeof input !== 'object' || input === null) throw new Error('A001-SPEC-SCHEMA-001: operation object');
  const operation = input as Record<string, unknown>;
  const candidateId = typeof operation.candidateId === 'string' ? operation.candidateId : 'unknown';
  if (operation.retentionState !== 'retained')
    throw new Error(`A001-SPEC-SCHEMA-001: invalid retention state ${candidateId}`);
  if (operation.freezeState !== 'evidence-complete' && operation.freezeState !== 'retained-unfrozen')
    throw new Error(`A001-SPEC-SCHEMA-001: invalid freeze state ${candidateId}`);
  if (operation.specState !== 'evidence-complete' && operation.specState !== 'missing-evidence')
    throw new Error(`A001-SPEC-SCHEMA-001: invalid spec state ${candidateId}`);
  if (
    !Array.isArray(operation.missingFields) ||
    !operation.missingFields.every((field) => missingFieldOrder.includes(field as MissingField))
  )
    throw new Error(`A001-SPEC-SCHEMA-001: invalid missing field ${candidateId}`);
  if (!operation.fieldStates || typeof operation.fieldStates !== 'object' || Array.isArray(operation.fieldStates))
    throw new Error(`A001-SPEC-SCHEMA-001: invalid field states ${candidateId}`);
  const fieldStates = operation.fieldStates as Record<string, unknown>;
  if (Object.keys(fieldStates).join(',') !== missingFieldOrder.join(','))
    throw new Error(`A001-SPEC-SCHEMA-001: field state keys ${candidateId}`);
  for (const field of missingFieldOrder) {
    if (!['complete', 'partial', 'missing', 'explicit-none'].includes(fieldStates[field] as string))
      throw new Error(`A001-SPEC-SCHEMA-001: invalid field state ${candidateId}`);
  }
  if (!Array.isArray(operation.evidenceRefs))
    throw new Error(`A001-SPEC-SCHEMA-001: invalid evidence refs ${candidateId}`);
  const evidenceRefs = operation.evidenceRefs as Array<Record<string, unknown>>;
  for (const reference of evidenceRefs) {
    if (!Array.isArray(reference.fields) || reference.fields.length === 0)
      throw new Error(`A001-SPEC-SCHEMA-001: empty evidence fields ${candidateId}`);
    if (!reference.fields.every((field) => missingFieldOrder.includes(field as MissingField)))
      throw new Error(`A001-SPEC-SCHEMA-001: unknown evidence field ${candidateId}`);
    if (new Set(reference.fields).size !== reference.fields.length)
      throw new Error(`A001-SPEC-SCHEMA-001: duplicate evidence field ${candidateId}`);
  }
  return operation as unknown as AuditedOperation;
}

export function validateContractState(input: unknown): void {
  const operation = parseContractState(input);
  const candidateId = operation.candidateId;
  if (operation.missingFields.some((field, index) => field !== missingFieldOrder[index]))
    throw new Error(`A001-SPEC-SCHEMA-001: missing field order ${candidateId}`);
  const missing = missingFieldOrder.filter(
    (field) => operation.fieldStates[field] === 'missing' || operation.fieldStates[field] === 'partial',
  );
  const complete = missing.length === 0;
  if (JSON.stringify(operation.missingFields) !== JSON.stringify(missing))
    throw new Error(`A001-SPEC-SCHEMA-001: field state/missing complement ${candidateId}`);
  if (
    complete !== (operation.specState === 'evidence-complete') ||
    complete !== (operation.freezeState === 'evidence-complete')
  )
    throw new Error(`A001-SPEC-SCHEMA-001: completeness state mismatch ${candidateId}`);
  const covered = new Set(operation.evidenceRefs.flatMap((reference) => reference.fields));
  for (const field of missingFieldOrder) {
    if (
      (operation.fieldStates[field] === 'complete' || operation.fieldStates[field] === 'explicit-none') &&
      !covered.has(field)
    )
      throw new Error(`A001-SPEC-SCHEMA-001: missing evidence coverage ${candidateId}`);
  }
}

export function check(): void {
  const spec = readJson<{
    operations: AuditedOperation[];
    state: string;
    missingFieldOrder: MissingField[];
    candidateRegistrySha256: string;
    crosscutPolicy: unknown;
    sourceProjection: ReturnType<typeof sourceProjection>;
    evidenceSourceAllowlist: string[];
  }>(specFile);
  if (spec.state !== 'not-publishable' || spec.operations.length !== 176) throw new Error('A001-SPEC-COUNT-001 failed');
  if (spec.candidateRegistrySha256 !== candidateHash || sha256File(candidateFile) !== candidateHash)
    throw new Error('A001-SPEC-DRIFT-001: candidate registry hash');
  validateRegistryObject(spec);
  validateCrosscutPolicyArtifact(readJson(policyFile));
  validatePolicyReference(spec.crosscutPolicy);
  validateSharedTargetSchemasArtifact(readJson(sharedSchemaFile));
  const projection = sourceProjection();
  if (
    JSON.stringify(spec.sourceProjection) !==
    JSON.stringify({ algorithm: 'WP-060 scanDocument semanticProjection stableJson', ...projection })
  )
    throw new Error('A001-SPEC-DRIFT-001: semantic projection');
  if (JSON.stringify(spec.evidenceSourceAllowlist) !== JSON.stringify(evidenceSourceAllowlist))
    throw new Error('A001-SPEC-DRIFT-001: evidence source allowlist');
  if (JSON.stringify(spec.missingFieldOrder) !== JSON.stringify(missingFieldOrder))
    throw new Error('A001-SPEC-SCHEMA-001 failed');
  if (new Set(spec.operations.map((operation) => operation.operationId)).size !== 176)
    throw new Error('A001-SPEC-ID-001 failed');
  for (const operation of spec.operations) {
    validateContractState(operation);
    if (
      operation.policyAssignment.policyId !== policyId ||
      operation.policyAssignment.policyVersion !== policyVersion ||
      JSON.stringify(operation.policyAssignment.pendingBusinessCoverage) !== JSON.stringify(missingFieldOrder)
    )
      throw new Error(`A001-SPEC-POLICY-003: invalid policy assignment ${operation.candidateId}`);
    for (const reference of operation.evidenceRefs) {
      if (!evidenceSourceAllowlist.includes(reference.file) || reference.line < 1)
        throw new Error(`A001-SPEC-DRIFT-001: invalid evidence ${operation.candidateId}`);
      if (reference.file === 'docs/重构文档/02-API接口契约.md') {
        const lines = fs.readFileSync(documentationFile, 'utf8').split(/\r?\n/u);
        if (!matchesEndpointMarker(operation, lines[reference.line - 1] ?? ''))
          throw new Error(`A001-SPEC-DRIFT-001: stale document evidence ${operation.candidateId}`);
      } else {
        const absolute = path.join(root, reference.file);
        const lines = fs.readFileSync(absolute, 'utf8').split(/\r?\n/u);
        const key = reference.sectionOrSymbol.match(/\[([^\]]+)\]/u)?.[1];
        const expectedText = key ? `'${key.replace('/{}', '/{composition_id}')}'` : reference.sectionOrSymbol;
        if (!lines[reference.line - 1]?.includes(expectedText))
          throw new Error(`A001-SPEC-DRIFT-001: stale symbol evidence ${operation.candidateId}`);
      }
    }
  }
  const summary = auditSummary();
  if (summary.incomplete > 0)
    throw new Error(
      `A001-SPEC-EVIDENCE-INCOMPLETE count=${summary.incomplete} candidateIds=${summary.candidateIds.join(',')}`,
    );
}

if (require.main === module) {
  const command = process.argv[2] ?? 'check';
  if (command === 'generate') generate();
  else if (command === 'audit') console.log(JSON.stringify(auditSummary()));
  else if (command === 'check') check();
  else throw new Error(`unknown command: ${command}`);
}
