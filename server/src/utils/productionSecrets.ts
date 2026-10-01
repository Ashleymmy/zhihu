/** Reject documented placeholders and obviously repetitive signing keys. */
export function unsafeProductionJwtSecret(value: string): boolean {
  return (
    value.length < 32 ||
    new Set(value).size < 12 ||
    /(?:^|[_\s-])(change(?:me)?|replace|example|sample|test|testing|mock|please|your)(?:[_\s-]|$)/i.test(value)
  );
}
