import { permissionsFor } from '../../src/auth/permissions';
import { AuthUser } from '../../src/types';
import { decryptSecret, encryptSecret } from '../../src/utils/secretCrypto';
import { maskAccount, maskName, maskSecret } from '../../src/utils/maskSecret';
import { scopeFilter } from '../../src/utils/scopeFilter';

const user = (role: AuthUser['role']): AuthUser => ({ sub: '42', role, parentId: '1', username: 'u', displayName: 'U', jti: 'j' });

describe('权限与安全工具', () => {
  it('角色权限按矩阵收敛', () => {
    expect(permissionsFor('boss')).toContain('callback.secret');
    expect(permissionsFor('leader')).toContain('team.create_member');
    expect(permissionsFor('member')).not.toContain('team.view');
  });

  it('生成参数化分级范围', () => {
    expect(scopeFilter(user('boss'))).toEqual({ clause: '1=1', bindings: [] });
    expect(scopeFilter(user('leader')).bindings).toEqual(['42', '42']);
    expect(scopeFilter(user('member'))).toEqual({ clause: 'owner_id = ?', bindings: ['42'] });
  });

  it('加密回传秘钥且只显示脱敏结果', () => {
    const encrypted = encryptSecret('sk_live_example_1234');
    expect(encrypted.ciphertext).not.toContain('example');
    expect(decryptSecret(encrypted)).toBe('sk_live_example_1234');
    expect(maskSecret('sk_live_example_1234')).toBe('****1234');
    expect(maskName('张三丰')).toBe('张**丰');
    expect(maskAccount('13800138000')).toBe('13****00');
  });
});
