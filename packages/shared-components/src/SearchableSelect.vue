<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  id: string
  modelValue: string
  options: { value: string; label: string; detail?: string }[]
  placeholder?: string
  loading?: boolean
}>(), { placeholder: '输入关键词搜索并选择', loading: false })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const query = ref(''), open = ref(false), active = ref(-1)
const root = ref<HTMLElement>(), input = ref<HTMLInputElement>()
const selected = computed(() => props.options.find(option => option.value === props.modelValue))
const filtered = computed(() => {
  const text = query.value.trim().toLocaleLowerCase()
  return text ? props.options.filter(option => `${option.label} ${option.detail ?? ''} ${option.value}`.toLocaleLowerCase().includes(text)) : props.options
})
watch(filtered, () => { active.value = -1 })
watch(() => props.modelValue, value => { if (value) query.value = '' })
function choose(option: typeof props.options[number]) {
  emit('update:modelValue', option.value)
  query.value = ''
  open.value = false
}
function edit(event: Event) {
  query.value = (event.target as HTMLInputElement).value
  open.value = true
  emit('update:modelValue', '')
  // The text is a filter only. A plan ID is set exclusively by selecting a result.
}
function blur(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) {
    open.value = false
    query.value = ''
  }
}
async function keydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape') { open.value = false; query.value = ''; event.stopPropagation(); return }
  if (event.key === 'Enter' && open.value) {
    event.preventDefault()
    const option = filtered.value[active.value]
    if (option) choose(option)
    return
  }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
  event.preventDefault()
  open.value = true
  if (!filtered.value.length) return
  active.value = active.value < 0
    ? (event.key === 'ArrowDown' ? 0 : filtered.value.length - 1)
    : (active.value + (event.key === 'ArrowDown' ? 1 : -1) + filtered.value.length) % filtered.value.length
  await nextTick()
  root.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
}
</script>

<template>
  <div ref="root" class="searchable-select" @focusout="blur">
    <div class="select-control">
      <input :id="id" ref="input" :value="open ? query : selected?.label ?? ''"
        role="combobox" aria-autocomplete="list" aria-haspopup="listbox" :aria-expanded="open"
        :aria-controls="`${id}-options`" :aria-busy="loading"
        :aria-activedescendant="open && active >= 0 ? `${id}-option-${active}` : undefined"
        :placeholder="selected?.label || placeholder" autocomplete="off"
        @focus="open = true" @click="open = true" @input="edit" @keydown="keydown" />
      <button v-if="modelValue" type="button" class="select-clear" aria-label="清除已选计划"
        @click="query = ''; emit('update:modelValue', ''); input?.focus()">×</button>
      <span class="select-arrow" aria-hidden="true">⌄</span>
    </div>
    <div v-if="open" class="select-menu">
      <p v-if="loading" role="status">正在加载全部计划…</p>
      <p v-else-if="!filtered.length" role="status">{{ options.length ? '没有匹配的计划，请更换关键词' : '暂无可选计划' }}</p>
      <ul :id="`${id}-options`" role="listbox" aria-label="推广计划" :aria-busy="loading">
        <li v-for="(option, index) in filtered" :id="`${id}-option-${index}`" :key="option.value"
          role="option" :aria-selected="option.value === modelValue" :data-active="index === active"
          @mousedown.prevent @click="choose(option)" @mousemove="active = index">
          <span>{{ option.label }}</span><small v-if="option.detail">{{ option.detail }}</small>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.searchable-select { position: relative; min-width: 0; }
.select-control { position: relative; }
.select-control input { box-sizing: border-box; width: 100%; padding-right: 62px !important; }
.select-arrow { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; }
.select-clear { position: absolute; right: 30px; top: 50%; transform: translateY(-50%); border: 0; background: transparent; color: var(--ink-soft); cursor: pointer; }
.select-menu { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 5; max-height: min(260px, 40vh); overflow-y: auto; border: 1px solid var(--line); border-radius: var(--radius); background: var(--white); box-shadow: 0 6px 18px #0002; }
.select-menu ul { margin: 0; padding: 4px; list-style: none; }
.select-menu li { padding: 9px 10px; cursor: pointer; overflow-wrap: anywhere; font-size: 13px; }
.select-menu li[data-active="true"], .select-menu li[aria-selected="true"] { background: var(--paper-deep); }
.select-menu li small { display: block; color: var(--ink-soft); }
.select-menu p { margin: 12px; color: var(--ink-soft); font-size: 12px; }
</style>
