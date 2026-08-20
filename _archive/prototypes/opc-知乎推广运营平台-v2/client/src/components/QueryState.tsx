import { AlertCircle, LoaderCircle } from "lucide-react";

export function QueryState({ loading, error, label }: { loading: boolean; error?: { message?: string } | null; label: string }) {
  if (loading) return <div className="query-state"><LoaderCircle size={19} className="query-state-spinner" /><strong>正在读取{label}</strong><span>请稍候，数据会在连接完成后显示。</span></div>;
  if (error) return <div className="query-state query-state-error"><AlertCircle size={19} /><strong>{label}暂时无法读取</strong><span>{error.message || "请稍后重试，或检查权限与网络连接。"}</span></div>;
  return null;
}
