import type { Permission } from '../auth/permissions';

export const CLIENT_ALLIANCE_PREFIX = '/alliance/api' as const;

export type AllianceMethod = 'GET' | 'POST' | 'PUT';
export type AllianceRequestKind = 'json' | 'multipart' | 'query';
export type AllianceRequiredPermission = Extract<
  Permission,
  'plan.create' | 'composition.create' | 'composition.edit' | 'project.manage' | 'earning.view_all'
>;

export interface AllianceEndpointDefinition {
  readonly definitionKey: string;
  readonly method: AllianceMethod;
  readonly publicPath: string;
  readonly clientPath: string;
  readonly upstreamPath: string;
  readonly requestKind: AllianceRequestKind;
  readonly requiredPermission: AllianceRequiredPermission;
  readonly dynamicCompositionId?: boolean;
}

export interface AllianceEndpoint {
  readonly definitionKey: string;
  readonly operationKey: string;
  readonly method: AllianceMethod;
  readonly publicPath: string;
  readonly clientPath: string;
  readonly upstreamPath: string;
  readonly requestKind: AllianceRequestKind;
  readonly requiredPermission: AllianceRequiredPermission;
}

const definitions: AllianceEndpointDefinition[] = [
  {
    definitionKey: 'POST /popularize_plan',
    method: 'POST',
    publicPath: '/popularize_plan',
    clientPath: '/alliance/api/popularize_plan',
    upstreamPath: '/popularize_plan',
    requestKind: 'json',
    requiredPermission: 'plan.create',
  },
  {
    definitionKey: 'POST /popularize_plans',
    method: 'POST',
    publicPath: '/popularize_plans',
    clientPath: '/alliance/api/popularize_plans',
    upstreamPath: '/popularize_plans',
    requestKind: 'multipart',
    requiredPermission: 'plan.create',
  },
  {
    definitionKey: 'POST /popularize_composition/v2',
    method: 'POST',
    publicPath: '/popularize_composition/v2',
    clientPath: '/alliance/api/popularize_composition/v2',
    upstreamPath: '/popularize_composition/v2',
    requestKind: 'json',
    requiredPermission: 'composition.create',
  },
  {
    definitionKey: 'POST /popularize_compositions/v2',
    method: 'POST',
    publicPath: '/popularize_compositions/v2',
    clientPath: '/alliance/api/popularize_compositions/v2',
    upstreamPath: '/popularize_compositions/v2',
    requestKind: 'multipart',
    requiredPermission: 'composition.create',
  },
  {
    definitionKey: 'PUT /popularize_composition/v2/{composition_id}',
    method: 'PUT',
    publicPath: '/popularize_composition/v2/:composition_id',
    clientPath: '/alliance/api/popularize_composition/v2/{composition_id}',
    upstreamPath: '/popularize_composition/v2/{composition_id}',
    requestKind: 'json',
    requiredPermission: 'composition.edit',
    dynamicCompositionId: true,
  },
  {
    definitionKey: 'GET /popularize_compositions',
    method: 'GET',
    publicPath: '/popularize_compositions',
    clientPath: '/alliance/api/popularize_compositions',
    upstreamPath: '/popularize_compositions',
    requestKind: 'query',
    requiredPermission: 'project.manage',
  },
  {
    definitionKey: 'GET /data_report/real_time_data',
    method: 'GET',
    publicPath: '/data_report/real_time_data',
    clientPath: '/alliance/api/data_report/real_time_data',
    upstreamPath: '/data_report/real_time_data',
    requestKind: 'query',
    requiredPermission: 'earning.view_all',
  },
];

export const ALLIANCE_ENDPOINT_DEFINITIONS = Object.freeze(
  definitions.map((definition) => Object.freeze(definition)),
) as readonly AllianceEndpointDefinition[];
export const ALLIANCE_ENDPOINTS = ALLIANCE_ENDPOINT_DEFINITIONS;

// 仅供内部 Job（如 syncMetrics 的 D+1 日批）使用的端点：
// 不生成公共代理路由，也不进入公共版本策略，只能通过 resolveClientEndpoint 命中。
const clientOnlyDefinitions: ReadonlyArray<AllianceEndpointDefinition> = [
  {
    definitionKey: 'GET /data_report/daily_data',
    method: 'GET',
    publicPath: '/data_report/daily_data',
    clientPath: '/alliance/api/data_report/daily_data',
    upstreamPath: '/data_report/daily_data',
    requestKind: 'query',
    requiredPermission: 'earning.view_all',
  },
];

const registeredEndpoints = new WeakSet<object>();
const staticEndpoints = new Map<string, AllianceEndpoint>();

const ALLOWED_REQUIRED_PERMISSIONS: ReadonlySet<AllianceRequiredPermission> = new Set([
  'plan.create',
  'composition.create',
  'composition.edit',
  'project.manage',
  'earning.view_all',
]);

export function isAllowedRequiredPermission(value: unknown): value is AllianceRequiredPermission {
  return typeof value === 'string' && ALLOWED_REQUIRED_PERMISSIONS.has(value as AllianceRequiredPermission);
}

function registerEndpoint(endpoint: AllianceEndpoint): AllianceEndpoint {
  if (!isAllowedRequiredPermission(endpoint.requiredPermission)) {
    throw new Error('invalid Alliance endpoint permission');
  }
  registeredEndpoints.add(endpoint);
  return endpoint;
}

for (const definition of ALLIANCE_ENDPOINT_DEFINITIONS) {
  if (definition.dynamicCompositionId) continue;
  const endpoint = Object.freeze({
    definitionKey: definition.definitionKey,
    operationKey: definition.definitionKey,
    method: definition.method,
    publicPath: definition.publicPath,
    clientPath: definition.clientPath,
    upstreamPath: definition.upstreamPath,
    requestKind: definition.requestKind,
    requiredPermission: definition.requiredPermission,
  });
  staticEndpoints.set(`${definition.method} ${definition.publicPath}`, registerEndpoint(endpoint));
}

const clientOnlyEndpoints = new Map<string, AllianceEndpoint>();
for (const definition of clientOnlyDefinitions) {
  const endpoint = Object.freeze({
    definitionKey: definition.definitionKey,
    operationKey: definition.definitionKey,
    method: definition.method,
    publicPath: definition.publicPath,
    clientPath: definition.clientPath,
    upstreamPath: definition.upstreamPath,
    requestKind: definition.requestKind,
    requiredPermission: definition.requiredPermission,
  });
  clientOnlyEndpoints.set(`${definition.method} ${definition.publicPath}`, registerEndpoint(endpoint));
}

function requestPath(requestTarget: unknown): string | null {
  if (typeof requestTarget !== 'string') return null;
  const queryIndex = requestTarget.indexOf('?');
  return queryIndex === -1 ? requestTarget : requestTarget.slice(0, queryIndex);
}

export function isCanonicalAlliancePath(requestTarget: unknown): boolean {
  const path = requestPath(requestTarget);
  if (
    path === null ||
    path.length === 0 ||
    !path.startsWith('/') ||
    /[^\x21-\x7e]/u.test(path) ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    path.includes('%') ||
    path.includes(';') ||
    path.includes('\\') ||
    /\/{2,}/u.test(path) ||
    (path.length > 1 && path.endsWith('/'))
  ) {
    return false;
  }
  return !path.split('/').some((segment) => segment === '.' || segment === '..');
}

export function isCanonicalCompositionId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 20) return false;
  const match = /^[1-9][0-9]{0,19}$/u.exec(value);
  return match?.[0] === value;
}

function resolvedDynamicEndpoint(definition: AllianceEndpointDefinition, id: string): AllianceEndpoint {
  return registerEndpoint(
    Object.freeze({
      definitionKey: definition.definitionKey,
      operationKey: definition.definitionKey,
      method: definition.method,
      publicPath: `/popularize_composition/v2/${id}`,
      clientPath: `/alliance/api/popularize_composition/v2/${id}`,
      upstreamPath: `/popularize_composition/v2/${id}`,
      requestKind: definition.requestKind,
      requiredPermission: definition.requiredPermission,
    }),
  );
}

function resolveLocalPath(method: string, path: string): AllianceEndpoint | undefined {
  if (method !== 'GET' && method !== 'POST' && method !== 'PUT') return undefined;
  const staticEndpoint = staticEndpoints.get(`${method} ${path}`);
  if (staticEndpoint) return staticEndpoint;

  const dynamicDefinition = ALLIANCE_ENDPOINT_DEFINITIONS.find(
    (definition) => definition.dynamicCompositionId && definition.method === method,
  );
  if (!dynamicDefinition) return undefined;
  const match = /^\/popularize_composition\/v2\/([1-9][0-9]{0,19})$/u.exec(path);
  if (!match || !isCanonicalCompositionId(match[1])) return undefined;
  return resolvedDynamicEndpoint(dynamicDefinition, match[1]);
}

export function resolvePublicEndpoint(method: string, requestTarget: unknown): AllianceEndpoint | undefined {
  const path = requestPath(requestTarget);
  if (!isCanonicalAlliancePath(path)) return undefined;
  return resolveLocalPath(method, path!);
}

export function resolveClientEndpoint(method: string, requestTarget: unknown): AllianceEndpoint | undefined {
  const path = requestPath(requestTarget);
  if (!isCanonicalAlliancePath(path) || path === CLIENT_ALLIANCE_PREFIX) return undefined;
  if (!path!.startsWith(`${CLIENT_ALLIANCE_PREFIX}/`)) return undefined;
  const localPath = path!.slice(CLIENT_ALLIANCE_PREFIX.length);
  const endpoint = resolveLocalPath(method, localPath) ?? clientOnlyEndpoints.get(`${method} ${localPath}`);
  if (!endpoint || endpoint.clientPath !== path) return undefined;
  return endpoint;
}

export function isRegisteredAllianceEndpoint(value: unknown): value is AllianceEndpoint {
  return typeof value === 'object' && value !== null && registeredEndpoints.has(value);
}

export function isCurrentAllianceEndpoint(value: unknown): value is AllianceEndpoint {
  if (typeof value !== 'object' || value === null) return false;
  const endpoint = value as Partial<AllianceEndpoint>;
  if (!isAllowedRequiredPermission(endpoint.requiredPermission)) return false;
  if (!isRegisteredAllianceEndpoint(value)) return false;
  if (typeof endpoint.method !== 'string' || typeof endpoint.clientPath !== 'string') return false;
  const resolved = resolveClientEndpoint(endpoint.method, endpoint.clientPath);
  return Boolean(
    resolved &&
    resolved.definitionKey === endpoint.definitionKey &&
    resolved.method === endpoint.method &&
    resolved.clientPath === endpoint.clientPath &&
    resolved.upstreamPath === endpoint.upstreamPath &&
    resolved.requestKind === endpoint.requestKind &&
    resolved.requiredPermission === endpoint.requiredPermission,
  );
}

export function getAllianceEndpointDefinition(definitionKey: string): AllianceEndpointDefinition | undefined {
  return ALLIANCE_ENDPOINT_DEFINITIONS.find((definition) => definition.definitionKey === definitionKey);
}
