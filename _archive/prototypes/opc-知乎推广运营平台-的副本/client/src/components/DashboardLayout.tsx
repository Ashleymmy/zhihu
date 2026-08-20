import { useAuth } from "@/_core/hooks/useAuth";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { Activity, BadgeCheck, BarChart3, BookMarked, ChevronDown, CircleDollarSign, Compass, FileArchive, LayoutDashboard, ListChecks, LogOut, Menu, PanelTop, Plus, ShieldCheck, Tags, Target, WandSparkles, X } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

type NavItem = { label: string; path: string; icon: React.ElementType; roles?: string[] };
type NavGroup = { label: string; items: NavItem[] };

export const navigation: NavGroup[] = [
  { label: "运营", items: [{ label: "概览", path: "/dashboard/overview", icon: LayoutDashboard }, { label: "推广计划", path: "/dashboard/campaigns", icon: Target }] },
  { label: "洞察", items: [{ label: "数据分析", path: "/dashboard/analytics", icon: BarChart3 }, { label: "收益结算", path: "/dashboard/earnings", icon: CircleDollarSign }] },
  { label: "配置", items: [{ label: "词条与回传", path: "/dashboard/keywords", icon: Activity, roles: ["boss", "leader"] }] },
  { label: "知乎工作台", items: [{ label: "知乎推广", path: "/workspace/promote", icon: Target }, { label: "知乎工作台", path: "/workspace/zhihu", icon: PanelTop }, { label: "盐选内容库", path: "/workspace/salt", icon: BookMarked }, { label: "结算中心", path: "/workspace/settlement", icon: BadgeCheck, roles: ["boss", "leader"] }, { label: "创意中心", path: "/workspace/creative", icon: WandSparkles }, { label: "风控中心", path: "/workspace/risk", icon: ShieldCheck, roles: ["boss", "leader"] }] },
  { label: "运营工具", items: [{ label: "词包管理", path: "/tools/wordpacks", icon: Tags }, { label: "落地页", path: "/tools/landing-pages", icon: PanelTop }, { label: "素材管理", path: "/tools/assets", icon: FileArchive }, { label: "操作记录", path: "/tools/activity", icon: ListChecks }] },
];

export const pageMeta: Record<string, { title: string; note: string; code: string }> = {
  "/dashboard": { title: "运营概览", note: "本周投放表现", code: "01" },
  "/dashboard/overview": { title: "运营概览", note: "本周投放表现", code: "01" },
  "/dashboard/campaigns": { title: "推广计划", note: "管理你的投放节奏", code: "02" },
  "/dashboard/keywords": { title: "词条与回传", note: "连接内容与转化", code: "03" },
  "/dashboard/analytics": { title: "数据分析", note: "读取增长的真实信号", code: "04" },
  "/dashboard/earnings": { title: "收益结算", note: "查看资金与结算记录", code: "05" },
  "/workspace/promote": { title: "知乎推广", note: "管理平台内的投放线索", code: "06" },
  "/workspace/zhihu": { title: "知乎工作台", note: "把内容和增长放在一起推进", code: "07" },
  "/workspace/salt": { title: "盐选内容库", note: "整理可运营的内容资产", code: "08" },
  "/workspace/settlement": { title: "结算中心", note: "核对平台结算进度", code: "09" },
  "/workspace/creative": { title: "创意中心", note: "沉淀可复用的表达方式", code: "10" },
  "/workspace/risk": { title: "风控中心", note: "让投放动作保持可控", code: "11" },
  "/tools/wordpacks": { title: "词包管理", note: "整理搜索与投放词包", code: "12" },
  "/tools/landing-pages": { title: "落地页", note: "管理承接转化的页面", code: "13" },
  "/tools/assets": { title: "素材管理", note: "归档运营视觉与文本素材", code: "14" },
  "/tools/activity": { title: "操作记录", note: "查看工作空间内的操作轨迹", code: "15" },
};

const routeRoles: Record<string, string[]> = { "/dashboard/keywords": ["boss", "leader"], "/workspace/settlement": ["boss", "leader"], "/workspace/risk": ["boss", "leader"] };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  if (loading) return <div className="app-loading"><span className="loading-mark">O</span><p>正在整理工作台</p></div>;
  if (!user) return <AuthGate />;
  return <StudioShell>{children}</StudioShell>;
}

function AuthGate() {
  return <div className="auth-gate"><div className="auth-gate-panel"><span className="eyebrow">OPC / ACCESS</span><h1>这是你的<br />运营工作台。</h1><p>请使用 Manus 身份验证后继续。访问范围将随你的运营角色同步。</p><button onClick={() => startLogin()} className="primary-action">使用 Manus 继续 <span>→</span></button></div></div>;
}

function StudioShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { data: profile } = trpc.auth.profile.useQuery(undefined);
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ "运营": true, "洞察": true, "配置": true, "知乎工作台": false, "运营工具": false });
  const role = profile?.role ?? "member";
  const meta = pageMeta[location] ?? { title: "运营工作台", note: "OPC 工作空间", code: "00" };
  const initials = (user?.name || "OP").slice(0, 2).toUpperCase();
  const visibleNavigation = useMemo(() => navigation.map(group => ({ ...group, items: group.items.filter(item => !item.roles || item.roles.includes(role)) })).filter(group => group.items.length), [role]);

  useEffect(() => {
    const allowed = routeRoles[location];
    if (profile && allowed && !allowed.includes(role)) setLocation("/dashboard/overview");
  }, [location, profile, role, setLocation]);

  const navigate = (path: string) => { setLocation(path); setMobileOpen(false); };

  return <div className="studio-app" data-menu-open={mobileOpen}>
    <aside className="studio-nav" aria-label="主导航">
      <div className="studio-brand"><div className="studio-mark">O</div><div><strong>OPC</strong><span>OPERATIONS</span></div><button onClick={() => setMobileOpen(false)} className="nav-close" aria-label="关闭导航"><X size={17} /></button></div>
      <nav className="studio-nav-scroll">{visibleNavigation.map(group => <Collapsible key={group.label} open={openGroups[group.label]} onOpenChange={value => setOpenGroups(current => ({ ...current, [group.label]: value }))} className="studio-nav-group"><CollapsibleTrigger className="nav-group-trigger"><span>{group.label}</span><ChevronDown size={14} /></CollapsibleTrigger><CollapsibleContent>{group.items.map(item => <NavItem key={`${group.label}-${item.label}`} item={item} active={location === item.path} onClick={() => navigate(item.path)} />)}</CollapsibleContent></Collapsible>)}</nav>
      <div className="nav-utility"><button className="utility-link" onClick={() => navigate("/dashboard/overview")}><Compass size={15} />工作指南</button><button className="account-chip" onClick={logout}><span>{initials}</span><div><strong>{user?.name || "运营成员"}</strong><small>{role === "boss" ? "所有者" : role === "leader" ? "负责人" : "成员"}</small></div><LogOut size={13} /></button></div>
    </aside>
    <div className="studio-backdrop" onClick={() => setMobileOpen(false)} />
    <section className="studio-content-shell"><header className="studio-header"><div className="header-context"><button className="menu-toggle" onClick={() => setMobileOpen(true)} aria-label="打开导航"><Menu size={20} /></button><div><span className="crumb">{meta.title} <i>/</i> {meta.code}</span><h1>{meta.title}</h1></div></div><div className="header-controls"><button className="header-create" onClick={() => navigate("/dashboard/campaigns")}><Plus size={16} />新建计划</button><button className="header-account" onClick={logout} aria-label="退出当前账号"><span>{initials}</span><div><strong>{user?.name || "运营成员"}</strong><small>{role === "boss" ? "所有者" : role === "leader" ? "负责人" : "成员"}</small></div></button><span className="header-initials">{initials}</span></div></header><main className="studio-page">{children}</main></section>
  </div>;
}

function NavItem({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return <button onClick={onClick} className="studio-nav-item" data-active={active}><Icon size={16} /><span>{item.label}</span></button>;
}
