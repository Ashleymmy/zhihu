import type { Connection, RowDataPacket } from 'mysql2/promise';
export async function seedFinanceHistory(c: Connection) {
  const [users] = await c.query<RowDataPacket[]>(
    "SELECT id,username FROM users WHERE username IN ('admin','leader_wang','creator_li','creator_chen')",
  );
  const ids = Object.fromEntries(users.map((u) => [String(u.username), String(u.id)]));
  for (const name of ['leader_wang', 'creator_li', 'creator_chen']) {
    await c.query(
      "INSERT INTO earnings(user_id,project_id,settle_date,amount,status) VALUES(?,1,'2025-09-01',?,'paid')",
      [ids[name], name === 'leader_wang' ? '1000' : '8000'],
    );
    await c.query(
      "INSERT INTO withdrawal_requests(user_id,amount,pay_method,pay_account,status,remark) VALUES(?,1000,'wechat','private-account','approved','已完成历史收款')",
      [ids[name]],
    );
    await c.query(
      "INSERT INTO finance_appeals(user_id,kind,title,content,status,adjust_amount,remark) VALUES(?,'结算异议','九月结算说明','已核对当月原始记录','approved',0,'已处理')",
      [ids[name]],
    );
  }
  const [batch] = (await c.query(
    "INSERT INTO settlement_batches(title,period_start,period_end,status,total_source,total_relay,created_by) VALUES('九月历史结算','2025-09-01','2025-09-30','approved',100,80,?)",
    [ids.admin],
  )) as unknown as [{ insertId: number }];
  await c.query(
    "INSERT INTO settlement_items(batch_id,creator_id,source_amount,note) VALUES(?,?,100,'原始来源已核对')",
    [batch.insertId, ids.creator_li],
  );
  const [upload] = (await c.query(
    "INSERT INTO data_import_batches(file_name,file_size,file_sha256,sheet_name,total_rows,valid_rows,error_rows,errors_json,headers_json,created_by) VALUES('九月历史报表.xlsx',10,REPEAT('f',64),'订单',2,1,1,'[]','[]',?)",
    [ids.admin],
  )) as unknown as [{ insertId: number }];
  await c.query(
    "INSERT INTO data_import_rows(batch_id,`row_number`,keyword,order_count,validation_status,errors_json,raw_json) VALUES(?,2,'历史小说',1,'valid','[]','{}'),(?,3,'待补日期记录',NULL,'invalid',JSON_ARRAY('原表缺少日期'),'{}')",
    [upload.insertId, upload.insertId],
  );
}
