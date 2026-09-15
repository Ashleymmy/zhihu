import {describe,it,expect} from 'vitest';
import {dutyAllows,assertDuty} from '../../src/core/duties';
import type {AuthUser} from '../../src/types';
const user=(role:AuthUser['role'],adminDuty?:AuthUser['adminDuty']):AuthUser=>({sub:'1',role,adminDuty,parentId:null,username:'test',displayName:'测试',jti:'test'});
describe('管理员岗位边界',()=>{
 it('运营与财务相互隔离，完整管理员可管理岗位',()=>{
  expect(dutyAllows(user('admin','operations'),'operations')).toBe(true);
  expect(dutyAllows(user('admin','finance'),'finance')).toBe(true);
  expect(()=>assertDuty(user('admin','operations'),'finance')).toThrow('财务权限');
  expect(()=>assertDuty(user('admin','finance'),'operations')).toThrow('运营权限');
  for(const duty of ['finance','operations'] as const)expect(()=>assertDuty(user('admin',duty),'staff')).toThrow('完整管理员');
  expect(dutyAllows(user('admin'),'staff')).toBe(true);
 });
 it('团长和达人不能伪造管理员岗位',()=>{
  for(const role of ['leader','creator'] as const)for(const area of ['finance','operations','staff'] as const)expect(dutyAllows(user(role,'all'),area)).toBe(false);
 });
});
