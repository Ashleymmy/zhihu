/**
 * 纸面操作台设计提醒：表单按档案录入的节奏组织；字段清楚、对比克制、提交行为明确。
 */
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type TaskPriority, useWorkspace } from "@/contexts/WorkspaceContext";
import { useState } from "react";

type NewTaskDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

export function NewTaskDialog({ open, onOpenChange }: NewTaskDialogProps) {
  const { addTask } = useWorkspace();
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("林舟");
  const [due, setDue] = useState("今天");
  const [project, setProject] = useState("运营规划");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [note, setNote] = useState("");

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return;
    addTask({ title: title.trim(), owner, due, project, priority, note });
    setTitle("");
    setNote("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[620px] rounded-none border-[#d5d2cb] bg-[#f7f5f1] p-0 shadow-[0_24px_80px_rgba(32,41,47,0.18)]">
        <form onSubmit={submit}>
          <DialogHeader className="border-b border-[#d5d2cb] px-6 py-5 text-left">
            <p className="font-mono text-[10px] tracking-[0.16em] text-[#e66b3a]">新建记录 / 01</p>
            <DialogTitle className="font-display text-[27px] font-normal tracking-[-0.03em]">将工作加入队列</DialogTitle>
            <DialogDescription className="text-xs leading-5 text-[#687078]">先记录足以推进的关键信息；其余细节可在任务页继续补充。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 px-6 py-6 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.13em] text-[#737a80]">任务名称</span>
              <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：确认 Q3 运营节奏" className="mt-2 h-10 w-full border-b border-[#aaa9a3] bg-transparent px-0 text-sm outline-none placeholder:text-[#a3a5a2] focus:border-[#e66b3a]" />
            </label>
            <FieldSelect label="负责人" value={owner} onChange={setOwner} options={["林舟", "陈悦", "周晗", "吴楠", "方野"]} />
            <FieldSelect label="截止时间" value={due} onChange={setDue} options={["今天", "明天", "8 月 22 日", "8 月 23 日", "本周内"]} />
            <FieldSelect label="归属项目" value={project} onChange={setProject} options={["运营规划", "Northstar", "资源计划", "供应商管理", "团队协同"]} />
            <label>
              <span className="font-mono text-[10px] uppercase tracking-[0.13em] text-[#737a80]">优先级</span>
              <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} className="mt-2 h-10 w-full border-b border-[#aaa9a3] bg-transparent text-sm outline-none focus:border-[#e66b3a]">
                <option value="high">高优先级</option><option value="medium">中优先级</option><option value="low">低优先级</option>
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.13em] text-[#737a80]">说明（可选）</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="补充完成条件、背景或关联决定。" className="mt-2 min-h-[92px] w-full resize-none border border-[#d5d2cb] bg-[#fbfaf7] p-3 text-sm leading-6 outline-none placeholder:text-[#a3a5a2] focus:border-[#e66b3a]" />
            </label>
          </div>
          <DialogFooter className="border-t border-[#d5d2cb] bg-[#efede8] px-6 py-4 sm:justify-between">
            <p className="hidden font-mono text-[10px] text-[#7c8284] sm:block">提交后状态默认为「待处理」</p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="h-9 rounded-none text-xs text-[#687078] hover:bg-[#e1ded8]">取消</Button>
              <Button type="submit" disabled={!title.trim()} className="h-9 rounded-none bg-[#20292f] px-4 text-xs text-[#f7f5f1] hover:bg-[#303b42]">加入队列</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label><span className="font-mono text-[10px] uppercase tracking-[0.13em] text-[#737a80]">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 h-10 w-full border-b border-[#aaa9a3] bg-transparent text-sm outline-none focus:border-[#e66b3a]">{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}
