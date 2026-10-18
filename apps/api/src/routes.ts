import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { parseFilter } from './catalog/query.js';
import {
  deleteResource,
  getResource,
  listResources,
  saveResource,
  setFavorite,
} from './catalog/resources.js';
import {
  deleteCategory,
  deleteTag,
  listCategories,
  listTags,
  saveCategory,
  saveTag,
} from './catalog/taxonomy.js';
import type { Database } from './db/database.js';
import { resourceKinds, schemaMigrations } from './db/schema.js';
import { APIError, invalid } from './errors.js';
import { pathID, readBody, readResource, validateName } from './validation.js';

export function apiRoutes(db: Database) {
  const api = new Hono();

  api.get('/health', async (c) => {
    try {
      const applied = await db
        .select()
        .from(schemaMigrations)
        .where(
          eq(schemaMigrations.version, '004_resource_kind_descriptions.sql'),
        );
      if (applied.length) return c.json({ status: 'ready' });
    } catch {
      /* Missing migrations/unreachable database is expected readiness failure. */
    }
    throw new APIError(
      503,
      'not_ready',
      'Database unavailable or migrations pending',
    );
  });

  api.get('/resources', async (c) =>
    c.json(
      await listResources(db, parseFilter(new URL(c.req.url).searchParams)),
    ),
  );

  api.get('/resources/:id', async (c) =>
    c.json(await getResource(db, pathID(c.req.param('id')))),
  );

  api.post('/resources', async (c) => {
    const { input, normalized } = await readResource(c);

    return c.json(await saveResource(db, input, normalized), 201);
  });

  api.put('/resources/:id', async (c) => {
    const id = pathID(c.req.param('id'));
    const { input, normalized } = await readResource(c);

    return c.json(await saveResource(db, input, normalized, id));
  });

  api.patch('/resources/:id/favorite', async (c) => {
    const id = pathID(c.req.param('id'));
    const body = await readBody(c, { favorite: 'boolean' });
    if (typeof body.favorite !== 'boolean')
      invalid({ favorite: 'A boolean favorite is required' });

    return c.json(await setFavorite(db, id, body.favorite));
  });

  api.delete('/resources/:id', async (c) => {
    await deleteResource(db, pathID(c.req.param('id')));

    return c.body(null, 204);
  });

  api.get('/categories', async (c) => c.json(await listCategories(db)));

  api.post('/categories', async (c) => {
    const body = await readBody(c, {
      name: 'string',
      parent_id: 'nullableString',
    });

    return c.json(
      await saveCategory(
        db,
        validateName(body.name),
        body.parent_id === null || body.parent_id === undefined
          ? null
          : pathID(body.parent_id as string),
      ),
      201,
    );
  });

  api.put('/categories/:id', async (c) => {
    const id = pathID(c.req.param('id'));
    const body = await readBody(c, {
      name: 'string',
      parent_id: 'nullableString',
    });

    return c.json(
      await saveCategory(
        db,
        validateName(body.name),
        body.parent_id === null || body.parent_id === undefined
          ? null
          : pathID(body.parent_id as string),
        id,
      ),
    );
  });

  api.delete('/categories/:id', async (c) => {
    await deleteCategory(db, pathID(c.req.param('id')));

    return c.body(null, 204);
  });

  api.get('/kinds', async (c) =>
    c.json(
      await db
        .select()
        .from(resourceKinds)
        .orderBy(asc(resourceKinds.sort_order), asc(resourceKinds.name)),
    ),
  );
  for (const method of ['post', 'put'] as const) {
    api[method](method === 'post' ? '/kinds' : '/kinds/:id', async (c) => {
      const id = method === 'put' ? pathID(c.req.param('id')!) : undefined;
      const body = await readBody(c, {
        name: 'string',
        description: 'string',
        sort_order: 'integer',
        archived: 'boolean',
      });
      const name = validateName(body.name);
      const sort_order = body.sort_order ?? 0;
      if (
        typeof sort_order !== 'number' ||
        sort_order < 0 ||
        sort_order > 2147483647
      )
        invalid({ sort_order: 'Enter an order between 0 and 2147483647' });
      const description =
        typeof body.description === 'string'
          ? body.description.trim()
          : undefined;
      if (
        description !== undefined &&
        ([...description].length > 2000 ||
          description.includes('\0') ||
          Buffer.from(description).toString('utf8') !== description)
      )
        invalid({
          description: 'Enter valid text with at most 2000 characters',
        });
      const values = {
        name,
        sort_order,
        archived: body.archived === true,
        ...(description === undefined ? {} : { description }),
      };
      const [saved] =
        id === undefined
          ? await db
              .insert(resourceKinds)
              .values({
                ...values,
                key:
                  name
                    .toLowerCase()
                    .replace(/[^\p{L}\p{N}]+/gu, '-')
                    .replace(/^-|-$/g, '') || name.toLowerCase(),
              })
              .returning()
          : await db
              .update(resourceKinds)
              .set(values)
              .where(eq(resourceKinds.id, id))
              .returning();
      if (!saved)
        throw new APIError(404, 'not_found', 'This item no longer exists');
      return c.json(saved, method === 'post' ? 201 : 200);
    });
  }
  api.delete('/kinds/:id', async (c) => {
    const deleted = await db
      .delete(resourceKinds)
      .where(eq(resourceKinds.id, pathID(c.req.param('id'))))
      .returning();
    if (!deleted.length)
      throw new APIError(404, 'not_found', 'This item no longer exists');
    return c.body(null, 204);
  });
  api.get('/tags', async (c) => c.json(await listTags(db)));

  api.post('/tags', async (c) => {
    const body = await readBody(c, { name: 'string' });

    return c.json(await saveTag(db, validateName(body.name)), 201);
  });

  api.put('/tags/:id', async (c) => {
    const id = pathID(c.req.param('id'));
    const body = await readBody(c, { name: 'string' });

    return c.json(await saveTag(db, validateName(body.name), id));
  });

  api.delete('/tags/:id', async (c) => {
    await deleteTag(db, pathID(c.req.param('id')));

    return c.body(null, 204);
  });

  return api;
}
