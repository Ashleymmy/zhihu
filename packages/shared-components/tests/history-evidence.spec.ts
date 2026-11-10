import { describe, expect, it } from 'vitest'
import type { HistorySaveResult, HistoryTarget } from '@zhihu-koc/shared-contracts/core'
import { evidenceDateRanges, historyTargetFromError, historyTargetsAfterSave, remainingHistoryTargets } from '../src/history-evidence'
const context = { moduleId:'zhihu', accountId:'18', sourceKind:'legacy_report_record', sourceId:'71', sourceVersion:'v1:'+'a'.repeat(64), operation:'adopt_legacy_record' as const, selection:{ memberId:'5', date:'2026-10-03' } }
const target = (id:string):HistoryTarget => ({memberId:id,projectId:'3',at:'2026-10-03',label:'补齐历史资料',method:'POST',path:'/api/v1/core/relations/members/'+id+'/history-evidence',expectedVersion:4,context})
const result = (targets:HistoryTarget[]):HistorySaveResult => ({status:'verified',evidenceId:'11',version:5,refreshStatus:{status:'refreshed',recalculated:0,resumed:0,nextActions:targets},nextAction:targets[0]||null})
describe('history evidence continuation',()=>{
 it('keeps the signed source context distinct from evidence version',()=>{const t=historyTargetFromError({extras:{history:{version:99},nextAction:target('5')}});expect(t?.context).toBe(context);expect(t?.context?.sourceVersion).toBe(context.sourceVersion);expect(t?.expectedVersion).toBe(4)})
 it('accepts only the known endpoint and matching actual member',()=>{expect(historyTargetFromError({extras:{nextAction:{...target('5'),path:'https://other.invalid/api'}}})).toBeNull();expect(historyTargetFromError({extras:{nextAction:{...target('5'),memberId:'6'}}})).toBeNull()})
 it('preserves every server continuation and remaining queued person',()=>{const first=target('5'),second=target('6'),third=target('7');expect(historyTargetsAfterSave(result([second,third]))).toHaveLength(2);expect(remainingHistoryTargets([first,second,third],result([second]))).toEqual([second,third]);expect(remainingHistoryTargets([second,third],result([]))).toEqual([third])})
 it('does not resume on an unverified description',()=>{const pending={...result([target('5')]),status:'pending' as const};expect(historyTargetsAfterSave(pending)).toEqual([]);expect(remainingHistoryTargets([target('5')],pending)).toEqual([])})
 it('chunks arbitrary inclusive ranges without dropping a date or accepting a rolled-over calendar date',()=>{expect(evidenceDateRanges('2026-01-31','2026-04-03')).toEqual([{from:'2026-01-31',to:'2026-03-02'},{from:'2026-03-03',to:'2026-04-02'},{from:'2026-04-03',to:'2026-04-03'}]);expect(()=>evidenceDateRanges('2026-02-30','2026-03-02')).toThrow();expect(()=>evidenceDateRanges('2026-04-01','2026-03-01')).toThrow()})
})
