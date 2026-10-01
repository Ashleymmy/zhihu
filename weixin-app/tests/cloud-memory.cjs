const {Store}=require('../cloudfunctions/opc-api/lib/store')
const clone=v=>v==null?v:structuredClone(v)
class Expression {
  constructor(test,operator,operands){this.test=test;this.operator=operator;this.operands=operands}
  and(other){return new Expression(v=>this.test(v)&&other.test(v),'and',[this,other])}
}
function memory({optimistic=false}={}){
  let state=new Map(),tail=Promise.resolve(),versions=new Map()
  const commands={in:values=>new Expression(v=>values.includes(v),'in',values),gt:min=>new Expression(v=>v>min,'gt',[min]),lt:max=>new Expression(v=>v<max,'lt',[max]),gte:min=>new Expression(v=>v>=min,'gte',[min]),lte:max=>new Expression(v=>v<=max,'lte',[max])}
  const dot=(row,key)=>key.split('.').reduce((a,k)=>a?.[k],row)
  function handle(tables,transaction=false,writes=new Map()){
    function table(name){if(!tables.has(name))tables.set(name,new Map());return tables.get(name)}
    return {collection(name){
      const query=(where={},offset=0,size=100,order='_id')=>({
        where:w=>{if(transaction)throw Error('CloudBase transactions do not support where()');return query(w,offset,size,order)},
        orderBy:key=>query(where,offset,size,key),
        skip:n=>query(where,n,size,order),limit:n=>query(where,offset,n,order),
        async get(){let rows=[...table(name)].map(([id,value])=>({_id:id,...clone(value)})).filter(row=>Object.entries(where).every(([key,value])=>value instanceof Expression?value.test(dot(row,key)):dot(row,key)===value));rows.sort((a,b)=>String(a[order]).localeCompare(String(b[order])));return {data:rows.slice(offset,offset+size)}},
        async count(){return{total:table(name).size}},
        doc(id){return{
          async set({data}){table(name).set(String(id),clone(data));writes.set(name+'/'+id,{name,id:String(id),data:clone(data)});return{}},
          async get(){const v=table(name).get(String(id));return {data:v?{_id:id,...clone(v)}:null}},
          async remove(){table(name).delete(String(id));writes.set(name+'/'+id,{name,id:String(id),data:null});return{}},
        }},
      })
      return query()
    }}
  }
  const db={command:commands,collection:name=>handle(state).collection(name),async createCollection(name){if(!state.has(name))state.set(name,new Map())},
    runTransaction(work){
      if(optimistic)return(async()=>{
        const snapshot=clone(state),before=new Map(versions),writes=new Map()
        const result=await work(handle(snapshot,true,writes))
        for(const key of writes.keys())if(versions.get(key)!==before.get(key))throw Object.assign(Error('document.set:fail -501001 resource system error. [ResourceUnavailable.TransactionConflict] Transaction is conflict, maybe resource operated by others.'),{errCode:-501001})
        for(const [key,row]of writes){
          if(!state.has(row.name))state.set(row.name,new Map())
          if(row.data===null)state.get(row.name).delete(row.id);else state.get(row.name).set(row.id,clone(row.data))
          versions.set(key,(versions.get(key)||0)+1)
        }
        return result
      })()
      const task=tail.then(async()=>{const snapshot=clone(state);const result=await work(handle(snapshot,true));state=snapshot;return result})
      tail=task.catch(()=>{});return task
    }}
  const store=new Store(db)
  return {db,store,dump:name=>[...(state.get('opc_'+name)||new Map()).values()].map(clone)}
}
module.exports={memory}
