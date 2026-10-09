import { expect, it } from "vitest";
import { earningMoney, cashUnits, cashAmount } from "../src/platform-earnings";
it("formats exact monetary strings beyond floating point precision and keeps unknown amounts distinct from zero", () => {
  expect(earningMoney("9007199254740991.1250")).toBe(
    "¥9,007,199,254,740,991.13",
  );
  expect(earningMoney("-0.0050")).toBe("-¥0.01");
  expect(earningMoney("-0.0049")).toBe("¥0.00");
  expect(earningMoney("164.80000000")).toBe("¥164.80");
  expect(earningMoney("0.00999999")).toBe("¥0.01");
  expect(earningMoney("0.0000")).toBe("¥0.00");
  expect(earningMoney(null)).toBe("待计算");
});
it("keeps wallet precision and compares withdrawal minimums as integers", () => {
  expect(cashAmount("9007199254740991.1234")).toBe(
    "9,007,199,254,740,991.1234",
  );
  expect(cashAmount("12.1000")).toBe("12.10");
  expect(cashAmount("-0.0001")).toBe("-0.0001");
  expect(cashUnits("0.0099")).toBe(99n);
  expect(cashUnits("0.0100")).toBe(100n);
  expect(cashUnits(undefined)).toBe(0n);
});
