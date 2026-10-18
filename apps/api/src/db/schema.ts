import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// These definitions map the existing SQL schema; migrations remain the source of
// truth for DDL, including the category-depth trigger. No schema push on startup.
export const categories = pgTable(
  'categories',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    parent_id: uuid().references((): AnyPgColumn => categories.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    uniqueIndex('categories_root_name')
      .on(sql`lower(${table.name})`)
      .where(sql`${table.parent_id} is null`),
    uniqueIndex('categories_child_name')
      .on(table.parent_id, sql`lower(${table.name})`)
      .where(sql`${table.parent_id} is not null`),
    check(
      'categories_name_check',
      sql`length(btrim(${table.name})) between 1 and 100 and ${table.name} = btrim(${table.name})`,
    ),
    check(
      'categories_check',
      sql`${table.parent_id} is distinct from ${table.id}`,
    ),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
  },
  (table) => [
    uniqueIndex('tags_name').on(sql`lower(${table.name})`),
    check(
      'tags_name_check',
      sql`length(btrim(${table.name})) between 1 and 100 and ${table.name} = btrim(${table.name})`,
    ),
  ],
);

export const resourceKinds = pgTable(
  'resource_kinds',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    key: text().notNull().unique(),
    description: text().notNull().default(''),
    sort_order: integer().notNull().default(0),
    archived: boolean().notNull().default(false),
  },
  (t) => [
    uniqueIndex('resource_kinds_name').on(sql`lower(${t.name})`),
    check(
      'resource_kinds_name_check',
      sql`length(btrim(${t.name})) between 1 and 100 and ${t.name} = btrim(${t.name})`,
    ),
    check(
      'resource_kinds_description_check',
      sql`length(${t.description}) <= 2000`,
    ),
    check('resource_kinds_sort_order_check', sql`${t.sort_order} >= 0`),
  ],
);
export const resources = pgTable(
  'resources',
  {
    id: uuid().primaryKey().defaultRandom(),
    url: text().notNull(),
    normalized_url: text().notNull(),
    domain: text().notNull(),
    name: text().notNull().default(''),
    description: text().notNull().default(''),
    notes: text().notNull().default(''),
    keywords: text().notNull().default(''),
    rating: integer(),
    favorite: boolean().notNull().default(false),
    pricing: text().notNull().default('Unknown'),
    kind_id: uuid().references(() => resourceKinds.id, {
      onDelete: 'restrict',
    }),
    category_id: uuid().references(() => categories.id, {
      onDelete: 'restrict',
    }),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('resources_normalized_url').on(table.normalized_url),
    index('resources_category').on(table.category_id),
    index('resources_kind').on(table.kind_id),
    check('resources_url_check', sql`length(${table.url}) between 1 and 4096`),
    check('resources_name_check', sql`length(${table.name}) <= 300`),
    check(
      'resources_description_check',
      sql`length(${table.description}) <= 20000`,
    ),
    check('resources_notes_check', sql`length(${table.notes}) <= 50000`),
    check('resources_keywords_check', sql`length(${table.keywords}) <= 2000`),
    check('resources_rating_check', sql`${table.rating} between 1 and 5`),
    check(
      'resources_pricing_check',
      sql`${table.pricing} in ('Unknown','Free','Freemium','Paid')`,
    ),
  ],
);

export const resourceTags = pgTable(
  'resource_tags',
  {
    resource_id: uuid()
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    tag_id: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.resource_id, table.tag_id] }),
    index('resource_tags_tag').on(table.tag_id, table.resource_id),
  ],
);

export const schemaMigrations = pgTable('schema_migrations', {
  version: text().primaryKey(),
  applied_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type Category = typeof categories.$inferSelect;
export type Tag = typeof tags.$inferSelect;
