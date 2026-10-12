/**
 * demo 同款 toast 通知（右下角滑入，3.6s 自动消失）
 * 模块级单例：任何组件 import 后可直接调用 toast()
 */
import { ref } from 'vue'

export interface ToastItem {
  id: number
  text: string
}

const items = ref<ToastItem[]>([])
let seq = 0

export function useToast() {
  function toast(text: string) {
    const id = ++seq
    items.value.push({ id, text })
    setTimeout(() => {
      items.value = items.value.filter((t) => t.id !== id)
    }, 3600)
  }
  return { items, toast }
}
