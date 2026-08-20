import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryState } from "@/components/QueryState";
import { trpc } from "@/lib/trpc";
import { ArrowDownToLine, ArrowRight, CircleDollarSign, Landmark, WalletCards } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const currency = (value: number) => `¥${(value / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}`;

export default function EarningsPage() {
  const earnings = trpc.earnings.useQuery();
  const utils = trpc.useUtils();
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const data = earnings.data ?? { total: 0, records: [], withdrawals: [] };
  const reserved = data.withdrawals.filter(item => item.status !== "rejected").reduce((sum, item) => sum + item.amount, 0);
  const paid = data.withdrawals.filter(item => item.status === "paid").reduce((sum, item) => sum + item.amount, 0);
  const available = Math.max(0, data.total - reserved);
  const hasRecords = Boolean(data.records.length || data.withdrawals.length);
  const request = trpc.withdrawals.request.useMutation({ onSuccess: () => { toast.success("提现申请已提交"); setWithdrawOpen(false); setAmount(""); utils.earnings.invalidate(); utils.activity.invalidate(); }, onError: error => toast.error(error.message) });

  if (earnings.isLoading) return <QueryState loading label="收益账本" />;
  if (earnings.error) return <QueryState loading={false} error={earnings.error} label="收益账本" />;

  return <div className="earnings-journal"><section className="earnings-intro"><div><p className="eyebrow">FINANCE / SETTLEMENT BOOK</p><h2>让每一笔收益，<br /><em>都有清楚的去处。</em></h2><p>从已结算收益到提现状态，资金记录在这里被逐笔保留。</p></div><Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}><DialogTrigger asChild><button className="module-primary" disabled={available <= 0}><ArrowDownToLine size={16} />申请提现</button></DialogTrigger><DialogContent className="aurora-dialog"><DialogHeader><DialogTitle>申请提现</DialogTitle><DialogDescription>当前可申请金额为 {currency(available)}。提交后会进入处理队列。</DialogDescription></DialogHeader><form onSubmit={event => { event.preventDefault(); request.mutate({ amount: Math.round(Number(amount) * 100) }); }} className="form-grid"><div className="full-span"><Label>提现金额（元）</Label><Input required type="number" min="0.01" max={available / 100} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="例如：500.00" /></div><Button type="submit" disabled={request.isPending || !amount} className="aurora-button form-submit">{request.isPending ? "正在提交…" : "确认提交申请"}</Button></form></DialogContent></Dialog></section><section className="balance-sheet"><article><p>当前可结算</p><strong>{currency(available)}</strong><span>收入会在结算完成后显示在这里</span></article><div className="balance-path"><div><b>已结算</b><strong>{currency(data.total)}</strong></div><i /><div><b>已提现</b><strong>{currency(paid)}</strong></div><i /><div><b>处理中</b><strong>{currency(reserved - paid)}</strong></div></div><CircleDollarSign size={26} /></section><section className="metric-grid"><EarningsMetric label="累计收益" value={currency(data.total)} icon={Landmark} tone="cyan" /><EarningsMetric label="已提现" value={currency(paid)} icon={ArrowDownToLine} tone="mint" /><EarningsMetric label="提现次数" value={String(data.withdrawals.length)} icon={WalletCards} tone="violet" /><EarningsMetric label="结算记录" value={String(data.records.length)} icon={CircleDollarSign} tone="indigo" /></section>{hasRecords ? <section className="settlement-ledger"><header><div><p className="eyebrow">RECORD / LEDGER</p><h3>收益与提现记录</h3></div><span>{data.records.length + data.withdrawals.length} 笔记录</span></header><div className="settlement-columns"><article><div className="ledger-label"><Landmark size={15} /><span>收益结算</span><b>{data.records.length}</b></div>{data.records.length ? <div className="simple-list">{data.records.map(item => <div key={item.id}><span className="list-check"><CircleDollarSign size={12} /></span><div><strong>{item.source}</strong><small>{new Date(item.settledAt).toLocaleDateString("zh-CN")}</small></div><strong>{currency(item.amount)}</strong></div>)}</div> : <div className="ledger-empty">暂无已结算收益记录。</div>}</article><article><div className="ledger-label"><ArrowDownToLine size={15} /><span>提现申请</span><b>{data.withdrawals.length}</b></div>{data.withdrawals.length ? <div className="simple-list">{data.withdrawals.map(item => <div key={item.id}><span className="list-check"><ArrowDownToLine size={12} /></span><div><strong>{new Date(item.requestedAt).toLocaleDateString("zh-CN")}</strong><small>提现申请</small></div><span className={`status-badge ${item.status}`}>{({ processing: "处理中", paid: "已到账", rejected: "已拒绝" } as Record<string, string>)[item.status]}</span><strong>{currency(item.amount)}</strong></div>)}</div> : <div className="ledger-empty">暂无提现记录。</div>}</article></div></section> : <section className="settlement-empty"><div><p className="eyebrow">YOUR FIRST SETTLEMENT</p><h3>当推广产生收益，<br />它会从这里开始被记录。</h3><p>完成投放、回传和结算后，资金流向会按时间沉淀为可核对的账本。</p><button disabled>等待首笔结算 <ArrowRight size={15} /></button></div><aside><span>资金记录</span><strong>清晰、可追溯<br />也可随时核对。</strong><i>OPC / FINANCE</i></aside></section>}</div>;
}

function EarningsMetric({ label, value, icon: Icon, tone }: { label: string; value: string; icon: React.ElementType; tone: string }) { return <article className="metric-card"><div><span>{label}</span><i className={`metric-icon ${tone}`}><Icon size={17} /></i></div><strong>{value}</strong><p>结算数据已同步</p></article>; }
