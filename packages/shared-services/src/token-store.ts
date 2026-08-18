/**
 * Access Token 存储。Refresh Token 由服务端以 HttpOnly Cookie 下发，前端不可见、也不应可见。
 * 这里只保管短时效的 Access Token，默认放内存，可选镜像到 sessionStorage 以扛住页面刷新。
 */

export interface TokenStore {
  get(): string | null
  set(token: string | null): void
}

const STORAGE_KEY = 'zk_access_token'

/** 纯内存存储：刷新页面即登出，安全性最高。 */
export function createMemoryTokenStore(): TokenStore {
  let token: string | null = null
  return {
    get: () => token,
    set: (value) => {
      token = value
    },
  }
}

/**
 * 内存 + sessionStorage 镜像：刷新页面仍在线，关闭标签页即失效。
 * 不使用 localStorage——避免 token 跨标签页长期驻留。
 */
export function createSessionTokenStore(): TokenStore {
  let token: string | null = readSession()

  function readSession(): string | null {
    try {
      return globalThis.sessionStorage?.getItem(STORAGE_KEY) ?? null
    } catch {
      return null
    }
  }

  return {
    get: () => token,
    set: (value) => {
      token = value
      try {
        if (value === null) globalThis.sessionStorage?.removeItem(STORAGE_KEY)
        else globalThis.sessionStorage?.setItem(STORAGE_KEY, value)
      } catch {
        // 隐私模式下 sessionStorage 不可写；内存副本仍然有效。
      }
    },
  }
}
