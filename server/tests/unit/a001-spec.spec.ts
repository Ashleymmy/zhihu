import fs from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';
import { describe, expect, it } from 'vitest';
import {
  apiEnvelopeSchema,
  auditEventSchema,
  authorizationHeaderSchema,
  auditSummary,
  check,
  expectedRegistry,
  financeGateRejectedErrorResponseSchema,
  globalRoleSchema,
  generate,
  httpMethodSchema,
  idempotencyKeySchema,
  markerOperationKey,
  matchesEndpointMarker,
  pageResponseSchema,
  projectMemberRoleSchema,
  refreshCookieSchema,
  validateCrosscutPolicyArtifact,
  validateReusableTargetSchemas,
  validateContractState,
  validateRegistryObject,
  validateSharedTargetSchemasArtifact,
} from '../../scripts/contracts/a001-spec-check';

const projectRoot = path.resolve(__dirname, '../../..');
const specPath = path.join(projectRoot, 'contracts/operations/a001-spec-registry.json');
const policyPath = path.join(projectRoot, 'contracts/openapi/policies/a001-crosscut-policies.json');
function read<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

describe('A-001 SPEC evidence audit', () => {
  it('A001-SPEC-SHARED-001 validates reusable target schemas without binding operations', () => {
    expect(() => validateReusableTargetSchemas()).not.toThrow();
    expect(
      apiEnvelopeSchema.parse({ code: 0, message: 'ok', data: { value: 1 }, requestId: 'r-1', timestamp: 1 }),
    ).not.toHaveProperty('meta');
    expect(() =>
      apiEnvelopeSchema.parse({ code: 0, message: 'ok', data: {}, requestId: 'r-1', timestamp: 1, meta: {} }),
    ).toThrow();
    expect(() =>
      pageResponseSchema.parse({
        code: 0,
        message: 'ok',
        data: [],
        meta: { page: 0, pageSize: 20, total: 0 },
        requestId: 'r-1',
        timestamp: 1,
      }),
    ).toThrow();
    expect(() =>
      pageResponseSchema.parse({
        code: 0,
        message: 'ok',
        data: [],
        meta: { page: 1, pageSize: 101, total: 0 },
        requestId: 'r-1',
        timestamp: 1,
      }),
    ).toThrow();
    expect(() => apiEnvelopeSchema.parse({ code: 0, data: {}, requestId: 'r-1', timestamp: 1 })).toThrow();
    expect(() =>
      apiEnvelopeSchema.parse({ code: '0', message: 'ok', data: {}, requestId: 'r-1', timestamp: 1 }),
    ).toThrow();
    expect(() =>
      apiEnvelopeSchema.parse({ code: 0, message: 'ok', data: {}, requestId: 'r-1', timestamp: 1, extra: true }),
    ).toThrow();
    expect(() => apiEnvelopeSchema.parse({ code: 0, message: 'ok', data: {}, requestId: '', timestamp: 1 })).toThrow();
  });

  it('A001-SPEC-FIN-001 rejects invalid finance gate error shapes and ordering', () => {
    const base = { code: 50310, message: 'blocked', requestId: 'r-1', timestamp: 1 };
    expect(
      financeGateRejectedErrorResponseSchema.parse({
        ...base,
        failedGates: ['D-001-DECISION', 'P0-008', 'M6'],
      }),
    ).toMatchObject(base);
    expect(() => financeGateRejectedErrorResponseSchema.parse({ ...base, failedGates: [] })).toThrow();
    expect(() => financeGateRejectedErrorResponseSchema.parse({ ...base, failedGates: ['M6', 'P0-008'] })).toThrow(
      /ordered/u,
    );
    expect(() => financeGateRejectedErrorResponseSchema.parse({ ...base, failedGates: ['M6', 'M6'] })).toThrow(
      /unique/u,
    );
    expect(() => financeGateRejectedErrorResponseSchema.parse({ ...base, failedGates: ['UNKNOWN'] })).toThrow();
  });

  it('A001-SPEC-ROLE-001 keeps global and project member roles independent and strict', () => {
    expect(globalRoleSchema.options).toEqual(['admin', 'leader', 'creator']);
    expect(projectMemberRoleSchema.options).toEqual(['owner', 'admin', 'member', 'viewer']);
    expect(() => globalRoleSchema.parse('owner')).toThrow();
    expect(() => projectMemberRoleSchema.parse('creator')).toThrow();
  });

  it('A001-SPEC-SHARED-ARTIFACT-001 validates generated schema artifact and tamper', () => {
    const artifact = read<{
      $defs: Record<string, { properties?: Record<string, unknown>; required?: string[]; [key: string]: unknown }>;
      'x-a001-state': string;
    }>(path.join(projectRoot, 'contracts/openapi/schemas/shared-target-schemas.json'));
    expect(() => validateSharedTargetSchemasArtifact(artifact)).not.toThrow();
    expect(Object.keys(artifact.$defs).sort()).toEqual([
      'ApiEnvelope',
      'AuditEvent',
      'AuthorizationHeader',
      'ErrorBaselineStage',
      'ErrorResponse',
      'FinanceGateRejectedErrorResponse',
      'GlobalRole',
      'IdempotencyKey',
      'PageResponse',
      'PaginationMeta',
      'ProjectMemberRole',
      'RefreshCookieAttributes',
      'SharedMockFixture',
    ]);
    const finance = artifact.$defs.FinanceGateRejectedErrorResponse;
    expect(finance.required).toEqual(
      expect.arrayContaining(['code', 'message', 'requestId', 'timestamp', 'failedGates']),
    );
    expect(finance.properties).toEqual(
      expect.objectContaining({
        code: expect.anything(),
        message: expect.anything(),
        requestId: expect.anything(),
        timestamp: expect.anything(),
        failedGates: expect.anything(),
      }),
    );
    expect(finance.properties?.requestId).toEqual({ type: 'string', minLength: 1 });
    expect(artifact.$defs.ApiEnvelope.properties?.requestId).toEqual({ type: 'string', minLength: 1 });
    expect(artifact.$defs.PageResponse.properties?.requestId).toEqual({ type: 'string', minLength: 1 });
    expect(artifact.$defs.ErrorResponse.properties?.requestId).toEqual({ type: 'string', minLength: 1 });
    const refs = JSON.stringify(artifact).match(/#\/\$defs\/([A-Za-z]+)/gu) ?? [];
    for (const ref of refs) expect(artifact.$defs[ref.slice('#/$defs/'.length)]).toBeDefined();
    expect(artifact['x-a001-state']).toBe('target-reusable/not-operation-bound');
    const tampered = JSON.parse(JSON.stringify(artifact)) as { 'x-a001-state': string };
    tampered['x-a001-state'] = 'operation-bound';
    expect(() => validateSharedTargetSchemasArtifact(tampered)).toThrow(/DRIFT/u);
  });

  it('A001-SPEC-MATCH-001 matches static and parameterized endpoint markers exactly once', () => {
    expect(markerOperationKey('**接口**：`GET /api/v1/admin/users/:id`')).toEqual({
      method: 'GET',
      path: '/api/v1/admin/users/{}',
    });
    expect(
      matchesEndpointMarker(
        { method: 'GET', path: '/api/v1/admin/users/{id}' },
        '**接口**：`GET /api/v1/admin/users/:id`',
      ),
    ).toBe(true);
    const candidate = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'contracts/operations/operation-registry.json'), 'utf8'),
    ) as { operations: Array<{ method: string; path: string; candidateId: string }> };
    const lines = fs.readFileSync(path.join(projectRoot, 'docs/重构文档/02-API接口契约.md'), 'utf8').split(/\r?\n/u);
    const markers = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => markerOperationKey(line) !== null);
    const matches = markers.map(({ line }) =>
      candidate.operations.filter((operation) => matchesEndpointMarker(operation, line)),
    );
    expect(markers).toHaveLength(16);
    expect(matches.every((items) => items.length > 0)).toBe(true);
    expect(matches.every((items) => items.length === 1)).toBe(true);
    expect(new Set(matches.map((items) => items[0].candidateId)).size).toBe(16);
  });
  it('A001-SPEC-COUNT-001 retains 176 operations without fabricated tombstones', () => {
    generate();
    const spec = read<{ operations: Array<{ surface: string }>; state: string }>(specPath);
    expect(spec.operations).toHaveLength(176);
    expect(spec.operations.filter((item) => item.surface === 'public-bff')).toHaveLength(169);
    expect(spec.operations.filter((item) => item.surface === 'upstream-adapter')).toHaveLength(7);
    expect(spec.state).toBe('not-publishable');
  });

  it('A001-SPEC-GENERATE-001 produces identical bytes and frozen source projection', () => {
    generate();
    const first = fs.readFileSync(specPath);
    const artifactPath = path.join(projectRoot, 'contracts/openapi/schemas/shared-target-schemas.json');
    const firstArtifact = fs.readFileSync(artifactPath);
    generate();
    const second = fs.readFileSync(specPath);
    const secondArtifact = fs.readFileSync(artifactPath);
    expect(second.equals(first)).toBe(true);
    expect(secondArtifact.equals(firstArtifact)).toBe(true);
    const spec = JSON.parse(second.toString('utf8')) as {
      sourceProjection: {
        publicBff: { count: number; semanticSha256: string };
        upstreamAdapter: { count: number; semanticSha256: string };
      };
    };
    expect(spec.sourceProjection).toEqual({
      algorithm: 'WP-060 scanDocument semanticProjection stableJson',
      publicBff: { count: 169, semanticSha256: '78a1983a0c6e0d1ce9081544d4412de0aadf651a731d9f992f6c93f601c5e87f' },
      upstreamAdapter: { count: 7, semanticSha256: 'b38c2d7a151b312813fbfa8f2220c56322071a0294cf38cf962973b2e569a061' },
    });
  });

  it('A001-SPEC-PRETTIER-001 generated JSON is Prettier-stable', async () => {
    for (const file of [specPath, path.join(projectRoot, 'contracts/openapi/schemas/shared-target-schemas.json')]) {
      const source = fs.readFileSync(file, 'utf8');
      expect(await prettier.format(source, { filepath: file })).toBe(source);
    }
  });

  it('A001-SPEC-ID-001 freezes unique operationId/Test ID and planned status', () => {
    const spec = read<{
      operations: Array<{
        operationId: string;
        specTestId: string;
        implementationStatus: string;
        implementationEvidence: unknown;
      }>;
    }>(specPath);
    expect(new Set(spec.operations.map((item) => item.operationId)).size).toBe(176);
    expect(new Set(spec.operations.map((item) => item.specTestId)).size).toBe(176);
    expect(spec.operations.every((item) => /^a001_(pub|up)_\d{4}$/u.test(item.operationId))).toBe(true);
    expect(
      spec.operations.every((item) => item.implementationStatus === 'planned' && item.implementationEvidence === null),
    ).toBe(true);
  });

  it('A001-SPEC-SCHEMA-001 records operation-specific evidence or fixed missing fields', () => {
    const spec = read<{
      missingFieldOrder: string[];
      operations: Array<{
        specState: string;
        evidenceRefs: Array<{ file: string; sectionOrSymbol: string; line: number; fields: string[] }>;
        missingFields: string[];
        fieldStates: Record<string, string>;
      }>;
    }>(specPath);
    const allowed = new Set(spec.missingFieldOrder);
    for (const operation of spec.operations) {
      expect(
        operation.evidenceRefs.every(
          (reference) =>
            reference.file.length > 0 &&
            reference.sectionOrSymbol.length > 0 &&
            reference.line > 0 &&
            reference.fields.length > 0,
        ),
      ).toBe(true);
      expect(operation.missingFields.every((field) => allowed.has(field))).toBe(true);
      expect(Object.keys(operation.fieldStates)).toEqual(spec.missingFieldOrder);
      const observed = operation.evidenceRefs.flatMap((reference) => reference.fields);
      expect(operation.specState).toBe(operation.missingFields.length === 0 ? 'evidence-complete' : 'missing-evidence');
    }
  });

  it('A001-SPEC-BOUNDARY-001 stops evidence at any heading boundary', () => {
    const spec = read<{
      operations: Array<{ candidateId: string; evidenceRefs: Array<{ sectionOrSymbol: string; fields: string[] }> }>;
    }>(specPath);
    const users = spec.operations.find((operation) => operation.candidateId === 'A001-PUB-0001');
    const batchDelete = spec.operations.find((operation) => operation.candidateId === 'A001-PUB-0021');
    expect(users?.evidenceRefs[0]).toMatchObject({
      sectionOrSymbol: '4.1.1 获取用户列表',
      fields: ['path', 'query', 'success'],
    });
    expect(batchDelete?.evidenceRefs[0]).toMatchObject({ sectionOrSymbol: '4.2.4 批量删除订单' });
    expect(batchDelete?.evidenceRefs[0]?.fields).not.toContain('audit');
  });

  it('A001-SPEC-UPSTREAM-NEG-001 does not infer headers, scope, errors, audit, or mock fixtures', () => {
    const spec = read<{
      operations: Array<{
        surface: string;
        candidateId: string;
        evidenceRefs: Array<{ fields: string[] }>;
        missingFields: string[];
      }>;
    }>(specPath);
    for (const operation of spec.operations.filter((item) => item.surface === 'upstream-adapter')) {
      const fields = operation.evidenceRefs.flatMap((reference) => reference.fields);
      expect(fields).not.toContain('header');
      expect(fields).not.toContain('security');
      expect(fields).not.toContain('scope');
      expect(fields).not.toContain('errors');
      expect(fields).not.toContain('audit');
      expect(fields).not.toContain('mockFixture');
      expect(operation.missingFields).toEqual(expect.arrayContaining(['scope', 'idempotency', 'audit', 'mockFixture']));
    }
    expect(spec.operations.find((item) => item.candidateId === 'A001-UP-0001')?.evidenceRefs[0]?.fields).toEqual([
      'path',
      'body',
    ]);
    expect(spec.operations.find((item) => item.candidateId === 'A001-UP-0006')?.evidenceRefs[0]?.fields).toEqual([
      'path',
      'query',
    ]);
  });

  it('A001-SPEC-PARTIAL-001 never treats observed references as complete evidence', () => {
    const spec = read<{
      operations: Array<{ freezeState: string; fieldStates: Record<string, string>; missingFields: string[] }>;
    }>(specPath);
    for (const operation of spec.operations) {
      expect(operation.freezeState).toBe('retained-unfrozen');
      expect(
        Object.values(operation.fieldStates).every((state) => state !== 'complete' && state !== 'explicit-none'),
      ).toBe(true);
      expect(operation.missingFields).toHaveLength(11);
      expect(
        Object.entries(operation.fieldStates)
          .filter(([, state]) => state === 'partial')
          .map(([field]) => field),
      ).toEqual(expect.arrayContaining([]));
    }
  });

  it('A001-SPEC-DRIFT-001 deterministically fails closed while evidence is incomplete', () => {
    const summary = auditSummary();
    expect(summary.count).toBe(176);
    expect(summary.incomplete).toBeGreaterThan(0);
    expect(summary.candidateIds).toHaveLength(summary.incomplete);
    expect(() => check()).toThrow(/A001-SPEC-(DRIFT|EVIDENCE-INCOMPLETE)/u);
  });

  it('A001-SPEC-TAMPER-001 rejects a changed in-memory registry before incomplete evidence', () => {
    const tampered = JSON.parse(JSON.stringify(expectedRegistry())) as { operations: Array<{ candidateId: string }> };
    tampered.operations[0].candidateId = 'TAMPERED';
    expect(() => validateRegistryObject(tampered)).toThrow(/A001-SPEC-DRIFT-001/u);
  });

  it('A001-SPEC-VALIDATOR-001 accepts a complete operation fixture', () => {
    const complete = {
      ...read<{ operations: Array<Record<string, unknown>> }>(specPath).operations[0],
      freezeState: 'evidence-complete' as const,
      specState: 'evidence-complete' as const,
      fieldStates: Object.fromEntries(
        [
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
        ].map((field) => [field, 'explicit-none']),
      ),
      missingFields: [],
      evidenceRefs: [
        {
          file: 'docs/重构文档/02-API接口契约.md',
          sectionOrSymbol: 'synthetic validator fixture',
          line: 1,
          fields: [
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
          ],
        },
      ],
    };
    expect(() => validateContractState(complete)).not.toThrow();
  });

  it('A001-SPEC-VALIDATOR-NEG-001 rejects invalid states and evidence coverage', () => {
    type Fixture = {
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
      operationId: string;
      retentionState: 'retained';
      freezeState: 'evidence-complete' | 'retained-unfrozen';
      fieldStates: Record<string, 'complete' | 'partial' | 'missing' | 'explicit-none'>;
      specState: 'evidence-complete' | 'missing-evidence';
      evidenceRefs: Array<{ file: string; sectionOrSymbol: string; line: number; fields: string[] }>;
      missingFields: string[];
    };
    const operation = read<{ operations: Fixture[] }>(specPath).operations[0] as unknown as Record<string, unknown>;
    const fieldStates = operation.fieldStates as Record<string, unknown>;
    const evidenceRefs = operation.evidenceRefs as Array<Record<string, unknown>>;
    expect(() => validateContractState({ ...operation, specState: 'invalid' })).toThrow(/invalid spec state/u);
    expect(() =>
      validateContractState({
        ...operation,
        specState: 'evidence-complete',
        freezeState: 'evidence-complete',
        missingFields: [],
      }),
    ).toThrow(/complement|completeness|coverage/u);
    expect(() => validateContractState({ ...operation, missingFields: [] })).toThrow(/complement/u);
    expect(() =>
      validateContractState({
        ...operation,
        fieldStates: Object.fromEntries(Object.keys(fieldStates).map((field) => [field, 'complete'])),
        missingFields: [],
      }),
    ).toThrow(/completeness|coverage/u);
    expect(() =>
      validateContractState({
        ...operation,
        fieldStates: Object.fromEntries(Object.keys(fieldStates).map((field) => [field, 'explicit-none'])),
        missingFields: [],
        evidenceRefs: [],
        specState: 'evidence-complete',
        freezeState: 'evidence-complete',
      }),
    ).toThrow(/coverage/u);
    expect(() =>
      validateContractState({
        ...operation,
        evidenceRefs: [{ file: 'synthetic', sectionOrSymbol: 'synthetic', line: 1, fields: ['unknown'] }],
      }),
    ).toThrow(/unknown evidence field/u);
    expect(() =>
      validateContractState({
        ...operation,
        evidenceRefs: [{ ...evidenceRefs[0], fields: ['path', 'path'] }],
      }),
    ).toThrow(/duplicate evidence/u);
  });

  it('A001-SPEC-REBUILD-001 uses the same absolute-root reconstruction outside server cwd', () => {
    const before = JSON.stringify(expectedRegistry());
    process.chdir(path.join(projectRoot, '..'));
    try {
      expect(JSON.stringify(expectedRegistry())).toBe(before);
    } finally {
      process.chdir(projectRoot);
    }
  });
});
