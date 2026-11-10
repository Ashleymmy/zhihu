import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { SettlementSummary } from '@zhihu-koc/shared-contracts/core'
import SettlementSavedLabel from '../../../packages/shared-components/src/SettlementSavedLabel.vue'

const preview:SettlementSummary={
 id:'saved-1',version:'version',status:'preview',
 scope:{moduleId:'zhihu',projectId:'3',accountId:'18',leaderId:'5',from:'2026-11-07',to:'2026-11-10'},
 recipient:{id:'5',name:'王团长',role:'leader',active:true},
 summary:{amount:'97.0000',knownAmount:'97.0000',confirmedAmount:'0.0000',confirmableAmount:'10.0000',pendingCalculations:0,records:3,ready:1,blocked:2,confirmed:0,groups:[]},
 impactSummary:{recipients:2,records:1,amount:'170.0000',deltaAmount:'170.0000'},
 createdAt:'2026-11-10 10:00:00',confirmedAt:null,paymentStatus:'not_initiated',
}
async function text(item:SettlementSummary) {
 const html=await renderToString(createSSRApp({render:()=>h('button',[h(SettlementSavedLabel,{item})])}))
 return html.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim()
}
describe('saved settlement button labels',()=>{
 it('separates a 97 scope total from the selected recipient 10 ready delta',async()=>{
  const label=await text(preview)
  expect(label).toContain('待确认预览 · 范围应得 ¥97.00')
  expect(label).toContain('本次可确认变动 ¥10.00')
  expect(label).not.toContain('¥170.00')
 })
 it('never labels the scope total or cumulative balance as this confirmation amount',async()=>{
  const confirmed:SettlementSummary={...preview,status:'confirmed',confirmedAt:'2026-11-10 10:01:00',summary:{...preview.summary,confirmedAmount:'10.0000',confirmableAmount:'0.0000',ready:0,confirmed:1}}
  const label=await text(confirmed)
  expect(label).toContain('已确认 · 范围应得 ¥97.00 · 查看本次确认结果')
  expect(label).not.toMatch(/已确认 · ¥|本次确认.*¥|本次可确认|¥10\.00|¥0\.00/)
 })
 it('preserves zero and negative preview deltas without a positive-amount gate',async()=>{
  expect(await text({...preview,summary:{...preview.summary,confirmableAmount:'0.0000'}})).toContain('本次可确认变动 ¥0.00')
  expect(await text({...preview,summary:{...preview.summary,confirmableAmount:'-10.0000'}})).toContain('本次可确认变动 -¥10.00')
 })
 it('keeps an unknown complete scope amount distinct from zero',async()=>{
  expect(await text({...preview,summary:{...preview.summary,amount:null,pendingCalculations:1}})).toContain('范围应得 待计算')
 })
})
