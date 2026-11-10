import { describe, it, expect } from "vitest";
import {
  gridViewRows,
  groupGridRows,
  type DataGridRow,
} from "../src/data-grid";
const rows: DataGridRow[] = [
  {
    id: "1",
    title: "完成作品",
    status: { key: "done", label: "已完成", tone: "success" },
    cells: { person: "甲", quantity: 0 },
    viewKeys: ["done"],
  },
  {
    id: "2",
    title: "ＡＢＣ 长篇",
    status: { key: "missing", label: "待处理", tone: "danger" },
    cells: { person: "乙", quantity: "4" },
    viewKeys: ["follow"],
    next: { actor: "运营", text: "指定执行人" },
  },
  {
    id: "3",
    title: "待核对作品",
    status: { key: "wait", label: "待核对", tone: "warning" },
    cells: { person: "甲", quantity: null },
    viewKeys: ["follow"],
  },
];
describe("共享核对表格", () => {
  it('does not describe a mixed blocked group using the first record reason',()=>{
    const mixed:DataGridRow[]=[{id:'a',title:'有作品缺历史',status:{key:'blocked',label:'待补齐',tone:'warning',description:'缺少历史参与资料'},cells:{}},{id:'b',title:'缺作品',status:{key:'blocked',label:'待补齐',tone:'warning',description:'还没有登记作品'},cells:{}}];
    const grouped=groupGridRows(mixed);expect(grouped).toHaveLength(1);expect(grouped[0]?.rows).toHaveLength(2);expect(grouped[0]?.description).toBe('');expect(grouped[0]?.rows[0]?.status.description).toBe('缺少历史参与资料');
  });
  it("视图与搜索同时生效，未计价行不丢失，零值可搜索", () => {
    expect(gridViewRows(rows, "follow")).toHaveLength(2);
    expect(gridViewRows(rows, "follow", "abc").map((r) => r.id)).toEqual(["2"]);
    expect(gridViewRows(rows, "follow", "运营").map((r) => r.id)).toEqual([
      "2",
    ]);
    expect(gridViewRows(rows, "all", "0").map((r) => r.id)).toEqual(["1"]);
  });
  it("需要处理的组排在完成组之前，切换分组不改原始数据", () => {
    expect(groupGridRows(rows).map((g) => g.key)).toEqual([
      "missing",
      "wait",
      "done",
    ]);
    const people = groupGridRows(rows, "person");
    expect(people.map((g) => [g.label, g.rows.length])).toEqual([
      ["甲", 2],
      ["乙", 1],
    ]);
    expect(rows.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });
});
