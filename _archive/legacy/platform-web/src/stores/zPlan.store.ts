import { defineStore } from "pinia";
import { ref } from "vue";
import { alliancePlanApi } from "@/api/alliance";
import type { CreatePlanReq } from "@/api/alliance";
import { AllianceHttpError } from "@/api/alliance-http";
import { message } from "ant-design-vue";

export const useZPlanStore = defineStore("zPlan", () => {
  const creating = ref(false);
  const lastPlanId = ref("");
  const lastChannelId = ref("");
  const lastKeyword = ref("");
  const batchUploading = ref(false);
  const lastBatchTaskId = ref("");

  async function submitCreatePlan(req: CreatePlanReq) {
    creating.value = true;
    try {
      const res = await alliancePlanApi.createPlan(req);
      lastPlanId.value = res.planId;
      lastChannelId.value = req.channelId;
      lastKeyword.value = req.keyword.trim();
      message.success(`计划创建成功！Plan ID: ${res.planId}`);
    } catch (error: unknown) {
      if (error instanceof AllianceHttpError) message.error(error.message);
      else throw error;
    } finally {
      creating.value = false;
    }
  }

  async function submitBatchCreate(
    file: File,
    fields: {
      taskId: string;
      channelId: string;
      popularizeType: 0;
      secondChannelId?: string;
    },
  ) {
    if (batchUploading.value) return;
    batchUploading.value = true;
    lastBatchTaskId.value = "";
    try {
      const result = await alliancePlanApi.batchCreatePlans(file, fields);
      lastBatchTaskId.value = result.batchTaskId;
      message.success("批量计划已提交");
      return result.batchTaskId;
    } catch (error: unknown) {
      if (error instanceof AllianceHttpError) message.error(error.message);
      else throw error;
    } finally {
      batchUploading.value = false;
    }
  }

  return {
    creating,
    lastPlanId,
    lastChannelId,
    lastKeyword,
    batchUploading,
    lastBatchTaskId,
    submitCreatePlan,
    submitBatchCreate,
  };
});
