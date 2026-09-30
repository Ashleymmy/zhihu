import { afterEach, expect, it, vi } from 'vitest'
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules()})
it('HTTP 环境无 randomUUID 仍生成稳定浏览器标识，并跨模块重载保留',async()=>{
  const storage=new Map<string,string>()
  vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key),setItem:(key:string,value:string)=>storage.set(key,value)})
  const getRandomValues=globalThis.crypto.getRandomValues.bind(globalThis.crypto)
  vi.stubGlobal('crypto',{getRandomValues})
  const a=(await import('../src/client-identity')).browserClientId()
  expect(a).toMatch(/^[a-f0-9]{48}$/)
  vi.resetModules()
  const b=(await import('../src/client-identity')).browserClientId()
  expect(b).toBe(a)
})
it('无法持久化时当前页面保持同一客户端标识',async()=>{
  vi.stubGlobal('localStorage',{getItem:()=>{throw new Error('denied')},setItem:()=>{throw new Error('denied')}})
  const {browserClientId}=await import('../src/client-identity')
  expect(browserClientId()).toBe(browserClientId())
})
