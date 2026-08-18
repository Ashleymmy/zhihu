import {
  assertDestructiveDatabaseSafety,
  DESTRUCTIVE_TEST_TABLES,
  resetDestructiveTestDatabase,
  type DatabaseSafetyEnvironment,
  type DestructiveDatabaseConnection,
} from '../support/databaseSafety';

function safeEnvironment(overrides: Partial<DatabaseSafetyEnvironment> = {}): DatabaseSafetyEnvironment {
  return {
    NODE_ENV: 'test',
    RUN_DB_TESTS: '1',
    ALLOW_DESTRUCTIVE_TEST_DB: 'true',
    DB_NAME: 'zhihu_koc_test',
    DB_HOST: '127.0.0.1',
    ...overrides,
  };
}

function safetyErrorMessage(environment: DatabaseSafetyEnvironment): string {
  try {
    assertDestructiveDatabaseSafety(environment);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error('Expected database safety validation to fail.');
}

describe('测试数据库防误清硬门', () => {
  it('接受全部精确安全条件', () => {
    expect(() => assertDestructiveDatabaseSafety(safeEnvironment())).not.toThrow();
  });

  it.each([
    ['缺少 NODE_ENV', undefined],
    ['非 test NODE_ENV', 'production'],
  ])('拒绝%s', (_label, nodeEnvironment) => {
    expect(() => assertDestructiveDatabaseSafety(safeEnvironment({ NODE_ENV: nodeEnvironment }))).toThrow('NODE_ENV');
  });

  it.each([undefined, '0', 'true', '01'])('拒绝非精确 RUN_DB_TESTS=%s', (runDbTests) => {
    expect(() => assertDestructiveDatabaseSafety(safeEnvironment({ RUN_DB_TESTS: runDbTests }))).toThrow(
      'RUN_DB_TESTS',
    );
  });

  it.each([undefined, '1', 'TRUE', 'yes', 'on'])('拒绝近似 destructive 开关=%s', (destructiveFlag) => {
    expect(() =>
      assertDestructiveDatabaseSafety(
        safeEnvironment({
          ALLOW_DESTRUCTIVE_TEST_DB: destructiveFlag,
        }),
      ),
    ).toThrow('ALLOW_DESTRUCTIVE_TEST_DB');
  });

  it.each(['zhihu_koc', 'production', '', 'test_database'])('拒绝不安全 DB_NAME=%s', (databaseName) => {
    expect(() => assertDestructiveDatabaseSafety(safeEnvironment({ DB_NAME: databaseName }))).toThrow('unsafe DB_NAME');
  });

  it.each(['127.0.0.1', 'localhost', '::1'])('接受 loopback host=%s', (databaseHost) => {
    expect(() => assertDestructiveDatabaseSafety(safeEnvironment({ DB_HOST: databaseHost }))).not.toThrow();
  });

  it('只接受精确列出的测试 host', () => {
    expect(() =>
      assertDestructiveDatabaseSafety(
        safeEnvironment({
          DB_HOST: 'ci-mysql.test.internal',
          TEST_DB_HOST_ALLOWLIST: 'ci-mysql.test.internal',
        }),
      ),
    ).not.toThrow();

    expect(() =>
      assertDestructiveDatabaseSafety(
        safeEnvironment({
          DB_HOST: 'ci-mysql.test.internal',
          TEST_DB_HOST_ALLOWLIST: 'ci-mysql.test.internal.example',
        }),
      ),
    ).toThrow('unsafe DB_HOST');
  });

  it('在安全判断失败时不获取连接也不执行 SQL', async () => {
    const query = vi.fn(async (_sql: string) => undefined);
    const release = vi.fn();
    const connection: DestructiveDatabaseConnection = { query, release };
    const getConnection = vi.fn(async () => connection);

    await expect(
      resetDestructiveTestDatabase({ getConnection }, safeEnvironment({ DB_NAME: 'zhihu_koc' })),
    ).rejects.toThrow('unsafe DB_NAME');

    expect(getConnection).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('清理失败时仍恢复 FK 并释放专用连接', async () => {
    const query = vi
      .fn(async (_sql: string) => undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('truncate failed'))
      .mockResolvedValueOnce(undefined);
    const release = vi.fn();
    const connection: DestructiveDatabaseConnection = { query, release };
    const getConnection = vi.fn(async () => connection);

    await expect(resetDestructiveTestDatabase({ getConnection }, safeEnvironment())).rejects.toThrow('truncate failed');

    expect(query).toHaveBeenNthCalledWith(1, 'SET FOREIGN_KEY_CHECKS=0');
    expect(query).toHaveBeenNthCalledWith(2, `TRUNCATE TABLE ${DESTRUCTIVE_TEST_TABLES[0]}`);
    expect(query).toHaveBeenNthCalledWith(3, 'SET FOREIGN_KEY_CHECKS=1');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('关闭 FK 失败时仍尝试恢复并释放专用连接', async () => {
    const query = vi
      .fn(async (_sql: string) => undefined)
      .mockRejectedValueOnce(new Error('disable FK failed'))
      .mockResolvedValueOnce(undefined);
    const release = vi.fn();
    const connection: DestructiveDatabaseConnection = { query, release };
    const getConnection = vi.fn(async () => connection);

    await expect(resetDestructiveTestDatabase({ getConnection }, safeEnvironment())).rejects.toThrow(
      'disable FK failed',
    );

    expect(query).toHaveBeenNthCalledWith(1, 'SET FOREIGN_KEY_CHECKS=0');
    expect(query).toHaveBeenNthCalledWith(2, 'SET FOREIGN_KEY_CHECKS=1');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('错误文本不回显密码、JWT、Token 或连接串', () => {
    const secretEnvironment: NodeJS.ProcessEnv = {
      ...safeEnvironment({ DB_NAME: 'zhihu_koc' }),
      DB_PASS: 'db-password-must-not-appear',
      JWT_SECRET: 'jwt-secret-must-not-appear',
      ZHIHU_ACCESS_TOKEN: 'access-token-must-not-appear',
      DATABASE_URL: 'mysql://user:connection-password-must-not-appear@example.test/db',
    };
    const message = safetyErrorMessage(secretEnvironment);

    expect(message).toContain('unsafe DB_NAME');
    expect(message).not.toContain('db-password-must-not-appear');
    expect(message).not.toContain('jwt-secret-must-not-appear');
    expect(message).not.toContain('access-token-must-not-appear');
    expect(message).not.toContain('connection-password-must-not-appear');
  });
});
