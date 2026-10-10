import { it, expect } from 'vitest';
import { MySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runOpcMigrations } from '../../scripts/opcMigrations';

it('从已付款的旧结构升级，保留银行资料、凭证、金额和旧账，重复迁移无变化', async () => {
  const tempRoot = path.resolve(await mkdtemp(path.join(tmpdir(), 'zhihu-finance-upgrade-')));
  const container = await new MySqlContainer('mysql:8.0')
    .withDatabase('finance_upgrade')
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
  const c = await mysql.createConnection(target);
  try {
    await cp(path.resolve('schema'), tempRoot, {
      recursive: true,
      filter: (src) => !['017_offline_payment_records.sql', '039_finance_workflow.sql'].includes(path.basename(src)),
    });
    await runOpcMigrations(target, ['zhihu'], tempRoot);
    await c.query(
      "INSERT INTO users(id,username,password_hash,display_name,role) VALUES(1,'migration-finance','unused','旧数据用户','creator')",
    );
    const [accounts] = await c.query<mysql.RowDataPacket[]>('SELECT id FROM integration_accounts LIMIT 1');
    await c.query(
      "INSERT INTO opc_withdrawals(module_id,project_id,account_id,user_id,amount,status,request_key,request_hash,receiver_name,bank_name,bank_account,payment_reference,paid_on,paid_by,paid_at,proof_name,proof_type,proof_bytes,proof_hash) VALUES('zhihu',1,?,1,12.3400,'paid','legacy-payment',REPEAT('a',64),'原收款人','原银行','原账号','原流水','2026-09-01',1,NOW(3),'原凭证.png','image/png',?,REPEAT('b',64))",
      [accounts[0].id, Buffer.from('preserved-proof')],
    );
    await c.query(
      "INSERT INTO earnings(user_id,project_id,settle_date,amount,status,source_ref) VALUES(1,1,'2026-09-01',1234.5678,'confirmed','upgrade-fixture')",
    );
    const [before] = await c.query<mysql.RowDataPacket[]>('SELECT * FROM opc_withdrawals');
    const [earnings] = await c.query('SELECT * FROM earnings');
    await runOpcMigrations(target, ['zhihu']);
    const [after] = await c.query<mysql.RowDataPacket[]>('SELECT * FROM opc_withdrawals');
    expect(after[0]).toMatchObject({ ...before[0], pay_method: 'bank', pay_account: null, payment_version: 0 });
    expect((await c.query('SELECT * FROM earnings'))[0]).toEqual(earnings);
    await runOpcMigrations(target, ['zhihu']);
    expect((await c.query('SELECT * FROM opc_withdrawals'))[0]).toEqual(after);
    expect((await c.query('SELECT * FROM earnings'))[0]).toEqual(earnings);
  } finally {
    await c.end();
    await container.stop({ remove: true, removeVolumes: true });
    // Only remove this test's freshly allocated directory after checking its absolute parent.
    if (
      path.dirname(tempRoot) !== path.resolve(tmpdir()) ||
      !path.basename(tempRoot).startsWith('zhihu-finance-upgrade-')
    )
      throw new Error('Unsafe test cleanup path');
    await rm(tempRoot, { recursive: true, force: true });
  }
}, 120000);
