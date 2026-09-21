import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import * as XLSX from 'xlsx';
import { db } from '../../src/db';
import type { AuthUser } from '../../src/types';
import { businessDay } from '../../src/modules/zhihu/attribution/domain';
import * as resources from '../../src/modules/zhihu/attribution/resources';
import * as prices from '../../src/modules/zhihu/attribution/pricing';
import { configureRoute } from '../../src/modules/zhihu/attribution/cutover';
import { parseReport } from '../../src/modules/zhihu/attribution/report';

export async function seedAttributionDemo(outputDir: string) {
  if (process.env.ATTRIBUTION_UI_TEST !== '1') throw Error('仅允许隔离演练');
  const user = (sub: string, role: AuthUser['role']): AuthUser => ({
    sub, role, parentId: role === 'creator' ? '2' : null, username: role, displayName: role, jti: randomUUID(),
  });
  const admin = user('1', 'admin'), leader = user('2', 'leader'), creator = user('3', 'creator');
  const [accounts] = await db.query<RowDataPacket[]>("SELECT id FROM integration_accounts WHERE module_id='zhihu'");
  if (accounts.length !== 1) throw Error('演练账号不唯一');
  const scope = { projectId: '1', accountId: String(accounts[0].id) };
  const day = businessDay();
  await configureRoute(admin, scope, { from: day, mode: 'trial', reason: '同事隔离演练，合成样本', sampleVerified: false });
  const mapping = await resources.createMapping(admin, scope, randomUUID(), { channelId: '1', name: '测试渠道', from: day });
  const bindings: Array<{ keyword: string; bindingId: string }> = [];
  for (const keyword of ['模拟独占词甲', '模拟独占词乙']) {
    const word = await resources.createKeyword(admin, scope, randomUUID(), {
      keyword, taskId: '1', mappingId: mapping.id, landingUrl: 'https://www.zhihu.com/market/test', popularizeType: 0,
    });
    // 等待隔离主机注册的模拟上游处理器完成，其余领取与报价均走实际业务服务。
    const deadline = Date.now() + 10000;
    while (true) {
      const [plans] = await db.query<RowDataPacket[]>('SELECT sync_status FROM plans WHERE id=?', [word.planId]);
      if (plans[0]?.sync_status === 'synced') break;
      if (Date.now() >= deadline) throw Error('模拟上游创建超时');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const binding = await resources.claim(leader, scope, word.id, randomUUID());
    await resources.changeBinding(leader, scope, binding.id, randomUUID(), { action: 'assign', executorId: '3' });
    await resources.changeBinding(creator, scope, binding.id, randomUUID(), { action: 'activate' });
    bindings.push({ keyword, bindingId: binding.id });
  }
  for (const [payer, payeeId, unitPrice] of [[admin, '2', '15'], [leader, '3', '13']] as const) {
    const draft = await prices.draftPrice(payer, scope, randomUUID(), {
      taskId: '1', payeeId, unitPrice, from: day, reason: '同任务两词共用演练报价',
    });
    await prices.publishPrice(payer, scope, draft.id, randomUUID());
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const files: string[] = [];
  for (const [name, orders] of [['01-首次报告100单.xlsx', [60, 40]], ['02-修订报告90单.xlsx', [54, 36]]] as const) {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['日期时间', '渠道名称', '关键词', '推广任务', '风险判定', '搜索量', '订单量', '搜索转化率（单位%）'],
      ...bindings.map(({ keyword }, i) => [day, '测试渠道', keyword, '测试任务', null, i === 0 ? 600 : 400, orders[i], orders[i] / (i === 0 ? 6 : 4)]),
    ]);
    worksheet['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(workbook, worksheet, '模拟反馈');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const parsed = await parseReport({ originalname: name, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer, size: buffer.length }, 'combined');
    if (parsed.length !== 2 || parsed.some((row) => row.error)) throw Error('演练报告未通过真实解析器校验');
    const file = path.join(outputDir, name);
    fs.writeFileSync(file, buffer);
    files.push(file);
  }
  return { day, scope, bindings, files, mode: 'trial' };
}
