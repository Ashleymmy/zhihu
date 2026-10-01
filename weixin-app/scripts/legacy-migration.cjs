const d=require('../cloudfunctions/opc-api/lib/domain')
const targets={plans:'legacy_plans',compositions:'legacy_compositions',daily_metrics:'legacy_metrics',earnings:'legacy_earnings',withdrawal_requests:'legacy_withdrawals',finance_appeals:'legacy_appeals',pricing_rules:'legacy_rules',settlement_batches:'legacy_batches',settlement_items:'legacy_items',relay_logs:'legacy_relay'}
function yuan(cents){const value=d.cash(String(cents),true);if(value%100n)throw Error('历史分金额无法无损转换为四位小数元');return d.money(value/100n)}
function migrateLegacy(tables,add,handled){
  const blockers=[]
  for(const [table,collection]of Object.entries(targets)){
    handled.add(table)
    for(const original of tables[table]||[]){
      const row={...original}
      for(const [key,value]of Object.entries(row))if((key==='id'||key.endsWith('Id'))&&value!=null)row[key]=String(value)
      if(table==='earnings'||table==='withdrawal_requests'){
        row.sourceAmountCents=String(row.amount);row.amountYuan=yuan(row.amount);row.amountUnit='cent'
      }
      if(table==='finance_appeals'&&row.adjustAmount!=null){row.adjustAmount=String(row.adjustAmount);row.adjustAmountYuan=yuan(row.adjustAmount)}
      if(table==='withdrawal_requests'&&row.invoicePath)blockers.push({table,id:row.id,reason:'Invoice bytes must be copied to private cloud storage and hash verified'})
      // Original status and ownership are retained; an old approval is not invented as a new payment.
      add(collection,row.id,{...row,migrationSource:table})
    }
  }
  const find=(table,id)=>(tables[table]||[]).find(row=>String(row.id)===String(id))
  for(const table of Object.keys(targets))for(const row of tables[table]||[]){
    const references={userId:'users',ownerId:'users',creatorId:'users',leaderId:'users',targetUserId:'users',projectId:'projects',planId:'plans',batchId:'settlement_batches',itemId:'settlement_items',earningId:'earnings',ruleId:'pricing_rules'}
    for(const [field,target]of Object.entries(references))if(row[field]!=null&&!find(target,row[field]))blockers.push({table,id:String(row.id),reason:'Unresolved '+field+' reference'})
  }
  for(const log of tables.relay_logs||[]){
    const earning=find('earnings',log.earningId)
    if(!earning||String(earning.userId)!==String(log.userId)||earning.sourceRef!==`batch:${log.batchId}:item:${log.itemId}`||d.cash(yuan(earning.amount),true)!==d.cash(String(log.relayAmount),true))blockers.push({table:'relay_logs',id:String(log.id),reason:'Relay and earning reconciliation mismatch'})
  }
  const users={}
  for(const e of tables.earnings||[]){const u=users[e.userId]??={confirmed:0n,reserved:0n,approved:0n};if(e.status==='confirmed')u.confirmed+=d.cash(yuan(e.amount),true)}
  for(const w of tables.withdrawal_requests||[]){const u=users[w.userId]??={confirmed:0n,reserved:0n,approved:0n};if(['pending','leader_approved','approved'].includes(w.status))u.reserved+=d.cash(yuan(w.amount));if(w.status==='approved')u.approved+=d.cash(yuan(w.amount))}
  return {blockers,reconciliation:{unit:'yuan',policy:'Historical balances remain in a separate ledger; source earnings are imported once, relay logs are references only.',users:Object.fromEntries(Object.entries(users).map(([id,u])=>[id,{confirmed:d.money(u.confirmed),reserved:d.money(u.reserved),approved:d.money(u.approved),available:d.money(u.confirmed-u.reserved)}])),counts:Object.fromEntries(Object.keys(targets).map(table=>[table,(tables[table]||[]).length]))}}
}
module.exports={migrateLegacy,targets,yuan}
