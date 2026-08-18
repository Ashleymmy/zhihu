/**
 * WebSocket 通知客户端骨架。M5 才接入真实通知流；此处先固化连接状态机与退避策略，
 * 保证 M1 阶段三应用可以引用同一套类型与生命周期，不各自造轮子。
 */

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed'

export interface NotificationMessage {
  type: string
  payload: unknown
  requestId?: string
}

export interface WebSocketClientOptions {
  url: string
  /** 每次连接前解析 Access Token；返回 null 表示未登录，跳过连接。 */
  getToken?: () => string | null
  onMessage?: (message: NotificationMessage) => void
  onStateChange?: (state: ConnectionState) => void
  maxRetries?: number
  /** 退避基数（毫秒），实际间隔为 base * 2^n，上限 30s。 */
  retryBaseMs?: number
  /** 便于测试注入；默认使用全局 WebSocket。 */
  socketFactory?: (url: string) => WebSocket
}

export interface WebSocketClient {
  connect(): void
  close(): void
  readonly state: ConnectionState
  readonly retryCount: number
}

const MAX_BACKOFF_MS = 30_000

export function backoffDelay(attempt: number, baseMs = 1_000): number {
  return Math.min(baseMs * 2 ** attempt, MAX_BACKOFF_MS)
}

export function createWebSocketClient(options: WebSocketClientOptions): WebSocketClient {
  const maxRetries = options.maxRetries ?? 5
  const retryBaseMs = options.retryBaseMs ?? 1_000
  let socket: WebSocket | null = null
  let state: ConnectionState = 'idle'
  let retryCount = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let manuallyClosed = false

  function setState(next: ConnectionState) {
    if (state === next) return
    state = next
    options.onStateChange?.(next)
  }

  function scheduleRetry() {
    if (manuallyClosed || retryCount >= maxRetries) return
    const delay = backoffDelay(retryCount, retryBaseMs)
    retryCount += 1
    timer = setTimeout(connect, delay)
  }

  function connect() {
    if (state === 'connecting' || state === 'open') return
    const token = options.getToken?.() ?? null
    // 未登录时不建立连接——避免匿名连接把服务端会话表打满。
    if (options.getToken && token === null) return

    manuallyClosed = false
    setState('connecting')
    const url = token ? `${options.url}?token=${encodeURIComponent(token)}` : options.url
    const factory = options.socketFactory ?? ((target: string) => new WebSocket(target))
    socket = factory(url)

    socket.onopen = () => {
      retryCount = 0
      setState('open')
    }
    socket.onmessage = (event: MessageEvent) => {
      try {
        options.onMessage?.(JSON.parse(String(event.data)) as NotificationMessage)
      } catch {
        // 非法负载直接丢弃，不影响连接。
      }
    }
    socket.onclose = () => {
      setState('closed')
      scheduleRetry()
    }
    socket.onerror = () => {
      socket?.close()
    }
  }

  function close() {
    manuallyClosed = true
    if (timer) clearTimeout(timer)
    timer = null
    socket?.close()
    socket = null
    setState('closed')
  }

  return {
    connect,
    close,
    get state() {
      return state
    },
    get retryCount() {
      return retryCount
    },
  }
}
