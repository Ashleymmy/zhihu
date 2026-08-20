import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardLayout from "@/components/DashboardLayout";
import AnalyticsPage from "@/pages/AnalyticsPage";
import CampaignsPage from "@/pages/CampaignsPage";
import EarningsPage from "@/pages/EarningsPage";
import LoginPage from "@/pages/LoginPage";
import OverviewPage from "@/pages/OverviewPage";
import KeywordsCallbacksPage from "@/pages/KeywordsCallbacksPage";
import WorkspaceModulePage from "@/pages/WorkspaceModulePage";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

function WorkspaceRoute({ children }: { children: React.ReactNode }) {
  return <DashboardLayout>{children}</DashboardLayout>;
}

export function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={LoginPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/dashboard"><WorkspaceRoute><OverviewPage /></WorkspaceRoute></Route>
      <Route path="/dashboard/overview"><WorkspaceRoute><OverviewPage /></WorkspaceRoute></Route>
      <Route path="/dashboard/campaigns"><WorkspaceRoute><CampaignsPage /></WorkspaceRoute></Route>
      <Route path="/dashboard/keywords"><WorkspaceRoute><KeywordsCallbacksPage /></WorkspaceRoute></Route>
      <Route path="/dashboard/analytics"><WorkspaceRoute><AnalyticsPage /></WorkspaceRoute></Route>
      <Route path="/dashboard/earnings"><WorkspaceRoute><EarningsPage /></WorkspaceRoute></Route>
      <Route path="/workspace/promote"><WorkspaceRoute><WorkspaceModulePage /></WorkspaceRoute></Route>
      <Route path="/workspace/zhihu"><WorkspaceRoute><WorkspaceModulePage /></WorkspaceRoute></Route>
      <Route path="/workspace/salt"><WorkspaceRoute><WorkspaceModulePage /></WorkspaceRoute></Route>
      <Route path="/workspace/settlement"><WorkspaceRoute><WorkspaceModulePage /></WorkspaceRoute></Route>
      <Route path="/workspace/creative"><WorkspaceRoute><WorkspaceModulePage /></WorkspaceRoute></Route>
      <Route path="/workspace/risk"><WorkspaceRoute><WorkspaceModulePage /></WorkspaceRoute></Route>
      <Route path="/tools/wordpacks"><WorkspaceRoute><WorkspaceModulePage /></WorkspaceRoute></Route>
      <Route path="/tools/word-packs"><WorkspaceRoute><WorkspaceModulePage /></WorkspaceRoute></Route>
      <Route path="/tools/landing-pages"><WorkspaceRoute><WorkspaceModulePage /></WorkspaceRoute></Route>
      <Route path="/tools/assets"><WorkspaceRoute><WorkspaceModulePage /></WorkspaceRoute></Route>
      <Route path="/tools/materials"><WorkspaceRoute><WorkspaceModulePage /></WorkspaceRoute></Route>
      <Route path="/tools/activity"><WorkspaceRoute><WorkspaceModulePage /></WorkspaceRoute></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <AppRouter />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
