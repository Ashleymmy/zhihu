import { describe, expect, it } from 'vitest';
import { evaluateAllianceVersionPolicy, isCanonicalCompositionId } from '../../src/zhihu/allianceVersionPolicy';

describe('知乎联盟精确路由策略', () => {
  it('P0007-R1-REG-001 permits exactly the seven registered operations', () => {
    const allowed = [
      ['POST', '/popularize_plan'],
      ['POST', '/popularize_plans'],
      ['POST', '/popularize_composition/v2'],
      ['POST', '/popularize_compositions/v2'],
      ['PUT', '/popularize_composition/v2/2071266138193975100'],
      ['GET', '/popularize_compositions'],
      ['GET', '/data_report/real_time_data'],
    ] as const;

    for (const [method, target] of allowed) {
      expect(evaluateAllianceVersionPolicy(method, target), `${method} ${target}`).toMatchObject({
        allowed: true,
        reason: 'allowed',
      });
    }
  });

  it('P0007-R1-DENY-001 rejects unknown paths and methods before route dispatch', () => {
    for (const [method, target] of [
      ['GET', '/get_agent_channels'],
      ['POST', '/upload_image'],
      ['GET', '/get_batch_task_result'],
      ['GET', '/data_report/daily_data'],
      ['PUT', '/popularize_plan/2071265453767405652'],
      ['HEAD', '/popularize_compositions'],
      ['OPTIONS', '/popularize_compositions'],
      ['PATCH', '/popularize_composition/v2/1'],
    ] as const) {
      expect(evaluateAllianceVersionPolicy(method, target).allowed, `${method} ${target}`).toBe(false);
    }
  });

  it('P0007-R1-CANON-001 rejects path mutations but ignores query text', () => {
    const denied = [
      '/popularize_composition%2Fv2',
      '/%70opularize_composition/v1',
      '/%2570opularize_composition/v1',
      '/popularize_composition/v2%2F1',
      '/popularize_composition/v2/%2E%2E',
      '/popularize_composition/v2/1\\2',
      '/popularize_composition/v2/1\u0000',
      '/popularize_composition/v2/1\u001f',
      '/popularize_plan;foo',
      '//popularize_composition/v2',
      '/popularize_composition/./v2',
      '/POPULARIZE_COMPOSITION/v2',
      '/popularize_composition/v2/',
      '/popularize_composition/v2/1/extra',
      '/popularize_composition/v2/01',
    ];

    for (const target of denied) {
      expect(evaluateAllianceVersionPolicy('PUT', target).allowed, target).toBe(false);
    }

    expect(evaluateAllianceVersionPolicy('GET', '/popularize_compositions?keyword=%252F').allowed).toBe(true);
    expect(evaluateAllianceVersionPolicy('POST', '/popularize_plan?target=https://attacker.example/%25').allowed).toBe(
      true,
    );
  });

  it('keeps canonical composition IDs as strings without numeric coercion', () => {
    expect(isCanonicalCompositionId('90071992547409931234')).toBe(true);
    expect(isCanonicalCompositionId('1')).toBe(true);
    for (const value of ['0', '01', '123456789012345678901', '1.0', '1e3', '1\n', 1, new String('1'), null]) {
      expect(isCanonicalCompositionId(value), String(value)).toBe(false);
    }
  });
});
