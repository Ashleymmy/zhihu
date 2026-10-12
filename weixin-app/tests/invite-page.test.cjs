const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { harness, scoped } = require("./harness.cjs");

/**
 * 邀请好友页（pages/invite）契约：
 *   - 本人可看邀请统计和注册记录；分享封面仅展示平台介绍
 *   - 分享路径携带邀请码，标题和封面不暴露邀请人的信息
 *   - 注册页支持 URL 参数预填邀请码
 */

const CREATOR = { id: "3", role: "creator", parentId: "2" };

function setup() {
  const h = harness((call) => {
    const common = scoped(call);
    if (common !== undefined) return common;
    if (call.path === "/modules/zhihu/invite/me")
      return { code: "ABCD1234", total: "10.0000", usageCount: 2 };
    if (call.path === "/modules/zhihu/invite/rewards")
      return {
        total: "10.0000",
        records: [
          {
            key: "r1",
            title: "邀请好友 · 新人甲",
            time: "2026-09-20T02:00:00.000Z",
            amount: "5.0000",
          },
        ],
      };
    return {};
  });
  h.session(CREATOR);
  return h;
}

test("invite page keeps the share token internal and displays registration records without monetary rewards", async () => {
  const h = setup();
  const page = h.page("invite");
  await page.onShow();

  assert.equal(page.data.code, "ABCD1234");
  assert.equal(page.data.total, 0);
  assert.equal(page.data.usageCount, 2);
  assert.equal(page.data.records.length, 1);
  assert.equal(page.data.rewardAmount, undefined);
  assert.equal(page.data.records[0].timeText, "2026-09-20");
});

test("invite share uses a packaged 5:4 brand cover while preserving registration attribution", async () => {
  const h = setup();
  const page = h.page("invite");
  await page.onShow();

  const share = page.onShareAppMessage();
  assert.ok(share.path.includes("/pages/register/index?invite=ABCD1234"));
  assert.match(share.title, /TIMO.*推广/);
  assert.doesNotMatch(share.title, /ABCD1234|邀请人数|成功邀请|新人甲/);
  assert.ok(share.imageUrl.startsWith("/images/"), "Always supply a local cover instead of a page screenshot");
  const image = fs.readFileSync(path.join(__dirname, "../miniprogram", share.imageUrl));
  assert.equal(image.subarray(1, 4).toString(), "PNG");
  assert.equal(image.readUInt32BE(16) / image.readUInt32BE(20), 5 / 4);
  page.setData({ code: "", usageCount: 999, records: [{ name: "私人邀请记录" }] });
  const fallback = page.onShareAppMessage();
  assert.equal(fallback.path, "/pages/home/index");
  assert.equal(fallback.imageUrl, share.imageUrl);
  assert.equal(fallback.title, share.title);
});

test("register page prefills the invite code from the share link", async () => {
  const h = harness(() => ({}));
  const page = h.page("register");
  page.onLoad({ code: "abcd1234" });
  assert.equal(page.data.inviteCode, "ABCD1234", "预填并统一大写");
});
