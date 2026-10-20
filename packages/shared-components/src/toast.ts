import { reactive } from 'vue'

/**
 * 全局轻提示与「撤销」。
 *
 * undoable() 只用于不涉及金额、可以逆转的操作（移除筛选、标记已读、合并疑似重复、移出列表等）：
 * 先在界面上生效，5 秒后才真正提交；期间点「撤销」就不提交，并调用 undo 恢复界面。
 * 确认账单、打款、停用账号、晋升生效等不可逆或涉及金额的操作，必须走对话面板写明后果，不要用这里。
 */
export interface ToastItem {
  id: number
  message: string
  tone: 'ok' | 'error' | 'undo'
  /** 撤销倒计时（毫秒），仅 undo 类型 */
  timeout?: number
  undo?: () => void
}

export const toastState = reactive({ items: [] as ToastItem[] })
let seq = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()
const pendingCommits = new Map<number, () => unknown>()

function remove(id: number) {
  const i = toastState.items.findIndex((item) => item.id === id)
  if (i >= 0) toastState.items.splice(i, 1)
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
}

/** 成功或失败的轻提示，3 秒后消失；失败提示要写清下一步 */
export function notify(message: string, tone: 'ok' | 'error' = 'ok') {
  const id = ++seq
  toastState.items.push({ id, message, tone })
  timers.set(id, setTimeout(() => remove(id), tone === 'error' ? 6000 : 3000))
  if (toastState.items.length > 3) remove(toastState.items[0]!.id)
  return id
}

export function undoable(options: {
  message: string
  commit: () => unknown | Promise<unknown>
  undo?: () => void
  timeout?: number
  failMessage?: string
}) {
  const id = ++seq, timeout = options.timeout ?? 5000
  const run = async () => {
    pendingCommits.delete(id)
    remove(id)
    try { await options.commit() } catch {
      options.undo?.()
      notify(options.failMessage ?? '没有保存成功，已恢复原样，请稍后重试。', 'error')
    }
  }
  pendingCommits.set(id, run)
  toastState.items.push({
    id,
    message: options.message,
    tone: 'undo',
    timeout,
    undo: () => {
      pendingCommits.delete(id)
      remove(id)
      options.undo?.()
    },
  })
  timers.set(id, setTimeout(run, timeout))
  return id
}

/** 页面关闭或跳走前，把还在倒计时的操作立即提交，避免用户以为已生效而实际没保存 */
export function flushUndoable() {
  for (const run of [...pendingCommits.values()]) void run()
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', flushUndoable)
