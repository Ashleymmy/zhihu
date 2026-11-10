import { ref } from "vue";
import type {
  ReminderApi,
  ReminderItem,
} from "@zhihu-koc/shared-contracts/core";

/** Requests from a previous login/filter may never refill the current user's inbox. */
export function createReminderInbox(api: ReminderApi) {
  const list = ref<ReminderItem[] | undefined>(),
    unread = ref<number | undefined>(),
    total = ref(0),
    page = ref(1);
  const state = ref<"unread" | "all">("unread"),
    loading = ref(false),
    error = ref("");
  let identity = "",
    generation = 0,
    epoch = 0;
  function reset(next: string) {
    identity = next;
    generation++;
    epoch++;
    list.value = undefined;
    unread.value = undefined;
    total.value = 0;
    page.value = 1;
    error.value = "";
    loading.value = false;
  }
  async function load(more = false) {
    if (!identity) return;
    const current = ++generation,
      requested = more ? page.value + 1 : 1;
    loading.value = true;
    error.value = "";
    try {
      const result = await api.list({
        page: requested,
        pageSize: 20,
        state: state.value,
      });
      if (current !== generation) return;
      list.value = more
        ? [
            ...new Map(
              [...(list.value ?? []), ...result.list].map((row) => [
                row.id,
                row,
              ]),
            ).values(),
          ]
        : result.list;
      unread.value = result.unread;
      total.value = result.total;
      page.value = requested;
    } catch (e) {
      if (current !== generation) return;
      const status =
        e && typeof e === "object" && "status" in e ? e.status : null;
      if (status === 401 || status === 403) {
        list.value = undefined;
        unread.value = undefined;
        total.value = 0;
      }
      error.value = "提醒暂未更新。请重新读取后继续查看。";
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  async function read(item: ReminderItem, value: boolean): Promise<boolean> {
    const original = epoch;
    try {
      await api.read(item.id, value);
      if (epoch !== original) return false;
      await load();
      return epoch === original;
    } catch {
      if (epoch === original) {
        await load();
        if (epoch === original)
          error.value =
            "这条提醒可能已更新或权限已变化，请重新读取提醒后再打开。";
      }
      return false;
    }
  }
  async function select(value: "unread" | "all") {
    state.value = value;
    await load();
  }
  return {
    list,
    unread,
    total,
    page,
    state,
    loading,
    error,
    reset,
    load,
    read,
    select,
  };
}
