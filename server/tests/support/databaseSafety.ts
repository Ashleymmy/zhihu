export const DESTRUCTIVE_TEST_TABLES = [
  'callback_logs',
  'callback_secrets',
  'callback_rules',
  'audit_logs',
  'withdrawal_requests',
  'earnings',
  'daily_metrics',
  'compositions',
  'plans',
  'tasks',
  'channels',
  'users',
] as const;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const ERROR_PREFIX = 'Destructive database test blocked:';

export interface DatabaseSafetyEnvironment {
  NODE_ENV?: string;
  RUN_DB_TESTS?: string;
  ALLOW_DESTRUCTIVE_TEST_DB?: string;
  DB_NAME?: string;
  DB_HOST?: string;
  TEST_DB_HOST_ALLOWLIST?: string;
}

export interface DestructiveDatabaseConnection {
  query(sql: string): Promise<unknown>;
  release(): void;
}

export interface DestructiveDatabasePool {
  getConnection(): Promise<DestructiveDatabaseConnection>;
}

function block(reason: string): never {
  throw new Error(`${ERROR_PREFIX} ${reason}`);
}

function testHostAllowlist(environment: DatabaseSafetyEnvironment): Set<string> {
  return new Set(
    (environment.TEST_DB_HOST_ALLOWLIST ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function assertDestructiveDatabaseSafety(environment: DatabaseSafetyEnvironment = process.env): void {
  if (environment.NODE_ENV !== 'test') {
    block('NODE_ENV must be exactly "test".');
  }

  if (environment.RUN_DB_TESTS !== '1') {
    block('RUN_DB_TESTS must be exactly "1".');
  }

  if (environment.ALLOW_DESTRUCTIVE_TEST_DB !== 'true') {
    block('ALLOW_DESTRUCTIVE_TEST_DB must be exactly "true".');
  }

  const databaseName = environment.DB_NAME?.trim();
  if (!databaseName || !databaseName.endsWith('_test')) {
    block('unsafe DB_NAME; it must be explicitly set and end with "_test".');
  }

  const databaseHost = environment.DB_HOST?.trim().toLowerCase();
  const allowedHosts = testHostAllowlist(environment);
  if (!databaseHost || (!LOOPBACK_HOSTS.has(databaseHost) && !allowedHosts.has(databaseHost))) {
    block('unsafe DB_HOST; it must be loopback or explicitly listed in TEST_DB_HOST_ALLOWLIST.');
  }
}

export async function resetDestructiveTestDatabase(
  pool: DestructiveDatabasePool,
  environment: DatabaseSafetyEnvironment = process.env,
): Promise<void> {
  assertDestructiveDatabaseSafety(environment);

  const connection = await pool.getConnection();

  try {
    await connection.query('SET FOREIGN_KEY_CHECKS=0');

    for (const table of DESTRUCTIVE_TEST_TABLES) {
      await connection.query(`TRUNCATE TABLE ${table}`);
    }
  } finally {
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS=1');
    } finally {
      connection.release();
    }
  }
}
