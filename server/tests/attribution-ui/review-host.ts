// Owns a disposable database for the real review-demo application and browser checks.
import { MySqlContainer } from '@testcontainers/mysql';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { runOpcMigrations } from '../../scripts/opcMigrations';

async function main() {
  if (process.env.REMEDIATION_REVIEW !== '1') throw Error('仅允许隔离整改验收');
  const container = await new MySqlContainer('mysql:8.0').withDatabase('remediation_review_test')
    .withUsername('review').withUserPassword('isolated_review_only').start();
  const target = {host:container.getHost(),port:container.getPort(),database:container.getDatabase(),user:container.getUsername(),password:container.getUserPassword()};
  let child: ReturnType<typeof spawn> | undefined;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    child?.kill();
    await container.stop({remove:true,removeVolumes:true});
    process.exit();
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  process.on('message', message => { if (message === 'stop') void stop(); });
  try {
    await runOpcMigrations(target, ['zhihu']);
    const c = await mysql.createConnection(target);
    await c.query("INSERT INTO users(username,password_hash,role,display_name,is_active,must_change_pwd) VALUES('admin',?,'admin','系统管理员',1,0)",[await bcrypt.hash('Admin123456!',4)]);
    await c.end();
    const listener = createServer();
    await new Promise<void>(resolve => listener.listen(0,'127.0.0.1',resolve));
    const port=(listener.address() as {port:number}).port;
    await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
    child=spawn(process.execPath,['--import',pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href,path.resolve('scripts/review-demo.ts')],{
      cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe'],
      env:{...process.env,NODE_ENV:'test',DB_HOST:target.host,DB_PORT:String(target.port),DB_NAME:target.database,DB_USER:target.user,DB_PASS:target.password,
        OPC_MODULES:'zhihu',QUEUE_DRIVER:'memory',RUN_BACKGROUND_JOBS:'true',PORT:String(port),JWT_SECRET:'isolated_review_test_secret_32_characters',LOG_LEVEL:'silent',
        ZHIHU_API_BASE:'https://open.zhihu.com',ZHIHU_ACCESS_TOKEN:'mock_access_token',ZHIHU_SECRET_KEY:'mock_secret_key',DEV_DEMO_AUTH:'0',ZHIHU_ACTIVATION_ENABLED:'true'},
    });
    let output='';
    child.stdout?.on('data',async chunk=>{
      process.stdout.write(chunk);output+=String(chunk);
      if(output.includes('演示数据已写入')&&!output.includes('READY_SENT')){
        output+='READY_SENT';
        const db=await mysql.createConnection(target);
        const [before]=await db.query('SELECT metric_type,COUNT(*) total FROM zh_metric_facts GROUP BY metric_type ORDER BY metric_type');
        const migration=await readFile(path.resolve('schema/zhihu/029_metric_types.sql'),'utf8');
        for(const statement of migration.split(/;\s*(?:\r?\n|$)/).map(part=>part.trim()).filter(Boolean))await db.query(statement);
        const [after]=await db.query('SELECT metric_type,COUNT(*) total FROM zh_metric_facts GROUP BY metric_type ORDER BY metric_type');
        if(JSON.stringify(before)!==JSON.stringify(after))throw Error('重复迁移改变了演示业绩');
        console.log('REVIEW_MIGRATION_REPLAY_VERIFIED',JSON.stringify(after));
        const [ratesBefore]=await db.query("SELECT id,project_id,rule_code,unit_price FROM opc_rate_rules WHERE module_id='zhihu' ORDER BY id");
        const rateMigration=await readFile(path.resolve('schema/zhihu/030_activation_rates.sql'),'utf8');
        await db.query(rateMigration);await db.query(rateMigration);
        const [ratesAfter]=await db.query("SELECT id,project_id,rule_code,unit_price FROM opc_rate_rules WHERE module_id='zhihu' ORDER BY id");
        if(JSON.stringify(ratesBefore)!==JSON.stringify(ratesAfter))throw Error('重复迁移改变了初始单价');
        console.log('REVIEW_RATE_REPLAY_VERIFIED',JSON.stringify(ratesAfter));
        const hash=await bcrypt.hash('Review123456',4);
        await db.query("INSERT INTO users(username,password_hash,role,admin_duty,display_name,is_active,must_change_pwd) VALUES('review_ops',?,'admin','operations','运营测试',1,0),('review_finance',?,'admin','finance','财务测试',1,0)",[hash,hash]);
        await db.end();
        process.send?.({port});console.log('REVIEW_READY',port);
      }
    });
    child.stderr?.pipe(process.stderr);
    child.on('exit',()=>{if(!stopping){process.exitCode=1;void stop();}});
  }catch(error){console.error(error);process.exitCode=1;await stop();}
}
void main();
