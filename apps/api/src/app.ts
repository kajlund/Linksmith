import { randomUUID } from 'node:crypto';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Logger } from 'pino';
import type { Database } from './db/database.js';
import { APIError, databaseCode, databaseError } from './errors.js';
import { importRoutes } from './import/routes.js';
import { apiRoutes } from './routes.js';
import { clientRoutes } from './static.js';

export function createApp(
  db: Database,
  logger: Logger,
  clientDirectory: string,
) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const request_id = randomUUID();
    const start = performance.now();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Request-ID', request_id);
    await next();
    logger.info(
      {
        request_id,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration_ms: Math.round(performance.now() - start),
      },
      'request',
    );
  });

  app.onError((error, c) => {
    const code = databaseCode(error);
    const known = error instanceof APIError ? error : databaseError(code);
    if (known)
      return c.json(
        {
          error: { code: known.code, message: known.message, ...known.details },
        },
        known.status,
      );
    logger.error(
      {
        error_type: error.name,
        error_code: code,
        method: c.req.method,
        path: c.req.path,
        request_id: c.res.headers.get('X-Request-ID'),
      },
      'request failed',
    );

    return c.json(
      {
        error: {
          code: 'internal',
          message: 'Could not complete the request. Please try again.',
        },
      },
      500,
    );
  });

  const limit = bodyLimit({
    maxSize: 128 * 1024,
    onError: (c) =>
      c.json(
        { error: { code: 'request_size', message: 'Request exceeds 128 KiB' } },
        413,
      ),
  });

  const importLimit = bodyLimit({
    maxSize: 2 * 1024 * 1024,
    onError: (c) =>
      c.json(
        {
          error: {
            code: 'import_limits',
            message: 'Import request exceeds 2 MiB',
          },
        },
        413,
      ),
  });
  app.use('/api/*', (c, next) =>
    c.req.path.startsWith('/api/import/')
      ? importLimit(c, next)
      : limit(c, next),
  );

  app.route('/api/import', importRoutes(db));

  app.route('/api', apiRoutes(db));

  // Never let unknown API endpoints (including /api itself) reach SPA fallback.
  const apiMissing = (c: Context) =>
    c.json({ error: { code: 'not_found', message: 'Unknown API route' } }, 404);

  app.all('/api', apiMissing);

  app.all('/api/*', apiMissing);

  clientRoutes(app, clientDirectory);

  return app;
}
