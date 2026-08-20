import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { getAuthenticatedLandingPath } from "@/lib/authRedirect";
import { ArrowRight, Check, CircleGauge, Command, LockKeyhole, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "wouter";

const principles = ["计划、词条与结算在一处推进", "所有重要动作都有明确记录", "用数据判断，而不是用感觉猜测"];

export default function LoginPage() {
  const { isAuthenticated, loading } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => { const destination = getAuthenticatedLandingPath(isAuthenticated, loading); if (destination) setLocation(destination); }, [isAuthenticated, loading, setLocation]);

  return <div className="login-editorial"><aside className="login-manifesto"><div className="login-wordmark"><span className="studio-mark">O</span><strong>OPC</strong><i>OPERATIONS</i></div><div className="manifesto-copy"><span className="eyebrow">知乎推广运营工作台</span><h1>增长，是可以<br /><em>被好好经营</em>的。</h1><p>一个为运营决策而设计的工作台，把复杂投放变成清晰、可追踪的日常节奏。</p></div><div className="manifesto-note"><CircleGauge size={22} /><div><strong>今日工作节奏</strong><span>所有数据同步正常</span></div><b>06 / 06</b></div></aside><main className="login-access"><div className="access-card"><div className="access-heading"><span className="eyebrow">身份验证</span><h2>欢迎回来。</h2><p>使用 Manus 账号进入你的工作空间。</p></div><button type="button" onClick={() => startLogin()} className="primary-action access-action">继续使用 Manus <ArrowRight size={18} /></button><p className="access-trust"><LockKeyhole size={13} />账号和权限由 Manus 安全验证与同步</p><div className="access-rule" /><div className="access-list">{principles.map(item => <span key={item}><Check size={13} />{item}</span>)}</div></div><p className="access-footer"><Sparkles size={13} />OPC Operations workspace</p></main></div>;
}
