import { writeAudit, type AuditInput } from '../services/audit.service';
import type { Request, Response } from 'express';
import type { AllianceEndpoint } from './allianceEndpointRegistry';

export type AllianceAuditStage =
  'allowlist' | 'auth' | 'permission' | 'quota' | 'parser' | 'schema' | 'upstream' | 'internal';
export type AllianceUpstreamFailure = 'business' | 'protocol' | 'transport';

export interface AllianceRejectedAuditEvent {
  readonly requestId: string;
  readonly timestamp: number;
  readonly operationKey: string | null;
  readonly method: 'GET' | 'POST' | 'PUT' | 'HEAD' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'OTHER';
  readonly stage: AllianceAuditStage;
  readonly outcome: 'rejected';
  readonly httpStatus: number;
  readonly code: number;
  readonly userId: string | null;
  readonly role: string | null;
  readonly upstreamFailure?: AllianceUpstreamFailure;
}

export type AllianceAuditSink = (event: AllianceRejectedAuditEvent) => Promise<void>;
export interface AllianceAuditContext {
  readonly requestId: string;
  readonly timestamp: number;
}

const productionSink: AllianceAuditSink = async (event) => {
  const input: AuditInput = {
    userId: event.userId,
    action: 'alliance.request.rejected',
    resourceType: 'alliance_endpoint',
    resourceId: event.operationKey,
    ip: null,
    detail: {
      requestId: event.requestId,
      timestamp: event.timestamp,
      operationKey: event.operationKey,
      method: event.method,
      stage: event.stage,
      outcome: event.outcome,
      httpStatus: event.httpStatus,
      code: event.code,
      role: event.role,
      ...(event.upstreamFailure === undefined ? {} : { upstreamFailure: event.upstreamFailure }),
    },
  };
  await writeAudit(input);
};

let sink: AllianceAuditSink = productionSink;

const isTestEnvironment = process.env.NODE_ENV === 'test';
const testSink: AllianceAuditSink = async () => undefined;
if (isTestEnvironment) sink = testSink;

export function installAllianceAuditSink(next: AllianceAuditSink): void {
  if (!isTestEnvironment) return;
  sink = next;
}

export function resetAllianceAuditSink(): void {
  sink = isTestEnvironment ? testSink : productionSink;
}

export function allianceAuditEvent(
  req: Request,
  res: Response,
  endpoint: AllianceEndpoint | undefined,
  stage: AllianceAuditStage,
  httpStatus: number,
  code: number,
  upstreamFailure?: AllianceUpstreamFailure,
): AllianceRejectedAuditEvent {
  const context = res.locals.allianceContext as AllianceAuditContext | undefined;
  if (
    !context ||
    typeof context.requestId !== 'string' ||
    !context.requestId ||
    !Number.isSafeInteger(context.timestamp)
  ) {
    throw new Error('alliance audit context missing');
  }
  const user = req.user as { sub?: string; role?: string } | undefined;
  return {
    requestId: context.requestId,
    timestamp: context.timestamp,
    operationKey: endpoint?.operationKey ?? null,
    method: ['GET', 'POST', 'PUT', 'HEAD', 'DELETE', 'PATCH', 'OPTIONS'].includes(req.method)
      ? (req.method as AllianceRejectedAuditEvent['method'])
      : 'OTHER',
    stage,
    outcome: 'rejected',
    httpStatus,
    code,
    userId: user?.sub ?? null,
    role: user?.role ?? null,
    ...(upstreamFailure === undefined ? {} : { upstreamFailure }),
  };
}

export async function writeAllianceRejectedAudit(event: AllianceRejectedAuditEvent): Promise<void> {
  await sink(event);
}
