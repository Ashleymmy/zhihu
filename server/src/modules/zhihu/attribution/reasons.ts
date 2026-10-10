export const factTodoReasons = ['BINDING_MISSING', 'PERIOD_AMBIGUOUS', 'PRICE_MISSING', 'PRICE_OVERLAP', 'REPORT_INCOMPLETE','AGENCY_NOT_CONFIGURED','AGENCY_MISMATCH'] as const;

export interface ReasonContext {
  metricType?: string;
  bindingId?: unknown;
  executorId?: unknown;
  executorName?: unknown;
  executorRole?: unknown;
  leaderName?: unknown;
  evidenceCount?: unknown;
}

// Shared by the bill and the data inbox so the same blocker has one next step.
export function reasonText(code: string | null | undefined, context: ReasonContext = {}) {
  const executorRole = context.executorRole==='leader'?'团长':['admin','operator','developer'].includes(String(context.executorRole))?'管理员':'达人';
  const executor = context.executorName ? `${executorRole} ${context.executorName}` : executorRole;
  const leader = context.leaderName ? `团长 ${context.leaderName}` : '团长';
  switch (code) {
    case 'CHANNEL_UNMAPPED':
    case 'CHANNEL_AMBIGUOUS': return { reason: '渠道没对上', next: '运营：确认渠道' };
    case 'KEYWORD_UNKNOWN': return { reason: '关键词尚未对上报表', next: '运营：核对关键词与历史记录' };
    case 'MEMBER_OBJECTION': return {reason:'成员金额异议待回复',next:'财务：查看并回复金额异议'};
    case 'BINDING_MISSING':
      if (!context.bindingId) return { reason: '没有执行人', next: '运营：指定执行人' };
      if (!context.executorId) return { reason: '待分配', next: `${leader}：分配执行人` };
      return { reason: '尚未登记执行记录', next: `运营：核对历史执行，或由${executor}提交作品` };
    case 'PERIOD_AMBIGUOUS': return { reason: '早于执行人开始日期', next: '运营：确认从哪天算' };
    case 'PRICE_MISSING':
    case 'PRICE_OVERLAP': return { reason: '单价还没设置', next: context.metricType==='activation'?'财务：设置拉活单价':'财务：设置单价' };
    case 'AGENCY_NOT_CONFIGURED': return {reason:'尚未登记代理名称',next:'运营或财务：登记项目代理名称'};
    case 'AGENCY_MISMATCH': return {reason:'报表代理名称不一致',next:'运营或财务：核对代理名称'};
    case 'PRICE_CONFLICT': return { reason: '单价有冲突', next: '财务：设置单价' };
    case 'REPORT_WITHDRAWN': return {reason:'来源报表已撤销',next:'财务：核对更正金额'};
    case 'REPORT_INCOMPLETE': return context.metricType==='activation'?{reason:'没有拉活量',next:'财务：补传拉活报表'}:{ reason: '只有搜索数据，没有订单', next: '财务：补传订单报表' };
    case 'RISK_REVIEW_REQUIRED': return { reason: '知乎标了风险', next: '运营：核实' };
    case 'RISK_EXCLUDED': return {reason:'已核实不计费',next:'核实结论已保留'};
    case 'SOURCE_REVISION_PENDING': return { reason: '两份报表数字不同', next: '财务：选用哪个数' };
    case 'WORK_MISSING': return { reason: '还没有登记作品', next: `${executor}：补登记作品` };
    case 'WORK_UNVERIFIED': return { reason: '作品待核验', next: `${context.leaderName ? leader + ' 或管理员' : '管理员'}：核验作品` };
    case 'WORK_DISPUTED': return { reason: '作品有争议', next: '运营：核实作品归属' };
    case 'BUSINESS_STOPPED': return { reason: '业务已暂停', next: '运营：恢复项目' };
    case 'PROJECT_MISMATCH': return { reason: '报表与当前项目不一致', next: '财务：选择报表所属项目' };
    case 'LEGACY_SHARED': return { reason: '历史关键词多人共用', next: '运营：核对原执行人' };
    default: return { reason: '需要核对来源数据', next: '运营：核对报表内容' };
  }
}
