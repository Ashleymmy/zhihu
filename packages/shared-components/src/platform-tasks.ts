export interface TaskAction {
  key: string;
  label: string;
  path?: string;
  confirm?: string;
  fields?: {
    key: string;
    label: string;
    type: "text" | "url" | "select" | "textarea";
    required?: boolean;
    value?: string;
    options?: { value: string; label: string }[];
  }[];
}
export interface PlatformTask {
  id: string;
  title: string;
  subtitle?: string;
  status: {
    key: string;
    label: string;
    tone: "success" | "warning" | "danger" | "neutral" | "leader";
  };
  executor: string;
  leader?: string;
  next: { actor: string; text: string; action?: TaskAction };
  metrics: { label: string; value: string }[];
}
export interface PlatformTaskDetail extends PlatformTask {
  fields: { label: string; value: string; url?: string }[];
  progress: {
    label: string;
    status: "done" | "current" | "waiting";
    actor: string;
    description?: string;
  }[];
  actions: TaskAction[];
}
export interface TaskGroup {
  projectId: string;
  projectName: string;
  moduleId: string;
  accountId: string;
  page: number;
  pageSize: number;
  list: PlatformTask[];
  total: number | null;
  status: string;
  create?: { label: string; path: string };
}
