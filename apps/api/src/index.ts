import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadEnvironment, readConfig } from './config.js';
import { createDatabase } from './db/database.js';
import { databaseCode } from './errors.js';
import { createLogger } from './logger.js';

try {
  loadEnvironment();
  const config = readConfig();
  const logger = createLogger(config.logLevel, config.pretty);
  const { db, pool } = createDatabase(config.databaseURL);

  pool.on('error', (error) =>
    logger.error(
      { error_code: databaseCode(error) },
      'idle database connection failed',
    ),
  );

  const app = createApp(db, logger, config.clientDirectory);
  const server = serve(
    {
      fetch: app.fetch,
      hostname: config.hostname,
      port: config.port,
      serverOptions: {
        requestTimeout: 30000,
        headersTimeout: 10000,
        keepAliveTimeout: 5000,
        maxHeaderSize: 16 * 1024,
      },
    },
    () =>
      logger.info(
        { address: `${config.hostname}:${config.port}` },
        'Linksmith listening',
      ),
  );

  server.on('error', async (error) => {
    logger.error(
      { error_code: (error as NodeJS.ErrnoException).code },
      'Could not start HTTP server',
    );
    await pool.end();
    process.exitCode = 1;
  });

  let stopping = false;

  function shutdown() {
    if (stopping) return;
    stopping = true;
    logger.info('Shutting down Linksmith');
    const deadline = setTimeout(() => process.exit(1), 5000);
    deadline.unref();
    server.close(async () => {
      await pool.end();
      clearTimeout(deadline);
      logger.flush();
    });
  }

  process.on('SIGINT', shutdown);

  process.on('SIGTERM', shutdown);
} catch (error) {
  // Configuration messages are controlled here and never include connection URLs.
  createLogger().error(
    {
      message: error instanceof Error ? error.message : 'Invalid configuration',
    },
    'Linksmith stopped',
  );
  process.exitCode = 1;
}
