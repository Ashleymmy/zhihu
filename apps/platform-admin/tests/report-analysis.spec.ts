import { describe, expect, it } from 'vitest'
import { reportAnalysisForDisplay, type ReportRun } from '../../module-views/zhihu/report-analysis'

const run:ReportRun={
 id:'report',fileName:'拉新报表',status:'needs_input',progress:{done:6,total:6},steps:[],
 conclusion:{title:'本次报表已读取 6 条拉新记录',value:'44 单',summary:'成员金额已算出',pendingText:'5 条记录仍需处理，涉及 7 单，其他记录可以继续核对。',actions:[{key:'details',label:'查看金额与待处理明细'}]},
 totals:{reportedQuantity:'44',reportedSettlement:null,staffAmount:'0.0000',billableQuantity:'37',billableAmount:'314.5000',confirmableAmount:'170.0000',pendingQuantity:'7',excludedQuantity:'0'},
}
describe('report analysis distinguishes pending records from unpriced units',()=>{
 it('keeps five pending records while identifying only seven units as unpriced',()=>{
  const displayed=reportAnalysisForDisplay(run)
  expect(displayed.conclusion?.pendingText).toBe('5 条记录仍需处理；其中 7 单尚未计价；已计价的待处理记录仍需补齐资料。其他记录可以继续核对。')
  expect(displayed.totals).toBe(run.totals)
  expect(displayed.steps).toBe(run.steps)
  expect(displayed.conclusion?.actions).toBe(run.conclusion?.actions)
  expect(run.conclusion?.pendingText).toContain('涉及 7 单')
 })
 it('retains the server unit and exact quantity for activation',()=>{
  const quantity='9007199254740993'
  const activation:ReportRun={...run,totals:{...run.totals!,pendingQuantity:quantity},conclusion:{...run.conclusion!,pendingText:`2 条记录仍需处理，涉及 ${quantity} 个，其他记录可以继续核对。`}}
  expect(reportAnalysisForDisplay(activation).conclusion?.pendingText).toContain(`其中 ${quantity} 个尚未计价`)
 })
 it('preserves nonfinancial, processing and already corrected copy',()=>{
  for(const entry of [{...run,totals:undefined},{...run,status:'running' as const},{...run,conclusion:{...run.conclusion!,pendingText:'5 条记录仍需处理，其他记录可以继续核对。'}}])expect(reportAnalysisForDisplay(entry)).toBe(entry)
 })
 it('does not reinterpret a quantity that disagrees with the structured total',()=>{
  const mismatched={...run,totals:{...run.totals!,pendingQuantity:'17'}}
  expect(reportAnalysisForDisplay(mismatched)).toBe(mismatched)
 })
})
