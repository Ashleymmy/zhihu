import type { DataImportProcessing } from "@zhihu-koc/shared-contracts";

export function importResultCopy(result?: DataImportProcessing) {
  if (!result)
    return {
      title: "文件已保存，处理结果暂不可用",
      detail: "请刷新处理结果。仅凭“已保存”不能判断归因或收益是否完成。",
    };
  const messages: Record<
    DataImportProcessing["state"],
    { title: string; detail: string }
  > = {
    not_started: {
      title: "文件已保存，归因尚未开始",
      detail:
        "报表已保留，但还没有生成归因结果。点击“继续归因”处理这批数据，无需重新上传。",
    },
    processing: {
      title: "文件已保存，还有数据待分析",
      detail: `还有 ${result.pendingRows} 行未完成。点击“继续归因”处理剩余数据，已处理记录不会重复导入。`,
    },
    needs_attention: {
      title: "归因有待办，需要补充业务信息",
      detail:
        "请按下方原因补齐渠道、关键词归属或单价，再到“数据待办”重新计算。未解决的问题可能阻止收益生成。",
    },
    analyzed: {
      title: "归因已完成，下一步核对账单",
      detail:
        "请进入“财务做账”，核对该日期的人员归属和金额，再按页面提示确认账单。归因完成不代表已经付款。",
    },
    legacy_pending: {
      title: "历史报表已保存，旧归因任务待处理",
      detail:
        "这批数据属于历史流程，尚未完成归因。请管理员核对历史归属和结算规则；重新上传同一文件不会自动产生收益。",
    },
    legacy_completed: {
      title: "历史归因任务已完成",
      detail: "请结合历史结算记录核对金额与付款状态；任务完成不代表已经付款。",
    },
    needs_scope: {
      title: "发现多个项目的处理记录",
      detail:
        "请进入“财务做账”选择对应项目，再核对本次报表的业务日期与处理结果。",
    },
  };
  return messages[result.state];
}

export function importResultLink(
  result: DataImportProcessing,
  destination: "finance" | "issues",
) {
  const params = new URLSearchParams();
  if (result.scope) {
    params.set("projectId", result.scope.projectId);
    params.set("accountId", result.scope.accountId);
  }
  if (destination === "issues") params.set("tab", "issues");
  if (result.from) params.set("from", result.from);
  if (result.to) params.set("to", result.to);
  return `/modules/zhihu/${destination === "finance" ? "finance" : "operations"}?${params}`;
}

export function importIssueLabel(code: string) {
  const labels: Record<string, string> = {
    CHANNEL_UNMAPPED: "报表渠道尚未对应项目渠道",
    KEYWORD_UNKNOWN: "尚未找到报表中的关键词",
    PROJECT_MISMATCH: "报表与项目不一致",
    BINDING_MISSING: "关键词尚未分配或使用",
    PERIOD_AMBIGUOUS: "报表日期早于关键词开始使用日期",
    PRICE_MISSING: "尚未设置对应成员的单价",
    SOURCE_REVISION_PENDING: "来源数据发生更正，需要核对",
    RISK_REVIEW_REQUIRED: "存在风险标记，需要核实",
    REPORT_INCOMPLETE: "还缺完整的订单数据",
    LEGACY_SHARED: "历史关键词多人共用，需要核对归属",
  };
  return labels[code] ?? "需要核对来源数据，请查看数据待办";
}
