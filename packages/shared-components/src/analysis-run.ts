export type AnalysisStepStatus =
  "pending" | "running" | "done" | "ask" | "failed" | "skipped";
export interface AnalysisOption {
  key: string;
  label: string;
  tone?: "primary" | "neutral";
  disabled?: boolean;
}
export interface AnalysisAsk {
  id: string;
  text: string;
  options: AnalysisOption[];
}
export interface AnalysisStep {
  key: string;
  title: string;
  summary: string;
  status: AnalysisStepStatus;
  asks?: AnalysisAsk[];
}
export interface AnalysisRunModel {
  id: string;
  fileName: string;
  source?: string;
  createdAt?: string;
  status: "running" | "needs_input" | "done" | "failed";
  progress?: { done: number; total: number };
  steps: AnalysisStep[];
  conclusion?: {
    title: string;
    value: string;
    summary: string;
    pendingText?: string;
    actions?: AnalysisOption[];
  };
}
