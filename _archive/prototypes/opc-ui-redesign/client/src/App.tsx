/**
 * 纸面操作台设计提醒：路由保持直接、可退出；所有页面共享同一稳定工作台框架。
 */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import Home from "@/pages/Home";
import NotFound from "@/pages/NotFound";
import Settings from "@/pages/Settings";
import Tasks from "@/pages/Tasks";
import Team from "@/pages/Team";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

function Router() { return <Switch><Route path="/" component={Home} /><Route path="/tasks" component={Tasks} /><Route path="/team" component={Team} /><Route path="/settings" component={Settings} /><Route path="/404" component={NotFound} /><Route component={NotFound} /></Switch>; }
function App() { return <ErrorBoundary><ThemeProvider defaultTheme="light"><WorkspaceProvider><TooltipProvider><Toaster position="bottom-right" richColors /><Router /></TooltipProvider></WorkspaceProvider></ThemeProvider></ErrorBoundary>; }
export default App;
