import { runOpcMigrations } from './opcMigrations';
export async function main() {
  const { config } = await import('../src/config');
  await runOpcMigrations(config.db, config.enabledModules);
  console.log('OPC schema ready');
}
if (require.main === module)
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Migration failed');
    process.exitCode = 1;
  });
