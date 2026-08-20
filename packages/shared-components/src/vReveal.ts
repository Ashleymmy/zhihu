import type { Directive } from 'vue'

/**
 * v-reveal — 滚动进入视口时淡入上移。
 * 用法：v-reveal / v-reveal="120"（延迟 ms，用于分拍）
 * 首屏元素直接按延迟显现；视口外的元素交给 IntersectionObserver；
 * 无 IO 或用户偏好减少动效时立即显示。
 */
export const vReveal: Directive<HTMLElement, number | string | undefined> = {
  mounted(el, binding) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    const delay = Number(binding.value ?? 0)
    const show = () => el.classList.add('reveal-in')
    el.classList.add('reveal-init')

    // 首屏元素不等 IO（隐藏标签页/无头浏览器下 IO 可能不回调）
    const rect = el.getBoundingClientRect()
    const inViewport = rect.top < window.innerHeight && rect.bottom > 0
    if (inViewport || typeof IntersectionObserver === 'undefined') {
      setTimeout(show, delay)
      return
    }

    // 兜底：无论 IO 是否回调，1.2s 后强制显现，避免内容永远不可见
    const fallback = setTimeout(show, delay + 1200)

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          io.unobserve(el)
          clearTimeout(fallback)
          setTimeout(show, delay)
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -24px 0px' },
    )
    io.observe(el)
  },
}
