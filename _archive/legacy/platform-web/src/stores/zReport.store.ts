import { defineStore } from "pinia";
import { ref } from "vue";
import { allianceReportApi } from "@/api/alliance";
import type { RealTimeDataItem } from "@/api/alliance";

export const useZReportStore = defineStore("zReport", () => {
  const data = ref<RealTimeDataItem[]>([]);
  const timeRange = ref("");
  const loading = ref(false);
  const error = ref("");

  async function fetchReport() {
    loading.value = true;
    error.value = "";
    try {
      const result = await allianceReportApi.getRealTimeData();
      data.value = result.items;
      timeRange.value = result.timeRange;
    } catch {
      error.value =
        "当前知乎账号尚未开通实时数据接口权限，请联系知乎运营申请后重试。";
    } finally {
      loading.value = false;
    }
  }

  return { data, timeRange, loading, error, fetchReport };
});
