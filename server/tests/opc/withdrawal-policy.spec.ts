import { it, expect } from 'vitest';
import {
  calculateWithdrawal,
  calendar2026,
  afterWorkdays,
  shanghaiDay,
  type WorkCalendar,
} from '../../src/core/withdrawal-policy';

it('uses gross boundaries and exact cent rounding without changing the reserved amount', () => {
  expect(calculateWithdrawal('0.01', 'creator', '2026-10-13')).toMatchObject({amount:'0.0100',feeAmount:'0.0000',netAmount:'0.0100',invoiceRequired:false});
  expect(calculateWithdrawal('9.99', 'creator', '2026-10-13').netAmount).toBe('9.8900');
  expect(calculateWithdrawal('10', 'creator', '2026-10-13')).toMatchObject({
    amount: '10.0000',
    feeAmount: '0.1000',
    netAmount: '9.9000',
    tier: 'small',
    invoiceRequired: false,
  });
  expect(calculateWithdrawal('100', 'creator', '2026-10-13')).toMatchObject({
    amount: '100.0000',
    feeAmount: '1.0000',
    netAmount: '99.0000',
  });
  expect(calculateWithdrawal('10.50', 'creator', '2026-10-13')).toMatchObject({
    feeAmount: '0.1100',
    netAmount: '10.3900',
  });
  expect(calculateWithdrawal('500', 'leader', '2026-10-13')).toMatchObject({ tier: 'small', invoiceRequired: false });
  expect(() => calculateWithdrawal('500.01','leader','2026-10-13')).toThrow('限额');
  expect(() => calculateWithdrawal('100.01','creator','2026-10-13')).toThrow('限额');
  for (const input of ['0','-10', '10.001', 'NaN', '1e3'])
    expect(() => calculateWithdrawal(input, 'creator', '2026-10-13')).toThrow();
  expect(() => calculateWithdrawal('9999999999999999.99','creator','2026-10-13')).toThrow('限额');
  expect(() => calculateWithdrawal('1','admin','2026-10-13')).toThrow('团长或达人');
});
it('counts official holidays and make-up weekends, beginning on the next working day', () => {
  expect(afterWorkdays('2026-09-30', 3, [calendar2026])).toBe('2026-10-10');
  expect(afterWorkdays('2026-10-09', 3, [calendar2026])).toBe('2026-10-13');
  expect(afterWorkdays('2026-02-13', 3, [calendar2026])).toBe('2026-02-25');
  expect(calculateWithdrawal('100', 'creator', '2026-10-13').settlementDeadline).toBe('2026-10-16');
  expect(shanghaiDay(new Date('2026-10-13T16:00:00Z'))).toBe('2026-10-14');
});
it('requires a configured statutory calendar across years instead of inventing working days', () => {
  const synthetic: WorkCalendar[] = [{year:2027,source:'synthetic test only',holidays:[],workdays:[]}];
  expect(calculateWithdrawal('100','creator','2026-12-31',[calendar2026,...synthetic])).toMatchObject({settlementMonth:null,settlementDeadline:'2027-01-05'});
  expect(() => calculateWithdrawal('100','creator','2026-12-31',[calendar2026])).toThrow('日历尚未更新');
});
