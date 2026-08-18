import { describe, expect, it } from 'vitest';
import {
  ALLIANCE_ENDPOINT_DEFINITIONS,
  isCanonicalAlliancePath,
  isAllowedRequiredPermission,
  isCurrentAllianceEndpoint,
  isRegisteredAllianceEndpoint,
  resolveClientEndpoint,
  resolvePublicEndpoint,
} from '../../src/zhihu/allianceEndpointRegistry';

describe('Alliance Endpoint Registry', () => {
  it('P0007-R1-REG-001 exposes the exact seven-operation allowlist', () => {
    expect(
      ALLIANCE_ENDPOINT_DEFINITIONS.map((endpoint) => [
        endpoint.method,
        endpoint.publicPath,
        endpoint.upstreamPath,
        endpoint.requestKind,
        endpoint.requiredPermission,
      ]),
    ).toEqual([
      ['POST', '/popularize_plan', '/popularize_plan', 'json', 'plan.create'],
      ['POST', '/popularize_plans', '/popularize_plans', 'multipart', 'plan.create'],
      ['POST', '/popularize_composition/v2', '/popularize_composition/v2', 'json', 'composition.create'],
      ['POST', '/popularize_compositions/v2', '/popularize_compositions/v2', 'multipart', 'composition.create'],
      [
        'PUT',
        '/popularize_composition/v2/:composition_id',
        '/popularize_composition/v2/{composition_id}',
        'json',
        'composition.edit',
      ],
      ['GET', '/popularize_compositions', '/popularize_compositions', 'query', 'project.manage'],
      ['GET', '/data_report/real_time_data', '/data_report/real_time_data', 'query', 'earning.view_all'],
    ]);
  });

  it('P0007-R1-CANON-001 resolves only canonical public and client request targets', () => {
    const publicEndpoint = resolvePublicEndpoint('PUT', '/popularize_composition/v2/90071992547409931234');
    const clientEndpoint = resolveClientEndpoint('GET', '/alliance/api/popularize_compositions?keyword=%252F');

    expect(publicEndpoint?.upstreamPath).toBe('/popularize_composition/v2/90071992547409931234');
    expect(clientEndpoint?.clientPath).toBe('/alliance/api/popularize_compositions');
    expect(resolvePublicEndpoint('HEAD', '/popularize_compositions')).toBeUndefined();
    expect(resolvePublicEndpoint('GET', '/api/alliance/api/popularize_compositions')).toBeUndefined();
    expect(
      resolveClientEndpoint('GET', 'https://attacker.example/alliance/api/popularize_compositions'),
    ).toBeUndefined();
    for (const path of [
      '/alliance/api/%70opularize_plan',
      '/alliance/api/popularize_plan;foo',
      '/alliance/api//popularize_plan',
      '/alliance/api/popularize_plan/',
      '/alliance/api/popularize_composition/v2/01',
    ]) {
      expect(resolveClientEndpoint('POST', path), path).toBeUndefined();
    }
  });

  it('P0007-R1-EGRESS-002 marks only registry-owned endpoints as current', () => {
    const endpoint = resolveClientEndpoint('POST', '/alliance/api/popularize_plan');
    expect(endpoint).toBeDefined();
    expect(isRegisteredAllianceEndpoint(endpoint)).toBe(true);
    expect(isCurrentAllianceEndpoint(endpoint)).toBe(true);
    expect(endpoint?.requiredPermission).toBe('plan.create');

    const dynamicEndpoint = resolveClientEndpoint('PUT', '/alliance/api/popularize_composition/v2/2071265453767405652');
    expect(dynamicEndpoint?.requiredPermission).toBe('composition.edit');
    expect(isRegisteredAllianceEndpoint(dynamicEndpoint)).toBe(true);
    expect(isCurrentAllianceEndpoint(dynamicEndpoint)).toBe(true);

    const forged = {
      definitionKey: 'POST /popularize_plan',
      operationKey: 'POST /popularize_plan',
      method: 'POST',
      publicPath: '/popularize_plan',
      clientPath: '/alliance/api/popularize_plan',
      upstreamPath: 'https://attacker.example',
      requestKind: 'json',
      requiredPermission: 'plan.create',
    };
    expect(isRegisteredAllianceEndpoint(forged)).toBe(false);
    expect(isCurrentAllianceEndpoint(forged)).toBe(false);
    const permissionForged = { ...endpoint, requiredPermission: 'project.manage' };
    expect(isCurrentAllianceEndpoint(permissionForged)).toBe(false);
    expect(isCanonicalAlliancePath('/popularize_compositions?keyword=%252F')).toBe(true);
  });

  it('P0007-R5-PERM-001 rejects missing or unknown required permissions', () => {
    const endpoint = resolveClientEndpoint('POST', '/alliance/api/popularize_plan');
    expect(endpoint).toBeDefined();
    expect(isAllowedRequiredPermission(undefined)).toBe(false);
    expect(isAllowedRequiredPermission('permission.forged')).toBe(false);
    expect(isAllowedRequiredPermission('plan.create')).toBe(true);
    expect(isCurrentAllianceEndpoint({ ...endpoint, requiredPermission: undefined })).toBe(false);
    expect(isCurrentAllianceEndpoint({ ...endpoint, requiredPermission: 'permission.forged' })).toBe(false);
  });
});
