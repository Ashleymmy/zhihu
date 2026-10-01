// General diagnostics omit messages. Isolated synthetic probes may include a
// bounded SDK message after removing environment secrets and IDs. The message is
// what distinguishes one errCode from another: wx-server-sdk 4.0.2 drops the
// upstream code, so -501001 (SYS_ERR "resource system error") alone cannot tell a
// transaction conflict (retryable) from any other storage failure. Without it the
// acceptance only reports a bare 50000 and the failure cannot be diagnosed.
//
// Phase formats differ: api.js emits 'acceptance.api:<path>' (colon) while
// cloud-acceptance.js emits 'acceptance.transaction.<name>' (dot). Match both,
// otherwise the API failures this exists for are silently excluded.
function probeMessage(error){
  let message=String(error?.message||error?.errMsg||'')
  for(const [name,value]of Object.entries(process.env))if(/TOKEN|SECRET|PASSWORD|KEY/i.test(name)&&value&&value.length>=8)message=message.split(value).join('[redacted]')
  return message.replace(/(?:https?:\/\/|cloud:\/\/)[^\s"']+/gi,'[url]').replace(/acceptance-[\w-]+/g,'[probe]').replace(/\b[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\b/gi,'[id]').replace(/\b[A-Za-z\d_+/=-]{24,}\b/g,'[id]').slice(0,800)
}
function diagnostic(error,phase){
  const message=String(error?.message||error?.errMsg||''),raw=error?.errCode??error?.code
  const sdkCode=typeof raw==='number'?raw:typeof raw==='string'&&/^[A-Z][A-Z0-9_.-]{0,79}$/.test(raw)?raw:null
  const categories=[['collection-exists',/(collection|table).*(already|exist)/i],['collection-limit',/(collection|table).*(limit|quota|exceed)/i],['permission',/permission|unauthoriz|access.?denied/i],['timeout',/timeout|timed out/i],['transaction-conflict',/transaction conflict|write conflict|事务冲突/i],['transaction-busy',/transactionbusy|transaction is busy/i],['transaction',/transaction|事务/i],['quota',/quota|exceed|rate.?limit/i]]
  return {phase,sdkCode,errorType:['Error','TypeError','RangeError','SyntaxError'].includes(error?.name)?error.name:'SDKError',category:require('./store').transactionConflict(error)?'transaction-conflict':categories.find(([,pattern])=>pattern.test(message))?.[0]||'unclassified',operation:message.match(/\b(?:database|cloud|collection|document)\.[A-Za-z]+/)?.[0]||null,cleanupCompleted:error?.cleanupCompleted??null,...(/^acceptance\.(?:transaction\.|api:)/.test(phase)?{sdkMessage:probeMessage(error)}:{}),location:String(error?.stack||'').match(/(?:index\.js|migration\.js|bootstrap\.js):\d+:\d+/)?.[0]||null}
}
module.exports={diagnostic}
