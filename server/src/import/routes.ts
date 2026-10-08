import { Hono } from 'hono';
import type { Database } from '../db/database.js';
import { APIError } from '../errors.js';
import { readBody } from '../validation.js';
import { applyImport, previewImport } from './service.js';
import type { ImportEntry, MarkdownFile } from './types.js';

export function importRoutes(db: Database) {
  const router = new Hono();
  router.post('/preview', async (c) => {
    const body = await readBody(c, { files: 'objectArray' });
    if (!Array.isArray(body.files))
      throw new APIError(422, 'import_files', 'Choose Markdown files first');
    return c.json(await previewImport(db, body.files as MarkdownFile[]));
  });
  router.post('/apply', async (c) => {
    const body = await readBody(c, { entries: 'objectArray' });
    if (!Array.isArray(body.entries))
      throw new APIError(422, 'import_entries', 'Select entries first');
    return c.json(await applyImport(db, body.entries as ImportEntry[]));
  });
  return router;
}
