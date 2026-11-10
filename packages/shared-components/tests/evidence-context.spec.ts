import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref, watch } from 'vue'
import { evidenceContextSources, evidenceFilterSources, type EvidenceContext } from '../src/evidence-context'

afterEach(()=>vi.useRealTimers())
const context=()=>reactive<EvidenceContext>({scope:{projectId:'1',accountId:'1',moduleId:'zhihu'},taskRef:'task',from:'2026-11-10',to:'2026-11-10'})
describe('evidence detail context changes',()=>{
 it('retains selection, history and unsaved input through three 15-second scope refreshes',async()=>{
  vi.useFakeTimers()
  const props=context(),scope=effectScope(),selected=ref('record'),history=ref('signed-target'),draft=ref('已经填写但尚未保存的历史资料'),close=vi.fn(()=>{selected.value='';history.value='';draft.value=''})
  scope.run(()=>watch(evidenceContextSources(props),close))
  const timer=setInterval(()=>{props.scope={...props.scope}},15000)
  try {
   await vi.advanceTimersByTimeAsync(45000)
   await nextTick()
   expect(close).not.toHaveBeenCalled()
   expect(selected.value).toBe('record')
   expect(history.value).toBe('signed-target')
   expect(draft.value).toBe('已经填写但尚未保存的历史资料')
  } finally {clearInterval(timer);scope.stop()}
 })
 it.each(['projectId','accountId','moduleId'] as const)('clears selected state after an actual %s change',async key=>{
  const props=context(),scope=effectScope(),close=vi.fn()
  scope.run(()=>watch(evidenceContextSources(props),close))
  props.scope={...props.scope,[key]:'different'}
  await nextTick()
  expect(close).toHaveBeenCalledTimes(1)
  scope.stop()
 })
 it.each(['taskRef','from','to'] as const)('clears selected state after an actual %s change',async key=>{
  const props=context(),scope=effectScope(),close=vi.fn()
  scope.run(()=>watch(evidenceContextSources(props),close))
  props[key]='different'
  await nextTick()
  expect(close).toHaveBeenCalledTimes(1)
  scope.stop()
 })
 it.each(['from','to','metricType'] as const)('clears selected state when the user changes filter %s',async key=>{
  const filter=reactive({from:'2026-11-10',to:'2026-11-10',metricType:'new_user'}),scope=effectScope(),close=vi.fn()
  scope.run(()=>watch(evidenceFilterSources(filter),close))
  filter[key]='different'
  await nextTick()
  expect(close).toHaveBeenCalledTimes(1)
  scope.stop()
 })
})
