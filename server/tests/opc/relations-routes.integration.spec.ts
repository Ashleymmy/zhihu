import { afterAll, beforeAll, expect, it } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import request from 'supertest';
import type { Express } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runOpcMigrations } from '../../scripts/opcMigrations';

let container: StartedMySqlContainer, c: mysql.Connection, app: Express;
let db: typeof import('../../src/db').db;
const headers: Record<string, Record<string, string>> = {};
// 1 完整管理员；2 团长；3 达人（团长 2 邀请）；4 达人（达人 3 邀请，同属团长 2）；5 运营岗位；6 财务岗位；7 独立达人
const people = [
  { sub: '1', role: 'admin', adminDuty: 'all' },
  { sub: '2', role: 'leader', adminDuty: 'all' },
  { sub: '3', role: 'creator', adminDuty: 'all' },
  { sub: '4', role: 'creator', adminDuty: 'all' },
  { sub: '5', role: 'admin', adminDuty: 'operations' },
  { sub: '6', role: 'admin', adminDuty: 'finance' },
  { sub: '7', role: 'creator', adminDuty: 'all' },
] as const;
const get = (who: string | null, path: string, query: object = {}) => {
  const r = request(app)
    .get('/api/v1/core/relations' + path)
    .query(query);
  return who ? r.set(headers[who]) : r;
};

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0')
    .withCommand(['--log-bin-trust-function-creators=1'])
    .withDatabase('core_relation_routes')
    .withUsername('test')
    .withUserPassword('isolated')
    .start();
  const target = {
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getUserPassword(),
  };
  Object.assign(process.env, {
    NODE_ENV: 'test',
    OPC_MODULES: '',
    QUEUE_DRIVER: 'memory',
    DB_HOST: target.host,
    DB_PORT: String(target.port),
    DB_NAME: target.database,
    DB_USER: target.user,
    DB_PASS: target.password,
    JWT_SECRET: 'relation_routes_isolated_secret_over_32_chars',
  });
  delete process.env.DEV_DEMO_AUTH;
  await runOpcMigrations(target, []);
  c = await mysql.createConnection(target);
  for (const person of people)
    await c.query('INSERT INTO users(id,username,password_hash,role,admin_duty,display_name) VALUES(?,?,?,?,?,?)', [
      person.sub,
      'user' + person.sub,
      'unused',
      person.role,
      person.adminDuty,
      '人员' + person.sub,
    ]);
  await c.query('UPDATE users SET parent_id=2 WHERE id IN (3,4)');
  const dbModule = await import('../../src/db');
  db = dbModule.db;
  const rel = await import('../../src/core/member-relations');
  await dbModule.withTransaction(async (conn) => {
    for (const p of people) {
      const inviterId = p.sub === '3' ? '2' : p.sub === '4' ? '3' : null;
      await rel.recordRegistration(conn, {
        userId: p.sub,
        role: p.role,
        parentId: ['3', '4'].includes(p.sub) ? '2' : null,
        inviterId,
        channel: 'organic',
      });
    }
  });
  const { ModuleRuntime } = await import('../../src/core/module-runtime'),
    { createCoreApp } = await import('../../src/core/app');
  app = createCoreApp(new ModuleRuntime([]));
  const { issueRefreshSession } = await import('../../src/auth/tokenSessions'),
    { signToken } = await import('../../src/auth/jwt');
  for (const person of people) {
    const client = 'relation-client-' + person.sub,
      session = await issueRefreshSession(person.sub, { type: 'web', id: client });
    headers[person.sub] = {
      'X-Client-Id': client,
      Authorization:
        'Bearer ' +
        (await signToken({
          ...person,
          id: person.sub,
          username: 'user' + person.sub,
          displayName: '人员' + person.sub,
          parentId: null,
          sessionId: session.familyId,
        })),
    };
  }
}, 90000);
afterAll(async () => {
  await db?.end();
  await c?.end();
  await container?.stop();
}, 30000);

it('达人和团长看自己的邀请关系：邀请人与名单昵称脱敏，只给人数，不含手机号', async () => {
  const creator = await get('3', '/mine');
  expect(creator.status, creator.text).toBe(200);
  expect(creator.body.data).toMatchObject({
    inviter: { name: '人*2' },
    team: { leaderName: '人员2' },
    counts: { direct: 1, indirect: 0 },
    directList: [{ name: '人*4', active: true }],
  });
  expect(creator.text).not.toContain('人员4');
  expect(creator.text).not.toContain('phone');
  const leader = await get('2', '/mine');
  expect(leader.body.data.counts).toEqual({ direct: 1, indirect: 1 });
  expect(leader.body.data.directList.map((x: { name: string }) => x.name)).toEqual(['人*3']);
  const independent = await get('7', '/mine');
  expect(independent.body.data).toMatchObject({
    inviter: null,
    team: { leaderName: null },
    counts: { direct: 0, indirect: 0 },
  });
});

it('拒绝未登录、后台岗位查看 /mine，以及多余参数', async () => {
  expect((await get(null, '/mine')).status).toBe(401);
  for (const who of ['1', '5']) expect((await get(who, '/mine')).status).toBe(403);
  expect((await get('3', '/mine', { userId: '2' })).status).toBe(422);
});

it('运营岗位查看成员三种关系与时间线；达人、团长和财务岗位被拒绝', async () => {
  const detail = await get('5', '/members/4');
  expect(detail.status, detail.text).toBe(200);
  expect(detail.body.data).toMatchObject({
    user: { id: '4', role: 'creator', active: true },
    referral: { inviter: { id: '3', name: '人员3' } },
    team: { leader: { id: '2', name: '人员2' } },
    counts: { direct: 0, indirect: 0 },
  });
  expect(detail.body.data.timeline.map((t: { kind: string }) => t.kind).sort()).toEqual(['role', 'team']);
  for (const who of ['2', '3', '6']) expect((await get(who, '/members/4')).status).toBe(403);
  expect((await get('5', '/members/999')).status).toBe(404);
  expect((await get('1', '/members/4')).status).toBe(200);
});

it('成员树按团队或邀请逐层加载；平台直管单列；拒绝非运营岗位与未知参数', async () => {
  const roots = await get('5', '/tree', { mode: 'team' });
  expect(roots.status, roots.text).toBe(200);
  expect(roots.body.data.list[0]).toMatchObject({ id: 'platform', children: 1 });
  expect(roots.body.data.list.find((n: { id: string }) => n.id === '2')).toMatchObject({ role: 'leader', children: 2 });
  expect(
    (await get('5', '/tree', { mode: 'team', parent: '2' })).body.data.list.map((n: { id: string }) => n.id),
  ).toEqual(['3', '4']);
  expect(
    (await get('5', '/tree', { mode: 'team', parent: 'platform' })).body.data.list.map((n: { id: string }) => n.id),
  ).toEqual(['7']);
  const inviteRoots = (await get('5', '/tree', { mode: 'invite' })).body.data.list.map((n: { id: string }) => n.id);
  expect(inviteRoots).toEqual(['2', '7']);
  expect((await get('5', '/tree', { mode: 'invite', parent: '2' })).body.data.list).toMatchObject([
    { id: '3', children: 1 },
  ]);
  expect(
    (await get('5', '/tree', { mode: 'invite', parent: '3' })).body.data.list.map((n: { id: string }) => n.id),
  ).toEqual(['4']);
  for (const who of ['2', '3', '6']) expect((await get(who, '/tree')).status).toBe(403);
  expect((await get('5', '/tree', { depth: '3' })).status).toBe(422);
});

it('关系树和历史分页可继续读取，不截断完整成员名单', async () => {
  const first = await get('1', '/tree', { mode: 'team', parent: '2', pageSize: 1 });
  const second = await get('1', '/tree', { mode: 'team', parent: '2', pageSize: 1, page: 2 });
  expect(first.body.data.hasMore).toBe(true);
  expect(second.body.data.hasMore).toBe(false);
  expect([...first.body.data.list, ...second.body.data.list].map((v: any) => v.id)).toEqual(['3', '4']);
  const detail = await get('1', '/members/3', { pageSize: 1 });
  expect(detail.body.data.total).toBe(2);
});
it('客服设置仅完整管理员可改，链接限定飞书 HTTPS 并拒绝过期保存', async () => {
  expect((await request(app).get('/api/v1/core/support')).status).toBe(401);
  for (const who of ['1', '2', '3', '5', '6'])
    expect((await request(app).get('/api/v1/core/support').set(headers[who])).status).toBe(200);
  const body = {
    revision: 0,
    serviceUrl: 'https://applink.feishu.cn/client/contact/example',
    businessUrl: '',
    serviceHours: '工作日',
    miniContactEnabled: true,
  };
  for (const who of ['2', '3', '5', '6'])
    expect((await request(app).put('/api/v1/core/support').set(headers[who]).send(body)).status).toBe(403);
  for (const bad of ['javascript:alert(1)', 'https://feishu.cn.evil.example/', 'https://user:pass@feishu.cn/'])
    expect(
      (
        await request(app)
          .put('/api/v1/core/support')
          .set(headers['1'])
          .send({ ...body, serviceUrl: bad })
      ).status,
    ).toBe(422);
  const saved = await request(app).put('/api/v1/core/support').set(headers['1']).send(body);
  expect(saved.status, saved.text).toBe(200);
  expect(saved.body.data.revision).toBe(1);
  expect((await request(app).put('/api/v1/core/support').set(headers['1']).send(body)).status).toBe(409);
});
it('成员导出拒绝达人团长财务，运营导出不包含金额，后台全部筛选成员均在表中', async () => {
  const body = { memberIds: ['2', '3', '4'], from: '2026-01-01', to: '2026-12-31' };
  for (const who of ['2', '3', '6'])
    expect((await request(app).post('/api/v1/core/member-exports').set(headers[who]).send(body)).status).toBe(403);
  expect(
    (
      await request(app)
        .post('/api/v1/core/member-exports')
        .set(headers['5'])
        .send({ ...body, includeEarnings: true })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .post('/api/v1/core/member-exports')
        .set(headers['1'])
        .send({ ...body, memberIds: ['99999'] })
    ).status,
  ).toBe(409);
  await c.query("UPDATE users SET display_name='=unsafe()',phone='0013800123456' WHERE id=3");
  const result = await request(app)
    .post('/api/v1/core/member-exports')
    .set(headers['5'])
    .send(body)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (v) => chunks.push(Buffer.from(v)));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  expect(result.status, result.text).toBe(200);
  const XLSX = await import('xlsx');
  const book = XLSX.read(result.body, { type: 'buffer' });
  expect(book.SheetNames).not.toContain('收益分类');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets['成员与归属']);
  expect(rows).toHaveLength(3);
  const [ids]=await c.query<mysql.RowDataPacket[]>('SELECT public_user,identifier FROM user_identifiers WHERE public_user IN (2,3)');
  const uid=(id:number)=>ids.find(r=>Number(r.public_user)===id)!.identifier;
  expect(rows.find((r) => r['用户ID'] === uid(3))).toMatchObject({
    姓名: '=unsafe()',
    手机号: '0013800123456',
    当前团长ID: uid(2),
    邀请人ID: uid(2),
  });
  for (const [key, cell] of Object.entries(book.Sheets['成员与归属']))
    if (!key.startsWith('!')) expect((cell as any).f).toBeUndefined();
});

it('商务二维码仅管理人员配置，原图受登录保护，旧客户端保存保留图片且变更原子化', async () => {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
  const sharedJpeg = Buffer.concat([
    readFileSync(path.join(__dirname, '../fixtures/business-jpeg-test.jpg')),
    Buffer.from('55fbf40900000000000102030405060708090a0b0c0d0e0f', 'hex'),
  ]).toString('base64');
  const uri = '/api/v1/core/support', imageUri = uri + '/business-qrcodes/wechat';
  expect((await request(app).get(imageUri)).status).toBe(401);
  const before = (await request(app).get(uri).set(headers['1'])).body.data;
  const body = { ...before, businessQrCodes: [{ channel: 'wechat', name: '微信商务', base64 }, { channel: 'feishu', name: '飞书商务', base64: sharedJpeg }] };
  for (const who of ['2', '3', '5', '6']) expect((await request(app).put(uri).set(headers[who]).send(body)).status).toBe(403);
  for (const entries of [
    [{ channel: 'wechat', name: '错误图片', base64: Buffer.from('<svg onload="alert(1)"/>').toString('base64') }],
    [body.businessQrCodes[0], body.businessQrCodes[0]],
    [{ channel: 'wechat', name: '外部链接', base64: 'https://example.com/qr.png' }],
  ]) expect((await request(app).put(uri).set(headers['1']).send({ ...body, businessQrCodes: entries })).status).toBe(422);
  const saved = await request(app).put(uri).set(headers['1']).send(body);
  expect(saved.status, saved.text).toBe(200);
  expect(saved.body.data.businessQrCodes).toHaveLength(2);
  expect(saved.text).not.toContain(base64);
  const metadata = saved.body.data.businessQrCodes;
  const jpegRead = await request(app).get(uri + '/business-qrcodes/feishu').set(headers['3']);
  expect(jpegRead.status).toBe(200);
  expect(jpegRead.body.data).toMatchObject({ mimeType: 'image/jpeg', base64: sharedJpeg });
  for (const who of ['1', '2', '3', '5', '6', '7']) {
    const image = await request(app).get(imageUri).set(headers[who]);
    expect(image.status).toBe(200);
    expect(image.body.data).toMatchObject({ channel: 'wechat', mimeType: 'image/png', base64, version: metadata.find((q: any) => q.channel === 'wechat').version });
  }
  expect((await request(app).put(uri).set(headers['1']).send(body)).status).toBe(409);
  const invalidUpdate = { ...saved.body.data, businessQrCodes: [metadata[0], { channel: 'feishu', name: '错误图片', base64: 'bad' }] };
  expect((await request(app).put(uri).set(headers['1']).send(invalidUpdate)).status).toBe(422);
  expect((await request(app).get(uri).set(headers['1'])).body.data).toEqual(saved.body.data);
  const { businessQrCodes: _images, ...oldClient } = saved.body.data;
  const preserved = await request(app).put(uri).set(headers['1']).send(oldClient);
  expect(preserved.status).toBe(200);
  expect(preserved.body.data.businessQrCodes).toEqual(metadata);
  const renamed = await request(app).put(uri).set(headers['1']).send({ ...preserved.body.data, businessQrCodes: metadata.map((q: any) => ({ ...q, name: q.name + '更新' })) });
  expect(renamed.status).toBe(200);
  expect(renamed.body.data.businessQrCodes[0].name).toContain('更新');
  const [logs] = await c.query<mysql.RowDataPacket[]>("SELECT detail_json FROM audit_logs WHERE action='support.update'");
  expect(JSON.stringify(logs)).not.toContain(base64);
  expect(JSON.stringify(logs)).not.toContain(sharedJpeg);
  const removed = await request(app).put(uri).set(headers['1']).send({ ...renamed.body.data, businessQrCodes: [] });
  expect(removed.status).toBe(200);
  expect((await request(app).get(imageUri).set(headers['3'])).status).toBe(404);
});
