import { expect, it, vi } from "vitest";
import { createReminderApi } from "../src/reminder-api";
it("preserves reminder pagination and sends only an encoded event and read state", async () => {
  const http = { get: vi.fn(), post: vi.fn() };
  const api = createReminderApi(http);
  await api.list({ state: "all", page: 2, pageSize: 20 });
  expect(http.get).toHaveBeenCalledWith("/reminders", {
    state: "all",
    page: 2,
    pageSize: 20,
  });
  await api.read("payment:123:abc", false);
  expect(http.post).toHaveBeenCalledWith(
    "/reminders/payment%3A123%3Aabc/read",
    { read: false },
  );
});
