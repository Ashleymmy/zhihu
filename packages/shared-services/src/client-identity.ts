const STORAGE_KEY = 'opc-client-id-v1'
let inMemoryId: string | undefined

/** Stable across reloads/tabs, separate for each browser installation. Works on HTTP. */
export function browserClientId(): string {
  if (inMemoryId) return inMemoryId
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (stored && /^[a-zA-Z0-9_-]{16,128}$/.test(stored)) return (inMemoryId = stored)
  } catch { /* Private browsing may disable storage. */ }
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  inMemoryId = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  try { globalThis.localStorage?.setItem(STORAGE_KEY, inMemoryId) } catch { /* Keep the current page usable. */ }
  return inMemoryId
}
