import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../scripts/migrationRunner';
import {
  createMySqlTestLease,
  FROZEN_MYSQL_IMAGE,
  getHarnessDockerApiCallCount,
  LeaseIssuanceError,
  readManagedEnvironment,
  resetHarnessDockerApiCallCount,
  withMySqlTestLease,
} from '../support/mysqlTestLease';

const suite = process.env.RUN_TESTCONTAINERS === '1' ? describe : describe.skip;
const migrationsDirectory = path.resolve(process.cwd(), 'migrations');
const expectedMigrations = ['001_init.sql', '002_callbacks.sql', '003_composition_v2.sql', '004_identity_rbac.sql'];

interface DatabaseIdentityRow extends RowDataPacket {
  databaseName: string;
}

interface TableCountRow extends RowDataPacket {
  tableCount: number | string;
}

function logLease(
  label: string,
  metadata: {
    leaseId: string;
    containerId: string;
    volumeName: string;
    image: string;
    host: string;
    port: number;
    database: string;
    currentUser: string;
    mysqlVersion: string;
  },
): void {
  console.info(
    `${label} leaseId=${metadata.leaseId} containerId=${metadata.containerId} volume=${metadata.volumeName} image=${metadata.image} host=${metadata.host} port=${metadata.port} database=${metadata.database} identityMatch=true mysql=${metadata.mysqlVersion}`,
  );
}

suite('Testcontainers MySQL lease harness', () => {
  it('TC-SAFE-001 rejects direct harness use without opt-in before Docker access', async () => {
    const hadOptIn = Object.hasOwn(process.env, 'RUN_TESTCONTAINERS');
    const previousOptIn = process.env.RUN_TESTCONTAINERS;

    try {
      delete process.env.RUN_TESTCONTAINERS;
      resetHarnessDockerApiCallCount();
      await expect(createMySqlTestLease()).rejects.toThrow('RUN_TESTCONTAINERS=1');
      expect(getHarnessDockerApiCallCount()).toBe(0);
    } finally {
      if (hadOptIn) process.env.RUN_TESTCONTAINERS = previousOptIn;
      else delete process.env.RUN_TESTCONTAINERS;
    }
  });

  it('TC-SAFE-002 proves random Lease ownership through inspect and SQL identity', async () => {
    const lease = await createMySqlTestLease();
    try {
      logLease('TC-SAFE-002', lease.metadata);
      expect(lease.metadata.image).toBe(FROZEN_MYSQL_IMAGE);
      expect(lease.metadata.port).toBeGreaterThan(0);
      expect(lease.metadata.database).toMatch(/_test$/);
      expect(lease.metadata.currentUser.split('@', 1)[0]).toMatch(/^lease_user_[a-f0-9]+$/);
      const rows = await lease.queryRows<DatabaseIdentityRow>('SELECT DATABASE() AS databaseName');
      expect(rows[0]?.databaseName).toBe(lease.metadata.database);
    } finally {
      const cleanup = await lease.dispose();
      expect(cleanup.containerInspectStatus).toBe(404);
      expect(cleanup.volumeInspectStatus).toBe(404);
    }
  });

  it('TC-SAFE-003 cleans only the failed Lease label and leaves another Lease intact', async () => {
    const retainedLease = await createMySqlTestLease();
    try {
      let failure: unknown;
      try {
        await createMySqlTestLease({ failAfterInspection: true });
      } catch (error) {
        failure = error;
      }

      if (!(failure instanceof LeaseIssuanceError)) throw failure;
      console.info(
        `TC-SAFE-003 cleanup containerId=${failure.cleanupEvidence.containerId} volume=${failure.cleanupEvidence.volumeName} container404=${failure.cleanupEvidence.containerInspectStatus} volume404=${failure.cleanupEvidence.volumeInspectStatus}`,
      );
      expect(failure.cleanupEvidence.containerInspectStatus).toBe(404);
      expect(failure.cleanupEvidence.volumeInspectStatus).toBe(404);
      const rows = await retainedLease.queryRows<DatabaseIdentityRow>('SELECT DATABASE() AS databaseName');
      expect(rows[0]?.databaseName).toBe(retainedLease.metadata.database);
    } finally {
      const cleanup = await retainedLease.dispose();
      expect(cleanup.containerInspectStatus).toBe(404);
      expect(cleanup.volumeInspectStatus).toBe(404);
    }
  });

  it('TC-IMPORT-001 imports application config and Pool only after Lease env injection', async () => {
    vi.resetModules();
    const lease = await createMySqlTestLease();
    let pool: typeof import('../../src/db').db | undefined;

    try {
      const cacheEntriesBeforeInjection = Object.keys(require.cache).filter(
        (entry) =>
          entry.endsWith(`${path.sep}src${path.sep}config.ts`) || entry.endsWith(`${path.sep}src${path.sep}db.ts`),
      );
      expect(cacheEntriesBeforeInjection).toEqual([]);

      lease.injectEnvironment();
      const [{ config }, databaseModule] = await Promise.all([import('../../src/config'), import('../../src/db')]);
      pool = databaseModule.db;
      expect(config.db.database).toBe(lease.metadata.database);
      expect(config.db.port).toBe(lease.metadata.port);
      const [rows] = await pool.query<DatabaseIdentityRow[]>('SELECT DATABASE() AS databaseName');
      expect(rows[0]?.databaseName).toBe(lease.metadata.database);
    } finally {
      if (pool) await pool.end();
      const cleanup = await lease.dispose();
      expect(cleanup.containerInspectStatus).toBe(404);
      expect(cleanup.volumeInspectStatus).toBe(404);
      vi.resetModules();
    }
  });

  it('TC-MIG-001 applies each production migration once and skips all on the second run', async () => {
    const lease = await createMySqlTestLease();
    try {
      lease.injectEnvironment();
      const first = await runMigrations(lease.migrationTarget, migrationsDirectory);
      const second = await runMigrations(lease.migrationTarget, migrationsDirectory);
      expect(first).toEqual({ applied: expectedMigrations, skipped: [] });
      expect(second).toEqual({ applied: [], skipped: expectedMigrations });
    } finally {
      const cleanup = await lease.dispose();
      expect(cleanup.containerInspectStatus).toBe(404);
      expect(cleanup.volumeInspectStatus).toBe(404);
    }
  });

  it('TC-MIG-002 destroys the failed Lease instead of reusing a partial schema', async () => {
    const temporaryMigrations = await fs.mkdtemp(path.join(os.tmpdir(), 'zhihu-lease-migrations-'));
    const failedLease = await createMySqlTestLease();

    try {
      await fs.writeFile(
        path.join(temporaryMigrations, '001_partial.sql'),
        'CREATE TABLE partial_schema (id INT PRIMARY KEY);\nINVALID DDL;\n',
        'utf8',
      );
      failedLease.injectEnvironment();
      await expect(runMigrations(failedLease.migrationTarget, temporaryMigrations)).rejects.toThrow();
    } finally {
      const cleanup = await failedLease.dispose();
      expect(cleanup.containerInspectStatus).toBe(404);
      expect(cleanup.volumeInspectStatus).toBe(404);
      await fs.rm(temporaryMigrations, { recursive: true, force: true });
    }

    const successorLease = await createMySqlTestLease();
    try {
      const rows = await successorLease.queryRows<TableCountRow>(
        'SELECT COUNT(*) AS tableCount FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
        ['partial_schema'],
      );
      expect(Number(rows[0]?.tableCount)).toBe(0);
    } finally {
      const cleanup = await successorLease.dispose();
      expect(cleanup.containerInspectStatus).toBe(404);
      expect(cleanup.volumeInspectStatus).toBe(404);
    }
  });

  it('TC-LIFE-001 restores env after successful and failing test callbacks', async () => {
    const originalEnvironment = readManagedEnvironment();

    await withMySqlTestLease(async (lease) => {
      expect(process.env.DB_NAME).toBe(lease.metadata.database);
      logLease('TC-LIFE-001-success', lease.metadata);
    });
    expect(readManagedEnvironment()).toEqual(originalEnvironment);

    await expect(
      withMySqlTestLease(async () => {
        throw new Error('Injected callback failure.');
      }),
    ).rejects.toThrow('Injected callback failure.');
    expect(readManagedEnvironment()).toEqual(originalEnvironment);

    const concurrentLease = await createMySqlTestLease();
    try {
      concurrentLease.injectEnvironment();
      const cleanupEvidence = await Promise.all([concurrentLease.dispose(), concurrentLease.dispose()]);
      expect(cleanupEvidence[0]).toEqual(cleanupEvidence[1]);
      expect(cleanupEvidence[0]?.containerInspectStatus).toBe(404);
      expect(cleanupEvidence[0]?.volumeInspectStatus).toBe(404);
    } finally {
      await concurrentLease.dispose();
    }
    expect(readManagedEnvironment()).toEqual(originalEnvironment);
  });
});
