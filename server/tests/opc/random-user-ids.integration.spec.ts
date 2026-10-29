import { beforeAll, afterAll, it, expect } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import { ModuleRuntime } from '../../src/core/module-runtime';
import { assignUserId, backfillUserIds, resolveUserIdentifier, userIdMap } from '../../src/auth/user-id';

let container: StartedMySqlContainer, c: mysql.Connection, app: import('express').Express;
let db: typeof import('../../src/db').db, tx: typeof import('../../src/db').withTransaction;
let hash: string, n = 0;
beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0').withDatabase('random_ids_test').withUsername('review').withUserPassword('isolated_only').start();
  const target = { host: container.getHost(), port: container.getPort(), database: container.getDatabase(), user: container.getUsername(), password: container.getUserPassword() };
  Object.assign(process.env, { DB_HOST: target.host, DB_PORT: String(target.port), DB_NAME: target.database, DB_USER: target.user, DB_PASS: target.password });
  await runOpcMigrations(target, []);
  c = await mysql.createConnection(target);
  ({ db, withTransaction: tx } = await import('../../src/db'));
  app = (await import('../../src/core/app')).createCoreApp(new ModuleRuntime());
  hash = await bcrypt.hash('Review123456', 4);
  await c.query("INSERT INTO users(id,username,password_hash,role,display_name,parent_id,must_change_pwd,phone,phone_verified_at) VALUES (1,'admin',?,'admin','管理',NULL,0,NULL,NULL),(2,'leader',?,'leader','团长',NULL,0,NULL,NULL),(3,'timo000003',?,'creator','达人',2,0,'13800000003',NOW()),(4,'custom_name',?,'creator','独立达人',NULL,0,NULL,NULL)", [hash,hash,hash,hash]);
}, 90000);
afterAll(async () => { if (db) await db.end(); if (c) await c.end(); if (container) await container.stop({ remove: true, removeVolumes: true }); },30000);
const uid = async (id: string) => (await tx(conn => userIdMap(conn,[id]))).get(id)!;
async function fresh(username?: string) {
  const [r] = await c.query<ResultSetHeader>("INSERT INTO users(username,password_hash,role,display_name,must_change_pwd) VALUES(?,?,'creator','新用户',0)", [username ?? 'new_' + ++n,hash]);
  return String(r.insertId);
}
async function freeId(start: number) {
  for (let i=start;i<999999;i++) {
    const id='timo'+String(i).padStart(6,'0');
    const [[r]]=await c.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM user_identifiers WHERE identifier=?)+(SELECT COUNT(*) FROM users WHERE username=?) n',[id,id]);
    if (!Number(r.n)) return id;
  }
  throw Error('No free test identifier');
}
async function login(username: string, loginMethod?: 'phone'|'username') {
  const client='random-ids-client-'+ ++n;
  const r=await request(app).post('/api/v1/core/auth/login').set('X-Client-Id',client).send({ username,password:'Review123456',loginMethod });
  expect(r.status,JSON.stringify(r.body)).toBe(200);
  return { result:r.body.data, headers:{Authorization:'Bearer '+r.body.data.token,'X-Client-Id':client} };
}
it('rolls back a dry run, then migrates every existing account atomically and idempotently without changing account relationships',async()=>{
  const snapshot=async()=>(await c.query<RowDataPacket[]>('SELECT id,password_hash,role,parent_id,phone,phone_verified_at,is_active FROM users ORDER BY id'))[0];
  const before=await snapshot();
  await c.beginTransaction();
  expect(await backfillUserIds(c)).toHaveLength(4);
  await c.rollback();
  expect((await c.query<RowDataPacket[]>('SELECT * FROM user_identifiers'))[0]).toHaveLength(0);
  expect((await c.query<RowDataPacket[]>('SELECT username FROM users WHERE id=3'))[0][0].username).toBe('timo000003');
  const changes=await tx(conn=>backfillUserIds(conn));
  expect(changes).toHaveLength(4);
  expect(new Set(changes.map(x=>x.userId)).size).toBe(4);
  for(const row of changes){
    expect(row.userId).toMatch(/^timo\d{6}$/);
    expect(changes.map(x=>x.oldId)).not.toContain(row.userId);
    expect(await resolveUserIdentifier(c,row.oldId.toUpperCase())).toBe(row.id);
    expect(await resolveUserIdentifier(c,'TIMO-'+row.id)).toBe(row.id);
  }
  expect(await snapshot()).toEqual(before);
  expect((await c.query<RowDataPacket[]>('SELECT username FROM users WHERE id=3'))[0][0].username).toBe(await uid('3'));
  expect((await c.query<RowDataPacket[]>('SELECT username FROM users WHERE id=4'))[0][0].username).toBe('custom_name');
  expect(await tx(conn=>backfillUserIds(conn))).toEqual([]);
});
it('rejects colliding public IDs, legacy IDs and custom usernames before choosing a unique ID',async()=>{
  const taken=await freeId(600000), custom=await fresh(taken), id=await fresh(), next=await freeId(610000);
  const candidates=[await uid('3'),'timo000003',taken,next];
  expect(await tx(conn=>assignUserId(conn,id,()=>candidates.shift()!))).toBe(next);
  expect(candidates).toHaveLength(0);
  await tx(conn=>assignUserId(conn,custom));
  await expect(tx(conn=>assignUserId(conn,'99999999'))).rejects.toMatchObject({httpStatus:404});
});
it('serializes concurrent allocation for the same user and retries collisions between different users',async()=>{
  const a=await fresh(), b=await fresh(), shared=await freeId(620000), other=await freeId(630000);
  const same=await Promise.all([tx(conn=>assignUserId(conn,a,()=>shared)),tx(conn=>assignUserId(conn,a,()=>other))]);
  expect(same[0]).toBe(same[1]);
  const candidate=await freeId(640000);let count=0;
  expect(await tx(conn=>assignUserId(conn,b,()=>count++===0?same[0]:candidate))).toBe(candidate);
  const x=await fresh(),y=await fresh(), collide=await freeId(650000), fallback=await freeId(660000);let retries=0, attempts=0;
  const values=await Promise.all([tx(conn=>assignUserId(conn,x,()=>attempts++===0?collide:fallback)),tx(conn=>assignUserId(conn,y,()=>retries++===0?collide:fallback))]);
  expect(new Set(values).size).toBe(2);
});
it('never parses random ID digits as an internal key and allocates no sequential aliases for new accounts',async()=>{
  const publicId=await freeId(700000), id=await fresh();
  await tx(conn=>assignUserId(conn,id,()=>publicId));
  const numeric=String(Number(publicId.slice(4)));
  await c.query("INSERT INTO users(id,username,password_hash,role,display_name,must_change_pwd) VALUES(?,?,?,'creator','不同账号',0)",[numeric,'numeric_'+numeric,hash]);
  await tx(conn=>assignUserId(conn,numeric));
  expect(await resolveUserIdentifier(c,publicId)).toBe(id);
  expect(await resolveUserIdentifier(c,'TIMO-'+id)).toBeUndefined();
  expect((await c.query<RowDataPacket[]>("SELECT * FROM user_identifiers WHERE user_id=? AND kind='legacy'",[id]))[0]).toHaveLength(0);
  expect(await resolveUserIdentifier(c,await freeId(710000))).toBeUndefined();
});
it('supports phone, new ID and both legacy ID logins while retaining own-account and team access restrictions',async()=>{
  for(const identifier of [await uid('3'),'timo000003','TIMO-3']) {
    const a=await login(identifier,'username');
    expect(a.result.user).toMatchObject({id:'3',userId:await uid('3'),parentId:'2'});
    expect((await request(app).get('/api/v1/core/auth/me?userId=4').set(a.headers)).body.data.id).toBe('3');
    expect((await request(app).get('/api/v1/core/team/members').set(a.headers)).status).toBe(403);
  }
  expect((await login('13800000003','phone')).result.user.userId).toBe(await uid('3'));
  expect((await login('custom_name','username')).result.user.id).toBe('4');
  const leader=await login('leader');
  const r=await request(app).get('/api/v1/core/team/members').set(leader.headers);
  expect(r.status).toBe(200);
  expect(r.body.data.map((u:any)=>u.id).sort()).toEqual(['2','3']);
  expect(r.body.data.find((u:any)=>u.id==='3').userId).toBe(await uid('3'));
  expect(r.body.data.every((u:any)=>!u.userIdAliases?.length)).toBe(true);
});
it('reserves identifiers after deletion and rolls back failed allocation without half-created accounts',async()=>{
  const id=await fresh(), value=await tx(conn=>assignUserId(conn,id));
  await expect(c.query('DELETE FROM users WHERE id=?',[id])).rejects.toMatchObject({code:'ER_ROW_IS_REFERENCED_2'});
  await tx(async conn=>{await conn.query('UPDATE user_identifiers SET user_id=NULL WHERE user_id=?',[id]);await conn.query('DELETE FROM users WHERE id=?',[id]);});
  expect(await resolveUserIdentifier(c,value)).toBeUndefined();
  const next=await fresh();
  await expect(tx(conn=>assignUserId(conn,next,()=>value))).rejects.toMatchObject({httpStatus:503});
  expect((await c.query<RowDataPacket[]>('SELECT * FROM user_identifiers WHERE public_user=?',[next]))[0]).toHaveLength(0);
  await tx(conn=>assignUserId(conn,next));
  await expect(tx(async conn=>{const [r]=await conn.query<ResultSetHeader>("INSERT INTO users(username,password_hash,role,display_name) VALUES('rolled_back',?,'creator','回滚')",[hash]);await assignUserId(conn,String(r.insertId));throw Error('rollback');})).rejects.toThrow('rollback');
  expect((await c.query<RowDataPacket[]>("SELECT * FROM users WHERE username='rolled_back'"))[0]).toHaveLength(0);
});
