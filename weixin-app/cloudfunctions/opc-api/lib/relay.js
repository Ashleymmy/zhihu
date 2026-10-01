const d=require('./domain')
const {mutate}=require('./legacy-finance')
const {assertLegacyRoute}=require('./routing')
function percentage(value){const text=String(value);if(!/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/.test(text))d.fail('比例须在 0 到 1 之间，最多六位小数');const [whole,fraction='']=text.split('.');return BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'))}
function apply(source,rule){return !rule?source:rule.method==='fixed'?d.cash(rule.unitPrice):(source*percentage(rule.percentage)+500000n)/1000000n}
function match(rules,role,userId){return rules.filter(r=>r.status==='active'&&r.targetRole===role&&(!r.targetUserId||r.targetUserId===userId)&&(!r.effectiveFrom||Date.parse(r.effectiveFrom)<=Date.now())).sort((a,b)=>Number(!!b.targetUserId)-Number(!!a.targetUserId)||Number(b.priority||0)-Number(a.priority||0)||(BigInt(a.id)<BigInt(b.id)?1:-1))[0]||null}
async function createBatch(c,input=c.data){
  d.duty(c.user,'finance');const periodStart=d.day(input.periodStart),periodEnd=d.day(input.periodEnd),title=d.text(input.title,'批次标题',128)
  if(periodStart>periodEnd)d.fail('周期不正确')
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>20)d.fail('单个结算批次须为 1 至 20 行，请拆分较大批次',413)
  const items=input.items.map(i=>({creatorId:d.id(i.creatorId),sourceAmount:d.money(d.cash(i.sourceAmount)),note:String(i.note||'').slice(0,255)}))
  return mutate(c,'legacy.batch.create',{title,periodStart,periodEnd,items},async tx=>{
    const batch={id:d.uid(),title,periodStart,periodEnd,status:'draft',totalSource:d.money(items.reduce((n,i)=>n+d.cash(i.sourceAmount),0n)),totalRelay:'0.0000',createdBy:c.user.id,createdAt:d.now()}
    for(const item of items){const u=await tx.get('users',item.creatorId);if(!u?.isActive||u.role!=='creator')d.fail('结算对象须为有效达人');await tx.add('legacy_items',{...item,batchId:batch.id})}
    await tx.put('legacy_batches',batch.id,batch);return {id:batch.id}
  })
}
async function approve(c){
  d.duty(c.user,'finance')
  return mutate(c,'legacy.batch.approve',{id:c.params.id},async tx=>{
    const batch=await tx.get('legacy_batches',c.params.id)
    if(!batch)d.fail('批次不存在',404);if(batch.status!=='draft')d.fail('只有草稿批次可审批',409)
    await assertLegacyRoute(tx,null,batch.periodEnd)
    const items=await tx.find('legacy_items',{batchId:batch.id}),rules=await tx.find('legacy_rules')
    if(!items.length||items.length>20)d.fail('审批批次明细数须为 1 至 20',413)
    const project=(await tx.find('projects',{slug:'zhihu'}))[0];if(!project)d.fail('缺少知乎项目',409)
    let total=0n
    for(const item of items){
      const creator=await tx.get('users',item.creatorId);if(!creator?.isActive||creator.role!=='creator')d.fail('达人状态已变化',409)
      const parent=creator.parentId?await tx.get('users',creator.parentId):null,source=d.cash(item.sourceAmount)
      const payees=[{user:creator,rule:match(rules,'creator',creator.id)}]
      if(parent?.role==='leader'){const rule=match(rules,'leader',parent.id);if(rule)payees.push({user:parent,rule})}
      for(const {user,rule}of payees){
        const value=apply(source,rule),sourceRef=`batch:${batch.id}:item:${item.id}`
        const id=d.hash(['legacy-earning',sourceRef,user.id])
        await tx.unique('legacy-earning',[user.id,sourceRef],id)
        if(await tx.get('legacy_earnings',id))d.fail('该来源收益已入账',409)
        await tx.put('legacy_earnings',id,{id,userId:user.id,projectId:project.id,planId:null,settleDate:batch.periodEnd,amount:d.money(value*100n),amountYuan:d.money(value),amountUnit:'cent',status:'confirmed',sourceRef,createdAt:d.now()})
        await tx.add('legacy_relay',{batchId:batch.id,itemId:item.id,earningId:id,userId:user.id,role:user.role,ruleId:rule?.id||null,method:rule?.method||'passthrough',unitPrice:rule?.unitPrice||null,percentage:rule?.percentage||null,sourceAmount:item.sourceAmount,relayAmount:d.money(value)})
        total+=value
      }
    }
    await tx.put('legacy_batches',batch.id,{...batch,status:'approved',approvedBy:c.user.id,approvedAt:d.now(),totalRelay:d.money(total)})
    return {id:batch.id,totalRelay:d.money(total)}
  })
}
async function importBatch(c){
  d.duty(c.user,'finance');const scope=d.scopeOf(c.data);await require('./store').authorize(c.store,c.user,scope)
  const {owned,download}=require('./files'),file=await owned(c.store,c.user,scope,d.id(c.data.fileId),'report'),buffer=await download(c.cloud,file)
  await require('../vendor/zhihu/allianceXlsx').validateAllianceXlsx({buffer,originalname:file.name,mimetype:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:buffer.length},{allowFormulas:true})
  const XLSX=require('xlsx'),book=XLSX.read(buffer,{type:'buffer',dense:true}),rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,raw:true,defval:null})
  let head=-1,userColumn=-1,amountColumn=-1,noteColumn=-1
  for(let i=0;i<Math.min(5,rows.length);i++){const columns=rows[i].map(v=>String(v||'').trim().toLowerCase());const u=columns.findIndex(v=>['达人用户名','用户名','达人','账号','username'].includes(v)),a=columns.findIndex(v=>['来源金额','结算金额','金额','收益金额','amount'].includes(v));if(u>=0&&a>=0){head=i;userColumn=u;amountColumn=a;noteColumn=columns.findIndex(v=>['备注','说明','note'].includes(v));break}}
  if(head<0)d.fail('未找到达人用户名与来源金额表头')
  const items=[]
  for(const row of rows.slice(head+1)){
    const username=String(row[userColumn]||'').trim(),text=String(row[amountColumn]??'').replace(/[¥￥,\s]/g,'')
    if(!username&&!text)continue
    const key=await c.store.get('keys',d.hash(['username',username.toLowerCase()]));if(!key)d.fail('结算表存在未知达人账号')
    items.push({creatorId:key.owner,sourceAmount:d.money(d.cash(text)),note:noteColumn>=0?row[noteColumn]:''})
  }
  return {...await createBatch(c,{...c.data,items}),imported:items.length}
}
function register(r){
  r('GET','/modules/zhihu/finance/rules',async c=>{d.duty(c.user,'finance');return c.store.find('legacy_rules')})
  r('POST','/modules/zhihu/finance/rules',async c=>{
    d.duty(c.user,'finance');const input={targetRole:c.data.targetRole,targetUserId:c.data.targetUserId?d.id(c.data.targetUserId):null,method:c.data.method,unitPrice:null,percentage:null,priority:Number(c.data.priority||0)}
    if(!['leader','creator'].includes(input.targetRole)||!['fixed','percentage'].includes(input.method)||!Number.isInteger(input.priority)||input.priority<0||input.priority>9999)d.fail('定价规则参数不正确')
    if(input.method==='fixed')input.unitPrice=d.money(d.cash(c.data.unitPrice));else{percentage(c.data.percentage);input.percentage=String(c.data.percentage)}
    return mutate(c,'legacy.rule.create',input,async tx=>{if(input.targetUserId){const u=await tx.get('users',input.targetUserId);if(!u?.isActive||u.role!==input.targetRole)d.fail('指定用户角色不匹配')}const row=await tx.add('legacy_rules',{...input,status:'active',effectiveFrom:d.now(),createdBy:c.user.id});return {id:row.id}})
  })
  r('POST','/modules/zhihu/finance/rules/:id/disable',async c=>{d.duty(c.user,'finance');return mutate(c,'legacy.rule.disable',{id:c.params.id},async tx=>{const row=await tx.get('legacy_rules',c.params.id);if(!row)d.fail('规则不存在',404);await tx.put('legacy_rules',row.id,{...row,status:'inactive'});return {id:row.id}})})
  r('GET','/modules/zhihu/finance/batches',async c=>{d.duty(c.user,'finance');return c.store.find('legacy_batches')})
  r('GET','/modules/zhihu/finance/batches/:id',async c=>{d.duty(c.user,'finance');const row=await c.store.get('legacy_batches',c.params.id);if(!row)d.fail('批次不存在',404);return {...row,items:await c.store.find('legacy_items',{batchId:row.id}),logs:await c.store.find('legacy_relay',{batchId:row.id})}})
  r('POST','/modules/zhihu/finance/batches',createBatch)
  r('POST','/modules/zhihu/finance/batches/import',importBatch)
  r('POST','/modules/zhihu/finance/batches/:id/approve',approve)
  r('POST','/modules/zhihu/finance/batches/:id/cancel',async c=>{d.duty(c.user,'finance');return mutate(c,'legacy.batch.cancel',{id:c.params.id},async tx=>{const row=await tx.get('legacy_batches',c.params.id);if(!row||row.status!=='draft')d.fail('只有草稿批次可撤销',409);await tx.put('legacy_batches',row.id,{...row,status:'cancelled'});return {id:row.id}})})
}
module.exports={register,apply,match,percentage}
