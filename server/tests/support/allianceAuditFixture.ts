import {
  installAllianceAuditSink,
  resetAllianceAuditSink,
  type AllianceRejectedAuditEvent,
} from '../../src/zhihu/allianceAudit';

export function installAllianceAuditTestSink() {
  const events: AllianceRejectedAuditEvent[] = [];
  let calls = 0;
  let failure: Error | undefined;
  installAllianceAuditSink(async (event) => {
    calls += 1;
    if (failure) throw failure;
    events.push(event);
  });
  return {
    events,
    get calls() {
      return calls;
    },
    failWith(error: Error) {
      failure = error;
    },
    reset() {
      resetAllianceAuditSink();
    },
  };
}

export function createAllianceAuditSpy() {
  return installAllianceAuditTestSink();
}
