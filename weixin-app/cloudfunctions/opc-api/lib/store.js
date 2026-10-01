const { fail, clean, hash, now, uid } = require('./domain')
const PREFIX = 'opc_'
const extraCollections=['mcn','statements','callback_rules','callback_secrets','callback_logs']
function transactionConflict(error){
  if(['DATABASE_TRANSACTION_CONFLICT','ResourceUnavailable.TransactionConflict'].includes(error?.code))return true
  // wx-server-sdk 4.0.2 drops the upstream code while wrapping document errors,
  // preventing its underlying database driver's conflict-only retry from firing.
  if(error?.errCode!==-501001)return false
  return /\[ResourceUnavailable\.TransactionConflict\]|database transaction conflict|transaction (?:is )?conflict|write conflict|事务冲突/i.test(String(error.message||error.errMsg||''))
}
// -501001 是通用的 TCB_RESOURCE_SYSTEM_ERROR，单看错误码无法区分具体故障，
// 必须靠消息。除了写冲突，后端在并发事务争用同一批文档时还会返回
// TransactionBusy —— 同属瞬时失败，稍后重试即可成功：
//
//   document.get:fail -501001 resource system error.
//   [ResourceUnavailable.TransactionBusy] Transaction is busy.
//
// 不把它算作可重试会让整笔业务写入直接失败（隔离验收 2026-09-18 就卡在这里，
// 失败点还在 claim 与 assign 之间游走，正是争用而非确定性缺陷的特征）。
function transactionRetryable(error){
  if(transactionConflict(error))return true
  if(error?.errCode!==-501001)return false
  return /\[ResourceUnavailable\.TransactionBusy\]|transaction is busy/i.test(String(error.message||error.errMsg||''))
}
const collections = ['users','keys','sessions','limits','locks','projects','members','accounts','links','applications','channels','tasks','mappings','keywords','bindings','evidence','prices','requests','audit','jobs','files','imports','import_rows','facts','revisions','exceptions','income','income_entries','ledger','withdrawals','routes','announcements','story','courses','legacy','settings','legacy_plans','legacy_compositions','legacy_metrics','legacy_earnings','legacy_withdrawals','legacy_appeals','legacy_rules','legacy_batches','legacy_items','legacy_relay','invite_codes','invite_rewards']
function matches(row,where){
  const equal=(a,b)=>a===undefined||b===undefined?a===b:hash(a)===hash(b)
  const test=(value,expected)=>{
    if(expected&&typeof expected==='object'&&typeof expected.operator==='string'&&Array.isArray(expected.operands)){
      const operands=expected.operands
      switch(expected.operator){
        case 'and':return operands.every(item=>test(value,item))
        case 'or':return operands.some(item=>test(value,item))
        case 'in':return operands.some(item=>equal(item,value))
        case 'eq':return equal(value,operands[0])
        case 'gte':return value>=operands[0]
        case 'lte':return value<=operands[0]
        case 'gt':return value>operands[0]
        case 'lt':return value<operands[0]
        default:fail('事务查询条件暂不支持',422)
      }
    }
    return equal(value,expected)
  }
  return row&&Object.entries(where).every(([key,value])=>test(key.split('.').reduce((current,field)=>current?.[field],row),value))
}
class Store {
  constructor(db, handle = db) { this.db = db; this.handle = handle;this.inTransaction=handle!==db;this.cache=new Map();this.dirty=new Map();this.guards=new Map();this.operations=0 }
  col(name) { if (!collections.includes(name)) throw new Error('Unknown collection'); return this.handle.collection(PREFIX + name) }
  tick(){if(this.inTransaction&&++this.operations>90)fail('当前事务超过安全操作上限，请缩小批次',413)}
  async readDoc(name,id){
    this.tick();let result
    try{result=await this.col(name).doc(String(id)).get()}catch(error){if(error.errCode===-1&&String(error.message).includes('document with _id '+id+' does not exist'))return null;throw error}
    const row=Array.isArray(result.data)?result.data[0]:result.data
    if(!row)return null;const {_id,...value}=row;return value
  }
  async get(name, id) {
    const key=name+'/'+String(id)
    if(this.inTransaction&&this.cache.has(key))return clean(this.cache.get(key))
    const value=await this.readDoc(name,id);if(this.inTransaction)this.cache.set(key,value)
    return value===null?null:clean(value)
  }
  async guard(name){
    if(name==='locks')return
    if(!this.guards.has(name))this.guards.set(name,(async()=>{
      const id='collection-'+name,old=await this.get('locks',id);this.tick()
      const next={version:(old?.version||0)+1};await this.col('locks').doc(id).set({data:next});this.cache.set('locks/'+id,next)
    })())
    await this.guards.get(name)
  }
  async put(name, id, value) {
    if(!this.inTransaction)return this.transaction(tx=>tx.put(name,id,value))
    await this.guard(name);this.tick();const row=clean(value)
    await this.col(name).doc(String(id)).set({data:row});this.cache.set(name+'/'+id,row);this.dirty.set(name+'/'+id,{name,id:String(id),value:row});return value
  }
  async add(name, value) { const row = Object.assign({id:uid(),createdAt:now()},value); await this.put(name,row.id,row); return row }
  async remove(name,id) {
    if(!this.inTransaction)return this.transaction(tx=>tx.remove(name,id))
    await this.guard(name);this.tick();await this.col(name).doc(String(id)).remove();this.cache.set(name+'/'+id,null);this.dirty.set(name+'/'+id,{name,id:String(id),value:null})
  }
  async find(name, where = {}, options = {}) {
    // CloudBase forbids where() inside a transaction. A collection revision lock
    // is held by every Store writer; discover IDs through the nontransactional
    // query, then read each document in the transaction snapshot. This also
    // prevents phantom inserts/deletes, including an empty query result.
    if(this.inTransaction){
      this.col(name)
      if(name==='locks')fail('事务内锁记录仅支持按 ID 访问',422)
      await this.guard(name)
      const rows=await this.queryRows(this.db.collection(PREFIX+name),where,options),ids=new Set(rows.map(row=>String(row._id)))
      for(const row of this.dirty.values())if(row.name===name)ids.add(row.id)
      const result=[]
      for(const id of [...ids].sort()){const value=await this.get(name,id);if(matches(value,where))result.push(value)}
      if(result.length>(options.max||2000))fail('当前数据量需缩小查询范围或使用批处理',413)
      return result
    }
    return (await this.queryRows(this.col(name),where,options)).map(({_id,...value})=>value)
  }
  async queryRows(collection,where,options){
    let query = collection.where(where)
    const maximum = options.max || 2000
    const rows = []
    // Stable ordering prevents page overlap. Large jobs must use a durable cursor.
    for (let skip = 0; ; skip += 100) {
      const r = await query.orderBy('_id','asc').skip(skip).limit(100).get()
      for (const row of r.data) rows.push(row)
      if (rows.length > maximum) fail('当前数据量需缩小查询范围或使用批处理',413)
      if (r.data.length < 100) return rows
    }
  }
  async scan(name,where={},options={}){
    if(this.inTransaction)fail('游标扫描须在事务外执行；写入时须重新读取并校验',422)
    const limit=options.limit||50
    if(!Number.isInteger(limit)||limit<1||limit>100||options.after&&typeof options.after!=='string')fail('游标分页参数不正确')
    const filter={...where,...(options.after?{_id:this.db.command.gt(options.after)}:{})}
    const result=await this.col(name).where(filter).orderBy('_id','asc').limit(limit).get()
    return {rows:result.data.map(({_id,...value})=>value),cursor:result.data.length===limit?String(result.data[result.data.length-1]._id):null}
  }
  async transaction(work) {
    for(let attempt=0;;attempt++){
      try{return await this.db.runTransaction(tx=>work(new Store(this.db,tx)),0)}
      catch(error){
        // SDK retry count 0 makes it finish rollback before this whole transaction
        // is retried. Unknown commit results, timeouts and business faults do not retry.
        if(attempt>=5||!transactionRetryable(error))throw error
        await new Promise(resolve=>setTimeout(resolve,20*2**attempt+Math.floor(Math.random()*20)))
      }
    }
  }
  async lock(key) { const doc = hash(key), old = await this.get('locks',doc); await this.put('locks',doc,{version:(old?.version || 0)+1,updatedAt:now()}) }
  async unique(kind, value, owner) {
    const key = hash([kind,value]), old = await this.get('keys',key)
    if (old && old.owner !== owner) fail('该' + kind + '已存在',409)
    await this.put('keys',key,{kind,owner,value})
  }
  async audit(user, action, resource, detail = {}) { return this.add('audit',{userId:user.id,action,resourceId:String(resource),detail}) }
  async mutate(user, scope, action, key, payload, work) {
    if (!/^[\w.-]{8,128}$/.test(String(key || ''))) fail('缺少有效请求键')
    const requestId = hash([user.id,scope,action,key]), digest = hash(payload)
    return this.transaction(async tx => {
      await tx.lock(['scope',scope])
      await authorize(tx,user,scope)
      if(/^(keyword|binding|price|mapping|evidence|attribution)\./.test(action))await require('./routing').assertWritable(tx,scope)
      const previous = await tx.get('requests',requestId)
      if (previous) { if (previous.hash !== digest) fail('同一请求键不能用于不同内容',409); return previous.result }
      const result = await work(tx)
      await tx.put('requests',requestId,{id:requestId,userId:user.id,scope,action,hash:digest,result:result ?? null,createdAt:now()})
      await tx.audit(user,action,scope.projectId || user.id,{requestId})
      return result
    })
  }
}
async function authorize(tx,user,scope) {
  const current = await tx.get('users',user.id)
  if(!current?.isActive || current.role !== user.role || current.adminDuty !== user.adminDuty || (current.sessionVersion||0)!==(user.sessionVersion||0)) fail('账号权限已变化，请重新登录',401)
  const [project,account,links] = await Promise.all([tx.get('projects',scope.projectId),tx.get('accounts',scope.accountId),tx.get('links',hash(scope))])
  if (!project || !project.isEnabled || !account || account.moduleId !== 'zhihu' || account.status !== 'active' || !links) fail('项目或知乎接入账号不可用',403)
  if (user.role !== 'admin' && !await tx.get('members',hash([scope.projectId,user.id]))) fail('没有项目访问权限',403)
}
collections.push(...extraCollections)
module.exports = { Store, collections, PREFIX, authorize, transactionConflict, transactionRetryable, matches }
