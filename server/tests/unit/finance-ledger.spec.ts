import {describe,it,expect} from 'vitest';
import {cash,cashText} from '../../src/core/money';
describe('资金金额精度',()=>{
 it('完整保留大额和四位小数，差额不经过浮点运算',()=>{
  const value='9999999999999999.9999';expect(cashText(cash(value))).toBe(value);
  expect(cashText(cash('0.0001')+cash('0.0002'))).toBe('0.0003');
  expect(cashText(cash('390')-cash('391.1234'))).toBe('-1.1234');
 });
 it('拒绝溢出、小数截断、负提现和非金额值',()=>{
  for(const value of ['1.23456','1e6','NaN','-1','10000000000000000'])expect(()=>cash(value)).toThrow();
  expect(()=>cashText(10n**20n)).toThrow();
 });
});
