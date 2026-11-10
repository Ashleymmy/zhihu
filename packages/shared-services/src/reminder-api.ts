import type { ReminderApi } from "@zhihu-koc/shared-contracts/core";
import type { HttpClient } from "./http";

export function createReminderApi(
  http: Pick<HttpClient, "get" | "post">,
): ReminderApi {
  return {
    list: (input) => http.get("/reminders", input),
    read: (id, read) =>
      http.post("/reminders/" + encodeURIComponent(id) + "/read", { read }),
  };
}
