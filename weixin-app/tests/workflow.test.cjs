const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, scoped, deferred } = require("./harness.cjs");
const word = {
  id: "1",
  keyword: "test",
  taskId: "1",
  bindingId: "11",
  leaderId: "2",
  executorId: "3",
  lifecycleStatus: "assigned",
  syncStatus: "synced",
  planStatus: "active",
  releaseStatus: "none",
};
const options = {
  tasks: [{ id: "1", name: "Task" }],
  mappings: [{ id: "1", channelName: "Channel" }],
  users: [
    { id: "2", role: "leader", displayName: "Leader" },
    { id: "3", role: "creator", parentId: "2", displayName: "Creator" },
  ],
};
const event = (data) => ({ currentTarget: { dataset: data } });
test("claim, assign and work eligibility respects ownership and creator priority", () => {
  const k = harness().load("utils/keyword-actions");
  const pool = {
    ...word,
    bindingId: null,
    lifecycleStatus: "available",
    priorityEnded: 1,
  };
  assert.ok(k.flags({ id: "3", role: "creator" }, pool).includes("claim"));
  assert.ok(
    !k
      .flags({ id: "3", role: "creator", parentId: "2" }, pool)
      .includes("claim"),
  );
  assert.ok(
    !k
      .flags({ id: "3", role: "creator" }, { ...pool, priorityEnded: 0 })
      .includes("claim"),
  );
  assert.ok(k.flags({ id: "2", role: "leader" }, word).includes("assign"));
  assert.ok(!k.flags({ id: "9", role: "leader" }, word).includes("assign"));
  assert.ok(
    !k
      .flags(
        { id: "3", role: "creator" },
        { ...word, releaseStatus: "requested" },
      )
      .includes("work"),
  );
  assert.deepEqual(
    Array.from(
      k.targets({ id: "2", role: "leader" }, word, "assign", options.users),
      (x) => x.id,
    ),
    ["2", "3"],
  );
});
test("stable retry keys are payload-specific; money and URL validation match input rules", () => {
  const a = harness().load("utils/actions"),
    owner = {};
  assert.equal(
    a.intent(owner, "/x", { a: 1, b: 2 }).key,
    a.intent(owner, "/x", { b: 2, a: 1 }).key,
  );
  assert.notEqual(
    a.intent(owner, "/x", { a: 1 }).key,
    a.intent(owner, "/x", { a: 2 }).key,
  );
  for (const bad of ["0", "-1", "1.234", "1e3", "NaN"])
    assert.equal(a.money(bad), false);
  assert.ok(a.money("12.30"));
  assert.ok(a.money("0.0001", 4));
  assert.equal(a.publicUrl("https://user:pass@example.com"), false);
  assert.ok(a.publicUrl("https://www.zhihu.com/question/1"));
});
test("multi-step work retry reuses both keys and double-click sends a single write", async () => {
  const delayed = deferred();
  let submissions = 0,
    first = true;
  const h = harness((c) => {
    const scope = scoped(c);
    if (scope !== undefined) return scope;
    if (c.path.endsWith("/attribution-options")) return options;
    if (c.method === "GET") return { list: [word], total: 1 };
    if (c.path.endsWith("/activate")) return { id: "11" };
    if (c.path.endsWith("/evidence")) {
      submissions++;
      return first ? delayed.promise : { id: "55" };
    }
  });
  h.session({ id: "3", role: "creator", parentId: "2" });
  const page = h.page("keywords");
  await page.onShow();
  page.choose(event({ index: 0, action: "work" }));
  page.setData({ workUrl: "https://www.zhihu.com/answer/1" });
  const attempt = page.runAction();
  await page.runAction();
  delayed.resolve({ networkError: "request:fail timeout" });
  await attempt;
  assert.equal(submissions, 1);
  assert.ok(page.data.selected);
  first = false;
  await page.runAction();
  const posts = h.calls.filter((c) => c.method === "POST"),
    activation = posts.filter((c) => c.path.endsWith("/activate")),
    evidence = posts.filter((c) => c.path.endsWith("/evidence"));
  assert.equal(activation[0].data.requestKey, activation[1].data.requestKey);
  assert.equal(evidence[0].data.requestKey, evidence[1].data.requestKey);
  assert.equal(page.data.selected, null);
});
test("leader may review team work but cannot review own work", async () => {
  const h = harness(
    (c) =>
      scoped(c) ?? {
        list: [
          { id: "1", executorId: "2", status: "pending" },
          { id: "2", executorId: "3", status: "pending" },
        ],
        total: 2,
      },
  );
  h.session({ id: "2", role: "leader" });
  const p = h.page("works");
  await p.onShow();
  assert.equal(p.data.list[0].canReview, false);
  assert.equal(p.data.list[1].canReview, true);
  p.choose(event({ index: 0 }));
  assert.equal(p.data.selected, null);
  p.choose(event({ index: 1 }));
  await p.review(event({ accept: "false" }));
  assert.match(p.data.error, /退回原因/);
  assert.equal(h.calls.filter((c) => c.method === "POST").length, 0);
});
test("withdrawal validates balance and precision before calling backend", async () => {
  const h = harness(
    (c) =>
      scoped(c) ?? {
        balance: { available: "12.00" },
        withdrawals: [],
        total: 0,
        canManage: false,
      },
  );
  h.session({ id: "3", role: "creator" });
  const p = h.page("withdrawals");
  await p.onShow();
  p.setData({
    form: { amount: "13", receiverName: "A", bankName: "B", bankAccount: "C" },
  });
  await p.apply();
  assert.match(p.data.error, /余额/);
  assert.equal(h.calls.filter((c) => c.method === "POST").length, 0);
  p.setData({ "form.amount": "1.111" });
  await p.apply();
  assert.match(p.data.error, /两位小数/);
});
test("finance confirmation requires explicit acknowledgment and uses reviewed period/hash", async () => {
  const h = harness(
    (c) =>
      scoped(c) ??
      (c.path.endsWith("/workbench")
        ? {
            entries: [{ factId: "1", ready: true }],
            groups: [],
            reviewHash: "a".repeat(64),
            summary: {},
          }
        : c.path.endsWith("/confirm")
          ? { confirmed: 1, waiting: 0 }
          : {
              balance: null,
              funding: { amount: "10", hash: "b".repeat(64) },
              canManage: true,
            }),
  );
  h.session();
  const p = h.page("wallet");
  await p.onShow();
  await p.confirmBills();
  assert.equal(h.calls.filter((c) => c.method === "POST").length, 0);
  p.setData({ acknowledged: true });
  await p.confirmBills();
  const post = h.calls.find((c) => c.method === "POST");
  assert.equal(post.data.reviewHash, "a".repeat(64));
  assert.equal(post.data.acknowledged, true);
  assert.equal(post.data.from, p.data.from);
});
test("member creation keeps temporary password visible and clears it on hide", async () => {
  const h = harness((c) =>
    c.method === "GET"
      ? []
      : { id: "3", username: "new", temporaryPassword: "temporary-only" },
  );
  h.session({ id: "2", role: "leader" });
  const p = h.page("team");
  await p.onShow();
  p.setData({
    form: { username: "new", displayName: "New", phone: "" },
    roleIndex: 1,
  });
  await p.create();
  const post = h.calls.find((c) => c.method === "POST");
  assert.equal(post.data.role, "creator");
  assert.equal(p.data.credentials.password, "temporary-only");
  p.onHide();
  assert.equal(p.data.credentials, null);
});
test("project grants and integration links send exact IDs and role contracts", async () => {
  const h = harness((c) => {
    if (c.method === "POST") return null;
    if (c.path === "/core/projects") return [{ id: "1", name: "Project" }];
    if (c.path === "/core/team/members")
      return [{ id: "3", displayName: "Creator", isActive: 1 }];
    if (c.path === "/core/integrations")
      return [{ id: "10", name: "Zhihu", moduleId: "zhihu", status: "active" }];
    return [];
  });
  h.session();
  const p = h.page("projects");
  await p.onShow();
  p.setData({ userIndex: 0, roleIndex: 2 });
  await p.grant();
  p.setData({ accountIndex: 0 });
  await p.linkAccount();
  const posts = h.calls.filter((c) => c.method === "POST");
  assert.equal(posts[0].data.userId, "3");
  assert.equal(posts[0].data.memberRole, "member");
  assert.equal(posts[1].data.accountId, "10");
});
test("late page loads after hide cannot paint data into another page/session", async () => {
  const delayed = deferred();
  const h = harness((c) => scoped(c) ?? delayed.promise);
  h.session({ id: "3", role: "creator" });
  const p = h.page("works"),
    loading = p.onShow();
  await new Promise((r) => setImmediate(r));
  p.onHide();
  delayed.resolve({ list: [{ id: "99", status: "pending" }], total: 1 });
  await loading;
  assert.equal(p.data.list.length, 0);
  assert.equal(p.canAct(), false);
});
