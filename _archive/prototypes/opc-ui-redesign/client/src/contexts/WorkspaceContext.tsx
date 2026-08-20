/**
 * 纸面操作台设计提醒：状态逻辑服务于清晰、可追溯的运营动作；不在数据层引入装饰性概念。
 */
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { toast } from "sonner";

export type TaskState = "待决策" | "进行中" | "待处理" | "已完成";
export type TaskPriority = "high" | "medium" | "low";

export type Task = {
  id: string;
  title: string;
  owner: string;
  due: string;
  state: TaskState;
  priority: TaskPriority;
  project: string;
  note: string;
};

export const teamMembers = [
  { id: "lin", initials: "LS", name: "林舟", role: "运营负责人", load: 82, focus: "Q3 运营节奏", status: "在线" },
  { id: "chen", initials: "CY", name: "陈悦", role: "项目经理", load: 74, focus: "Northstar 发布", status: "在线" },
  { id: "zhou", initials: "ZH", name: "周晗", role: "采购与合规", load: 58, focus: "供应商更新", status: "专注中" },
  { id: "wu", initials: "WN", name: "吴楠", role: "数据运营", load: 69, focus: "容量预测", status: "在线" },
  { id: "fang", initials: "FY", name: "方野", role: "体验设计", load: 46, focus: "设计系统", status: "离线" },
];

const initialTasks: Task[] = [
  { id: "t-01", title: "确认 Q3 运营节奏", owner: "林舟", due: "今天", state: "待决策", priority: "high", project: "运营规划", note: "需要确认三个资源分配节点，并在今日例会前同步结论。" },
  { id: "t-02", title: "复核 Northstar 发布清单", owner: "陈悦", due: "明天", state: "进行中", priority: "medium", project: "Northstar", note: "发布前需要复核版本、渠道和回滚路径。" },
  { id: "t-03", title: "归档供应商报价版本", owner: "周晗", due: "8 月 22 日", state: "待处理", priority: "low", project: "供应商管理", note: "按最新比价结果更新归档及签核记录。" },
  { id: "t-04", title: "校准本周容量预测", owner: "吴楠", due: "8 月 23 日", state: "待处理", priority: "low", project: "资源计划", note: "根据新增请求与实际工时更新容量预测。" },
  { id: "t-05", title: "整理下周项目复盘素材", owner: "方野", due: "8 月 24 日", state: "待处理", priority: "medium", project: "知识库", note: "收集关键项目的结果、风险与决策记录。" },
  { id: "t-06", title: "确认月度例会议程", owner: "林舟", due: "8 月 25 日", state: "已完成", priority: "low", project: "团队协同", note: "议程已同步给参会成员。" },
];

type TaskDraft = Pick<Task, "title" | "owner" | "due" | "priority" | "project" | "note">;

type WorkspaceContextValue = {
  tasks: Task[];
  addTask: (task: TaskDraft) => void;
  updateTask: (id: string, update: Partial<Pick<Task, "state" | "priority" | "owner" | "due">>) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);

  const value = useMemo<WorkspaceContextValue>(() => ({
    tasks,
    addTask: (draft) => {
      const task: Task = {
        ...draft,
        id: `t-${Date.now()}`,
        state: "待处理",
        owner: draft.owner || "林舟",
        project: draft.project || "未分类",
        note: draft.note || "尚未添加说明。",
      };
      setTasks((current) => [task, ...current]);
      toast.success("任务已加入队列", { description: task.title });
    },
    updateTask: (id, update) => {
      setTasks((current) => current.map((task) => task.id === id ? { ...task, ...update } : task));
      toast.success("任务已更新");
    },
  }), [tasks]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace 必须在 WorkspaceProvider 中使用。");
  return context;
}
