import crypto from 'node:crypto';
import mysql, { RowDataPacket } from 'mysql2/promise';
import { getContainerRuntimeClient, ImageName, type ContainerRuntimeClient } from 'testcontainers';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';

export const FROZEN_MYSQL_IMAGE =
  'mysql:8.0.46@sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b';
export const FROZEN_MYSQL_IMAGE_DIGEST = 'sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b';
export const LEASE_LABEL = 'com.zhihu-app.test.lease';

const MANAGED_ENVIRONMENT_KEYS = [
  'NODE_ENV',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASS',
  'QUEUE_DRIVER',
  'REDIS_URL',
  'RUN_DB_TESTS',
  'ALLOW_DESTRUCTIVE_TEST_DB',
  'TEST_DB_HOST_ALLOWLIST',
  'DATABASE_URL',
] as const;

type ManagedEnvironmentKey = (typeof MANAGED_ENVIRONMENT_KEYS)[number];
type EnvironmentSnapshot = Map<ManagedEnvironmentKey, string | undefined>;

interface SqlIdentity {
  databaseName: string;
  currentUser: string;
  mysqlVersion: string;
}

export interface LeaseMetadata {
  leaseId: string;
  label: string;
  image: string;
  containerId: string;
  volumeName: string;
  host: string;
  port: number;
  database: string;
  currentUser: string;
  mysqlVersion: string;
}

export interface LeaseCleanupEvidence {
  containerId: string;
  volumeName: string;
  containerInspectStatus: 404;
  volumeInspectStatus: 404;
}

export interface MySqlTestLeaseOptions {
  failAfterInspection?: boolean;
}

interface InspectedLease {
  containerId: string;
  volumeName: string;
}

interface CleanupCandidate {
  containerId: string;
  volumeName: string | undefined;
}

interface FailedLeaseCleanupEvidence {
  containerId: string;
  volumeName: string | undefined;
  containerInspectStatus: 404;
  volumeInspectStatus: 404 | undefined;
}

interface SqlIdentityRow extends RowDataPacket {
  databaseName: string | null;
  currentUser: string | null;
  mysqlVersion: string | null;
}

let dockerApiCallCount = 0;

function recordDockerApiCall<T>(operation: () => Promise<T>): Promise<T> {
  dockerApiCallCount += 1;
  return operation();
}

export function resetHarnessDockerApiCallCount(): void {
  dockerApiCallCount = 0;
}

export function getHarnessDockerApiCallCount(): number {
  return dockerApiCallCount;
}

function captureEnvironment(): EnvironmentSnapshot {
  return new Map(MANAGED_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(snapshot: EnvironmentSnapshot): void {
  for (const [key, value] of snapshot) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

export function readManagedEnvironment(): Record<ManagedEnvironmentKey, string | undefined> {
  return Object.fromEntries(MANAGED_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])) as Record<
    ManagedEnvironmentKey,
    string | undefined
  >;
}

function requireTestcontainersOptIn(): void {
  if (process.env.RUN_TESTCONTAINERS !== '1') {
    throw new Error('Testcontainers MySQL harness requires RUN_TESTCONTAINERS=1.');
  }

  if (process.env.TESTCONTAINERS_RYUK_DISABLED !== undefined) {
    throw new Error('Testcontainers MySQL harness rejects TESTCONTAINERS_RYUK_DISABLED.');
  }

  if (process.env.TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX !== undefined) {
    throw new Error('Testcontainers MySQL harness rejects image name prefix overrides.');
  }
}

function randomSegment(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

function createLeaseCredentials(): {
  leaseId: string;
  database: string;
  user: string;
  password: string;
  rootPassword: string;
} {
  const leaseId = crypto.randomUUID();
  const segment = randomSegment();
  return {
    leaseId,
    database: `lease_${segment.slice(0, 24)}_test`,
    user: `lease_user_${segment.slice(0, 16)}`,
    password: crypto.randomBytes(24).toString('hex'),
    rootPassword: crypto.randomBytes(24).toString('hex'),
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 404;
}

async function expectNotFound(description: string, operation: () => Promise<unknown>): Promise<404> {
  try {
    await operation();
  } catch (error) {
    if (isNotFound(error)) return 404;
    throw new Error(`${description} inspection failed without a 404 response.`);
  }

  throw new Error(`${description} still exists after cleanup.`);
}

function mysqlVolumeMounts(inspect: Awaited<ReturnType<ContainerRuntimeClient['container']['inspect']>>) {
  return (inspect.Mounts ?? []).filter((mount) => mount.Type === 'volume' && mount.Destination === '/var/lib/mysql');
}

function readVolumeName(inspect: Awaited<ReturnType<ContainerRuntimeClient['container']['inspect']>>): string {
  const mounts = mysqlVolumeMounts(inspect).filter((mount) => Boolean(mount.Name));

  if (mounts.length !== 1 || !mounts[0].Name) {
    throw new Error('Lease container must have exactly one anonymous MySQL data volume.');
  }

  return mounts[0].Name;
}

function readOptionalVolumeName(
  inspect: Awaited<ReturnType<ContainerRuntimeClient['container']['inspect']>>,
): string | undefined {
  const mounts = mysqlVolumeMounts(inspect);
  if (mounts.length > 1) {
    throw new Error('Lease cleanup found more than one MySQL data volume.');
  }

  return mounts[0]?.Name || undefined;
}

async function inspectFrozenImage(runtime: ContainerRuntimeClient) {
  const image = await recordDockerApiCall(() => runtime.image.inspect(ImageName.fromString(FROZEN_MYSQL_IMAGE)));
  if (!image.Id || !image.RepoDigests?.includes(`mysql@${FROZEN_MYSQL_IMAGE_DIGEST}`)) {
    throw new Error('Frozen MySQL image digest is not present in Docker image metadata.');
  }

  return image;
}

function assertLabeledFrozenContainer(
  inspect: Awaited<ReturnType<ContainerRuntimeClient['container']['inspect']>>,
  leaseId: string,
  imageId: string | undefined,
): void {
  if (inspect.Config.Image !== FROZEN_MYSQL_IMAGE) {
    throw new Error('Lease container image does not match the frozen image reference.');
  }

  if (inspect.Config.Labels?.[LEASE_LABEL] !== leaseId) {
    throw new Error('Lease container label does not match the current lease.');
  }

  if (imageId !== undefined && inspect.Image !== imageId) {
    throw new Error('Lease container image ID does not match the inspected frozen image.');
  }
}

async function inspectLease(
  runtime: ContainerRuntimeClient,
  containerId: string,
  leaseId: string,
  expectedPort?: number,
): Promise<InspectedLease> {
  const container = runtime.container.getById(containerId);
  const inspect = await recordDockerApiCall(() => runtime.container.inspect(container));
  const image = await inspectFrozenImage(runtime);
  assertLabeledFrozenContainer(inspect, leaseId, image.Id);

  const mappings = inspect.NetworkSettings?.Ports?.['3306/tcp'];
  const mappedPorts = new Set(
    (mappings ?? []).map((mapping) => Number(mapping?.HostPort)).filter(Number.isSafeInteger),
  );
  if (!Array.isArray(mappings) || mappedPorts.size !== 1) {
    throw new Error('Lease container must have one random host mapping for MySQL.');
  }

  const mappedPort = [...mappedPorts][0];
  if (mappedPort <= 0) {
    throw new Error('Lease container host port is not a valid random mapping.');
  }

  if (expectedPort !== undefined && mappedPort !== expectedPort) {
    throw new Error('Lease container inspect port does not match the Testcontainers mapped port.');
  }

  const bindings = inspect.HostConfig.PortBindings?.['3306/tcp'] ?? [];
  if (bindings.some((binding: { HostPort?: string }) => binding.HostPort === '3306')) {
    throw new Error('Lease container configured a fixed MySQL host port.');
  }

  return { containerId, volumeName: readVolumeName(inspect) };
}

async function waitForSqlIdentity(target: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): Promise<SqlIdentity> {
  const deadline = Date.now() + 45_000;
  let lastFailure: unknown;

  while (Date.now() < deadline) {
    let connection: mysql.Connection | undefined;
    try {
      connection = await mysql.createConnection({ ...target, connectTimeout: 3_000, multipleStatements: false });
      const [rows] = await connection.query<SqlIdentityRow[]>(
        'SELECT DATABASE() AS databaseName, CURRENT_USER() AS currentUser, VERSION() AS mysqlVersion',
      );
      const identity = rows[0];
      const currentUser = identity?.currentUser;
      const currentUserName = currentUser?.split('@', 1)[0];
      if (
        identity?.databaseName === target.database &&
        currentUser &&
        currentUserName === target.user &&
        identity.mysqlVersion
      ) {
        return {
          databaseName: identity.databaseName,
          currentUser,
          mysqlVersion: identity.mysqlVersion,
        };
      }
    } catch (error) {
      lastFailure = error;
    } finally {
      if (connection) await connection.end();
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (lastFailure !== undefined) {
    throw new Error('Lease SQL identity did not become ready before the deadline.');
  }

  throw new Error('Lease SQL identity readiness ended without a result.');
}

async function findLabeledLease(
  runtime: ContainerRuntimeClient,
  leaseId: string,
): Promise<CleanupCandidate | undefined> {
  const containers = await recordDockerApiCall(() =>
    runtime.container.dockerode.listContainers({
      all: true,
      filters: { label: [`${LEASE_LABEL}=${leaseId}`] },
    }),
  );

  if (containers.length > 1) {
    throw new Error('Lease cleanup found more than one container for the exact lease label.');
  }

  if (containers.length === 0) return undefined;
  const container = runtime.container.getById(containers[0].Id);
  const inspect = await recordDockerApiCall(() => runtime.container.inspect(container));
  const image = await inspectFrozenImage(runtime);
  assertLabeledFrozenContainer(inspect, leaseId, image.Id);
  return { containerId: containers[0].Id, volumeName: readOptionalVolumeName(inspect) };
}

async function removeFailedLease(
  runtime: ContainerRuntimeClient,
  leaseId: string,
  started: StartedMySqlContainer | undefined,
): Promise<FailedLeaseCleanupEvidence | undefined> {
  const inspectedLease = await findLabeledLease(runtime, leaseId);
  if (!inspectedLease) return undefined;

  if (started && started.getId() !== inspectedLease.containerId) {
    throw new Error('Lease cleanup label does not resolve to the started container.');
  }

  const containerToRemove = runtime.container.dockerode.getContainer(inspectedLease.containerId);
  await recordDockerApiCall(() => containerToRemove.remove({ force: true, v: true }));

  const container = runtime.container.getById(inspectedLease.containerId);
  const containerInspectStatus = await expectNotFound('Lease container', () =>
    recordDockerApiCall(() => runtime.container.inspect(container)),
  );
  const volumeInspectStatus = inspectedLease.volumeName
    ? await expectNotFound('Lease anonymous volume', () =>
        recordDockerApiCall(() => runtime.container.dockerode.getVolume(inspectedLease.volumeName as string).inspect()),
      )
    : undefined;

  return {
    containerId: inspectedLease.containerId,
    volumeName: inspectedLease.volumeName,
    containerInspectStatus,
    volumeInspectStatus,
  };
}

export class LeaseIssuanceError extends Error {
  constructor(
    cause: unknown,
    readonly cleanupEvidence: FailedLeaseCleanupEvidence,
  ) {
    super('Lease issuance failed and the exact container and volume were removed.', { cause });
    this.name = 'LeaseIssuanceError';
  }
}

export class MySqlTestLease {
  private environmentSnapshot: EnvironmentSnapshot | undefined;
  private cleanupPromise: Promise<LeaseCleanupEvidence> | undefined;

  constructor(
    private readonly runtime: ContainerRuntimeClient,
    private readonly started: StartedMySqlContainer,
    private readonly credentials: {
      database: string;
      user: string;
      password: string;
    },
    readonly metadata: LeaseMetadata,
  ) {}

  injectEnvironment(): void {
    if (this.environmentSnapshot) return;

    this.environmentSnapshot = captureEnvironment();
    process.env.NODE_ENV = 'test';
    process.env.DB_HOST = this.metadata.host;
    process.env.DB_PORT = String(this.metadata.port);
    process.env.DB_NAME = this.metadata.database;
    process.env.DB_USER = this.credentials.user;
    process.env.DB_PASS = this.credentials.password;
    process.env.QUEUE_DRIVER = 'memory';
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    delete process.env.RUN_DB_TESTS;
    delete process.env.ALLOW_DESTRUCTIVE_TEST_DB;
    delete process.env.TEST_DB_HOST_ALLOWLIST;
    delete process.env.DATABASE_URL;
  }

  restoreEnvironment(): void {
    if (!this.environmentSnapshot) return;
    restoreEnvironment(this.environmentSnapshot);
    this.environmentSnapshot = undefined;
  }

  async queryRows<T extends RowDataPacket>(sql: string, values: unknown[] = []): Promise<T[]> {
    let connection: mysql.Connection | undefined;
    try {
      connection = await mysql.createConnection({
        host: this.metadata.host,
        port: this.metadata.port,
        database: this.metadata.database,
        user: this.credentials.user,
        password: this.credentials.password,
        multipleStatements: false,
      });
      const [rows] = await connection.query<T[]>(sql, values);
      return rows;
    } finally {
      if (connection) await connection.end();
    }
  }

  get migrationTarget(): { host: string; port: number; database: string; user: string; password: string } {
    return {
      host: this.metadata.host,
      port: this.metadata.port,
      database: this.metadata.database,
      user: this.credentials.user,
      password: this.credentials.password,
    };
  }

  async dispose(): Promise<LeaseCleanupEvidence> {
    this.cleanupPromise ??= this.disposeOnce();
    return this.cleanupPromise;
  }

  private async disposeOnce(): Promise<LeaseCleanupEvidence> {
    this.restoreEnvironment();

    try {
      await recordDockerApiCall(() => this.started.stop({ remove: true, removeVolumes: true }));
    } catch (stopError) {
      try {
        const fallbackEvidence = await removeFailedLease(this.runtime, this.metadata.leaseId, this.started);
        if (!fallbackEvidence) {
          throw new Error('Lease cleanup did not prove exact container and anonymous volume removal.');
        }
        const { containerId, volumeName, containerInspectStatus, volumeInspectStatus } = fallbackEvidence;
        if (volumeName !== this.metadata.volumeName || volumeInspectStatus !== 404) {
          throw new Error('Lease cleanup did not prove exact container and anonymous volume removal.');
        }
        return { containerId, volumeName, containerInspectStatus, volumeInspectStatus };
      } catch (cleanupError) {
        throw new AggregateError([stopError, cleanupError], 'Lease stop and exact cleanup both failed.');
      }
    }

    const container = this.runtime.container.getById(this.metadata.containerId);
    const containerInspectStatus = await expectNotFound('Lease container', () =>
      recordDockerApiCall(() => this.runtime.container.inspect(container)),
    );
    const volumeInspectStatus = await expectNotFound('Lease anonymous volume', () =>
      recordDockerApiCall(() => this.runtime.container.dockerode.getVolume(this.metadata.volumeName).inspect()),
    );

    return {
      containerId: this.metadata.containerId,
      volumeName: this.metadata.volumeName,
      containerInspectStatus,
      volumeInspectStatus,
    };
  }
}

export async function createMySqlTestLease(options: MySqlTestLeaseOptions = {}): Promise<MySqlTestLease> {
  requireTestcontainersOptIn();

  const credentials = createLeaseCredentials();
  let started: StartedMySqlContainer | undefined;
  let runtime: ContainerRuntimeClient | undefined;

  try {
    started = await recordDockerApiCall(() =>
      new MySqlContainer(FROZEN_MYSQL_IMAGE)
        .withDatabase(credentials.database)
        .withUsername(credentials.user)
        .withUserPassword(credentials.password)
        .withRootPassword(credentials.rootPassword)
        .withLabels({ [LEASE_LABEL]: credentials.leaseId })
        .start(),
    );
    runtime = await recordDockerApiCall(() => getContainerRuntimeClient());

    const containerId = started.getId();
    const port = started.getPort();
    const inspectedLease = await inspectLease(runtime, containerId, credentials.leaseId, port);
    const host = started.getHost();
    const sqlIdentity = await waitForSqlIdentity({
      host,
      port,
      database: credentials.database,
      user: credentials.user,
      password: credentials.password,
    });

    if (options.failAfterInspection) {
      throw new Error('Injected lease issuance failure.');
    }

    return new MySqlTestLease(runtime, started, credentials, {
      leaseId: credentials.leaseId,
      label: `${LEASE_LABEL}=${credentials.leaseId}`,
      image: FROZEN_MYSQL_IMAGE,
      containerId,
      volumeName: inspectedLease.volumeName,
      host,
      port,
      database: credentials.database,
      currentUser: sqlIdentity.currentUser,
      mysqlVersion: sqlIdentity.mysqlVersion,
    });
  } catch (primaryError) {
    let cleanupRuntime = runtime;
    try {
      cleanupRuntime ??= await recordDockerApiCall(() => getContainerRuntimeClient());
      const cleanupEvidence = await removeFailedLease(cleanupRuntime, credentials.leaseId, started);
      if (!cleanupEvidence) throw new Error('Lease issuance failed before a labeled container was created.');
      throw new LeaseIssuanceError(primaryError, cleanupEvidence);
    } catch (cleanupError) {
      if (cleanupError instanceof LeaseIssuanceError) throw cleanupError;
      throw new AggregateError([primaryError, cleanupError], 'Lease issuance and cleanup both failed.');
    }
  }
}

export async function withMySqlTestLease<T>(work: (lease: MySqlTestLease) => Promise<T>): Promise<T> {
  const lease = await createMySqlTestLease();
  let result: T | undefined;
  let primaryError: unknown;
  let hasPrimaryError = false;

  try {
    lease.injectEnvironment();
    result = await work(lease);
  } catch (error) {
    hasPrimaryError = true;
    primaryError = error;
  }

  try {
    await lease.dispose();
  } catch (cleanupError) {
    if (hasPrimaryError) {
      throw new AggregateError([primaryError, cleanupError], 'Lease callback and cleanup both failed.');
    }
    throw cleanupError;
  }

  if (hasPrimaryError) throw primaryError;
  return result!;
}
