import { describe, expect, it, vi } from "vitest";
import type {
  ReminderApi,
  ReminderItem,
  ReminderResult,
} from "@zhihu-koc/shared-contracts/core";
import { createReminderInbox } from "../src/reminder-inbox";
import { evidenceReminderContext } from "../src/reminder-context";
const item: ReminderItem = {
  id: "comment:1",
  kind: "comment",
  title: "留言",
  body: "",
  next: "查看",
  path: "/dashboard",
  createdAt: "2026-10-01",
  readAt: null,
  handled: false,
};
const result: ReminderResult = {
  list: [item],
  total: 1,
  unread: 1,
  page: 1,
  pageSize: 20,
};
describe("authorized reminder inbox", () => {
  it("rejects a previous login response and clears privileged cached content", async () => {
    let resolve!: (r: ReminderResult) => void;
    const api: ReminderApi = {
      list: () => new Promise((r) => (resolve = r)),
      read: vi.fn(),
    };
    const inbox = createReminderInbox(api);
    inbox.reset("finance");
    const pending = inbox.load();
    inbox.reset("operator");
    resolve(result);
    await pending;
    expect(inbox.list.value).toBeUndefined();
    expect(inbox.unread.value).toBeUndefined();
  });
  it("retains last known content on network failure but clears it on permission denial", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(result)
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 403 });
    const inbox = createReminderInbox({ list, read: vi.fn() });
    inbox.reset("finance");
    await inbox.load();
    await inbox.load();
    expect(inbox.list.value).toHaveLength(1);
    expect(inbox.error.value).toContain("重新读取");
    await inbox.load();
    expect(inbox.list.value).toBeUndefined();
    expect(inbox.unread.value).toBeUndefined();
  });
  it("does not navigate after read authorization fails or identity changes", async () => {
    const inbox = createReminderInbox({
      list: vi.fn().mockResolvedValue(result),
      read: vi.fn().mockRejectedValue({ status: 404 }),
    });
    inbox.reset("finance");
    expect(await inbox.read(item, true)).toBe(false);
    expect(inbox.error.value).toContain("权限");
  });
  it("requires the entire exact evidence context and rejects arrays/invalid dates", () => {
    const value = {
      reminderContext: "evidence",
      moduleId: "zhihu",
      projectId: "1",
      accountId: "2",
      channelRef: "3",
      taskRef: "4",
      businessDate: "2026-10-01",
      metricType: "activation",
    };
    expect(evidenceReminderContext(value)?.channelRef).toBe("3");
    expect(
      evidenceReminderContext({ ...value, channelRef: undefined }),
    ).toBeNull();
    expect(evidenceReminderContext({ ...value, channelRef: ["3"] })).toBeNull();
    expect(
      evidenceReminderContext({ ...value, businessDate: "2026-02-30" }),
    ).toBeNull();
  });
});
