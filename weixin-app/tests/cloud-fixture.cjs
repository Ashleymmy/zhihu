const assert=require('node:assert/strict')
const bcrypt=require('../cloudfunctions/opc-api/node_modules/bcryptjs')
const {memory}=require('./cloud-memory.cjs')
const d=require('../cloudfunctions/opc-api/lib/domain')
const {createAPI}=require('../cloudfunctions/opc-api/lib/api')
const passwordHash=bcrypt.hashSync('Test-password-123',4)
const identity={openid:'openid-one',appid:'wx22b91776ccf37354'}
const scope={projectId:'1',accountId:'10'}
async function fixture(cloud={}){
  const db=memory(),store=db.store
  const users=[
    {id:'1',username:'admin',displayName:'Admin',role:'admin',adminDuty:'all',parentId:null},
    {id:'2',username:'leader',displayName:'Leader',role:'leader',parentId:null},
    {id:'3',username:'creator',displayName:'Creator',role:'creator',parentId:'2'},
    {id:'4',username:'finance',displayName:'Finance',role:'admin',adminDuty:'finance',parentId:null},
    {id:'5',username:'operations',displayName:'Operations',role:'admin',adminDuty:'operations',parentId:null},
  ]
  for(const user of users){await store.put('users',user.id,{...user,passwordHash,isActive:true,sessionVersion:0,mustChangePwd:false,createdAt:d.now()});await store.unique('username',user.username,user.id)}
  await store.put('projects','1',{id:'1',name:'Project',isEnabled:true})
  await store.put('accounts','10',{id:'10',moduleId:'zhihu',status:'active',name:'Zhihu'})
  await store.put('links',d.hash(scope),scope)
  await store.put('routes',d.hash(scope),{id:d.hash(scope),...scope,exclusiveFrom:'2020-01-01',mode:'enabled',sampleVerified:true})
  for(const userId of ['2','3'])await store.put('members',d.hash(['1',userId]),{projectId:'1',userId,memberRole:'member'})
  await store.put('tasks','20',{id:'20',projectId:'1',name:'Task',zhihuTaskId:'200'})
  await store.put('channels','30',{id:'30',projectId:'1',name:'Channel',zhihuChannelId:'300',isEnabled:true})
  await store.put('mappings','40',{id:'40',...scope,channelId:'30',channelName:'test-channel',from:'2020-01-01',to:null,canonicalId:null})
  const api=createAPI(store,cloud,'test')
  async function login(username,id=identity){const r=await api.handle({method:'POST',path:'/core/auth/login',data:{username,password:'Test-password-123'}},id);assert.equal(r.code,0,r.message);return r.data.token}
  async function call(token,method,path,data={},id=identity){return api.handle({token,method,path,data},id)}
  return {...db,api,login,call,users}
}
module.exports={fixture,scope,identity}
