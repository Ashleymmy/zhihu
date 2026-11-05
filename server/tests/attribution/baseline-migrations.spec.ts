import { expect, it } from 'vitest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMigrations } from '../../scripts/migrationRunner';
import { runOpcMigrations } from '../../scripts/opcMigrations';

const riskMigration = '041_risk_reports.sql';
const reviewMigration = '041_work_review_records.sql';
const migrationNames = [riskMigration, reviewMigration];
const baseTables = [
  'zh_keyword_bindings',
  'zh_evidence',
  'compositions',
  'audit_logs',
  'zh_import_batches',
  'zh_import_rows',
  'zh_metric_facts',
  'zh_metric_revisions',
  'zh_attribution_results',
  'zh_statement_entries',
  'opc_income_sources',
  'opc_income_entries',
];
const reviewTables = ['zh_work_review_records'];
const riskTables = ['zh_risk_images', 'zh_risk_reports'];

async function snapshot(c: Connection, tables: string[]) {
  const result: Record<string, RowDataPacket[]> = {};
  // Table names are test constants, never request input.
  for (const table of tables) result[table] = (await c.query<RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY id`))[0];
  return result;
}

async function seedBusiness(c: Connection) {
  await c.query(
    "INSERT INTO users(id,username,password_hash,display_name,role) VALUES(1,'baseline-admin','unused','管理人员','admin'),(2,'baseline-creator','unused','成员','creator')",
  );
  await c.query(
    "INSERT INTO channels(id,project_id,zhihu_channel_id,generation,name) VALUES(1,1,'baseline-channel',1,'原渠道')",
  );
  await c.query(
    "INSERT INTO tasks(id,project_id,zhihu_task_id,name,synced_at) VALUES(1,1,'baseline-task','原活动','2026-09-01')",
  );
  await c.query(
    "INSERT INTO plans(id,project_id,keyword,channel_id,zhihu_task_id,landing_url,popularize_type,owner_id,created_by,sync_status,zhihu_plan_id) VALUES(1,1,'原关键词','baseline-channel','baseline-task','https://example.com/story',1,2,1,'synced','9001')",
  );
  await c.query(
    "INSERT INTO zh_channel_mappings(id,account_id,project_id,channel_id,channel_name,effective_from,created_by) VALUES(1,1,1,1,'原渠道','2026-09-01',1)",
  );
  await c.query(
    "INSERT INTO zh_keywords(id,account_id,project_id,task_id,channel_mapping_id,plan_id,keyword,created_by) VALUES(1,1,1,1,1,1,'原关键词',1)",
  );
  await c.query(`INSERT INTO zh_keyword_bindings(id,keyword_id,path_type,executor_id,relation_snapshot,activated_on,used_at,verification_status)
    VALUES(1,1,'direct_creator',2,'{"executorId":"2","source":"saved-assignment"}','2026-09-01','2026-09-01 12:00:00','passed')`);
  await c.query('UPDATE zh_keywords SET current_binding_id=1 WHERE id=1');
  await c.query(`INSERT INTO compositions(id,plan_id,owner_id,zhihu_composition_id,media_type,media_account,composition_type,composition_sub_type,promo_url,release_time,sync_status,zhihu_status_json)
    VALUES(1,1,2,'2071000000000000001',1,'original-account',1,1,'https://example.com/work','2026-09-02 12:00:00','synced','{"status":"pending","source":"original-upstream"}')`);
  await c.query(`INSERT INTO zh_evidence(id,binding_id,work_url,description,submitted_by,status,reviewed_by,reviewed_at)
    VALUES(1,1,'https://example.com/work','原始登记',2,'passed',NULL,'2026-09-02 12:01:00.123')`);
  await c.query(`INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,detail_json,created_at)
    VALUES(9001,NULL,'zhihu.work.default-review','zh_keyword_binding','1','{"policy":"R7-default-review-v1","bindingId":"1","compositionIds":["1"]}','2026-09-02 12:01:00.123')`);

  await c.query(
    `INSERT INTO zh_import_batches(id,account_id,project_id,file_name,file_sha256,file_bytes,report_kind,template_version,preview_hash,status,created_by)
    VALUES(1,1,1,'original.csv',REPEAT('a',64),?,'order','original-v1',REPEAT('b',64),'committed',1)`,
    [Buffer.from('original report bytes')],
  );
  await c.query(`INSERT INTO zh_import_rows(id,batch_id,line_number,normalized_json,raw_json,processing_status)
    VALUES(1,1,2,'{"date":"2026-09-03","orders":1}','{"original":"saved"}','processed')`);
  await c.query(
    "INSERT INTO zh_metric_facts(id,account_id,project_id,channel_mapping_id,keyword_id,business_date,metric_type) VALUES(1,1,1,1,1,'2026-09-03','new_user')",
  );
  await c.query(`INSERT INTO zh_metric_revisions(id,fact_id,source_row_id,snapshot_json,status,accepted_by)
    VALUES(1,1,1,'{"orders":1,"sourceRowId":"1"}','accepted',1)`);
  await c.query(`INSERT INTO zh_attribution_results(id,fact_id,revision_id,binding_id,input_hash,status,snapshot_json)
    VALUES(1,1,1,1,REPEAT('c',64),'ready','{"executorId":"2","bindingId":"1"}')`);
  await c.query('UPDATE zh_metric_facts SET current_revision_id=1,current_result_id=1 WHERE id=1');
  await c.query(`INSERT INTO zh_statement_entries(id,account_id,project_id,fact_id,result_id,revision_id,binding_id,relation_type,payer_kind,payer_id,payee_id,entry_kind,amount,target_amount,snapshot_json,input_hash,status,confirmed_by,confirmed_at)
    VALUES(1,1,1,1,1,1,1,'direct_creator','platform',1,2,'base','8.0000','8.0000','{"source":"original-confirmed-entry"}',REPEAT('d',64),'confirmed',1,'2026-09-04 09:00:00.456')`);
  await c.query(`INSERT INTO opc_income_sources(id,module_id,project_id,account_id,source_key,business_date,source_version,snapshot_hash,description)
    VALUES(1,'zhihu',1,1,'statement:1','2026-09-03','original-v1',REPEAT('e',64),'原已确认收益')`);
  await c.query(`INSERT INTO opc_income_entries(id,source_id,source_version,user_id,amount,target_amount,availability,entry_part,confirmed_by,confirmed_at)
    VALUES(1,1,'original-v1',2,'8.0000','8.0000','available','available',1,'2026-09-04 09:00:00.456')`);
}

async function seedReview(c: Connection) {
  await c.query(`INSERT INTO zh_work_review_records(binding_id,policy,status,detail_json,source_audit_id,created_at)
    SELECT 1,'R7-default-review-v1','passed',detail_json,id,created_at FROM audit_logs WHERE id=9001`);
}

async function seedRisk(c: Connection) {
  await c.query(`INSERT INTO zh_risk_images(id,project_id,account_id,actor_id,file_hash,file_token)
    VALUES('00000000-0000-4000-8000-000000000001',1,1,1,REPEAT('f',64),'original-image-token')`);
  await c.query(`INSERT INTO zh_risk_reports(id,project_id,account_id,actor_id,request_key,request_hash,content_hash,composition_id,upstream_composition_id,keyword,risk_type,payload_json,status,message,attempt)
    VALUES('00000000-0000-4000-8000-000000000002',1,1,1,'original-request',REPEAT('1',64),REPEAT('2',64),1,'2071000000000000001','原关键词',1,'{"compositionId":"1","imageIds":["00000000-0000-4000-8000-000000000001"]}','unknown','等待人工核对是否收到',2)`);
}

const cases = [
  { name: '全新安装同时登记两份 041', omitted: [], fresh: true },
  { name: '已安装作品审核后补风险迁移', omitted: [riskMigration], fresh: false },
  { name: '已安装风险后补作品审核迁移', omitted: [reviewMigration], fresh: false },
  { name: '两份均已安装时完整重跑', omitted: [], fresh: false },
];

it.each(cases)(
  '$name，保留原始依据、举报与已确认账',
  async ({ omitted, fresh }) => {
    const tempRoot = path.resolve(await mkdtemp(path.join(tmpdir(), 'zhihu-baseline-migrations-')));
    const completeSchema = path.join(tempRoot, 'complete');
    const installedSchema = path.join(tempRoot, 'installed');
    let container: StartedMySqlContainer | undefined;
    let c: Connection | undefined;
    try {
      // Capture the real checked-out files once. Only omit a complete filename in
      // this isolated copy to represent either independently published history.
      await cp(path.resolve('schema'), completeSchema, { recursive: true });
      await cp(completeSchema, installedSchema, {
        recursive: true,
        filter: (src) => !omitted.includes(path.basename(src)),
      });
      container = await new MySqlContainer('mysql:8.0')
        .withDatabase('baseline_migration_test')
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
      await runOpcMigrations(target, ['zhihu'], installedSchema);
      c = await mysql.createConnection(target);
      const registered = async () =>
        (
          await c!.query<RowDataPacket[]>(
            'SELECT name,applied_at FROM schema_migrations WHERE name IN (?,?) ORDER BY name',
            migrationNames,
          )
        )[0];
      const installed = await registered();
      expect(installed.map((r) => r.name)).toEqual(migrationNames.filter((name) => !omitted.includes(name)));
      const [initialTables] = await c.query<RowDataPacket[]>(
        `SELECT table_name name FROM information_schema.tables WHERE table_schema=DATABASE()
       AND table_name IN ('zh_work_review_records','zh_risk_images','zh_risk_reports') ORDER BY table_name`,
      );
      expect(initialTables.map((r) => r.name)).toEqual(
        [
          ...(!omitted.includes(riskMigration) ? riskTables : []),
          ...(!omitted.includes(reviewMigration) ? reviewTables : []),
        ].sort(),
      );

      if (fresh) {
        const tables = [...reviewTables, ...riskTables, 'zh_statement_entries', 'opc_income_entries'];
        const empty = Object.fromEntries(tables.map((table) => [table, []]));
        expect(await snapshot(c, tables)).toEqual(empty);
        await runOpcMigrations(target, ['zhihu'], completeSchema);
        const replay = await runMigrations(target, path.join(completeSchema, 'zhihu'));
        expect(replay.applied).toEqual([]);
        expect(replay.skipped).toEqual(expect.arrayContaining(migrationNames));
        expect(await registered()).toEqual(installed);
        expect(await snapshot(c, tables)).toEqual(empty);
        return;
      }

      await seedBusiness(c);
      if (!omitted.includes(reviewMigration)) await seedReview(c);
      if (!omitted.includes(riskMigration)) await seedRisk(c);
      const preservedTables = [
        ...baseTables,
        ...(!omitted.includes(reviewMigration) ? reviewTables : []),
        ...(!omitted.includes(riskMigration) ? riskTables : []),
      ];
      const before = await snapshot(c, preservedTables);
      expect(before.zh_statement_entries).toHaveLength(1);
      expect(before.zh_statement_entries[0]).toMatchObject({ status: 'confirmed', amount: '8.0000' });
      expect(before.opc_income_entries[0]).toMatchObject({ availability: 'available', amount: '8.0000' });

      const upgrade = await runMigrations(target, path.join(completeSchema, 'zhihu'));
      expect(upgrade.applied).toEqual(omitted);
      for (const row of installed) expect(upgrade.skipped).toContain(row.name);
      expect(await snapshot(c, preservedTables)).toEqual(before);
      const afterInstall = await registered();
      expect(afterInstall.map((r) => r.name)).toEqual(migrationNames);
      for (const row of installed) expect(afterInstall.find((r) => r.name === row.name)).toEqual(row);
      const [review] = await c.query<RowDataPacket[]>('SELECT * FROM zh_work_review_records');
      expect(review).toHaveLength(1);
      expect(review[0]).toMatchObject({
        binding_id: 1,
        policy: 'R7-default-review-v1',
        status: 'passed',
        source_audit_id: 9001,
        decided_by: null,
      });
      // On the risk-first installation, the missing review migration must recover
      // this saved approval, rather than merely registering its numeric prefix.
      expect(review[0].detail_json).toEqual(before.audit_logs[0].detail_json);
      if (omitted.includes(riskMigration)) await seedRisk(c);

      const allTables = [...baseTables, ...reviewTables, ...riskTables];
      const complete = await snapshot(c, allTables);
      expect(complete.zh_risk_reports).toHaveLength(1);
      expect(complete.zh_risk_reports[0]).toMatchObject({ status: 'unknown', attempt: 2 });
      await runOpcMigrations(target, ['zhihu'], completeSchema);
      const replay = await runMigrations(target, path.join(completeSchema, 'zhihu'));
      expect(replay.applied).toEqual([]);
      expect(replay.skipped).toEqual(expect.arrayContaining(migrationNames));
      expect(await registered()).toEqual(afterInstall);
      expect(await snapshot(c, allTables)).toEqual(complete);
    } finally {
      try {
        await c?.end();
        await container?.stop({ remove: true, removeVolumes: true });
      } finally {
        if (
          path.dirname(tempRoot) !== path.resolve(tmpdir()) ||
          !path.basename(tempRoot).startsWith('zhihu-baseline-migrations-')
        )
          throw new Error('Unsafe test cleanup path');
        await rm(tempRoot, { recursive: true, force: true });
      }
    }
  },
  120000,
);
