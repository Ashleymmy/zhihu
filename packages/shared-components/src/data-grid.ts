export type GridTone = "success" | "warning" | "danger" | "neutral" | "leader";
export interface DataGridColumn {
  key: string;
  label: string;
  numeric?: boolean;
}
export interface DataGridView {
  key: string;
  label: string;
}
export interface DataGridRow {
  id: string;
  title: string;
  status: { key: string; label: string; tone: GridTone; description?: string };
  cells: Record<string, string | number | null>;
  next?: {
    actor: string;
    text: string;
    action?: { key: string; label: string; disabled?: boolean };
  };
  viewKeys?: string[];
}
export interface DataGridTotal {
  label: string;
  value: string | number;
}
export interface DataGridGroup {
  key: string;
  label: string;
  description: string;
  tone: GridTone;
  rows: DataGridRow[];
}
const normalize = (s: string) => s.normalize("NFKC").trim().toLocaleLowerCase();
export function gridViewRows(rows: DataGridRow[], view: string, search = "") {
  const needle = normalize(search);
  return rows.filter(
    (row) =>
      (view === "all" || row.viewKeys?.includes(view)) &&
      (!needle ||
        normalize(
          [
            row.title,
            row.status.label,
            ...Object.values(row.cells),
            row.next?.actor,
            row.next?.text,
          ]
            .filter((v) => v != null)
            .join(" "),
        ).includes(needle)),
  );
}
export function groupGridRows(
  rows: DataGridRow[],
  field = "status",
): DataGridGroup[] {
  const groups = new Map<string, DataGridGroup>();
  const rank: Record<GridTone, number> = {
    danger: 0,
    warning: 1,
    neutral: 2,
    leader: 3,
    success: 4,
  };
  for (const row of rows) {
    const key =
      field === "status" ? row.status.key : String(row.cells[field] ?? "");
    if (!groups.has(key))
      groups.set(key, {
        key,
        label: field === "status" ? row.status.label : key || "未填写",
        description: field === "status" ? (row.status.description ?? "") : "",
        tone: field === "status" ? row.status.tone : "neutral",
        rows: [],
      });
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()].sort((a, b) =>
    field === "status" ? rank[a.tone] - rank[b.tone] : 0,
  );
}
