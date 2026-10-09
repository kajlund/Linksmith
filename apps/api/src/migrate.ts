import type { Pool } from 'pg';
import { loadEnvironment, readConfig } from './config.js';
import { createDatabase } from './db/database.js';
import { applyMigrations } from './db/migrations.js';
import { databaseCode } from './errors.js';
import { createLogger } from './logger.js';

let logger = createLogger();
let pool: Pool | undefined;
let phase = 'configuration';
try {
  loadEnvironment();
  const config = readConfig();
  logger = createLogger(config.logLevel, config.pretty);
  const database = createDatabase(config.databaseURL);
  pool = database.pool;
  phase = 'migration';
  await applyMigrations(database.db);
  logger.info('Migrations applied');
} catch (error) {
  logger.error(
    {
      phase,
      error_code: databaseCode(error),
      ...(phase === 'configuration'
        ? {
            message:
              error instanceof Error ? error.message : 'Invalid configuration',
          }
        : {}),
    },
    'Migration failed. Check configuration, database access, and unapplied SQL migration files.',
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
  logger.flush();
}
