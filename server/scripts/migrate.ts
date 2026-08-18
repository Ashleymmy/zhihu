import path from 'node:path';
import { runMigrations } from './migrationRunner';

export async function main(): Promise<void> {
  const { config } = await import('../src/config');
  const result = await runMigrations(config.db, path.resolve(process.cwd(), 'migrations'));

  for (const name of result.applied) {
    console.log(`applied ${name}`);
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Migration failed');
    process.exitCode = 1;
  });
}
