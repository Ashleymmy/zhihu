const {Store,collections,PREFIX}=require('./store')
// Server-only test adapter: all logical tables live inside opc_settings, using
// a run/table namespace. No synthetic users or money enter business collections.
function isolatedStore(db,runId){
  if(!/^[a-f0-9]{24}$/.test(runId))throw Error('Invalid acceptance namespace')
  function wrap(handle){return {collection(name){
    if(!collections.includes(name.slice(PREFIX.length))||!name.startsWith(PREFIX))throw Error('Unknown acceptance collection')
    const prefix='qa-'+runId+'-'+name.slice(PREFIX.length)+'-',raw=handle.collection(PREFIX+'settings')
    function strip(row){if(!row)return row;if(row._qaRun!==runId||row._qaCollection!==name)throw Error('Acceptance namespace mismatch');const {_qaRun,_qaCollection,...value}=row;return {...value,_id:String(value._id).slice(prefix.length)}}
    function query(current){return {
      where(filter){
        const scoped={...filter,_qaRun:runId,_qaCollection:name}
        if(scoped._id){const term=scoped._id;if(typeof term==='string')scoped._id=prefix+term;else if(term.operator==='gt')scoped._id=db.command.gt(prefix+term.operands[0]);else throw Error('Unsupported acceptance ID filter')}
        return query(current.where(scoped))
      },
      orderBy:(...args)=>query(current.orderBy(...args)),skip:n=>query(current.skip(n)),limit:n=>query(current.limit(n)),
      async get(){const result=await current.get();return {...result,data:Array.isArray(result.data)?result.data.map(strip):strip(result.data)}},
      doc(id){const reference=raw.doc(prefix+id);return {
        set:({data})=>reference.set({data:{...data,_qaRun:runId,_qaCollection:name}}),remove:()=>reference.remove(),
        async get(){let result;try{result=await reference.get()}catch(error){if(error.errCode===-1&&String(error.message).includes('document with _id '+prefix+id+' does not exist'))return {data:null};throw error}return {...result,data:Array.isArray(result.data)?result.data.map(strip):strip(result.data)}}
      }}
    }}
    return query(raw)
  }}}
  const adapter={...wrap(db),command:db.command,runTransaction:(work,retries)=>db.runTransaction(tx=>work(wrap(tx)),retries)}
  return new Store(adapter)
}
async function cleanup(store){
  let removed=0
  for(const name of [...collections.filter(name=>name!=='locks'),'locks']){
    // All test-created records include an id except internal lock/key entries.
    for(;;){
      const raw=await store.col(name).where({}).limit(20).get()
      if(!raw.data.length)break
      await store.transaction(async tx=>{for(const row of raw.data)await tx.remove(name,row._id)})
      removed+=raw.data.length
    }
  }
  return removed
}
module.exports={isolatedStore,cleanup}
