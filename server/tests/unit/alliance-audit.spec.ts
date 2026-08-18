import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  allianceAuditEvent,
  installAllianceAuditSink,
  resetAllianceAuditSink,
  writeAllianceRejectedAudit,
  type AllianceRejectedAuditEvent,
} from '../../src/zhihu/allianceAudit';
import { AppError } from '../../src/middleware/errors';
import { handleAllianceError, normalizeAllianceErrorForTest } from '../../src/routes/alliance';

function request(method = 'GET'): Request {
  return { method, user: undefined } as unknown as Request;
}

function response(): Response {
  const current = {
    locals: { allianceContext: { requestId: 'request-1', timestamp: 1700000000000 } },
    headersSent: false,
    writableEnded: false,
    status: undefined as number | undefined,
    body: undefined as unknown,
  } as unknown as Response & { statusCode?: number; body?: unknown };
  current.status = function status(value: number) {
    (current as unknown as { statusCode: number }).statusCode = value;
    return current;
  } as unknown as Response['status'];
  (current as unknown as { json: (value: unknown) => Response }).json = (value) => {
    (current as unknown as { body: unknown }).body = value;
    return current;
  };
  return {
    ...current,
  } as unknown as Response;
}

describe('Alliance rejected audit', () => {
  beforeEach(() => {
    resetAllianceAuditSink();
  });

  it('P0007-R6-AUDIT-001 emits the fixed redacted event shape', async () => {
    const events: AllianceRejectedAuditEvent[] = [];
    installAllianceAuditSink(async (event) => {
      events.push(event);
    });
    const event = allianceAuditEvent(request('TRACE'), response(), undefined, 'schema', 422, 42200);
    await writeAllianceRejectedAudit(event);
    expect(events).toEqual([
      {
        requestId: 'request-1',
        timestamp: 1700000000000,
        operationKey: null,
        method: 'OTHER',
        stage: 'schema',
        outcome: 'rejected',
        httpStatus: 422,
        code: 42200,
        userId: null,
        role: null,
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/access_token|signature|secret|sentinel|url|cookie|filename|redis/iu);
  });

  it.each([
    ['business', 'business'],
    ['protocol', 'protocol'],
    ['transport', 'transport'],
  ] as const)('P0007-R6-AUDIT-001 preserves upstream class %s', async (_label, failure) => {
    let event: AllianceRejectedAuditEvent | undefined;
    installAllianceAuditSink(async (value) => {
      event = value;
    });
    await writeAllianceRejectedAudit(
      allianceAuditEvent(request(), response(), undefined, 'upstream', 502, 50200, failure),
    );
    expect(event?.upstreamFailure).toBe(failure);
  });

  it('P0007-R6-NOFALLBACK-001 permits only the test sink injection path', async () => {
    const calls: AllianceRejectedAuditEvent[] = [];
    installAllianceAuditSink(async (event) => {
      calls.push(event);
    });
    await writeAllianceRejectedAudit(allianceAuditEvent(request(), response(), undefined, 'internal', 500, 50000));
    expect(calls).toHaveLength(1);
  });

  it('P0007-R6-REDACT-001 normalizes unexpected AppError to the fixed internal failure', async () => {
    const normalized = normalizeAllianceErrorForTest(new AppError(418, 41801, 'secret-sentinel'));
    expect(normalized).toEqual({ status: 500, code: 50000, message: '服务器内部错误', stage: 'internal' });
    expect(JSON.stringify(normalized)).not.toContain('secret-sentinel');
  });

  it('P0007-R6-ONCE-001 uses the production once writer for unexpected errors', async () => {
    const events: AllianceRejectedAuditEvent[] = [];
    installAllianceAuditSink(async (event) => {
      events.push(event);
    });
    const req = request();
    const end = vi.fn();
    const res = {
      locals: { allianceContext: { requestId: 'request-1', timestamp: 1700000000000 } },
      headersSent: true,
      writableEnded: true,
      end,
    } as unknown as Response;
    const error = new Error('secret-sentinel');
    await handleAllianceError(error, req, res);
    await handleAllianceError(error, req, res);
    expect(events).toHaveLength(1);
    expect(end).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).not.toContain('secret-sentinel');
  });

  it('P0007-R6-ONCE-001 ends a headers-sent response when the sink fails', async () => {
    const end = vi.fn();
    installAllianceAuditSink(async () => {
      throw new Error('sink-sentinel');
    });
    const res = {
      locals: { allianceContext: { requestId: 'request-1', timestamp: 1700000000000 } },
      headersSent: true,
      writableEnded: false,
      end,
    } as unknown as Response;
    await handleAllianceError(new Error('secret-sentinel'), request(), res);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('P0007-R6-NOFALLBACK-001 locks production sink at module initialization', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const writeAudit = vi.fn(async () => undefined);
    vi.doMock('../../src/services/audit.service', () => ({ writeAudit }));
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    try {
      const auditModule = await import('../../src/zhihu/allianceAudit');
      process.env.NODE_ENV = 'test';
      const attempted: AllianceRejectedAuditEvent[] = [];
      auditModule.installAllianceAuditSink(async (event) => {
        attempted.push(event);
      });
      await auditModule.writeAllianceRejectedAudit(
        auditModule.allianceAuditEvent(request(), response(), undefined, 'internal', 500, 50000),
      );
      expect(attempted).toHaveLength(0);
      expect(writeAudit).toHaveBeenCalledTimes(1);
      expect(writeAudit).toHaveBeenCalledWith({
        userId: null,
        action: 'alliance.request.rejected',
        resourceType: 'alliance_endpoint',
        resourceId: null,
        ip: null,
        detail: {
          requestId: 'request-1',
          timestamp: 1700000000000,
          operationKey: null,
          method: 'GET',
          stage: 'internal',
          outcome: 'rejected',
          httpStatus: 500,
          code: 50000,
          role: null,
        },
      });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      vi.doUnmock('../../src/services/audit.service');
      vi.resetModules();
    }
  });

  it.each([
    [42910, 'quota'],
    [50320, 'quota'],
  ] as const)('P0007-R6-AUDIT-001 maps quota code %s to %s', async (code, stage) => {
    const normalized = normalizeAllianceErrorForTest(
      new AppError(code === 42910 ? 429 : 503, code, code === 42910 ? 'quota' : 'unavailable'),
    );
    expect(normalized).toMatchObject({ code, stage });
  });
});
