import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { saveResourceInTransaction } from '../catalog/resources.js';
import type { Database, Transaction } from '../db/database.js';
import { categories, resources, tags } from '../db/schema.js';
import { APIError } from '../errors.js';
import {
  normalizeURL,
  validateCategoryMove,
  validateName,
  validateResource,
} from '../validation.js';
import { parseMarkdown } from './parser.js';
import {
  type ImportEntry,
  type ImportResult,
  importLimits,
  type MarkdownFile,
} from './types.js';

export async function previewImport(db: Database, files: MarkdownFile[]) {
  const preview = parseMarkdown(files);
  const keys = preview.candidates.flatMap((candidate) => {
    try {
      return [normalizeURL(candidate.url).normalized_url];
    } catch {
      return [];
    }
  });
  const matches = keys.length
    ? await db
        .select({
          id: resources.id,
          name: resources.name,
          url: resources.url,
          key: resources.normalized_url,
        })
        .from(resources)
        .where(inArray(resources.normalized_url, keys))
    : [];
  for (const candidate of preview.candidates) {
    try {
      const key = normalizeURL(candidate.url).normalized_url;
      candidate.existing = matches
        .filter((match) => match.key === key)
        .map(({ key: _key, ...match }) => match);
    } catch {
      /* Invalid candidates remain editable. */
    }
    if (candidate.existing.length) candidate.included = false;
  }
  return preview;
}

function entryError(id: string, error: unknown): never {
  const known = error instanceof APIError ? error : undefined;
  throw new APIError(
    known?.status ?? 422,
    'import_entry',
    known?.message ??
      'This entry could not be imported; the batch was rolled back',
    { entry_id: id, fields: known?.details.fields, rolled_back: true },
  );
}

function validateEntry(entry: ImportEntry) {
  if (
    !entry ||
    typeof entry.id !== 'string' ||
    entry.id.length > 100 ||
    entry.reviewed !== true
  )
    throw new APIError(
      422,
      'import_review',
      'Review every selected candidate before importing',
    );
  for (const field of [
    'name',
    'url',
    'description',
    'notes',
    'category',
  ] as const)
    if (typeof entry[field] !== 'string')
      throw new APIError(400, 'import_input', `${field} must be text`);
  if (
    !Array.isArray(entry.tags) ||
    entry.tags.length > 50 ||
    entry.tags.some((tag) => typeof tag !== 'string')
  )
    throw new APIError(422, 'import_tags', 'Use at most 50 tag names');
  const category = entry.category.trim();
  const separator = category.indexOf('/');
  // Only the first slash separates levels: CI/CD remains one child name.
  const path = category
    ? (separator < 0
        ? [category]
        : [category.slice(0, separator), category.slice(separator + 1)]
      ).map((name) => validateName(name))
    : [];
  const tagNames = [
    ...new Map(
      entry.tags.map((name) => {
        const normalized = validateName(name);
        return [normalized.toLowerCase(), normalized];
      }),
    ).values(),
  ];
  const validated = validateResource({
    url: entry.url,
    name: entry.name,
    description: entry.description,
    notes: entry.notes,
  });
  return { entry, path, tagNames, ...validated };
}

async function categoryFor(
  tx: Transaction,
  path: string[],
): Promise<string | null> {
  if (path.length) {
    const tree = await tx.select().from(categories);
    const fullPath = path.join('/').toLowerCase();
    const existing = tree.find((category) => {
      const parent = tree.find((item) => item.id === category.parent_id);
      return (
        (parent
          ? `${parent.name}/${category.name}`
          : category.name
        ).toLowerCase() === fullPath
      );
    });
    if (existing) return existing.id;
  }
  let parent: string | null = null;
  for (const name of path) {
    const [found] = await tx
      .select()
      .from(categories)
      .where(
        and(
          sql`lower(${categories.name}) = lower(${name})`,
          parent === null
            ? isNull(categories.parent_id)
            : eq(categories.parent_id, parent),
        ),
      );
    if (found) {
      parent = found.id;
      continue;
    }
    validateCategoryMove(undefined, parent, await tx.select().from(categories));
    const createdRows: { id: string }[] = await tx
      .insert(categories)
      .values({ name, parent_id: parent })
      .returning();
    parent = createdRows[0].id;
  }
  return parent;
}

export async function applyImport(
  db: Database,
  entries: ImportEntry[],
): Promise<ImportResult> {
  if (
    !Array.isArray(entries) ||
    !entries.length ||
    entries.length > importLimits.batch
  )
    throw new APIError(422, 'import_limits', 'Select 1–500 entries per batch');
  const validated = entries.map((entry) => {
    try {
      return validateEntry(entry);
    } catch (error) {
      return entryError(entry?.id ?? '', error);
    }
  });
  if (new Set(validated.map((item) => item.entry.id)).size !== entries.length)
    throw new APIError(422, 'import_input', 'Candidate IDs must be distinct');
  return db.transaction(async (tx) => {
    // Imports serialize taxonomy resolution. URL locks also coordinate with ordinary
    // resource saves; sorted acquisition prevents deadlocks between import batches.
    await tx.execute(sql`select pg_advisory_xact_lock(73519202)`);
    await tx.execute(
      sql`lock table categories, tags in share row exclusive mode`,
    );
    for (const key of [
      ...new Set(validated.map((item) => item.normalized.normalized_url)),
    ].sort())
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
      );
    const results: ImportResult['results'] = [];
    for (const item of validated) {
      const { entry, input, normalized, path, tagNames } = item;
      try {
        const [existing] = await tx
          .select()
          .from(resources)
          .where(eq(resources.normalized_url, normalized.normalized_url))
          .orderBy(resources.id)
          .limit(1);
        if (existing) {
          results.push({
            id: entry.id,
            status: 'skipped',
            resourceId: existing.id,
            name: existing.name,
          });
          continue;
        }
        input.category_id = await categoryFor(tx, path);
        for (const name of tagNames) {
          const [found] = await tx
            .select()
            .from(tags)
            .where(sql`lower(${tags.name}) = lower(${name})`);
          const tag =
            found ?? (await tx.insert(tags).values({ name }).returning())[0];
          input.tag_ids.push(tag.id);
        }
        const saved = await saveResourceInTransaction(tx, input, normalized);
        results.push({
          id: entry.id,
          status: 'created',
          resourceId: saved.id,
          name: saved.name,
        });
      } catch (error) {
        entryError(entry.id, error);
      }
    }
    return {
      created: results.filter((result) => result.status === 'created').length,
      skipped: results.filter((result) => result.status === 'skipped').length,
      failed: 0,
      results,
    };
  });
}
