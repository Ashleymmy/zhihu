import { RowDataPacket } from 'mysql2/promise';
import { db, rows } from '../db';
import { config } from '../config';

interface MetricRow extends RowDataPacket {
  id: string;
  plan_id: string;
  owner_id: string;
  stat_date: string;
  earning: number;
  keyword: string;
}

interface PricingRule extends RowDataPacket {
  target_role: 'creator' | 'leader';
  method: 'fixed' | 'percentage';
  unit_price: number | null;
  percentage: number | null;
}

interface UserRow extends RowDataPacket {
  id: string;
  parent_id: string | null;
  role: string;
}

/**
 * 收益结算任务：知乎官方收益 → 定价策略清洗 → 团长分成 → 达人最终收益
 *
 * 流程：
 * 1. 扫描 daily_metrics 中未结算的记录（有 earning 且 owner_id 不为空）
 * 2. 按 pricing_rules 计算达人应得（知乎收益 × creator percentage）
 * 3. 如果达人有团长，按 leader percentage 计算团长抽成
 * 4. 生成 earnings 记录（达人 + 团长），标记 daily_metrics 已结算
 */
export async function settleEarnings(data?: Record<string, unknown>) {
  const settleDate = data?.settleDate ? String(data.settleDate) : (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1); // 默认结算昨天的数据
    return d.toISOString().slice(0, 10);
  })();

  // 1. 获取活跃定价规则
  const [creatorRules] = await rows<PricingRule>(
    "SELECT * FROM pricing_rules WHERE target_role='creator' AND status='active' ORDER BY priority DESC, id DESC LIMIT 1",
  );
  const [leaderRules] = await rows<PricingRule>(
    "SELECT * FROM pricing_rules WHERE target_role='leader' AND status='active' ORDER BY priority DESC, id DESC LIMIT 1",
  );
  if (!creatorRules || !leaderRules) {
    console.warn('settleEarnings: 缺少定价规则，跳过结算');
    return;
  }

  // 2. 找到未结算的 daily_metrics（earning > 0 且没有对应 earnings 记录）
  const unsettled = await rows<MetricRow>(
    `SELECT dm.id, dm.plan_id, dm.owner_id, dm.stat_date, dm.earning, dm.keyword
     FROM daily_metrics dm
     WHERE dm.stat_date = ?
       AND dm.earning > 0
       AND dm.owner_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM earnings e
         WHERE e.plan_id = dm.plan_id
           AND e.user_id = dm.owner_id
           AND e.settle_date = dm.stat_date
           AND e.source_ref = CONCAT('metric:', dm.id)
       )`,
    [settleDate],
  );

  if (unsettled.length === 0) {
    console.log(`settleEarnings: ${settleDate} 无待结算数据`);
    return;
  }

  let settled = 0;
  for (const metric of unsettled) {
    const zhihuEarning = Number(metric.earning); // 知乎官方给的收益

    // 3. 计算达人应得（按 creator 定价规则）
    let creatorAmount = 0;
    if (creatorRules.method === 'percentage' && creatorRules.percentage) {
      creatorAmount = zhihuEarning * Number(creatorRules.percentage);
    } else if (creatorRules.method === 'fixed' && creatorRules.unit_price) {
      creatorAmount = Number(creatorRules.unit_price); // 固定单价（转化按次计费）
    }

    // 4. 查达人是否有团长
    const [creator] = await rows<UserRow>(
      'SELECT id, parent_id, role FROM users WHERE id = ? LIMIT 1',
      [metric.owner_id],
    ) as unknown as [UserRow | undefined];

    let leaderAmount = 0;
    let finalCreatorAmount = creatorAmount;

    if (creator?.parent_id) {
      // 5. 团长抽成
      if (leaderRules.method === 'percentage' && leaderRules.percentage) {
        leaderAmount = creatorAmount * Number(leaderRules.percentage);
        finalCreatorAmount = creatorAmount - leaderAmount; // 达人最终 = 应得 - 团长抽成
      }

      // 写入团长收益
      if (leaderAmount > 0) {
        await db.query(
          `INSERT INTO earnings (user_id, project_id, plan_id, settle_date, amount, status, source_ref, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, NOW())`,
          [
            creator.parent_id,
            config.defaultProjectId,
            metric.plan_id,
            metric.stat_date,
            leaderAmount,
            `metric:${metric.id}:leader`,
          ],
        );
      }
    }

    // 6. 写入达人最终收益
    await db.query(
      `INSERT INTO earnings (user_id, project_id, plan_id, settle_date, amount, status, source_ref, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, NOW())`,
      [
        metric.owner_id,
        config.defaultProjectId,
        metric.plan_id,
        metric.stat_date,
        finalCreatorAmount,
        `metric:${metric.id}`,
      ],
    );

    settled++;
  }

  console.log(`settleEarnings: ${settleDate} 已结算 ${settled} 条记录`);
}
