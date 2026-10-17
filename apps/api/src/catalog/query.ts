import {
  and,
  asc,
  desc,
  eq,
  exists,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Executor } from '../db/database.js';
import { categories, resources, resourceTags, tags } from '../db/schema.js';
import { APIError } from '../errors.js';
import { isUUID } from '../validation.js';

export interface ListFilter {
  q: string;
  kind_id?: string;
  category_id?: string;
  tag_ids: string[];
  favorite: boolean;
  inbox: boolean;
  sort: 'title' | 'rating' | 'recent';
  page: number;
  limit: number;
}

export function parseFilter(query: URLSearchParams): ListFilter {
  const allowed = [
    'q',
    'kind_id',
    'category_id',
    'tag_id',
    'favorite',
    'inbox',
    'sort',
    'page',
    'limit',
  ];

  const fail = (message: string): never => {
    throw new APIError(400, 'filter', message);
  };

  for (const key of query.keys()) {
    if (!allowed.includes(key)) fail(`Unknown list parameter: ${key}`);
    if (key !== 'tag_id' && query.getAll(key).length !== 1)
      fail('Repeat only tag_id');
  }

  const positive = (
    key: string,
    raw: string,
    maximum = Number.MAX_SAFE_INTEGER,
  ) => {
    const value = Number(raw);
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > maximum
    )
      fail(`Invalid ${key}`);

    return value;
  };

  const boolean = (key: string) => {
    if (query.has(key) && !['true', 'false'].includes(query.get(key) ?? ''))
      fail(`${key} must be true or false`);

    return query.get(key) === 'true';
  };

  const q = (query.get('q') ?? '').trim();

  if ([...q].length > 200 || q.includes('\0'))
    fail('Search is limited to 200 characters');

  const sort = query.get('sort') || 'title';
  if (!['title', 'rating', 'recent'].includes(sort))
    fail('Sort must be title, rating or recent');

  const uuid = (key: string, value: string) => {
    if (!isUUID(value)) fail(`${key} must be a UUID`);

    return value.toLowerCase();
  };

  const tag_ids = query.getAll('tag_id').map((value) => uuid('tag_id', value));
  if (tag_ids.length > 50 || new Set(tag_ids).size !== tag_ids.length)
    fail('Choose at most 50 distinct tags');

  return {
    q,
    kind_id: query.has('kind_id')
      ? uuid('kind_id', query.get('kind_id') ?? '')
      : undefined,
    category_id: query.has('category_id')
      ? uuid('category_id', query.get('category_id') ?? '')
      : undefined,
    tag_ids,
    favorite: boolean('favorite'),
    inbox: boolean('inbox'),
    sort: sort as ListFilter['sort'],
    page: query.has('page')
      ? positive('page', query.get('page') ?? '', 1000000)
      : 1,
    limit: query.has('limit')
      ? positive('limit', query.get('limit') ?? '', 100)
      : 30,
  };
}

export const category = alias(categories, 'category');
export const parent = alias(categories, 'parent');

export function filterWhere(db: Executor, filter: ListFilter) {
  const conditions: (SQL | undefined)[] = [];
  if (filter.category_id !== undefined)
    conditions.push(
      or(
        eq(resources.category_id, filter.category_id),
        eq(category.parent_id, filter.category_id),
      ),
    );
  if (filter.kind_id !== undefined)
    conditions.push(eq(resources.kind_id, filter.kind_id));
  if (filter.favorite) conditions.push(eq(resources.favorite, true));
  if (filter.inbox) conditions.push(isNull(resources.category_id));
  for (const id of filter.tag_ids) {
    conditions.push(
      exists(
        db
          .select({ id: resourceTags.tag_id })
          .from(resourceTags)
          .where(
            and(
              eq(resourceTags.resource_id, resources.id),
              eq(resourceTags.tag_id, id),
            ),
          ),
      ),
    );
  }
  if (filter.q) {
    const textMatch = sql`strpos(lower(${resources.name} || ' ' || ${resources.description} || ' ' || ${resources.keywords} || ' ' || ${resources.domain} || ' ' || coalesce(${category.name}, '') || ' ' || coalesce(${parent.name}, '')), lower(${filter.q})) > 0`;
    const tagMatch = exists(
      db
        .select({ id: tags.id })
        .from(resourceTags)
        .innerJoin(tags, eq(tags.id, resourceTags.tag_id))
        .where(
          and(
            eq(resourceTags.resource_id, resources.id),
            sql`strpos(lower(${tags.name}), lower(${filter.q})) > 0`,
          ),
        ),
    );
    conditions.push(or(textMatch, tagMatch));
  }

  return and(...conditions);
}

export function resourceOrder(sort: ListFilter['sort']) {
  const title = sql`lower(coalesce(nullif(${resources.name}, ''), ${resources.domain}))`;

  if (sort === 'rating')
    return [sql`${resources.rating} desc nulls last`, title, asc(resources.id)];

  if (sort === 'recent')
    return [desc(resources.created_at), desc(resources.id)];

  return [title, asc(resources.id)];
}
