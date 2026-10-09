import { access } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

export function clientRoutes(app: Hono, directory: string) {
  // API routes/misses are registered before this layer; HTML fallback is only for
  // client navigation. Hono's Node adapter streams real files (including HEAD).

  app.use('*', async (c, next) => {
    if (!['GET', 'HEAD'].includes(c.req.method))
      return c.text('Method not allowed', 405);

    return next();
  });

  app.use('*', serveStatic({ root: directory }));
  const index = serveStatic({ path: join(directory, 'index.html') });

  app.use('*', async (c, next) => {
    let path: string;
    try {
      path = decodeURIComponent(c.req.path);
    } catch {
      return c.text('Invalid path', 400);
    }
    if (path.startsWith('/assets/') || extname(path) || path.includes('\\'))
      return c.text('Not found', 404);
    try {
      await access(join(directory, 'index.html'));
    } catch {
      return c.text(
        'Client build missing. Build the client and set CLIENT_DIR.',
        503,
      );
    }
    c.header('Cache-Control', 'no-cache');

    return index(c, next);
  });
}
