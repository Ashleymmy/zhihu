const test = require('node:test'), assert = require('node:assert/strict');
const {harness,deferred}=require('./harness.cjs');
const initial={id:'321',userId:'TIMO-321',username:'TIMO-321',role:'creator',displayName:'原昵称',hasPassword:false,phone:'13800000001',phoneVerifiedAt:'2026-10-14'};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=','base64');
function setup(extra){
  let user={...initial}, bytes;
  const h=harness(c=>{
    const override=extra?.(c);if(override!==undefined)return override;
    if(c.path==='/core/auth/profile'){if(c.method==='POST')user={...user,...c.data};return {...user};}
    if(c.path==='/core/auth/avatar'){
      if(c.method==='POST'){bytes=c.data.base64;user={...user,avatarVersion:'a'.repeat(64)};return {...user};}
      return bytes?{base64:bytes,mimeType:'image/png',avatarVersion:user.avatarVersion}:null;
    }
    return {};
  });h.session({...user});return h;
}
test('nickname selection saves the form value and refreshes cached mine identity without changing ID',async()=>{
  const h=setup(),p=h.page('profile');await p.onShow();p.openDisplayNameModal();
  await p.submitEdit({detail:{value:{profileValue:'微信所选昵称'}}});
  assert.equal(p.data.showEditModal,false);assert.equal(h.app.globalData.user.displayName,'微信所选昵称');
  assert.equal(h.app.globalData.user.userId,'TIMO-321');assert.equal(p.canAct(),true);
  assert.equal(h.storage.get('zk_user').displayName,'微信所选昵称');
  const mine=h.page('mine');await mine.onShow();assert.equal(mine.data.user.displayName,'微信所选昵称');
});
test('avatar persists bytes instead of a temporary path and reloads from the server',async()=>{
  const h=setup(),p=h.page('profile');await p.onShow();h.files.set('/chosen.png',png);
  await p.chooseAvatar({detail:{avatarUrl:'/chosen.png'}});
  const sent=h.calls.find(c=>c.path==='/core/auth/avatar'&&c.method==='POST');
  assert.equal(sent.data.base64,png.toString('base64'));assert.ok(!JSON.stringify(sent.data).includes('/chosen.png'));
  assert.match(p.data.avatarSrc,/^\/local-test\/timo-avatar-321-/);assert.equal(h.files.get(p.data.avatarSrc).toString('base64'),png.toString('base64'));
  h.load('utils/avatar').clear();assert.equal(h.files.has(p.data.avatarSrc),false);
  await p.onShow();assert.match(p.data.avatarSrc,/timo-avatar-321-/);
  h.load('utils/auth').clear();assert.equal([...h.files.keys()].some(x=>x.includes('timo-avatar-')),false);
});
test('cancelled avatar selection sends nothing and failed save retains previous avatar',async()=>{
  const h=setup(c=>c.path==='/core/auth/avatar'&&c.method==='POST'?{http:503,body:{message:'保存失败'}}:undefined),p=h.page('profile');await p.onShow();
  await p.chooseAvatar({detail:{}});assert.ok(!h.calls.some(c=>c.path.endsWith('/avatar')));
  h.files.set('/chosen.png',png);await p.chooseAvatar({detail:{avatarUrl:'/chosen.png'}});
  assert.equal(p.data.avatarSrc,'/images/avatar.png');assert.match(p.data.avatarError,/保存失败/);assert.equal(p.data.avatarBusy,false);
});
test('late profile response after logout cannot overwrite a different account',async()=>{
  const pending=deferred(),h=setup(c=>c.path==='/core/auth/profile'&&c.method==='POST'?pending.promise:undefined),p=h.page('profile');await p.onShow();
  p.openDisplayNameModal();p.setData({editInput:'不应写入'});const saving=p.submitEdit();await new Promise(r=>setImmediate(r));
  h.load('utils/auth').clear();h.session({id:'999',role:'creator',displayName:'另一账号'},'another');
  pending.resolve({...initial,displayName:'不应写入'});await saving;assert.equal(h.app.globalData.user.displayName,'另一账号');
});
test('first login offers password setup and allows later; existing passwords never get overwritten by setup',async()=>{
  const h=setup(),auth=h.load('utils/auth'),p=h.page('password');
  assert.equal(auth.entryPath(initial),'/pages/password/index');await p.onShow();p.later();assert.equal(auth.entryPath(initial),'/pages/home/index');
  for(const value of ['12345678','abcdefgh','Abc123!@','Ab1234567890123456']){
    p.setData({newPassword:value,confirmPassword:value});await p.submit();assert.match(p.data.error,/8–16/);
  }
  assert.ok(!h.calls.some(c=>c.path.endsWith('/set-password')));
  p.setData({newPassword:'abc12345',confirmPassword:'abc12345'});await p.submit();
  const sent=h.calls.find(c=>c.path.endsWith('/set-password'));assert.equal(sent.data.oldPassword,undefined);assert.equal(sent.data.newPassword,'abc12345');
  assert.equal(h.storage.has('zk_access_token'),false);
});
test('already logged-in passwordless account can opt into WeChat with phone verification',async()=>{
  const h=setup(c=>c.path==='/core/auth/sms-policy'?{smsLoginEnabled:true}:c.path==='/core/auth/binding-status'?{bound:false}:c.path==='/core/auth/bind-current'?{...initial}:undefined);
  const p=h.page('bind');await p.onLoad({from:'profile'});p.setData({agreed:true,smsCode:'123456'});assert.equal(p.data.needsPassword,false);
  await p.submit();assert.ok(h.calls.some(c=>c.path==='/core/auth/bind-current'));
});
test('passwordless account has an actionable password setup path before account closure',async()=>{
  const h=setup(),p=h.page('privacy');await p.onShow();p.setPassword();
  assert.ok(h.navigation.includes('/pages/password/index'));
});
