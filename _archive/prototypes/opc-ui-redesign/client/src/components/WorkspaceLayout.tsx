/**
 * 纸面操作台设计提醒：窄侧栏、横向操作条与不对称工作区共同建立稳定的阅读秩序；
 * 所有浮层与交互只服务于当前动作，不制造持续干扰。
 */
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Bell, ChevronDown, Command, LayoutDashboard, ListChecks, Menu, PanelLeftClose, Plus, Search, Settings2, UsersRound, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { NewTaskDialog } from "./NewTaskDialog";

type WorkspaceLayoutProps = { children: ReactNode };

const navItems = [
  { label: "总览", path: "/", icon: LayoutDashboard, index: "01" },
  { label: "任务", path: "/tasks", icon: ListChecks, index: "02" },
  { label: "团队", path: "/team", icon: UsersRound, index: "03" },
  { label: "设置", path: "/settings", icon: Settings2, index: "04" },
];

export function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  const [location, setLocation] = useLocation();
  const { tasks } = useWorkspace();
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const current = navItems.find((item) => item.path === location) ?? navItems[0];

  const navigate = (path: string) => { setLocation(path); setIsMobileNavOpen(false); setIsSearchOpen(false); };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-[#f7f5f1] text-[#20292f]">
      <div className="flex min-h-screen">
        <aside className="hidden w-[230px] shrink-0 flex-col border-r border-[#dedbd4] bg-[#efede8] px-5 py-6 lg:flex">
          <Brand />
          <nav className="mt-12 space-y-1" aria-label="主导航"><NavigationItems currentPath={location} onNavigate={navigate} /></nav>
          <Profile />
        </aside>
        <main className="min-w-0 flex-1">
          <header className="relative flex h-[72px] items-center justify-between border-b border-[#dedbd4] bg-[#f7f5f1]/95 px-5 sm:px-8 lg:px-10">
            <div className="flex items-center gap-3">
              <button onClick={() => setIsMobileNavOpen((value) => !value)} aria-label="打开导航" className="flex h-8 w-8 items-center justify-center border border-[#d8d5cf] text-[#596167] lg:hidden">{isMobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}</button>
              <div className="hidden lg:block"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#7b8286]">{current.label} / {current.index}</p></div>
              <div className="lg:hidden"><p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#7b8286]">{current.label} / {current.index}</p><p className="mt-0.5 text-xs font-medium">OPC 工作台</p></div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <button onClick={() => setIsSearchOpen(true)} className="hidden items-center gap-2 border border-[#d8d5cf] bg-[#fbfaf7] px-3 py-2 text-xs text-[#737a80] transition-colors hover:border-[#b8b5ae] hover:text-[#20292f] sm:flex"><Search className="h-3.5 w-3.5" /><span>搜索</span><kbd className="ml-6 font-mono text-[10px] text-[#9a9d9e]">⌘ K</kbd></button>
              <div className="relative"><button onClick={() => setIsNotificationsOpen((value) => !value)} aria-label="通知" className="relative flex h-9 w-9 items-center justify-center border border-[#d8d5cf] bg-[#fbfaf7] text-[#596167] transition-colors hover:border-[#b8b5ae] hover:text-[#20292f]"><Bell className="h-4 w-4 stroke-[1.7]" /><span className="absolute right-2 top-2 h-1.5 w-1.5 bg-[#e66b3a]" /></button>{isNotificationsOpen && <NotificationPanel onClose={() => setIsNotificationsOpen(false)} onNavigate={navigate} />}</div>
              <Button className="h-9 rounded-none bg-[#20292f] px-3.5 text-xs font-medium text-[#f7f5f1] shadow-none transition-transform duration-150 hover:bg-[#303b42] active:scale-[0.97]" onClick={() => setIsNewTaskOpen(true)}><Plus className="mr-1.5 h-3.5 w-3.5" /><span className="hidden sm:inline">新建任务</span><span className="sm:hidden">新建</span></Button>
            </div>
            {isMobileNavOpen && <div className="absolute inset-x-0 top-[71px] z-30 border-b border-[#d8d5cf] bg-[#efede8] px-5 py-4 shadow-[0_18px_32px_rgba(32,41,47,0.08)] lg:hidden"><Brand compact /><nav className="mt-4 grid grid-cols-2 gap-1"><NavigationItems currentPath={location} onNavigate={navigate} /></nav></div>}
          </header>
          {children}
        </main>
      </div>
      <SearchDialog open={isSearchOpen} onOpenChange={setIsSearchOpen} tasks={tasks} onNavigate={navigate} />
      <NewTaskDialog open={isNewTaskOpen} onOpenChange={setIsNewTaskOpen} />
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) { return <div className="relative flex items-center gap-3 px-2 before:absolute before:left-2 before:top-[-8px] before:h-[2px] before:w-12 before:bg-[#20292f]"><img src="/manus-storage/opc-mark_49c40ce4.png" alt="OPC 模块孔径标识" className="h-9 w-9 rounded-[2px] object-cover" /><div><p className="font-mono text-[10px] font-medium uppercase tracking-[0.42em] text-[#20292f]">OPC</p><p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.11em] text-[#687078]">{compact ? "Desk / Sys-01" : "Desk / Sys-01"}</p></div></div>; }
function Profile() { return <div className="mt-auto border-t border-[#d9d6cf] pt-5"><div className="flex items-center gap-3 px-2"><div className="flex h-8 w-8 items-center justify-center bg-[#20292f] font-mono text-[10px] font-medium text-[#f7f5f1]">LS</div><div className="min-w-0"><p className="truncate text-xs font-medium">林舟</p><p className="truncate text-[11px] text-[#737a80]">运营负责人</p></div><ChevronDown className="ml-auto h-3.5 w-3.5 text-[#737a80]" /></div></div>; }
export function RouteTrace({ code, label, className = "" }: { code: string; label: string; className?: string }) { return <div className={`flex items-center gap-3 ${className}`} aria-label={label}><div className="relative flex h-5 w-20 items-center"><span className="absolute left-0 h-1.5 w-1.5 bg-[#e66b3a]" /><span className="absolute left-3 h-px w-5 bg-[#39454c]" /><span className="absolute left-9 h-2.5 w-2.5 border border-[#6f7b80] bg-[#f7f5f1]" /><span className="absolute left-12 h-px w-6 bg-[#39454c]" /><span className="absolute right-0 h-1.5 w-1.5 bg-[#39454c]" /></div><span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#768084]">{code}</span><span className="hidden h-px min-w-8 flex-1 bg-[#d1cec7] sm:block" /><span className="hidden font-mono text-[9px] uppercase tracking-[0.12em] text-[#9a9d9d] md:block">{label}</span></div>; }
function NavigationItems({ currentPath, onNavigate }: { currentPath: string; onNavigate: (path: string) => void }) { return <>{navItems.map(({ label, path, icon: Icon }) => <button key={path} onClick={() => onNavigate(path)} className={`group flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-left text-sm transition-all duration-150 ${currentPath === path ? "border-[#e66b3a] bg-[#e5e2dc] font-medium text-[#20292f]" : "border-transparent text-[#697078] hover:bg-[#e8e5df] hover:text-[#20292f]"}`}><Icon className="h-4 w-4 stroke-[1.7]" />{label}</button>)}</>; }
function NotificationPanel({ onClose, onNavigate }: { onClose: () => void; onNavigate: (path: string) => void }) { return <div className="absolute right-0 top-11 z-40 w-[300px] border border-[#d6d3cc] bg-[#fbfaf7] p-4 shadow-[0_18px_40px_rgba(32,41,47,0.14)]"><div className="flex items-center justify-between border-b border-[#dedbd4] pb-3"><p className="font-display text-lg">需要留意</p><button onClick={onClose} className="font-mono text-[10px] text-[#737a80] hover:text-[#20292f]">关闭</button></div><button onClick={() => { onNavigate("/tasks"); onClose(); }} className="flex w-full items-start gap-3 border-b border-[#e3e0da] py-3 text-left"><span className="mt-1 h-1.5 w-1.5 shrink-0 bg-[#e66b3a]" /><span><span className="block text-xs font-medium">1 项决策今日到期</span><span className="mt-1 block text-[11px] leading-4 text-[#727a7e]">确认 Q3 运营节奏仍在等待结论。</span></span></button><button onClick={onClose} className="mt-3 text-xs font-medium text-[#5b656a] hover:text-[#e66b3a]">标记为已读</button></div>; }
function SearchDialog({ open, onOpenChange, tasks, onNavigate }: { open: boolean; onOpenChange: (open: boolean) => void; tasks: { id: string; title: string; project: string }[]; onNavigate: (path: string) => void }) { const [query, setQuery] = useState(""); const results = tasks.filter((task) => `${task.title}${task.project}`.toLowerCase().includes(query.toLowerCase())).slice(0, 4); return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-[620px] rounded-none border-[#d5d2cb] bg-[#f7f5f1] p-0 shadow-[0_24px_80px_rgba(32,41,47,0.18)]"><DialogHeader className="sr-only"><DialogTitle>搜索工作区</DialogTitle><DialogDescription>搜索任务和页面</DialogDescription></DialogHeader><div className="flex items-center gap-3 border-b border-[#d5d2cb] px-5 py-4"><Search className="h-4 w-4 text-[#737a80]" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、项目或页面" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#9a9d9e]" /><Command className="h-4 w-4 text-[#9a9d9e]" /></div><div className="p-3"><p className="px-2 py-2 font-mono text-[10px] tracking-[0.14em] text-[#7a8084]">快速前往</p>{[{ label: "任务队列", path: "/tasks" }, { label: "团队容量", path: "/team" }, { label: "工作区设置", path: "/settings" }].map((item) => <button key={item.path} onClick={() => onNavigate(item.path)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-[#eae7e1]"><span>{item.label}</span><span className="font-mono text-[10px] text-[#8b9092]">页面</span></button>)}<p className="mt-3 px-2 py-2 font-mono text-[10px] tracking-[0.14em] text-[#7a8084]">匹配任务</p>{results.length ? results.map((task) => <button key={task.id} onClick={() => onNavigate("/tasks")} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-[#eae7e1]"><span>{task.title}</span><span className="font-mono text-[10px] text-[#8b9092]">{task.project}</span></button>) : <p className="px-3 py-3 text-xs text-[#7a8084]">没有匹配记录。</p>}</div></DialogContent></Dialog>; }
