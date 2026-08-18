import type { AuthUser, GlobalRole } from '@zhihu-koc/shared-contracts'

let sequence = 0

/** 构造测试用 AuthUser；每次调用 id 递增，避免夹具之间撞 ID。 */
export function fakeUser(overrides: Partial<AuthUser> & { role?: GlobalRole } = {}): AuthUser {
  sequence += 1
  const role = overrides.role ?? 'creator'
  return {
    id: String(sequence),
    username: `${role}-user-${sequence}`,
    displayName: `${role} 用户 ${sequence}`,
    role,
    parentId: null,
    phone: null,
    ...overrides,
  }
}

/** BFF 成功 Envelope 夹具。 */
export function successEnvelope<T>(data: T) {
  return {
    code: 0 as const,
    message: 'ok',
    requestId: `test-req-${++sequence}`,
    timestamp: 1_700_000_000,
    data,
  }
}

/** BFF 失败 Envelope 夹具。 */
export function failureEnvelope(code: number, message = 'error') {
  return {
    code,
    message,
    requestId: `test-req-${++sequence}`,
    timestamp: 1_700_000_000,
  }
}
