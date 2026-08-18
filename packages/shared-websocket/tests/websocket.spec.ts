import { describe, expect, it, vi } from 'vitest'
import { backoffDelay, createWebSocketClient, type ConnectionState } from '../src'

class FakeSocket {
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false
  constructor(readonly url: string) {}
  close() {
    this.closed = true
    this.onclose?.()
  }
}

describe('退避策略', () => {
  it('指数增长且封顶 30s', () => {
    expect(backoffDelay(0, 1_000)).toBe(1_000)
    expect(backoffDelay(3, 1_000)).toBe(8_000)
    expect(backoffDelay(20, 1_000)).toBe(30_000)
  })
})

describe('WebSocket 客户端', () => {
  it('未登录时不建立连接', () => {
    const factory = vi.fn((url: string) => new FakeSocket(url) as unknown as WebSocket)
    const client = createWebSocketClient({
      url: 'ws://x',
      getToken: () => null,
      socketFactory: factory,
    })
    client.connect()
    expect(factory).not.toHaveBeenCalled()
    expect(client.state).toBe('idle')
  })

  it('带 Token 连接并在 open 后进入 open 状态', () => {
    let created: FakeSocket | null = null
    const states: ConnectionState[] = []
    const client = createWebSocketClient({
      url: 'ws://x',
      getToken: () => 'tok en',
      onStateChange: (state) => states.push(state),
      socketFactory: (url) => {
        created = new FakeSocket(url)
        return created as unknown as WebSocket
      },
    })
    client.connect()
    expect(created!.url).toBe('ws://x?token=tok%20en')
    created!.onopen?.()
    expect(client.state).toBe('open')
    expect(states).toEqual(['connecting', 'open'])
  })

  it('解析消息负载，非法 JSON 不抛出', () => {
    const onMessage = vi.fn()
    let created: FakeSocket | null = null
    const client = createWebSocketClient({
      url: 'ws://x',
      onMessage,
      socketFactory: (url) => {
        created = new FakeSocket(url)
        return created as unknown as WebSocket
      },
    })
    client.connect()
    created!.onmessage?.({ data: '{"type":"ping","payload":1}' } as MessageEvent)
    expect(onMessage).toHaveBeenCalledWith({ type: 'ping', payload: 1 })

    expect(() => created!.onmessage?.({ data: 'not-json' } as MessageEvent)).not.toThrow()
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('断线自动重连，达到上限后停止', () => {
    vi.useFakeTimers()
    const sockets: FakeSocket[] = []
    const client = createWebSocketClient({
      url: 'ws://x',
      maxRetries: 2,
      retryBaseMs: 10,
      socketFactory: (url) => {
        const socket = new FakeSocket(url)
        sockets.push(socket)
        return socket as unknown as WebSocket
      },
    })
    client.connect()
    sockets[0]!.onclose?.()
    vi.advanceTimersByTime(10)
    sockets[1]!.onclose?.()
    vi.advanceTimersByTime(20)
    sockets[2]!.onclose?.()
    vi.advanceTimersByTime(10_000)

    expect(sockets).toHaveLength(3)
    expect(client.retryCount).toBe(2)
    vi.useRealTimers()
  })

  it('主动 close 后不再重连', () => {
    vi.useFakeTimers()
    const sockets: FakeSocket[] = []
    const client = createWebSocketClient({
      url: 'ws://x',
      retryBaseMs: 10,
      socketFactory: (url) => {
        const socket = new FakeSocket(url)
        sockets.push(socket)
        return socket as unknown as WebSocket
      },
    })
    client.connect()
    client.close()
    vi.advanceTimersByTime(10_000)
    expect(sockets).toHaveLength(1)
    expect(client.state).toBe('closed')
    vi.useRealTimers()
  })
})
