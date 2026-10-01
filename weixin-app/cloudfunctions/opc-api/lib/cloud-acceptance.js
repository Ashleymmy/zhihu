const d=require('./domain')
// Uses isolated control documents only, never imported users, balances or jobs.
// These tests prove real transaction primitives, not full business readiness.
async function transactions(store,reportStage=()=>{}){
  const prefix='acceptance-'+d.uid(),ids=['counter','winner-a','winner-b','balance','withdraw-a','withdraw-b','idempotency','idempotency-result','rollback','query-a','query-b'].map(id=>prefix+'-'+id)
  const [counter,a,b,balance,wa,wb,key,result,rollback,qa,qb]=ids,checks={},rollbackError=Error('acceptance rollback sentinel')
  let phase='acceptance.transaction.concurrent',failure=null
  const stage=value=>{phase=value;reportStage(value)}
  const together=async tasks=>{const results=await Promise.allSettled(tasks);const failed=results.find(row=>row.status==='rejected');if(failed)throw failed.reason;return results.map(row=>row.value)}
  try{
    stage('acceptance.transaction.single-create')
    await store.put('settings',counter,{value:0})
    stage('acceptance.transaction.single-update')
    await store.transaction(async tx=>{const row=await tx.get('settings',counter);await tx.put('settings',counter,{value:row.value+1})})
    checks.singleUpdate=(await store.get('settings',counter)).value===1
    await store.put('settings',counter,{value:0})
    stage('acceptance.transaction.concurrent')
    const attempt=id=>store.transaction(async tx=>{const row=await tx.get('settings',counter);if(row.value!==0)return false;await tx.put('settings',counter,{value:1});await tx.put('settings',id,{winner:true});return true})
    const winners=await together([attempt(a),attempt(b)])
    checks.concurrentClaim=winners.filter(Boolean).length===1&&(await store.get('settings',counter)).value===1
    stage('acceptance.transaction.balance')
    await store.put('settings',balance,{available:'10.0000'})
    const reserve=id=>store.transaction(async tx=>{const row=await tx.get('settings',balance);if(d.cash(row.available)<80000n)return false;await tx.put('settings',balance,{available:d.money(d.cash(row.available)-80000n)});await tx.put('settings',id,{amount:'8.0000'});return true})
    const reservations=await together([reserve(wa),reserve(wb)])
    checks.concurrentBalance=reservations.filter(Boolean).length===1&&(await store.get('settings',balance)).available==='2.0000'
    stage('acceptance.transaction.idempotency')
    const execute=()=>store.transaction(async tx=>{const old=await tx.get('settings',key);if(old)return old.result;await tx.put('settings',key,{result:'same-operation'});await tx.put('settings',result,{count:1});return 'same-operation'})
    const replies=await together([execute(),execute()])
    checks.idempotency=replies.every(value=>value==='same-operation')&&(await store.get('settings',result)).count===1
    stage('acceptance.transaction.rollback')
    try{await store.transaction(async tx=>{await tx.put('settings',rollback,{shouldNotPersist:true});throw rollbackError})}catch(error){if(error!==rollbackError)throw error}
    checks.rollback=await store.get('settings',rollback)===null
    stage('acceptance.transaction.query-own-writes')
    checks.queryOwnWrites=await store.transaction(async tx=>{
      await tx.put('settings',qa,{acceptanceGroup:prefix,value:1})
      const inserted=await tx.find('settings',{acceptanceGroup:prefix})
      await tx.remove('settings',qa)
      const removed=await tx.find('settings',{acceptanceGroup:prefix})
      return inserted.length===1&&inserted[0].value===1&&removed.length===0
    })
    stage('acceptance.transaction.query-concurrent')
    const insertOnce=id=>store.transaction(async tx=>{
      if((await tx.find('settings',{acceptanceGroup:prefix})).length)return false
      await tx.put('settings',id,{acceptanceGroup:prefix});return true
    })
    const inserts=await together([insertOnce(qa),insertOnce(qb)])
    checks.queryPhantom=inserts.filter(Boolean).length===1&&(await store.find('settings',{acceptanceGroup:prefix})).length===1
  }catch(error){failure=error;throw error}finally{
    const operationPhase=phase
    stage('acceptance.transaction.cleanup')
    let removals=[]
    try{await store.transaction(async tx=>{for(const id of ids)await tx.remove('settings',id)});removals=ids.map(()=>({status:'fulfilled'}))}
    catch(_){for(const id of ids){try{await store.remove('settings',id);removals.push({status:'fulfilled'})}catch(error){removals.push({status:'rejected',reason:error})}}}
    if(failure){failure.cleanupCompleted=removals.every(row=>row.status==='fulfilled');reportStage(operationPhase)}
    else{const failed=removals.find(row=>row.status==='rejected');if(failed)throw failed.reason}
  }
  return {checks,passed:Object.values(checks).every(Boolean)&&Object.keys(checks).length===7,scope:'transaction primitives only; imported data unchanged',cleanupCompleted:true}
}
module.exports={transactions}
