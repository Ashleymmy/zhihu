/** Unknown outcomes retain both the exact payload and request key. Only a definitive rejection releases them. */
export function isDefinitiveRejection(error: unknown): boolean {
  const status = Number((error as { status?: number })?.status)
  return status >= 400 && status < 500 && status !== 408
}
export function isStaleSettlement(error: unknown): boolean { return Number((error as { status?: number })?.status) === 409 }
export function canPreviewSettlement(summary: { ready: number }): boolean { return summary.ready > 0 }
export function apiMessage(error: unknown, fallback: string): string { return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : fallback }
export function createMutationAttempt<T extends object>(key: () => string) {
  let payload: (T & { requestKey: string }) | null = null
  return {
    get pending() { return payload },
    prepare(input: T) { return payload ??= Object.freeze({ ...input, requestKey: key() }) },
    complete() { payload = null },
    reject(error: unknown) { if (isDefinitiveRejection(error)) payload = null },
  }
}
