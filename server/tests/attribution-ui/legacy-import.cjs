const assert = require('node:assert/strict');

module.exports = async function verifyLegacyImport(page, baseUrl, file) {
  page.setDefaultTimeout(12000);
  await page.goto(`${baseUrl}/admin/modules/zhihu/data-import`);
  await page.getByRole('heading', { name: '历史邮件 / Excel 导入', exact: true }).waitFor();
  await page.locator('input[type="file"]').setInputFiles(file);
  let preview;
  // 连续上传同一文件，覆盖数据库中的重复预览查询。
  for (let attempt = 0; attempt < 2; attempt++) {
    const pending = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/data-import/parse'));
    await page.getByRole('button', { name: '解析并预览', exact: true }).click();
    const response = await pending;
    assert.ok(response.ok(), await response.text());
    preview = (await response.json()).data;
  }
  assert.equal(preview.isDuplicate, true);
  assert.ok(preview.previewRows.length > 0);
  await page.locator('.success-notice').waitFor();
  assert.deepEqual(await page.locator('.error-notice').allTextContents(), []);
  const detailUrl = (url) => url.pathname.endsWith(`/data-import/${preview.id}`);
  // 重现解析成功后读取明细失败，旧成功提示必须清除。
  await page.route(detailUrl, (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ code: 50000, data: null, message: '模拟明细读取失败' }),
  }), { times: 1 });
  const batchRow = page.getByRole('row').filter({ has: page.getByText(preview.fileName, { exact: true }) });
  await batchRow.getByRole('button', { name: '查看数据', exact: true }).click();
  await page.getByText('批次明细读取失败：模拟明细读取失败', { exact: true }).waitFor();
  assert.equal(await page.locator('.success-notice').count(), 0);
  // 重试走真实 MySQL，验证保留字转义后的查询与错误状态恢复。
  const pending = page.waitForResponse((r) => r.request().method() === 'GET' && detailUrl(new URL(r.url())));
  await batchRow.getByRole('button', { name: '查看数据', exact: true }).click();
  const response = await pending;
  assert.equal(response.status(), 200, await response.text());
  const detail = (await response.json()).data;
  assert.equal(detail.total, preview.totalRows);
  assert.deepEqual(detail.rows.map((row) => row.rowNumber), preview.previewRows.map((row) => row.rowNumber));
  await page.getByText('批次数据明细', { exact: true }).waitFor();
  assert.deepEqual(await page.locator('.error-notice').allTextContents(), []);
  await page.getByRole('link', { name: '归因与对账', exact: true }).click();
  await page.getByRole('heading', { name: '知乎归因与对账', exact: true }).waitFor();
  await page.getByRole('button', { name: '报告与归因', exact: true }).click();
  console.log(`旧导入回归通过：重复预览、${detail.total} 行明细、失败提示清除、重试和新入口导航。`);
};
