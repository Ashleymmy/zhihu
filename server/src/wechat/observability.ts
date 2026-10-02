import type { Request, Response } from 'express';
import { db } from '../db';

export interface BridgeObservation {
  environment?: string;
  version?: string;
  clientVersion?: string;
  clientEnv?: string;
}
type Event = [
  string,
  string,
  number,
  number,
  number,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
];
const pending: Event[] = [];
let timer: NodeJS.Timeout | undefined,
  flushing: Promise<void> | undefined,
  cleanupAt = 0;
const writer = {
  startedAt: new Date().toISOString(),
  dropped: 0,
  failures: 0,
  lastWriteAt: null as string | null,
  lastFailureAt: null as string | null,
};
export function observationWriterState() {
  return { ...writer, pending: pending.length };
}

// Do not store arbitrary URLs, request/response bodies, tokens or OpenIDs.
export function miniRoute(path: string) {
  const auth = path.match(
    /^\/core\/auth\/(login|bind|register|wechat-login|me|profile|logout|refresh|registration-policy|registration-code|sms-policy|login-code|sms-login|phone-code|verify-phone)$/,
  );
  if (auth) return '/core/auth/' + auth[1];
  const business = path.match(
    /^\/modules\/zhihu\/(courses|keywords|mini-works|mini-import-works|home-summary|workbench|evidence|invite)(\/|$)/,
  );
  if (business) return '/modules/zhihu/' + business[1];
  const core = path.match(/^\/core\/(team|projects|files|finance)(\/|$)/);
  return core ? '/core/' + core[1] : '/other';
}

export async function flushMiniObservations(): Promise<void> {
  if (flushing) {
    await flushing;
    if (pending.length) await flushMiniObservations();
    return;
  }
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  const batch = pending.splice(0, 100);
  if (!batch.length) return;
  flushing = (async () => {
    let inserted = false;
    try {
      await db.query(
        `INSERT INTO mini_request_events(occurred_at,route_key,method,http_status,result_code,duration_ms,user_id,cloud_env,bridge_version,client_version,client_env) VALUES ${batch.map(() => '(NOW(3),?,?,?,?,?,?,?,?,?,?)').join(',')}`,
        batch.flat(),
      );
      inserted = true;
      writer.lastWriteAt = new Date().toISOString();
      if (Date.now() - cleanupAt > 300000) {
        cleanupAt = Date.now();
        await db.query(
          'DELETE FROM mini_request_events WHERE occurred_at < DATE_SUB(NOW(3),INTERVAL 7 DAY) LIMIT 1000',
        );
      }
    } catch {
      writer.failures++;
      if (!inserted) writer.dropped += batch.length;
      writer.lastFailureAt = new Date().toISOString();
    }
  })();
  await flushing;
  flushing = undefined;
  if (pending.length) await flushMiniObservations();
}
function schedule() {
  if (!timer) {
    timer = setTimeout(() => {
      timer = undefined;
      void flushMiniObservations();
    }, 500);
    timer.unref();
  }
}

/** Call only after signature, app and replay checks passed. Failures never block business writes. */
export function observeMiniRequest(req: Request, res: Response, path: string, metadata?: BridgeObservation) {
  if (path === '/core/mini-monitor') return;
  const started = performance.now(),
    method = req.method,
    route = miniRoute(path);
  let code = 0;
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    const value = (body as { code?: unknown })?.code;
    if (typeof value === 'number' && Number.isSafeInteger(value)) code = value;
    return json(body);
  };
  res.once('finish', () => {
    if (pending.length >= 1000) {
      writer.dropped++;
      return;
    }
    pending.push([
      route,
      method,
      res.statusCode,
      code,
      Math.min(2147483647, Math.round(performance.now() - started)),
      req.user?.sub ?? res.locals.miniVerifiedUserId ?? null,
      metadata?.environment ?? null,
      metadata?.version ?? null,
      metadata?.clientVersion ?? null,
      metadata?.clientEnv ?? null,
    ]);
    schedule();
  });
}
