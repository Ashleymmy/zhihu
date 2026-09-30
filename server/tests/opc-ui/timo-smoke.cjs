// Render the production bundle against isolated API fixtures; no business server is contacted.
const { chromium } = require(process.env.OPC_PLAYWRIGHT_MODULE || 'playwright');
const express = require('express'),
  path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
const out = process.env.TIMO_UI_OUTPUT || path.resolve(__dirname, '../../../.opc-work/timo-ui');
fs.mkdirSync(out, { recursive: true });
const dist = path.resolve(__dirname, '../../../apps/platform-admin/dist');
const app = express().use('/app', express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
const token = 'a'.repeat(43),
  results = [];
async function scenario(browser, base, role, width = 1440, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } }),
    page = await context.newPage(),
    errors = [],
    requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const user = {
    id: '5',
    username: role,
    displayName: '测试' + role,
    role,
    adminDuty: role === 'operator' ? 'operations' : 'all',
    parentId: options.parentId ?? null,
    mustChangePwd: false,
    permissions:
      role === 'creator'
        ? ['team.apply']
        : [
            'team.view',
            'team.create_member',
            'team.review',
            'team.delete',
            'team.reset_pwd',
            ...(['admin', 'developer'].includes(role) ? ['project.manage', 'staff.manage'] : []),
            ...(role === 'developer' ? ['system.develop'] : []),
          ],
  };
  const members = [
    {
      id: '8',
      username: 'tianshu',
      displayName: '天舒',
      role: 'creator',
      adminDuty: 'all',
      isActive: 1,
      parentId: null,
      parentName: null,
      createdAt: '2026-09-20T00:00:00Z',
      lastLoginAt: '2026-09-29T00:00:00Z',
      registrationSource: 'invitation',
      inviterName: '邀请团长',
      invitationLabel: '新成员邀请',
      canManage: true,
      editableRoles: role === 'leader' ? ['creator'] : ['creator', 'leader'],
      permissions: ['team.apply'],
      projects: [{ id: '1', name: '知乎业务', isEnabled: true, memberRole: 'member' }],
      canAssignProjects: ['admin', 'developer'].includes(role),
    },
    { id: '9', username: 'leader', displayName: '邀请团长', role: 'leader', isActive: 1, canManage: false },
  ];
  await page.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname;
    if (url.origin !== base) return route.abort();
    if (!p.startsWith('/api/')) return route.continue();
    requests.push({
      path: p,
      method: req.method(),
      body: req.postDataJSON(),
      query: Object.fromEntries(url.searchParams),
    });
    let data = null,
      status = 200;
    if (p.endsWith('/auth/refresh')) {
      if (role === 'guest') status = 401;
      else data = { token: 'mock-token' };
    } else if (p.endsWith('/auth/me')) data = user;
    else if (p.endsWith('/auth/invitation')) {
      if (req.postDataJSON().token === token) data = { inviterName: '邀请团长', teamName: '邀请团长', role: 'creator' };
      else status = 422;
    } else if (p.endsWith('/auth/register')) {
      data = { id: '10' };
      status = 201;
    } else if (p.endsWith('/core/modules'))
      data = [{ id: 'zhihu', name: '知乎', status: 'enabled', entryPath: '/modules/zhihu/operations' }];
    else if (p.endsWith('/projects'))
      data = [
        { id: '1', name: '知乎业务', isEnabled: true },
        { id: '2', name: '第二业务', isEnabled: true },
      ];
    else if (p.endsWith('/integrations')) data = [{ id: '1', moduleId: 'zhihu', status: 'active', name: '知乎接入' }];
    else if (p.endsWith('/summary')) data = { status: 'ready', metrics: [] };
    else if (p.endsWith('/attribution-options'))
      data = { tasks: [{ id: '1', name: '推广任务' }], channels: [], mappings: [], users: members };
    else if (p.endsWith('/keywords'))
      data = {
        list: [
          {
            id: '1',
            keyword: '薄雾颠覆瓦',
            taskId: '1',
            planId: '42',
            bindingId: ['creator', 'leader'].includes(role) ? '2' : null,
            leaderId: role === 'leader' ? '5' : null,
            executorId: role === 'creator' ? '5' : null,
            allocationReady: role === 'creator' ? 0 : 1,
            lifecycleStatus: role === 'creator' ? 'assigned' : 'available',
            priorityEnded: 1,
            usedEverAt: null,
          },
        ],
        total: 1,
      };
    else if (p.endsWith('/price-agreements')) data = { list: [], total: 0 };
    else if (p.endsWith('/plans'))
      data =
        url.searchParams.get('keyword') === '无匹配'
          ? { list: [], total: 0 }
          : {
              list: [
                { id: '42', keyword: '薄雾颠覆瓦', channelName: '测试渠道', status: 'active', canRegister: true },
                ...(url.searchParams.get('purpose') === 'composition'
                  ? []
                  : [
                      {
                        id: '43',
                        keyword: '本人历史关键词',
                        channelName: '历史渠道',
                        status: 'ended',
                        canRegister: false,
                      },
                    ]),
              ],
              total: url.searchParams.get('purpose') === 'composition' ? 1 : 2,
            };
    else if (p.endsWith('/team/members')) data = members;
    else if (p.endsWith('/team/invitations')) {
      data = req.method() === 'POST' ? { id: '1', token } : [];
      status = req.method() === 'POST' ? 201 : 200;
    } else if (p.endsWith('/team/applications') || p.endsWith('/announcements/active')) data = [];
    else if (/\/compositions|\/story-items|\/workbench\/works/.test(p)) data = { list: [], total: 0 };
    else if (req.method() === 'GET') data = [];
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({
        code: status < 400 ? 0 : status * 100,
        data,
        message: status < 400 ? 'ok' : '邀请链接已失效',
      }),
    });
  });
  const snap = async (name) =>
    page.screenshot({
      path: path.join(out, `${role}${options.parentId ? '-team' : ''}-${width}-${name}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  try {
    if (role === 'guest') {
      await page.goto(base + '/app/register#invite=' + token);
      await page.getByText('邀请团长 邀请你注册').waitFor();
      await page.getByLabel('用户名', { exact: true }).fill('invited_test');
      await page.getByLabel('密码', { exact: true }).fill('test_password');
      await page.getByLabel('确认密码', { exact: true }).fill('test_password');
      await page.getByLabel('昵称', { exact: true }).fill('受邀达人');
      await snap('invite-register');
      await page.getByRole('button', { name: '注册', exact: true }).click();
      await page.waitForURL('**/login?**');
      assert.equal(requests.find((r) => r.path.endsWith('/auth/register')).body.invitationToken, token);
      await page.goto(base + '/app/register#invite=invalid');
      await page.getByText('邀请链接已失效').waitFor();
      assert.equal(await page.getByRole('button', { name: '注册', exact: true }).isDisabled(), true);
    } else {
      await page.goto(base + '/app/dashboard');
      await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
      const guide = page.getByRole('region', { name: '操作引导', exact: true });
      await guide.waitFor();
      assert.equal(await guide.locator('[data-step]').count(), 3);
      assert.equal(await guide.locator('[data-guide]').count(), role === 'creator' ? 0 : 3);
      const firstLabel =
        role === 'creator'
          ? options.parentId
            ? '接收关键词'
            : '领取关键词'
          : role === 'leader'
            ? '领取关键词'
            : '创建关键词';
      assert.equal(await guide.locator('[data-step="keyword"] h3').innerText(), firstLabel);
      if (['leader', 'operator'].includes(role)) {
        await guide
          .getByText('由管理员为成员开通业务项目。分发前确认相关成员已加入同一个项目。', { exact: true })
          .waitFor();
        assert.equal(await guide.getByRole('link', { name: '分配成员项目', exact: false }).count(), 0);
      }
      await guide.locator('[data-step="return"] summary').focus();
      await page.keyboard.press('Enter');
      await guide
        .getByText('在作品列表查看“同步”和“知乎审核”；“已同步”表示已提交，不等于审核通过。', { exact: true })
        .waitFor();
      await snap('guide-expanded');
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'guide overflows viewport',
      );
      const screenshotGuide = await guide.boundingBox();
      assert.ok(screenshotGuide.width <= width);
      await guide.getByRole('link', { name: '去登记作品', exact: false }).click();
      await page.locator('.registration-page').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('projectId'), '1');
      await page.goto(base + '/app/dashboard');
      await guide.getByRole('link', { name: '查看回传结果', exact: false }).click();
      await page.getByRole('heading', { name: '推广作品', exact: true }).waitFor();
      await page.goto(base + '/app/dashboard');
      await guide.getByRole('button', { name: '收起引导', exact: false }).click();
      assert.equal(await guide.locator('[data-step]').count(), 0);
      await page.reload();
      await guide.getByRole('button', { name: '展开引导', exact: false }).waitFor();
      // Dismissal belongs to this account; another account on the same browser starts expanded.
      user.id = '55';
      await page.reload();
      await guide.locator('[data-step="keyword"]').waitFor();
      user.id = '5';
      await page.reload();
      await guide.getByRole('button', { name: '展开引导', exact: false }).waitFor();
      await guide.getByRole('button', { name: '展开引导', exact: false }).click();
      assert.equal(await page.getByText('知乎历史接入', { exact: true }).count(), 0);
      if (role === 'creator')
        for (const label of ['业务项目', '业务模块', '财务中心'])
          assert.equal(await page.locator('.studio-nav').getByRole('button', { name: label, exact: true }).count(), 0);
      await snap('dashboard');
      await page.getByRole('link', { name: '进入知乎工作台', exact: false }).click();
      await page.locator('.engine-table tbody tr').first().waitFor();
      await guide.getByRole('link', { name: '查看审核进度', exact: true }).click();
      await page
        .getByRole('heading', { name: role === 'creator' ? '作品审核进度' : '作品审核', exact: true })
        .waitFor();
      assert.equal(new URL(page.url()).searchParams.get('tab'), 'works');
      await guide.locator('[data-step="keyword"] a').click();
      await page.locator('.engine-table tbody tr').first().waitFor();
      // Storage failures must not prevent use, dismissal, or reopening of the cards.
      await page.evaluate(() => {
        Storage.prototype.setItem = function () {
          throw new DOMException('blocked', 'SecurityError');
        };
      });
      await guide.getByRole('button', { name: '收起引导', exact: false }).click();
      await guide.getByRole('button', { name: '展开引导', exact: false }).click();
      const nav = page.getByRole('navigation', { name: '知乎业务导航' });
      assert.equal(await nav.locator('a[href$="/works"]').count(), 1);
      assert.equal(await nav.locator('a[href$="/tasks"]').count(), 1);
      await snap('keywords');
      if (role === 'creator') {
        await page.getByRole('button', { name: '提交作品并开始使用', exact: true }).click();
        await page.waitForURL('**/works/new?**');
        await page.locator('.registration-page').waitFor();
        await page.locator('#work-plan[aria-busy="false"]').waitFor();
        assert.equal(await page.locator('#work-plan').inputValue(), '薄雾颠覆瓦（测试渠道）');
        assert.equal(new URL(page.url()).searchParams.get('planId'), '42');
        await snap('work-registration');
        await page.getByRole('button', { name: '批量上传', exact: true }).click();
        await page.getByRole('heading', { name: '批量上传作品', exact: true }).waitFor();
        // Close the import dialog and ensure the dedicated registration page remains usable.
        await page.getByRole('button', { name: '关闭批量上传', exact: true }).click();
        await page.locator('.registration-page').waitFor();
        await page.goto(base + '/app/modules/zhihu/plans');
        await page.getByRole('heading', { name: '我的计划', exact: true }).waitFor();
        await page.getByText('本人历史关键词', { exact: true }).waitFor();
        assert.equal(await page.getByRole('link', { name: '登记作品', exact: true }).count(), 1);
        assert.equal(await page.getByRole('link', { name: '查看我的作品', exact: true }).count(), 2);
        for (const name of ['新建计划', '创建计划', '删除', '重试同步', '同步渠道'])
          assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0);
        assert.equal(await page.getByText('每日预算', { exact: true }).count(), 0);
        await snap('my-plans');
        if (width < 600)
          assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            'plans overflow viewport',
          );
        await page.getByLabel('搜索我的计划').fill('无匹配');
        await page.getByRole('button', { name: '搜索', exact: true }).click();
        await page.getByText('没有匹配的本人计划。', { exact: true }).waitFor();
        assert.ok(
          requests.some(
            (r) =>
              r.path.endsWith('/plans') &&
              r.query.keyword === '无匹配' &&
              r.query.page === '1' &&
              r.query.pageSize === '20',
          ),
        );
      } else {
        await page.getByRole('button', { name: role === 'leader' ? '分发给达人' : '分发给成员', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        const box = await dialog.boundingBox();
        assert.ok(box.y >= 0 && box.y < 600);
        await snap('keyword-dialog');
        await page.keyboard.press('Escape');
        assert.equal(await dialog.isVisible(), false);
      }
      await page.goto(base + '/app/modules/zhihu/more');
      await page.getByRole('heading', { name: '更多功能', exact: true }).waitFor();
      assert.ok((await page.locator('.function-card').count()) > 0);
      assert.equal(await page.locator('.function-card[href$="/history"]').count(), 0);
      await snap('more');
      if (role !== 'creator') {
        await page.goto(base + '/app/team');
        await page.getByText('天舒', { exact: true }).waitFor();
        await page.getByRole('button', { name: '编辑', exact: true }).click();
        const dialog = page.getByRole('dialog');
        if (['admin', 'developer'].includes(role)) {
          await dialog.getByLabel('搜索项目').fill('第二');
          await dialog.getByRole('checkbox', { name: '第二业务', exact: true }).check();
          await dialog.getByLabel('搜索项目').fill('');
          assert.equal(await dialog.getByRole('checkbox', { name: '知乎业务', exact: true }).isChecked(), true);
          await snap('member-projects');
        } else {
          assert.equal(await dialog.getByRole('checkbox').count(), 0);
          await dialog.getByText('修改需要项目管理权限。', { exact: false }).waitFor();
        }
        await dialog.getByLabel(/^状态/).selectOption('false');
        await dialog.getByRole('button', { name: '保存修改' }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(requests.find((r) => r.path.endsWith('/8/access')).body.isActive, false);
        if (['admin', 'developer'].includes(role))
          assert.deepEqual(requests.find((r) => r.path.endsWith('/8/access')).body.projectIds, ['1', '2']);
        else assert.equal(requests.find((r) => r.path.endsWith('/8/access')).body.projectIds, undefined);
        await page.getByRole('button', { name: '详情', exact: true }).first().click();
        await snap('member-details');
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '邀请成员', exact: true }).click();
        await page.getByRole('button', { name: '生成邀请链接' }).click();
        await page.locator('#invitation-link').waitFor();
        assert.ok((await page.locator('#invitation-link').inputValue()).endsWith('#invite=' + token));
        await snap('invite-link');
        await page.keyboard.press('Escape');
        await snap('members');
      }
      if (width < 600)
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          'page overflows viewport',
        );
    }
    assert.deepEqual(errors, []);
    results.push({ role, width, parentId: options.parentId ?? null, status: 'passed' });
  } catch (error) {
    await snap('failure');
    throw error;
  } finally {
    await context.close();
  }
}
(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, channel: process.env.OPC_BROWSER_CHANNEL || 'msedge' });
  try {
    for (const [role, width, options] of [
      ['creator', 1440],
      ['admin', 1440],
      ['developer', 1440],
      ['leader', 1440],
      ['operator', 1440],
      ['admin', 390],
      ['creator', 390],
      ['creator', 390, { parentId: '9' }],
      ['guest', 390],
    ])
      await scenario(browser, base, role, width, options);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    console.log(results);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
