const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, scoped, deferred } = require("./harness.cjs");
test("finance login defaults to wallet, temporary passwords take priority", () => {
  const auth = harness().load("utils/auth");
  assert.equal(
    auth.entryPath({ role: "admin", adminDuty: "finance" }),
    "/pages/wallet/index",
  );
  assert.equal(
    auth.entryPath({
      role: "admin",
      adminDuty: "finance",
      mustChangePwd: true,
    }),
    "/pages/password/index",
  );
});
test("changing project clears prior records and dialogs before loading new data", async () => {
  const second = deferred();
  const h = harness((c) => {
    if (c.path === "/core/projects")
      return [
        { id: "1", name: "One" },
        { id: "2", name: "Two" },
      ];
    if (c.path.includes("/integrations"))
      return [
        {
          id: c.path.includes("/2/") ? "20" : "10",
          name: "Zhihu",
          moduleId: "zhihu",
          status: "active",
        },
      ];
    return c.data.projectId === "2"
      ? second.promise
      : { list: [{ id: "11", source: "evidence", executorId: "3", status: "pending" }], total: 1 };
  });
  h.session({ id: "2", role: "leader" });
  const page = h.page("works");
  await page.onShow();
  page.choose({ currentTarget: { dataset: { index: 0 } } });
  assert.ok(page.data.selected);
  await h.load("utils/scope").load(true, "2");
  const loading = page.load();
  await new Promise((r) => setImmediate(r));
  assert.equal(page.data.selected, null);
  assert.equal(page.data.list.length, 0);
  second.resolve({ list: [], total: 0 });
  await loading;
});
test("development and trial both stay off the migration-source environment; no local HTTP service", async () => {
  const seen = {};
  for (const version of ['develop','trial']) {
    const h=harness(()=>[]);h.wx.getAccountInfoSync=()=>({miniProgram:{envVersion:version}});
    const config=h.load('config/env');assert.equal(config.transport,'cloud');
    seen[version]=config.cloudEnv;
    await h.load('utils/request').get('/core/projects');assert.equal(h.calls.length,1);
  }
  // 当前阶段（2026-09-18，用户决定先把测试环境当生产环境用）：独立生产环境尚未建立，
  // 开发预览与体验版都指向已完成迁移并 seal 的测试环境，让模拟器/真机验收
  // 跑在同一条真实链路上（开发库仍是迁移数据源，处于 UI 预览模式）。
  assert.equal(seen.develop,'test-opc-app-d3gki762bfb61da92');
  assert.equal(seen.trial,'test-opc-app-d3gki762bfb61da92');
  // 无论怎么排布，两个版本都不能落到迁移数据源的开发库上，否则测试会污染开发数据。
  assert.notEqual(seen.develop,'cloud1-d4g9ou4cd3b80d764','开发预览不能指向迁移数据源');
  assert.notEqual(seen.trial,'cloud1-d4g9ou4cd3b80d764','体验版必须与迁移数据源分离');
});
test("release uses the production environment (promoted from the sealed test env)", () => {
  // 2026-09-24 用户决定：不再另建生产环境，test-opc-app 扶正为正式环境，
  // cloud1 退回开发/测试。release 指向 test 环境即放行；若哪天又指回开发库，守卫仍会拦截。
  const release=harness(()=>[]);
  release.wx.getAccountInfoSync=()=>({miniProgram:{envVersion:'release'}});
  const env=release.load('config/env');
  assert.equal(env.cloudEnv,'test-opc-app-d3gki762bfb61da92');
  assert.equal(env.environment,'production');
});
test("successful operation does not erase retry keys belonging to another uncertain operation", async () => {
  const h = harness((c) => scoped(c) ?? { list: [], total: 0 });
  h.session({ id: "3", role: "creator" });
  const page = h.page("works");
  await page.onShow();
  const actions = h.load("utils/actions");
  const previous = actions.intent(page, "/earlier", { id: "7" }).key;
  await page.action(() => actions.post(page, "/other", { id: "8" }));
  assert.equal(actions.intent(page, "/earlier", { id: "7" }).key, previous);
});
test("navigating away during a batch prevents the next composition write", async () => {
  const first=deferred();
  const word={id:'1',planId:'10',bindingId:'11',keyword:'keyword',executorId:'3',lifecycleStatus:'assigned',releaseStatus:'none',syncStatus:'synced'};
  const h=harness(c=>{
    const common=scoped(c);if(common!==undefined)return common;
    if(c.path.endsWith('/attribution-options'))return {tasks:[],users:[],mappings:[],hasTeamLeader:false};
    if(c.path.endsWith('/mini-works'))return first.promise;
    return {list:[word],total:1};
  });
  h.session({id:'3',role:'creator'});const page=h.page('keywords');await page.onShow();
  page.choose({currentTarget:{dataset:{index:0,action:'work'}}});
  const row={mediaAccount:'account',platformIndex:2,publishDate:'2026-10-01',workTypeIndex:0,contentTypeIndex:0};
  page.setData({batchMode:true,batchItems:[{...row,url:'https://example.com/1'},{...row,url:'https://example.com/2'}]});
  const writing=page.runAction();await new Promise(r=>setImmediate(r));
  assert.equal(h.calls.filter(c=>c.path.endsWith('/mini-works')).length,1);
  page.onHide();first.resolve({id:'10'});await writing;
  assert.equal(h.calls.filter(c=>c.path.endsWith('/mini-works')).length,1);
  assert.equal(page._hidden,true);
});
test("password change clears session and routes back to login", async () => {
  const h = harness(() => null);
  h.session({ id: "3", role: "creator", mustChangePwd: true });
  const page = h.page("password");
  await page.onShow();
  page.setData({
    oldPassword: "temporary123",
    newPassword: "updated123",
    confirmPassword: "updated123",
  });
  await page.submit();
  assert.equal(h.calls[0].path, "/core/auth/change-password");
  assert.equal(h.storage.has("zk_access_token"), false);
  assert.equal(page.data.newPassword, "");
  assert.equal(h.navigation.at(-1), "/pages/login/index");
});
test("leader pricing is restricted to own project creators and retains draft before publication", async () => {
  const h = harness((c) => {
    const scope = scoped(c);
    if (scope !== undefined) return scope;
    if (c.path.endsWith("/attribution-options"))
      return {
        tasks: [{ id: "1", name: "Task" }],
        users: [
          { id: "3", role: "creator", parentId: "2", displayName: "Own" },
          { id: "4", role: "creator", parentId: "5", displayName: "Other" },
        ],
      };
    if (c.method === "GET") return { list: [], total: 0 };
    return { id: "9" };
  });
  h.session({ id: "2", role: "leader" });
  const page = h.page("prices");
  await page.onShow();
  // 收款对象第一位是「全部达人（全局统一价）」分组，其后才是成员
  assert.equal(page.data.payees[0].id, "3");
  assert.deepEqual(
    Array.from(page.data.payees.filter((x) => !x.payeeRole), (x) => x.id),
    ["3"],
  );
  page.setData({
    taskIndex: 0,
    payeeIndex: 0,
    form: { unitPrice: "1.1234", from: "2026-09-16", to: "", reason: "新定价" },
  });
  await page.create();
  const posts = h.calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, "/modules/zhihu/price-agreements");
  assert.equal(posts[0].data.payeeId, "3");
  assert.equal(posts[0].data.unitPrice, "1.1234");
});
