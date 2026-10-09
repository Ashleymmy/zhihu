export interface EarningScope {
  projectId: string;
  projectName: string;
  moduleId: string;
  accountId: string;
}
export interface EarningLine extends EarningScope {
  id: string;
  taskId: string;
  taskName: string;
  businessDate: string;
  metricType: string;
  metricLabel: string;
  quantityUnit: string;
  performerId: string | null;
  performerName: string;
  ruleCode: string;
  quantity: string | null;
  unitPrice: string | null;
  calculationAmount: string | null;
  amount: string | null;
  confirmedAmount: string;
  pendingAmount: string | null;
  isInternal: number;
  isReady: number;
  confirmedAt: string | null;
  reason: string;
  nextAction: string;
  earningGroup: "self" | "team";
}
export interface EarningGroup {
  projectId: string;
  projectName: string;
  metricType: string;
  metricLabel: string;
  quantityUnit: string;
  quantity: string;
  records: number;
  amount: string;
  confirmedAmount: string;
  internalAmount: string;
  pendingCalculations: number;
}
export interface EarningView {
  scopes: EarningScope[];
  list: EarningLine[];
  groups: EarningGroup[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    amount: string;
    confirmedAmount: string;
    pendingAmount: string;
    internalAmount: string;
    pendingCalculations: number;
  };
}
export function earningMoney(value: string | null | undefined) {
  if (value == null) return "待计算";
  const negative = value.startsWith("-"),
    [whole, part = ""] = value.replace(/^-/, "").split(".");
  const cents =
    BigInt(whole!) * 100n +
    BigInt(part.slice(0, 2).padEnd(2, "0")) +
    (part[2] && part[2] >= "5" ? 1n : 0n);
  return (
    (negative && cents !== 0n ? "-" : "") +
    "¥" +
    (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    "." +
    String(cents % 100n).padStart(2, "0")
  );
}
export function cashUnits(value: string | null | undefined) {
  const text = value ?? "0",
    negative = text.startsWith("-"),
    [whole, part = ""] = text.replace(/^-/, "").split(".");
  return (
    (BigInt(whole!) * 10000n + BigInt(part.slice(0, 4).padEnd(4, "0"))) *
    (negative ? -1n : 1n)
  );
}
export function cashAmount(value: string | null | undefined) {
  const units = cashUnits(value),
    absolute = units < 0n ? -units : units;
  const fraction = String(absolute % 10000n)
    .padStart(4, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return (
    (units < 0n ? "-" : "") +
    (absolute / 10000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    "." +
    fraction
  );
}
