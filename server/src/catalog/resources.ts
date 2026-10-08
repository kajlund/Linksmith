import { and, count, eq, getTableColumns, inArray, ne, sql } from 'drizzle-orm';
import type { Database, Executor, Transaction } from '../db/database.js';
import {
  type Category,
  categories,
  resources,
  resourceTags,
  type Tag,
  tags,
} from '../db/schema.js';
import { APIError, invalid, notFound } from '../errors.js';
import type { normalizeURL, ResourceInput } from '../validation.js';
import {
  category,
  filterWhere,
  type ListFilter,
  parent,
  resourceOrder,
} from './query.js';

const { normalized_url: _privateKey, ...publicColumns } =
  getTableColumns(resources);
const selection = {
  ...publicColumns,
  category: sql<Category | null>`case when ${category.id} is null then null else jsonb_build_object('id', ${category.id}, 'name', ${category.name}, 'parent_id', ${category.parent_id}) end`,
  tags: sql<
    Tag[]
  >`coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by lower(t.name), t.id) from resource_tags rt join tags t on t.id = rt.tag_id where rt.resource_id = ${resources.id}), '[]'::jsonb)`,
  tag_ids: sql<
    string[]
  >`coalesce((select jsonb_agg(rt.tag_id order by rt.tag_id) from resource_tags rt where rt.resource_id = ${resources.id}), '[]'::jsonb)`,
  acknowledge_duplicate: sql<boolean>`false`,
};

// One page query includes tags and category data, with no per-resource round trips.

function resourceQuery(db: Executor) {
  return db
    .select(selection)
    .from(resources)
    .leftJoin(category, eq(category.id, resources.category_id))
    .leftJoin(parent, eq(parent.id, category.parent_id));
}

export async function getResource(db: Executor, id: string) {
  const [resource] = await resourceQuery(db).where(eq(resources.id, id));
  if (!resource) notFound();

  return resource;
}

export async function listResources(db: Database, filter: ListFilter) {
  return db.transaction(
    async (tx) => {
      if (filter.category_id !== undefined) {
        const matches = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.id, filter.category_id));
        if (!matches.length)
          throw new APIError(
            400,
            'filter',
            'Selected category no longer exists; remove this filter',
          );
      }
      if (filter.tag_ids.length) {
        const matches = await tx
          .select({ id: tags.id })
          .from(tags)
          .where(inArray(tags.id, filter.tag_ids));
        if (matches.length !== filter.tag_ids.length)
          throw new APIError(
            400,
            'filter',
            'A selected tag no longer exists; remove this filter',
          );
      }
      const where = filterWhere(tx, filter);
      const [matches] = await tx
        .select({ total: count() })
        .from(resources)
        .leftJoin(category, eq(category.id, resources.category_id))
        .leftJoin(parent, eq(parent.id, category.parent_id))
        .where(where);
      const items = await resourceQuery(tx)
        .where(where)
        .orderBy(...resourceOrder(filter.sort))
        .limit(filter.limit)
        .offset((filter.page - 1) * filter.limit);

      return {
        items,
        total: matches.total,
        page: filter.page,
        limit: filter.limit,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

export async function saveResource(
  db: Database,
  input: ResourceInput,
  normalized: ReturnType<typeof normalizeURL>,
  id?: string,
) {
  return db.transaction((tx) =>
    saveResourceInTransaction(tx, input, normalized, id),
  );
}

export async function saveResourceInTransaction(
  tx: Transaction,
  input: ResourceInput,
  normalized: ReturnType<typeof normalizeURL>,
  id?: string,
) {
  // URL-based locking still serializes duplicate checks independently of row IDs.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${normalized.normalized_url}, 0))`,
  );
  let previous: string | undefined;
  if (id !== undefined) {
    const [row] = await tx
      .select({ normalized: resources.normalized_url })
      .from(resources)
      .where(eq(resources.id, id))
      .for('update');
    if (!row) notFound();
    previous = row.normalized;
  }
  if (previous !== normalized.normalized_url && !input.acknowledge_duplicate) {
    const existing = await resourceQuery(tx)
      .where(
        and(
          eq(resources.normalized_url, normalized.normalized_url),
          id === undefined ? undefined : ne(resources.id, id),
        ),
      )
      .orderBy(resources.id)
      .limit(10);
    if (existing.length)
      throw new APIError(
        409,
        'duplicate',
        'This URL already exists. Open the existing entry, or acknowledge to save another copy.',
        { existing },
      );
  }
  if (input.category_id !== null) {
    const matches = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, input.category_id));
    if (!matches.length) invalid({ category_id: 'Category no longer exists' });
  }
  if (input.tag_ids.length) {
    const matches = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(inArray(tags.id, input.tag_ids));
    if (matches.length !== input.tag_ids.length)
      invalid({ tag_ids: 'A tag no longer exists' });
  }
  const { tag_ids, acknowledge_duplicate: _acknowledgment, ...values } = input;
  const data = {
    ...values,
    normalized_url: normalized.normalized_url,
    domain: normalized.domain,
  };
  if (id === undefined) {
    const [created] = await tx
      .insert(resources)
      .values(data)
      .returning({ id: resources.id });
    id = created.id;
  } else {
    await tx
      .update(resources)
      .set({ ...data, updated_at: sql`now()` })
      .where(eq(resources.id, id));
  }
  const resourceID = id;
  await tx.delete(resourceTags).where(eq(resourceTags.resource_id, resourceID));
  if (tag_ids.length)
    await tx
      .insert(resourceTags)
      .values(tag_ids.map((tag_id) => ({ resource_id: resourceID, tag_id })));

  return getResource(tx, id);
}

export async function setFavorite(db: Database, id: string, favorite: boolean) {
  const [updated] = await db
    .update(resources)
    .set({ favorite, updated_at: sql`now()` })
    .where(eq(resources.id, id))
    .returning({ id: resources.id, favorite: resources.favorite });
  if (!updated) notFound();

  return updated;
}

export async function deleteResource(db: Database, id: string) {
  const rows = await db
    .delete(resources)
    .where(eq(resources.id, id))
    .returning({ id: resources.id });
  if (!rows.length) notFound();
}
