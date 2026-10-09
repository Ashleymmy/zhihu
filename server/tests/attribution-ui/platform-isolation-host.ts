import { MySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import express from 'express';
import type { Server } from 'node:http';
import { runOpcMigrations } from '../../scripts/opcMigrations';
import { createSampleModule, sampleManifest } from '../../examples/sample-api/module';
import type { ModuleManifest } from '../../src/core/contracts';

async function main() {
  if (process.env.REMEDIATION_REVIEW !== '1' || process.env.NODE_ENV === 'production')
    throw Error('Only isolated review is allowed');
  const enabled = process.env.OPC_REVIEW_SAMPLE === '1';
  const container = await new MySqlContainer('mysql:8.0')
    .withDatabase('platform_isolation_test')
    .withUsername('review')
    .withUserPassword('isolated_review_only')
    .start();
  const target = {
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getUserPassword(),
  };
  let server: Server | undefined,
    upstream: Server | undefined,
    pool: typeof import('../../src/db').db | undefined,
    stopping = false;
  const close = async (s: Server | undefined) => {
    if (!s) return;
    await new Promise<void>((resolve) => {
      s.closeAllConnections();
      s.close(() => resolve());
    });
  };
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await close(server);
    await close(upstream);
    await pool?.end();
    await container.stop({ remove: true, removeVolumes: true });
    process.exit();
  };
  process.on('message', (m) => {
    if (m === 'stop') void stop();
  });
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
  try {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      OPC_MODULES: '',
      QUEUE_DRIVER: 'memory',
      RUN_BACKGROUND_JOBS: 'true',
      DB_HOST: target.host,
      DB_PORT: String(target.port),
      DB_NAME: target.database,
      DB_USER: target.user,
      DB_PASS: target.password,
      JWT_SECRET: 'platform_isolated_review_secret_32_characters',
      DEV_DEMO_AUTH: '0',
      LOG_LEVEL: 'silent',
    });
    await runOpcMigrations(target, []);
    const c = await mysql.createConnection(target),
      hash = await bcrypt.hash('Review123456', 4);
    for (const [id, username, role, duty, name, parent] of [
      [1, 'admin', 'admin', 'all', '管理员', null],
      [2, 'leader_wang', 'leader', 'all', '王团长', null],
      [3, 'creator_li', 'creator', 'all', '小李', 2],
      [4, 'review_ops', 'admin', 'operations', '运营', null],
      [5, 'review_finance', 'admin', 'finance', '财务', null],
      [6, 'creator_chen', 'creator', 'all', '小陈', null],
    ] as const)
      await c.query(
        'INSERT INTO users(id,username,password_hash,role,admin_duty,display_name,parent_id,is_active,must_change_pwd) VALUES(?,?,?,?,?,?,?,1,0)',
        [id, username, hash, role, duty, name, parent],
      );
    await c.query(
      "INSERT INTO projects(id,name,slug) VALUES(1,'示例甲项目','sample-a'),(2,'示例乙项目','sample-b'),(3,'知乎停用项目','disabled-zhihu')",
    );
    await c.query("INSERT INTO module_installations(module_id,version) VALUES('sample-api','1'),('zhihu','1')");
    await c.query(
      "INSERT INTO integration_accounts(id,module_id,account_key,name,created_by) VALUES(1,'sample-api','sample-a','示例甲',1),(2,'sample-api','sample-b','示例乙',1),(3,'zhihu','disabled','已停用',1)",
    );
    await c.query('INSERT INTO project_integrations(project_id,account_id) VALUES(1,1),(2,2),(3,3)');
    await c.query(
      'INSERT INTO project_members(project_id,user_id) VALUES(1,2),(2,2),(3,2),(1,3),(2,3),(3,3),(1,6),(3,6)',
    );
    const [tables] = await c.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE() AND LEFT(table_name,3)='zh_'",
    );
    if (Number(tables[0].n) !== 0) throw Error('Unexpected project tables');
    await c.end();
    const tasks: Record<string, { id: string; title: string; executorId: string | null; completed: boolean }[]> = {};
    for (const projectId of ['1', '2'])
      tasks[projectId] = [
        {
          id: '1',
          title: projectId === '1' ? '示例甲可领取任务' : '示例乙可领取任务',
          executorId: null,
          completed: false,
        },
        { id: '2', title: projectId === '1' ? '示例甲本人任务' : '示例乙本人任务', executorId: '3', completed: false },
      ];
    const mock = express();
    mock.use(express.json());
    mock.get('/tasks', (req, res) => {
      const list = tasks[String(req.query.projectId)] ?? [];
      res.json({ count: list.length, tasks: list });
    });
    mock.post('/claim', (req, res) => {
      const item = tasks[String(req.body.projectId)]?.find((t) => t.id === req.body.id);
      if (!item || item.executorId) {
        res.sendStatus(409);
        return;
      }
      item.executorId = String(req.body.userId);
      res.json({ ok: true });
    });
    upstream = await new Promise<Server>((resolve) => {
      const s = mock.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { ModuleRuntime } = await import('../../src/core/module-runtime'),
      { createCoreApp } = await import('../../src/core/app'),
      { mountStatic } = await import('../../src/composition/static');
    pool = (await import('../../src/db')).db;
    if (enabled) {
      const { withTransaction } = await import('../../src/db'),
        { writeEarningLines, confirmEarningSource } = await import('../../src/core/earnings');
      const actor = {
        sub: '1',
        username: 'admin',
        displayName: '管理员',
        role: 'admin' as const,
        adminDuty: 'all' as const,
        parentId: null,
        jti: 'sample-finance-review',
      };
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
      for (const projectId of ['1', '2']) {
        const quantity = projectId === '1' ? '2' : '3',
          amount = projectId === '1' ? '16.0000' : '24.0000';
        const scope = { moduleId: 'sample-api', projectId, accountId: projectId };
        await withTransaction(async (c) => {
          await writeEarningLines(c, scope, {
            sourceKey: 'completed:2',
            version: '1',
            date,
            taskId: '2',
            taskName: projectId === '1' ? '示例甲本人任务' : '示例乙本人任务',
            metricType: 'completed',
            metricLabel: '完成',
            unit: '个',
            lines: [
              {
                payeeId: '3',
                performerId: '3',
                performerName: '小李',
                ruleCode: 'creator',
                quantity,
                unitPrice: '8.0000',
                amount,
                internal: false,
                ready: true,
                reason: '',
                next: '财务：核对款项',
              },
              {
                payeeId: '2',
                performerId: '3',
                performerName: '小李',
                ruleCode: 'leader_override',
                quantity,
                unitPrice: '1.0000',
                amount: quantity + '.0000',
                internal: false,
                ready: true,
                reason: '',
                next: '财务：核对款项',
              },
            ],
          });
          await confirmEarningSource(c, actor, scope, 'completed:2', '1');
        });
      }
    }
    const disabled: ModuleManifest = {
      id: 'zhihu',
      name: '知乎',
      version: '1',
      contractVersion: 2,
      roles: ['admin', 'leader', 'creator'],
      capabilities: [],
      permissions: {},
      entryPath: '/modules/zhihu',
    };
    const runtime = new ModuleRuntime([sampleManifest, disabled]);
    if (enabled)
      runtime.register(
        createSampleModule('http://127.0.0.1:' + (upstream.address() as { port: number }).port + '/tasks'),
      );
    const app = createCoreApp(runtime, mountStatic);
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    process.send?.({ port: (server.address() as { port: number }).port, enabled });
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
    await stop();
  }
}
void main();
