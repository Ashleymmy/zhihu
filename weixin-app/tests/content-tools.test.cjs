const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { harness, scoped, deferred } = require("./harness.cjs");
const BASE = "/modules/zhihu/content-tools";
const boards = [
  { id: "1661766472115556352", name: "高评论书籍" },
  { id: "1710322868645269504", name: "推荐榜" },
];
const book = {
  id: "2099827666153124981",
  title: "原小说名称",
  url: "https://www.zhihu.com/market/story",
  columnTitle: "原专栏",
  topics: ["情感", "现代"],
};
const work = { id: "23", keyword: "原作品词", title: "我的原作品" };
function setup(handler, user = { id: "7", role: "creator" }) {
  const h = harness((call) => {
    if (call.path === "/core/auth/me") return user;
    const common = scoped(call);
    if (common !== undefined) return common;
    if (call.path === BASE + "/boards") return { list: boards };
    if (call.path === BASE + "/works") return { list: [work], hasNext: false };
    if (call.path === BASE + "/reports" && call.method === "GET")
      return { list: [], hasNext: false };
    return handler(call);
  });
  h.session(user);
  return h;
}
const event = (dataset = {}, value) => ({
  currentTarget: { dataset },
  detail: { value },
});
test("知乎客户工作台提供选书和举报，财务岗位隐藏入口并拒绝旧页面路径", async () => {
  for (const role of ["creator", "leader", "operator", "admin", "developer"]) {
    const h = setup(() => ({}), { id: "7", role });
    const page = h.page("zhihu");
    await page.onShow();
    for (const key of ["salt-books", "content-report"])
      assert(page.data.items.some((item) => item.key === key));
  }
  const h = setup(
    () => {
      throw Error("禁止请求客户接口");
    },
    { id: "7", role: "admin", adminDuty: "finance" },
  );
  const hub = h.page("zhihu");
  await hub.onShow();
  assert(
    !hub.data.items.some((item) =>
      ["salt-books", "content-report"].includes(item.key),
    ),
  );
  for (const name of ["salt-books", "content-report"]) {
    const page = h.page(name);
    await page.onShow();
    assert(page.data.denied);
  }
  assert(!h.calls.some((call) => call.path.startsWith(BASE)));
});
test("番茄使用原图标和稳定入口，游客直接查看引导及原二维码", () => {
  const h = harness();
  const home = h.page("home");
  const channel = home.data.channels.find((item) => item.key === "fanqie");
  assert.equal(channel.name, "番茄");
  assert.equal(channel.logo, "/images/channels/fanqie.png");
  home.setData({ guest: true });
  home.openChannel(event({ key: "fanqie" }));
  assert.equal(h.navigation.at(-1), "/pages/fanqie/index");
  const guide = h.page("fanqie");
  let preview;
  h.wx.previewImage = (options) => {
    preview = options;
  };
  guide.preview();
  assert.equal(preview.current, "/images/projects/fanqie-guide.jpg");
  const template = fs.readFileSync(
    path.join(__dirname, "../miniprogram/pages/fanqie/index.wxml"),
    "utf8",
  );
  for (const text of [
    "项目资源逐步分发中",
    "请添加助理导师了解详情",
    "【助理导师-枝枝微信二维码】",
  ])
    assert(template.includes(text));
  assert(
    fs.statSync(
      path.join(__dirname, "../miniprogram/images/projects/fanqie-guide.jpg"),
    ).size > 10000,
  );
});
test("选书通过项目范围查询，长编号及分页原样传递，详情可复制原文", async () => {
  const h = setup((call) => {
    if (call.path.includes("/contents"))
      return {
        list: [
          {
            ...book,
            id: String(BigInt(book.id) + BigInt(call.data.offset)),
            title: book.title + call.data.offset,
          },
        ],
        total: 21,
        hasNext: call.data.offset === 0,
      };
    throw Error("Unexpected " + call.path);
  });
  const page = h.page("salt-books");
  await page.onShow();
  assert.equal(page.data.boardId, boards[0].id);
  assert.equal(page.data.list[0].id, book.id);
  assert.equal(h.calls.at(-1).data.accountId, "10");
  page.showBook(event({ id: book.id }));
  assert.equal(page.data.selected.columnTitle, "原专栏");
  let copied;
  h.wx.setClipboardData = (options) => {
    copied = options.data;
    options.success();
  };
  page.copyOriginal(event({ id: book.id }));
  assert.equal(copied, book.url);
  await page.more();
  assert.equal(page.data.list.length, 2);
  assert.equal(h.calls.at(-1).data.offset, 20);
  await page.chooseBoard(event({}, 1));
  assert.equal(page.data.boardId, boards[1].id);
  assert.equal(page.data.list.length, 1);
  assert.equal(page.data.selected, null);
  assert.equal(page.data.page, 1);
});
test("榜单失败保留错误，离开页面后的响应不能覆盖现有内容", async () => {
  let failed = true,
    pending;
  const h = setup(() =>
    failed
      ? { http: 502, body: { message: "知乎暂时不可用" } }
      : pending.promise,
  );
  const page = h.page("salt-books");
  await page.onShow();
  assert.match(page.data.error, /知乎暂时不可用/);
  failed = false;
  pending = deferred();
  const load = page.load();
  await new Promise((resolve) => setImmediate(resolve));
  page.onHide();
  pending.resolve({ list: [book], total: 1 });
  await load;
  assert.equal(page.data.list.length, 0);
});
test("举报只使用所选作品，自动带原关键词，提交重试保留请求幂等键", async () => {
  let fail = true;
  const h = setup((call) => {
    if (call.method === "POST" && call.path === BASE + "/reports")
      return fail
        ? { networkError: "timeout" }
        : { id: "report-1", status: "submitted" };
    throw Error("Unexpected " + call.path);
  });
  const page = h.page("content-report");
  await page.onShow();
  page.chooseWork(event({}, 0));
  page.setData({
    keyword: "搬运词",
    riskType: 2,
    riskUrl: "https://example.com/risk",
    images: [{ id: "image-1", path: "/image.png" }],
  });
  await page.submit();
  assert(page.data.error);
  assert.equal(page.data.tab, "new");
  const first = h.calls.find(
    (call) => call.method === "POST" && call.path === BASE + "/reports",
  );
  assert.deepEqual(JSON.parse(JSON.stringify(first.data.report)), {
    compositionId: "23",
    keyword: "搬运词",
    riskType: 2,
    damageKeyword: "原作品词",
    imageIds: ["image-1"],
    riskUrl: "https://example.com/risk",
  });
  fail = false;
  await page.submit();
  const sends = h.calls.filter(
    (call) => call.method === "POST" && call.path === BASE + "/reports",
  );
  assert.equal(sends[0].data.requestKey, sends[1].data.requestKey);
  assert.equal(page.data.tab, "history");
  assert.equal(page.data.images.length, 0);
});
test("截图上传自动编码并使用个人接口，取消选择不显示错误", async () => {
  const h = setup((call) => {
    if (call.path === BASE + "/images") return { id: "evidence-1" };
    throw Error(call.path);
  });
  const page = h.page("content-report");
  await page.onShow();
  const content = Buffer.from("real-image-test");
  h.files.set("/photo.jpg", content);
  h.wx.chooseMedia = async () => ({
    tempFiles: [{ tempFilePath: "/photo.jpg" }],
  });
  await page.addImage();
  assert.equal(page.data.images[0].id, "evidence-1");
  assert.equal(
    h.calls.find((call) => call.path === BASE + "/images").data.base64,
    content.toString("base64"),
  );
  page.removeImage(event({ id: "evidence-1" }));
  assert.equal(page.data.images.length, 0);
  h.wx.chooseMedia = async () => {
    throw { errMsg: "chooseMedia:fail cancel" };
  };
  await page.addImage();
  assert.equal(page.data.error, "");
});
test("不确定举报先查询，再由用户明确核实后重试，页面不会自动重发", async () => {
  const record = {
    id: "report-1",
    keyword: "搬运词",
    status: "unknown",
    riskType: 2,
    attempt: 1,
  };
  const h = harness((call) => {
    if (call.path === "/core/auth/me") return { id: "7", role: "creator" };
    const common = scoped(call);
    if (common !== undefined) return common;
    if (call.path === BASE + "/reports" && call.method === "GET")
      return { list: [record] };
    if (call.path.endsWith("/result")) return { list: [], hasNext: false };
    if (call.path.endsWith("/retry")) return { ...record, status: "submitted" };
    if (call.path === BASE + "/works") return { list: [work] };
    throw Error(call.path);
  });
  h.session({ id: "7", role: "creator" });
  const page = h.page("content-report");
  page.setData({ tab: "history" });
  await page.onShow();
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 0);
  await page.retryReport(event({ id: record.id }));
  assert(page.data.resultLoaded);
  assert.equal(
    h.calls.filter((call) => call.path.endsWith("/retry")).length,
    0,
  );
  h.wx.showModal = async () => ({ confirm: false });
  await page.retryReport(event({ id: record.id }));
  assert.equal(
    h.calls.filter((call) => call.path.endsWith("/retry")).length,
    0,
  );
  h.wx.showModal = async () => ({ confirm: true });
  await page.retryReport(event({ id: record.id }));
  assert.equal(
    h.calls.find((call) => call.path.endsWith("/retry")).data
      .checkedNotReceived,
    true,
  );
});
test("较大截图压缩后传输，会话变化和无法压缩的图片会在上传前停止", async () => {
  const h = setup(call => { if (call.path === BASE + "/images") return { id: "compressed" }; throw Error(call.path); });
  const page = h.page("content-report"); await page.onShow();
  h.files.set("/large.jpg", Buffer.alloc(900 * 1024));
  h.files.set("/small.jpg", Buffer.from("compressed-image"));
  h.wx.chooseMedia = async () => ({ tempFiles: [{ tempFilePath: "/large.jpg" }] });
  let attempts = 0;
  h.wx.compressImage = options => { attempts++; options.success({ tempFilePath: "/small.jpg" }); };
  await page.addImage(); assert.equal(attempts, 1); assert.equal(page.data.images[0].path, "/small.jpg");
  assert.equal(h.calls.find(call => call.path === BASE + "/images").data.base64, Buffer.from("compressed-image").toString("base64"));
  page.setData({ images: [] });
  h.wx.compressImage = options => options.success({ tempFilePath: "/large.jpg" });
  await page.addImage(); assert.match(page.data.error, /裁剪/);
  assert.equal(h.calls.filter(call => call.path === BASE + "/images").length, 1);
  h.wx.compressImage = options => { h.app.globalData.scope = { projectId: "other", accountId: "other" }; options.success({ tempFilePath: "/small.jpg" }); };
  await page.addImage(); assert.equal(h.calls.filter(call => call.path === BASE + "/images").length, 1);
});
test("本人关键词的风险查询使用作品标识并区分无记录和查询失败", async () => {
  let fail = false;
  const h = setup(call => {
    if (call.path === BASE + "/works/23/risks") return fail ? { http: 502, body: { message: "暂时无法查询" } } : { list: [], hasNext: false };
    throw Error(call.path);
  });
  const page = h.page("content-report"); await page.onShow(); page.chooseWork(event({}, 0));
  await page.queryWorkRisk(event()); assert(page.data.workRiskLoaded); assert.equal(page.data.workRiskRows.length, 0);
  assert.equal(h.calls.at(-1).data.accountId, "10"); assert.equal(h.calls.at(-1).data.keyword, undefined);
  fail = true; await page.queryWorkRisk(event()); assert.match(page.data.error, /暂时无法查询/);
});
test("重新取得项目失败时隐藏旧详情，表单校验失败仍可原地修改", async () => {
  const user = { id: "7", role: "creator" };
  let failScope = false;
  const h = harness(call => {
    if (call.path === "/core/auth/me") return user;
    if (call.path === "/core/projects" && failScope) return { networkError: "timeout" };
    const common = scoped(call); if (common !== undefined) return common;
    if (call.path === BASE + "/boards") return { list: boards };
    if (call.path.includes("/contents")) return { list: [book], total: 1 };
    if (call.path === BASE + "/works") return { list: [work] };
    throw Error(call.path);
  });
  h.session(user);
  const books = h.page("salt-books"); await books.onShow(); books.showBook(event({ id: book.id }));
  h.load("utils/scope").reset(); failScope = true; await books.load();
  assert(books.data.loadFailed); assert.equal(books._context, null);
  const template = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/salt-books/index.wxml"), "utf8");
  assert(template.includes("!loadFailed"));
  failScope = false;
  const report = h.page("content-report"); await report.onShow(); await report.submit();
  assert.match(report.data.error, /原作品/); assert.equal(report.data.loadFailed, false); assert(report.canAct());
});
