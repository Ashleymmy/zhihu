import { ArrowRight, BookOpenCheck, Box, CheckCircle2, FilePlus2, FolderKanban, ListFilter, Plus, RefreshCw, ShieldCheck, Sparkles, Tags, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QueryState } from "@/components/QueryState";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type ModuleDefinition = { eyebrow: string; title: string; accent: string; description: string; action: string; icon: LucideIcon; steps: string[]; note: string };

const modules: Record<string, ModuleDefinition> = {
  "/workspace/promote": { eyebrow: "ZHIHU / PROMOTION", title: "知乎推广不是一条孤立的投放线。", accent: "它需要被放进完整的运营判断里。", description: "在这里整理平台推广节奏，让计划、内容和回传围绕同一个目标协作。", action: "新建知乎推广", icon: Sparkles, steps: ["确认推广目标与内容方向", "关联现有推广计划", "检查回传与归因链路"], note: "平台推广会在连接账户后同步到这里。" },
  "/workspace/zhihu": { eyebrow: "ZHIHU / DESK", title: "把内容现场，变成日常工作台。", accent: "不在多个页面之间来回切换。", description: "将知乎运营中的选题、内容、推广和数据放在同一张工作桌上，减少不必要的上下文切换。", action: "创建工作卡", icon: FolderKanban, steps: ["记录一个待处理的问题", "指定当日负责人与优先级", "在复盘时回看结果"], note: "第一张工作卡会成为今日工作节奏的起点。" },
  "/workspace/salt": { eyebrow: "YANXUAN / LIBRARY", title: "让值得反复使用的内容，\n有一个安静的归处。", accent: "内容库不是堆放处，而是判断的素材库。", description: "整理盐选内容的选题、状态、标签和运营价值，建立可回看的内容资产档案。", action: "收录内容", icon: BookOpenCheck, steps: ["粘贴或导入内容链接", "添加主题与使用场景", "记录复用与转化表现"], note: "内容被收录后，会按主题和状态在这里沉淀。" },
  "/workspace/settlement": { eyebrow: "ZHIHU / SETTLEMENT", title: "每一次结算，\n都应该可以被解释。", accent: "而不只是一个到账数字。", description: "集中核对知乎平台的结算周期、金额、状态与异常项，让资金和运营动作能够对照。", action: "记录结算事项", icon: CheckCircle2, steps: ["核对本期结算周期", "比对平台与内部记录", "处理待确认的异常项"], note: "连接结算数据后，这里会显示每个周期的核对结果。" },
  "/workspace/creative": { eyebrow: "CREATIVE / STUDIO", title: "好创意不是灵感闪现，\n而是一次次被整理过的判断。", accent: "把有效表达，变成可复用的方法。", description: "保存标题、切入角度、结构与素材灵感，逐步形成属于团队的创意语言。", action: "记录创意", icon: Sparkles, steps: ["先记录一个切入角度", "标记对应的内容场景", "在使用后补充表现观察"], note: "尚未有创意记录，从一次具体的表达开始。" },
  "/workspace/risk": { eyebrow: "RISK / CONTROL", title: "把风险放在动作之前，\n而不是问题之后。", accent: "运营才能保持可控的节奏。", description: "统一查看需要关注的账户、内容、预算和回传信号，避免小问题在无感中扩大。", action: "设置检查项", icon: ShieldCheck, steps: ["定义预算与内容阈值", "设定需要提醒的事件", "定期查看异常处理记录"], note: "连接账户后，异常信号和处理记录会出现在这里。" },
  "/tools/wordpacks": { eyebrow: "TOOLS / WORD PACKS", title: "词不是清单，\n是用户意图的索引。", accent: "先把意图看清，再开始投放。", description: "按主题、场景和意图整理词包，让计划创建和内容选题都能从更清晰的词汇开始。", action: "新建词包", icon: Tags, steps: ["定义一个清晰的主题", "补充相关词与否定词", "关联到推广计划"], note: "词包建立后，可以直接用于推广计划和内容选题。" },
  "/tools/landing-pages": { eyebrow: "TOOLS / LANDING PAGES", title: "承接页的每一处，\n都应该回应用户的来意。", accent: "不是把流量带来后，再让它离开。", description: "维护用于转化承接的页面资产，记录版本、用途、状态和关联的推广计划。", action: "登记落地页", icon: FilePlus2, steps: ["填写页面名称与链接", "说明承接的核心动作", "关联推广计划与回传"], note: "登记一个页面后，可以在这里持续管理它的版本。" },
  "/tools/assets": { eyebrow: "TOOLS / ASSET ARCHIVE", title: "素材需要被找到，\n也需要被记住。", accent: "让每一份有效内容都有再次使用的机会。", description: "为图片、文案和视觉物料建立结构化档案，按场景和状态回看团队资产。", action: "登记素材", icon: Box, steps: ["选择素材类型", "补充主题与使用场景", "记录版本和可用状态"], note: "资产登记后，会以更易检索的方式在这里归档。" },
  "/tools/activity": { eyebrow: "TOOLS / ACTIVITY LOG", title: "每一项动作留下轨迹，\n复盘才有真正的依据。", accent: "从记录里，看见工作的真实节奏。", description: "集中查看计划、词条、回传和内容资产的关键操作，让协作过程始终可追溯。", action: "添加工作记录", icon: ListFilter, steps: ["选择查看的模块范围", "按人员或日期筛选", "在复盘中定位关键变更"], note: "工作区发生的关键操作会自动沉淀到这里。" },
};

export const workspaceModuleAliases: Record<string, string> = {
  "/tools/word-packs": "/tools/wordpacks",
  "/tools/materials": "/tools/assets",
};

export function resolveWorkspaceModulePath(path: string) {
  return workspaceModuleAliases[path] ?? path;
}

export default function WorkspaceModulePage() {
  const [location] = useLocation();
  const modulePath = resolveWorkspaceModulePath(location);
  const module = modules[modulePath] ?? modules["/workspace/zhihu"];
  const Icon = module.icon;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const utils = trpc.useUtils();
  const records = trpc.workspace.list.useQuery({ module: modulePath });
  const activity = trpc.activity.useQuery();
  const create = trpc.workspace.create.useMutation({
    onSuccess: () => { toast.success("工作记录已保存"); setOpen(false); setTitle(""); setDetail(""); utils.workspace.list.invalidate({ module: modulePath }); utils.activity.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const submit = () => create.mutate({ module: modulePath, title, detail: detail || undefined });
  const hasRecords = Boolean(records.data?.length);

  if (modulePath === "/tools/activity") return <ActivityLogModule module={module} logs={activity.data ?? []} loading={activity.isLoading} error={activity.error} />;
  if (modulePath === "/workspace/promote") return <ZhihuPromotionModule module={module} />;
  if (records.isLoading) return <QueryState loading label="工作记录" />;
  if (records.error) return <QueryState loading={false} error={records.error} label="工作记录" />;

  return <div className="module-workspace"><section className="module-intro"><div><p className="eyebrow">{module.eyebrow}</p><h2>{module.title.split("\n").map((line, index) => <span key={line}>{index > 0 && <br />}{line}</span>)}</h2><h3>{module.accent}</h3><p>{module.description}</p></div><Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><button className="module-primary"><Plus size={16} />{module.action}</button></DialogTrigger><DialogContent className="aurora-dialog"><DialogHeader><DialogTitle>{module.action}</DialogTitle><DialogDescription>这条记录会保存到当前工作区，并自动写入操作日志。</DialogDescription></DialogHeader><form onSubmit={event => { event.preventDefault(); submit(); }} className="form-grid"><div className="full-span"><Label>记录标题</Label><Input autoFocus required value={title} onChange={event => setTitle(event.target.value)} placeholder="写下需要推进的一件具体事情" /></div><div className="full-span"><Label>补充说明（可选）</Label><Textarea value={detail} onChange={event => setDetail(event.target.value)} placeholder="记录背景、链接、负责人或下一步判断…" rows={4} /></div><button type="submit" className="aurora-button form-submit" disabled={create.isPending}>{create.isPending ? "正在保存…" : "保存工作记录"}<ArrowRight size={15} /></button></form></DialogContent></Dialog></section><section className="module-desk">{hasRecords ? <article className="module-empty"><div className="module-icon"><Icon size={23} /></div><p className="eyebrow">ACTIVE / REGISTER</p><h3>这里已有 {records.data?.length} 条真实工作记录。</h3><p>每一条记录都保存在当前工作区，可在复盘时回看它从开始到完成的过程。</p><button onClick={() => setOpen(true)}>继续添加 <ArrowRight size={15} /></button></article> : <article className="module-empty"><div className="module-icon"><Icon size={23} /></div><p className="eyebrow">READY / TO START</p><h3>{module.note}</h3><p>当前还没有需要处理的记录。你可以从一个具体动作开始，工作台会把它整理为后续可回看的脉络。</p><button onClick={() => setOpen(true)}>{module.action}<ArrowRight size={15} /></button></article>}<article className="module-protocol"><header><span>01 — 03</span><strong>开始方式</strong></header>{module.steps.map((step, index) => <div key={step}><b>0{index + 1}</b><p>{step}</p><ArrowRight size={14} /></div>)}</article></section><section className="module-register"><header><div><p className="eyebrow">OPERATING REGISTER</p><h3>工作记录</h3></div><span>{records.data?.length ?? 0} 条</span></header>{hasRecords ? <div className="simple-list">{records.data?.map(record => <div key={record.id}><span className="list-check"><FolderKanban size={12} /></span><div><strong>{record.title}</strong><small>{record.detail || "暂无补充说明"}</small></div><span className="event-tag">{record.status === "open" ? "处理中" : record.status === "done" ? "已完成" : "已归档"}</span></div>)}</div> : <div className="register-empty"><FolderKanban size={19} /><p>你创建的记录会在这里形成可阅读的工作档案。</p><button onClick={() => setOpen(true)}>开始添加 <ArrowRight size={14} /></button></div>}</section></div>;
}

function ZhihuPromotionModule({ module }: { module: ModuleDefinition }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [channelId, setChannelId] = useState("2067662706400834870");
  const [taskId, setTaskId] = useState("1443567656205545472");
  const [keyword, setKeyword] = useState("钝感力女配网恋后");
  const [contentUrl, setContentUrl] = useState("https://www.zhihu.com/xen/market/remix/paid_column/2056100013286207953");
  const utils = trpc.useUtils();
  const tasks = trpc.zhihu.promotionTasks.useQuery({ channelId, offset: 0, limit: 50 }, { enabled: false, retry: false });
  const create = trpc.campaigns.createZhihu.useMutation({
    onSuccess: result => { toast.success(result.reused ? "已读取既有知乎计划映射" : `知乎计划已创建：${result.externalPlanId}`); setDialogOpen(false); utils.campaigns.list.invalidate(); utils.activity.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const batchTasks = trpc.campaigns.listZhihuBatches.useQuery();
  const refreshBatch = trpc.campaigns.getZhihuBatchResult.useMutation({
    onSuccess: () => { toast.success("已更新批量结果摘要"); batchTasks.refetch(); utils.activity.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const matchedTask = tasks.data?.find(item => item.id === taskId);
  return <div className="module-workspace"><section className="module-intro"><div><p className="eyebrow">{module.eyebrow}</p><h2>{module.title}</h2><h3>{module.accent}</h3><p>{module.description}</p></div><Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogTrigger asChild><button className="module-primary">重新提交并获取计划 ID <ArrowRight size={16} /></button></DialogTrigger><DialogContent className="aurora-dialog"><DialogHeader><DialogTitle>重新提交知乎推广计划</DialogTitle><DialogDescription>此前相同提交超时且未返回 plan_id。此操作已由负责人授权，系统将复用原本地记录、等待最多 45 秒并写回响应中的计划 ID；若外部首次请求实际已成功，可能产生重复计划。</DialogDescription></DialogHeader><form className="form-grid" onSubmit={event => { event.preventDefault(); if (!/^[\u4e00-\u9fff0-9]+$/.test(keyword)) { toast.error("知乎推广词仅支持中文或数字"); return; } create.mutate({ taskId, channelId, keyword, contentUrl, retryUncertain: true }); }}><div><Label>渠道 ID</Label><Input required value={channelId} onChange={event => setChannelId(event.target.value)} /></div><div><Label>推广任务 ID</Label><Input required value={taskId} onChange={event => setTaskId(event.target.value)} /></div><div className="full-span"><Label>推广词</Label><Input required pattern="[\u4e00-\u9fff0-9]+" title="仅支持中文或数字" value={keyword} onChange={event => setKeyword(event.target.value)} /></div><div className="full-span"><Label>知乎内容 URL</Label><Input required type="url" value={contentUrl} onChange={event => setContentUrl(event.target.value)} /></div><button type="submit" className="aurora-button form-submit" disabled={create.isPending}>{create.isPending ? "正在等待知乎响应…" : "确认重新提交一次"}</button></form></DialogContent></Dialog></section><section className="panel data-panel external-source-panel"><div className="list-toolbar"><div><span className="toolbar-title">知乎开放平台 · 分组任务核验</span><span className="toolbar-caption">只读</span></div><button className="quiet-action" onClick={() => tasks.refetch()} disabled={tasks.isFetching}><RefreshCw size={14} className={tasks.isFetching ? "spin-icon" : ""} />{tasks.isFetching ? "正在读取…" : "读取当前任务"}</button></div><div className="external-source-controls"><label><span>渠道 ID</span><Input value={channelId} onChange={event => setChannelId(event.target.value)} /></label><label><span>推广任务 ID</span><Input value={taskId} onChange={event => setTaskId(event.target.value)} /></label></div>{tasks.error ? <p className="source-status source-error">任务读取失败：{tasks.error.message}</p> : matchedTask ? <p className="source-status">已核验：<strong>{matchedTask.task_name}</strong> · {matchedTask.status} · {matchedTask.pay_caliber || "未返回结算口径"}</p> : <p className="source-status">先读取当前任务，确认任务仍可用后再由负责人决定是否重新提交。</p>}</section><ZhihuBatchTaskPanel tasks={batchTasks.data ?? []} loading={batchTasks.isLoading} refreshing={refreshBatch.isPending} onRefresh={id => refreshBatch.mutate({ id })} /><section className="module-protocol"><header><span>SAFE / RETRY</span><strong>提交保护</strong></header><div><b>01</b><p>相同任务、渠道、内容和词条复用同一条本地记录。</p><ArrowRight size={14} /></div><div><b>02</b><p>只有处于“待核验”的记录，且在弹窗中明确确认后才允许重试。</p><ArrowRight size={14} /></div><div><b>03</b><p>成功响应会立即保存外部 plan_id 并写入操作记录。</p><ArrowRight size={14} /></div></section></div>;
}

function batchStatusLabel(status: string) {
  return status === "created" ? "已受理" : status === "uncertain" ? "待核验" : status === "failed" ? "提交失败" : status === "submitting" ? "提交中" : "未提交";
}

function batchSummaryText(value: string | null) {
  if (!value) return "等待结果文件";
  try {
    const rows = JSON.parse(value) as unknown;
    if (!Array.isArray(rows) || rows.length === 0) return "已受理，等待知乎回填行级审核或导入结果";
    return rows.slice(0, 2).map(row => Array.isArray(row) ? row.join(" · ") : String(row)).join(" / ").slice(0, 180);
  } catch {
    return value.slice(0, 180);
  }
}

function ZhihuBatchTaskPanel({ tasks, loading, refreshing, onRefresh }: { tasks: Array<{ id: number; itemCount: number; externalBatchTaskId: string | null; externalSubmissionState: string; resultSummary: string | null }>; loading: boolean; refreshing: boolean; onRefresh: (id: number) => void }) {
  return <section className="module-register"><header><div><p className="eyebrow">ZHIHU / BATCH TASKS</p><h3>批量任务回填</h3></div><span>{tasks.length} 条</span></header>{loading ? <QueryState loading label="批量任务" /> : tasks.length ? <div className="simple-list">{tasks.map(task => <div key={task.id}><span className="list-check"><ListFilter size={12} /></span><div><strong>{task.externalBatchTaskId || "等待任务 ID"}</strong><small>{task.itemCount} 条计划 · {batchSummaryText(task.resultSummary)}</small></div><span className="event-tag">{batchStatusLabel(task.externalSubmissionState)}</span><button className="row-action" disabled={!task.externalBatchTaskId || refreshing} onClick={() => onRefresh(task.id)}>{refreshing ? "读取中…" : "只读回查"}</button></div>)}</div> : <div className="register-empty"><ListFilter size={19} /><p>批量提交后，这里会显示知乎返回的 batch_task_id 与结果摘要。</p></div>}</section>;
}

function ActivityLogModule({ module, logs, loading, error }: { module: ModuleDefinition; logs: Array<{ id: number; type: string; message: string; context: string | null; createdAt: Date }>; loading: boolean; error: { message?: string } | null }) {
  if (loading) return <QueryState loading label="操作记录" />;
  if (error) return <QueryState loading={false} error={error} label="操作记录" />;
  return <div className="module-workspace"><section className="module-intro"><div><p className="eyebrow">{module.eyebrow}</p><h2>{module.title.split("\n").map((line, index) => <span key={line}>{index > 0 && <br />}{line}</span>)}</h2><h3>{module.accent}</h3><p>{module.description}</p></div><span className="module-primary">{logs.length} 条记录</span></section><section className="module-register"><header><div><p className="eyebrow">LIVE / ACTIVITY</p><h3>最新操作</h3></div><span>{logs.length} 条</span></header>{logs.length ? <div className="simple-list">{logs.map(log => <div key={log.id}><span className="list-check"><ListFilter size={12} /></span><div><strong>{log.message}</strong><small>{log.context || log.type} · {new Date(log.createdAt).toLocaleString("zh-CN")}</small></div><span className="event-tag">{log.type}</span></div>)}</div> : <div className="register-empty"><ListFilter size={19} /><p>还没有业务操作记录。创建计划、绑定词条或保存工作卡后，记录会实时显示在这里。</p></div>}</section></div>;
}
