import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { allianceCompositionApi } from "@/api/alliance";
import type { CompositionListItem, CreateCompositionReq } from "@/api/alliance";
import type { UpdateCompositionRequest } from "@/contracts/alliance";
import { AllianceHttpError } from "@/api/alliance-http";
import { message } from "ant-design-vue";

interface CompositionQuery {
  channelId: string;
  keyword: string;
}

export function canUpdateCompositionFromList(
  _item: CompositionListItem,
): boolean {
  return false;
}

export async function runCompositionBatchUiAction(
  action: () => Promise<unknown>,
): Promise<boolean> {
  await action();
  return true;
}

export const useZCompositionStore = defineStore("zComposition", () => {
  const items = ref<CompositionListItem[]>([]);
  const loading = ref(false);
  const creating = ref(false);
  const updating = ref(false);
  const total = ref(0);
  const page = ref(1);
  const pageSize = ref(20);
  const lastQuery = ref<CompositionQuery | null>(null);
  const current = computed(() => page.value);
  const batchUploading = ref(false);
  const lastBatchTaskId = ref("");

  function querySnapshot(query: CompositionQuery): CompositionQuery {
    return { channelId: query.channelId.trim(), keyword: query.keyword.trim() };
  }

  async function fetchList(query: CompositionQuery) {
    const snapshot = querySnapshot(query);
    loading.value = true;
    lastQuery.value = snapshot;
    page.value = 1;
    try {
      const res = await allianceCompositionApi.listCompositions({
        ...snapshot,
        page: 1,
        pageSize: pageSize.value,
      });
      items.value = res.data;
      page.value = res.meta.page;
      pageSize.value = res.meta.pageSize;
      total.value = res.meta.total;
      return res.data;
    } finally {
      loading.value = false;
    }
  }

  async function fetchPage(requestedPage: number) {
    if (!lastQuery.value) return;
    loading.value = true;
    page.value = requestedPage;
    try {
      const res = await allianceCompositionApi.listCompositions({
        ...lastQuery.value,
        page: requestedPage,
        pageSize: pageSize.value,
      });
      items.value = res.data;
      page.value = res.meta.page;
      pageSize.value = res.meta.pageSize;
      total.value = res.meta.total;
      return res.data;
    } finally {
      loading.value = false;
    }
  }

  async function submitCreate(req: CreateCompositionReq): Promise<string> {
    creating.value = true;
    try {
      const res = await allianceCompositionApi.createComposition(req);
      message.success(`作品创建成功！ID: ${res.compositionId}`);
      return res.compositionId;
    } finally {
      creating.value = false;
    }
  }

  async function submitUpdate(id: string, req: UpdateCompositionRequest) {
    updating.value = true;
    try {
      await allianceCompositionApi.updateComposition(id, req);
      message.success("作品已更新");
      if (lastQuery.value) await fetchList(lastQuery.value);
    } finally {
      updating.value = false;
    }
  }

  async function submitBatch(
    file: File,
    fields: { bindType: 1 | 2; channelId: string },
  ) {
    if (batchUploading.value) return;
    batchUploading.value = true;
    lastBatchTaskId.value = "";
    try {
      const result = await allianceCompositionApi.batchCreateCompositions(
        file,
        fields,
      );
      lastBatchTaskId.value = result.batchTaskId;
      message.success("批量作品已提交");
      return result.batchTaskId;
    } catch (error: unknown) {
      if (error instanceof AllianceHttpError) message.error(error.message);
      else throw error;
    } finally {
      batchUploading.value = false;
    }
  }

  return {
    items,
    loading,
    creating,
    updating,
    total,
    page,
    pageSize,
    current,
    lastQuery,
    batchUploading,
    lastBatchTaskId,
    fetchList,
    fetchPage,
    submitCreate,
    submitUpdate,
    submitBatch,
  };
});
