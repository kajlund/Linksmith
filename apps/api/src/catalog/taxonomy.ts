import { asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { categories, tags } from '../db/schema.js';
import { notFound } from '../errors.js';
import { validateCategoryMove } from '../validation.js';

export function listCategories(db: Database) {
  return db
    .select()
    .from(categories)
    .orderBy(sql`lower(${categories.name})`, asc(categories.id));
}

export async function saveCategory(
  db: Database,
  name: string,
  parent_id: string | null,
  id?: string,
) {
  return db.transaction(async (tx) => {
    // Serialize before reading; stale hierarchy validation cannot create a third
    // level. Existing database indexes/FKs/trigger remain the final constraints.
    await tx.execute(sql`lock table categories in share row exclusive mode`);
    const tree = await tx.select().from(categories);
    if (id !== undefined && !tree.some((category) => category.id === id))
      notFound();
    validateCategoryMove(id, parent_id, tree);
    const [saved] =
      id === undefined
        ? await tx.insert(categories).values({ name, parent_id }).returning()
        : await tx
            .update(categories)
            .set({ name, parent_id })
            .where(eq(categories.id, id))
            .returning();

    return saved;
  });
}

export async function deleteCategory(db: Database, id: string) {
  const deleted = await db
    .delete(categories)
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  if (!deleted.length) notFound();
}

export function listTags(db: Database) {
  return db
    .select()
    .from(tags)
    .orderBy(sql`lower(${tags.name})`, asc(tags.id));
}

export async function saveTag(db: Database, name: string, id?: string) {
  const [saved] =
    id === undefined
      ? await db.insert(tags).values({ name }).returning()
      : await db.update(tags).set({ name }).where(eq(tags.id, id)).returning();
  if (!saved) notFound();

  return saved;
}

export async function deleteTag(db: Database, id: string) {
  const deleted = await db
    .delete(tags)
    .where(eq(tags.id, id))
    .returning({ id: tags.id });
  if (!deleted.length) notFound();
}
