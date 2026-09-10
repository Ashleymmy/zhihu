import { isCanonicalAlliancePath, resolvePublicEndpoint } from './allianceEndpointRegistry';

export const PLAN_UPDATE_UNSUPPORTED_ERROR = '知乎同步失败，请稍后重试';
export const COMPOSITION_ID_INVALID_ERROR = '知乎同步失败，请稍后重试';

export { isCanonicalCompositionId } from './allianceEndpointRegistry';

export interface AllianceVersionPolicyResult {
  allowed: boolean;
  compositionFamily: boolean;
  reason: 'allowed' | 'non-canonical' | 'method-or-path';
}

function rawPathFromRequestTarget(requestTarget: string): string {
  const queryIndex = requestTarget.indexOf('?');
  return queryIndex === -1 ? requestTarget : requestTarget.slice(0, queryIndex);
}

export function evaluateAllianceVersionPolicy(method: string, requestTarget: string): AllianceVersionPolicyResult {
  const path = rawPathFromRequestTarget(requestTarget);
  if (!isCanonicalAlliancePath(path)) {
    return { allowed: false, compositionFamily: false, reason: 'non-canonical' };
  }

  const endpoint = resolvePublicEndpoint(method, path);
  if (endpoint) {
    return {
      allowed: true,
      compositionFamily: endpoint.definitionKey.includes('composition'),
      reason: 'allowed',
    };
  }

  return {
    allowed: false,
    compositionFamily: path.toLowerCase().includes('popularize_composition'),
    reason: 'method-or-path',
  };
}

export function isAllowedAllianceRequest(method: string, requestTarget: string): boolean {
  return evaluateAllianceVersionPolicy(method, requestTarget).allowed;
}
