import { describe, expect, it } from 'vitest';
import {
  adaptAllianceIngress,
  ALLIANCE_OPERATION_CONTRACTS,
  ALLIANCE_REALTIME_FIELDS,
  ALLIANCE_SIGNATURE_PROFILES,
  AllianceBusinessError,
  AllianceProtocolError,
  parseAllianceIngress,
  prepareAllianceRequest,
  projectAllianceSuccess,
} from '../../src/zhihu/allianceContracts';
import { resolvePublicEndpoint, type AllianceEndpoint } from '../../src/zhihu/allianceEndpointRegistry';
import { buildSignatureTrace } from '../../src/sign/zhihu';

const releaseTime = '2026-08-17T10:00:00+08:00';
const composition = {
  planId: 'plan-1',
  channelId: 'channel-1',
  mediaType: 'KOC抖音',
  mediaAccount: 'account-1',
  compositionType: 1,
  compositionSubType: 2,
  compositionUrl: 'https://example.com/composition',
  releaseTime,
};

function endpoint(method: string, path: string): AllianceEndpoint {
  const resolved = resolvePublicEndpoint(method, path);
  if (!resolved) throw new Error(`endpoint not found: ${method} ${path}`);
  return resolved;
}

const operations = [
  {
    endpoint: endpoint('POST', '/popularize_plan'),
    pathCompositionId: undefined,
    input: {
      taskId: 'task-1',
      channelId: 'channel-1',
      contentUrl: 'https://example.com/landing',
      popularizeType: 0,
      keyword: '关键词',
      secondChannelId: 'second-1',
    },
  },
  {
    endpoint: endpoint('POST', '/popularize_plans'),
    pathCompositionId: undefined,
    input: { taskId: 'task-1', channelId: 'channel-1', popularizeType: 0, secondChannelId: 'second-1' },
  },
  { endpoint: endpoint('POST', '/popularize_composition/v2'), input: composition, pathCompositionId: undefined },
  {
    endpoint: endpoint('POST', '/popularize_compositions/v2'),
    input: { bindType: 1, channelId: 'channel-1' },
    pathCompositionId: undefined,
  },
  {
    endpoint: endpoint('PUT', '/popularize_composition/v2/2071266138193975100'),
    input: composition,
    pathCompositionId: '2071266138193975100',
  },
  {
    endpoint: endpoint('GET', '/popularize_compositions'),
    pathCompositionId: undefined,
    input: { channelId: 'channel-1', keyword: '关键词', page: '2', pageSize: '20' },
  },
  {
    endpoint: endpoint('GET', '/data_report/real_time_data'),
    pathCompositionId: undefined,
    input: { type: '1', timeScale: '1', fields: ALLIANCE_REALTIME_FIELDS.join(',') },
  },
] as const;

describe('知乎联盟严格 contracts', () => {
  it('P0007-R2A-SCHEMA-001 rejects malformed non-batch ingress while preserving offline batch schemas', () => {
    const invalidInputs = [
      [endpoint('POST', '/popularize_plan'), { keyword: '缺少字段' }],
      [endpoint('POST', '/popularize_plan'), { ...operations[0].input, task_id: 'snake-case' }],
      [endpoint('POST', '/popularize_plan'), { ...operations[0].input, popularizeType: '0' }],
      [endpoint('POST', '/popularize_composition/v2'), { ...composition, accessToken: 'forbidden' }],
      [endpoint('POST', '/popularize_composition/v2'), { ...composition, compositionType: '1' }],
      [endpoint('PUT', '/popularize_composition/v2/2071266138193975100'), { ...composition, signature: 'forbidden' }],
      [endpoint('GET', '/popularize_compositions'), { channelId: 'channel-1', keyword: '关键词', pageSize: '101' }],
      [endpoint('GET', '/data_report/real_time_data'), { type: 1, timeScale: 1, fields: 'search_num,unknown_metric' }],
    ] as const;

    for (const [currentEndpoint, input] of invalidInputs) {
      expect(() => parseAllianceIngress(currentEndpoint, input, '2071266138193975100')).toThrow();
    }

    expect(parseAllianceIngress(operations[1].endpoint, operations[1].input)).toEqual(operations[1].input);
    expect(parseAllianceIngress(operations[3].endpoint, operations[3].input)).toEqual(operations[3].input);
  });

  it('P0007-R2A-ADAPTER-001 maps all seven public inputs to exact official fields', () => {
    const adapted = operations.map((operation) => {
      const ingress = parseAllianceIngress(operation.endpoint, operation.input, operation.pathCompositionId);
      return adaptAllianceIngress(operation.endpoint, ingress);
    });

    expect(adapted).toEqual([
      {
        task_id: 'task-1',
        channel_id: 'channel-1',
        content_url: 'https://example.com/landing',
        popularize_type: 0,
        keyword: '关键词',
        second_channel_id: 'second-1',
      },
      { task_id: 'task-1', channel_id: 'channel-1', popularize_type: 0, second_channel_id: 'second-1' },
      {
        plan_id: 'plan-1',
        channel_id: 'channel-1',
        media_type: 'KOC抖音',
        media_account: 'account-1',
        composition_type: 1,
        composition_sub_type: 2,
        composition_url: 'https://example.com/composition',
        release_time: Math.floor(Date.parse(releaseTime) / 1000),
      },
      { bind_type: 1, channel_id: 'channel-1' },
      {
        plan_id: 'plan-1',
        channel_id: 'channel-1',
        media_type: 'KOC抖音',
        media_account: 'account-1',
        composition_type: 1,
        composition_sub_type: 2,
        composition_url: 'https://example.com/composition',
        release_time: Math.floor(Date.parse(releaseTime) / 1000),
      },
      { channel_id: 'channel-1', keyword: '关键词', offset: 20, limit: 20 },
      { type: 1, time_scale: 1, fields: 'search_num,order_num,created_at' },
    ]);
    expect(() =>
      parseAllianceIngress(operations[2].endpoint, { ...composition, releaseTime: '2026-08-17T10:00:00' }),
    ).toThrow();
    expect(() => parseAllianceIngress(operations[2].endpoint, { ...composition, compositionType: 3 })).toThrow();
  });

  it('P0007-R2A-SIGN-001 signs endpoint profiles deterministically and keeps realtime token-only', () => {
    for (const operation of operations) {
      const ingress = parseAllianceIngress(operation.endpoint, operation.input, operation.pathCompositionId);
      const upstream = adaptAllianceIngress(operation.endpoint, ingress);
      const prepared = prepareAllianceRequest(operation.endpoint, upstream, 'token', 'secret', 123);
      const profile =
        ALLIANCE_SIGNATURE_PROFILES[operation.endpoint.definitionKey as keyof typeof ALLIANCE_SIGNATURE_PROFILES];
      if (profile.mode === 'token-only') {
        expect(prepared).toEqual({ ...upstream, access_token: 'token' });
      } else {
        expect(prepared).toMatchObject({ ...upstream, access_token: 'token', timestamp: 123 });
        expect(prepared.signature).toMatch(/^[a-f0-9]{64}$/u);
      }
    }

    const planProfile = ALLIANCE_SIGNATURE_PROFILES['POST /popularize_plan'];
    expect(
      buildSignatureTrace({ access_token: 'token', timestamp: 1, second_channel_id: 'ignored' }, 'secret', planProfile)
        .kvStr,
    ).not.toContain('second_channel_id');
    const listProfile = ALLIANCE_SIGNATURE_PROFILES['GET /popularize_compositions'];
    expect(
      buildSignatureTrace({ access_token: 'token', timestamp: 1, offset: 0, limit: 10 }, 'secret', listProfile).kvStr,
    ).not.toContain('offset=');
    expect(ALLIANCE_SIGNATURE_PROFILES['PUT /popularize_composition/v2/{composition_id}'].pathParametersIncluded).toBe(
      false,
    );
  });

  it('P0007-R2A-RESP-001 projects canonical data without upstream envelope fields', () => {
    const planIngress = parseAllianceIngress(operations[0].endpoint, operations[0].input);
    expect(
      projectAllianceSuccess(
        operations[0].endpoint,
        { data: { plan_id: '2071265453767405652' }, success: true },
        planIngress,
      ),
    ).toMatchObject({ data: { planId: '2071265453767405652' } });

    const listOperation = operations[5];
    const listIngress = parseAllianceIngress(listOperation.endpoint, listOperation.input);
    expect(
      projectAllianceSuccess(
        listOperation.endpoint,
        {
          data: [
            {
              composition_id: '2071266138193975100',
              composition_url: 'https://example.com/composition',
              submit_time: '2026-08-17 10:00:00',
              composition_type: 1,
              composition_sub_type: 2,
              keyword: '关键词',
              access_token: 'must-not-leak',
            },
          ],
          pagination: { total: 1, offset: 20, limit: 20 },
          success: true,
        },
        listIngress,
      ),
    ).toEqual({
      data: [
        {
          compositionId: '2071266138193975100',
          compositionUrl: 'https://example.com/composition',
          submitTime: '2026-08-17 10:00:00',
          compositionType: 1,
          compositionSubType: 2,
          keyword: '关键词',
        },
      ],
      clientData: {
        data: [
          {
            compositionId: '2071266138193975100',
            compositionUrl: 'https://example.com/composition',
            submitTime: '2026-08-17 10:00:00',
            compositionType: 1,
            compositionSubType: 2,
            keyword: '关键词',
          },
        ],
      },
      message: ALLIANCE_OPERATION_CONTRACTS['GET /popularize_compositions'].message,
      meta: { page: 2, pageSize: 20, total: 1 },
    });

    const realtimeOperation = operations[6];
    const realtimeIngress = parseAllianceIngress(realtimeOperation.endpoint, realtimeOperation.input);
    expect(
      projectAllianceSuccess(
        realtimeOperation.endpoint,
        {
          time_range: '2026-08-17 10:00:00',
          data: [
            {
              keyword: '关键词',
              channel_id: 'channel-1',
              channel_name: '渠道一',
              fields_data: { search_num: 1, order_num: 2, created_at: '2026-08-17', secret: 'must-not-leak' },
            },
          ],
        },
        realtimeIngress,
      ),
    ).toMatchObject({
      data: {
        timeRange: '2026-08-17 10:00:00',
        items: [
          {
            keyword: '关键词',
            channelId: 'channel-1',
            channelName: '渠道一',
            fieldsData: { searchNum: 1, orderNum: 2, createdAt: '2026-08-17' },
          },
        ],
      },
    });
  });

  it('P0007-R2A-RESP-002 rejects upstream business and protocol failures without partial projection', () => {
    const planIngress = parseAllianceIngress(operations[0].endpoint, operations[0].input);
    expect(() => projectAllianceSuccess(operations[0].endpoint, { error: { message: 'secret' } }, planIngress)).toThrow(
      AllianceBusinessError,
    );
    expect(() => projectAllianceSuccess(operations[0].endpoint, { data: {} }, planIngress)).toThrow(
      AllianceProtocolError,
    );
    expect(() =>
      projectAllianceSuccess(
        operations[0].endpoint,
        { data: { plan_id: 2071265453767405652 }, success: true },
        planIngress,
      ),
    ).toThrow(AllianceProtocolError);
    expect(() =>
      projectAllianceSuccess(operations[0].endpoint, { data: { plan_id: 1 }, success: true }, planIngress),
    ).toThrow(AllianceProtocolError);

    const compositionOperation = operations[2];
    const compositionIngress = parseAllianceIngress(compositionOperation.endpoint, compositionOperation.input);
    expect(
      projectAllianceSuccess(
        compositionOperation.endpoint,
        { data: { composition_id: '2071266138193975100' }, success: true },
        compositionIngress,
      ),
    ).toMatchObject({ data: { compositionId: '2071266138193975100' } });
    expect(() =>
      projectAllianceSuccess(
        compositionOperation.endpoint,
        { data: { composition_id: 1 }, success: true },
        compositionIngress,
      ),
    ).toThrow(AllianceProtocolError);
  });
});
