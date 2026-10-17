import { isIP } from 'node:net';
import type { Context } from 'hono';
import type { Category } from './db/schema.js';
import { APIError, invalid } from './errors.js';

type FieldType =
  | 'string'
  | 'boolean'
  | 'integer'
  | 'nullableInteger'
  | 'nullableString'
  | 'objectArray'
  | 'stringArray';

export const isUUID = (value: string) =>
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);

export async function readBody(
  c: Context,
  allowed: Record<string, FieldType>,
): Promise<Record<string, unknown>> {
  if (
    c.req.header('content-type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  ) {
    throw new APIError(415, 'content_type', 'Send application/json');
  }
  let body: unknown;
  try {
    body = JSON.parse(await c.req.text());
  } catch {
    throw new APIError(400, 'json', 'Send one valid JSON object');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new APIError(400, 'json', 'Send one valid JSON object');
  for (const [key, value] of Object.entries(body)) {
    const type = Object.hasOwn(allowed, key) ? allowed[key] : undefined;
    if (!type)
      throw new APIError(
        400,
        'json',
        'Invalid JSON, unknown field or incorrect field type',
      );
    if (value === null) {
      if (type === 'nullableInteger' || type === 'nullableString') continue;
      invalid({ [key]: 'This field cannot be null' });
    }
    const valid =
      type === 'string' || type === 'nullableString'
        ? typeof value === 'string'
        : type === 'boolean'
          ? typeof value === 'boolean'
          : type === 'objectArray'
            ? Array.isArray(value) &&
              value.every(
                (item) =>
                  item !== null &&
                  typeof item === 'object' &&
                  !Array.isArray(item),
              )
            : type === 'stringArray'
              ? Array.isArray(value) &&
                value.every((item) => typeof item === 'string')
              : Number.isSafeInteger(value);
    if (!valid)
      throw new APIError(
        400,
        'json',
        'Invalid JSON, unknown field or incorrect field type',
      );
  }

  return body as Record<string, unknown>;
}

export function pathID(value: string): string {
  if (!isUUID(value)) throw new APIError(400, 'id', 'ID must be a UUID');

  return value.toLowerCase();
}

function validText(value: string, limit: number) {
  return (
    !value.includes('\0') &&
    [...value].length <= limit &&
    Buffer.from(value).toString('utf8') === value
  );
}

export function validateName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || !validText(name, 100))
    invalid({ name: 'Enter a name of 1–100 characters' });

  return name;
}

export function normalizeURL(input: string) {
  const url = input.trim();
  // Do not use WHATWG URL.href as the duplicate key: it rewrites dot segments,
  // backslashes, numeric hosts, and queries. Keep the earlier conservative rules.
  const match = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(?:#.*)?$/i.exec(url);
  if (
    !match ||
    Buffer.byteLength(url) > 4096 ||
    /[\s\\]/u.test(url) ||
    [...url].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    match[2].includes('@') ||
    Buffer.from(url).toString('utf8') !== url
  ) {
    throw new Error(
      'Enter an absolute HTTP or HTTPS URL without credentials or spaces',
    );
  }
  const [, scheme, authority, enteredPath, query = ''] = match;

  const hostMatch = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(authority);
  if (!hostMatch) throw new Error('Invalid URL host or port');
  let hostname = hostMatch[1];
  if (hostname.includes('%')) {
    // Legacy net/url accepted escaped non-ASCII host bytes, not escaped ASCII.
    if (!/^(?:[^%]|%(?:[89a-f][\da-f]))+$/i.test(hostname))
      throw new Error('Invalid URL host');
    try {
      hostname = decodeURIComponent(hostname);
    } catch {
      throw new Error('Invalid URL host');
    }
  }
  hostname = hostname.toLowerCase();
  const domain = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  if (hostname.startsWith('[')) {
    if (isIP(domain) !== 6) throw new Error('Invalid URL host');
  } else {
    if (domain.length > 253 || /[/%?#]/.test(domain))
      throw new Error('Invalid URL host');
    for (const label of domain.replace(/\.$/, '').split('.')) {
      if (
        !label ||
        label.length > 63 ||
        !/^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(label)
      )
        throw new Error('Invalid URL host');
    }
  }
  let port = hostMatch[2] ?? '';
  if (port && (Number(port) < 1 || Number(port) > 65535))
    throw new Error('Invalid URL port');
  const protocol = scheme.toLowerCase();
  if (
    (protocol === 'http' && Number(port) === 80) ||
    (protocol === 'https' && Number(port) === 443)
  )
    port = '';
  const path = enteredPath || '/';
  if (/%(?![\da-f]{2})/i.test(path)) throw new Error('Invalid URL path');
  const fragment = url.slice(url.indexOf('#') + 1);
  if (url.includes('#') && /%(?![\da-f]{2})/i.test(fragment))
    throw new Error('Invalid URL fragment');
  const escapedPath = legacyEscapedPath(path);
  const escapedHost = [...hostname]
    .map((character) =>
      character.charCodeAt(0) > 127 ? encodeURIComponent(character) : character,
    )
    .join('');

  return {
    url,
    normalized_url: `${protocol}://${escapedHost}${port ? `:${port}` : ''}${escapedPath}${query}`,
    domain,
  };
}

function legacyEscapedPath(path: string): string {
  // Retain valid ASCII raw paths/escape spelling. For literal Unicode or unsafe
  // characters, reproduce net/url's byte escaping so existing duplicate keys match.
  if (/^[a-z\d\-._~!$&'()*+,;=:@/%[\]]*$/i.test(path)) return path;
  const bytes = Buffer.from(path);
  let escaped = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte =
      bytes[i] === 37
        ? Number.parseInt(bytes.subarray(i + 1, i + 3).toString(), 16)
        : bytes[i];
    if (bytes[i] === 37) i += 2;
    const character = String.fromCharCode(byte);
    escaped += /^[a-z\d\-._~$&+,/:;=@]$/i.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }

  return escaped;
}

export interface ResourceInput {
  url: string;
  name: string;
  description: string;
  notes: string;
  keywords: string;
  rating: number | null;
  favorite: boolean;
  pricing: string;
  kind_id: string | null;
  category_id: string | null;
  tag_ids: string[];
  acknowledge_duplicate: boolean;
}

const resourceFields: Record<keyof ResourceInput, FieldType> = {
  url: 'string',
  name: 'string',
  description: 'string',
  notes: 'string',
  keywords: 'string',
  rating: 'nullableInteger',
  favorite: 'boolean',
  pricing: 'string',
  kind_id: 'nullableString',
  category_id: 'nullableString',
  tag_ids: 'stringArray',
  acknowledge_duplicate: 'boolean',
};

export async function readResource(c: Context) {
  const body = await readBody(c, resourceFields);
  return validateResource(body);
}

export function validateResource(body: Record<string, unknown>) {
  const input: ResourceInput = {
    url: '',
    name: '',
    description: '',
    notes: '',
    keywords: '',
    rating: null,
    favorite: false,
    pricing: 'Unknown',
    kind_id: null,
    category_id: null,
    tag_ids: [],
    acknowledge_duplicate: false,
    ...body,
  };
  input.url = input.url.trim();
  input.name = input.name.trim();
  const fields: Record<string, string> = {};
  let normalized: ReturnType<typeof normalizeURL> | undefined;
  try {
    normalized = normalizeURL(input.url);
  } catch (error) {
    fields.url = (error as Error).message;
  }

  for (const [key, limit] of Object.entries({
    name: 300,
    description: 20000,
    notes: 50000,
    keywords: 2000,
  })) {
    if (
      !validText(
        input[key as 'name' | 'description' | 'notes' | 'keywords'],
        limit,
      )
    )
      fields[key] = `Use valid text with at most ${limit} characters`;
  }
  if (input.rating !== null && (input.rating < 1 || input.rating > 5))
    fields.rating = 'Choose Unrated or 1–5';
  if (input.pricing === '') input.pricing = 'Unknown';
  if (!['Unknown', 'Free', 'Freemium', 'Paid'].includes(input.pricing))
    fields.pricing = 'Choose Unknown, Free, Freemium or Paid';
  if (input.category_id !== null && !isUUID(input.category_id))
    fields.category_id = 'Choose an existing category (UUID required)';

  if (input.kind_id !== null && !isUUID(input.kind_id))
    fields.kind_id = 'Choose an existing resource kind (UUID required)';
  input.kind_id = input.kind_id?.toLowerCase() ?? null;
  input.category_id = input.category_id?.toLowerCase() ?? null;
  input.tag_ids = input.tag_ids.map((id) => id.toLowerCase());

  if (input.tag_ids.length > 50) fields.tag_ids = 'Choose at most 50 tags';

  if (
    input.tag_ids.some((id) => !isUUID(id)) ||
    new Set(input.tag_ids).size !== input.tag_ids.length
  )
    fields.tag_ids = 'Tag IDs must be valid and distinct UUIDs';

  if (Object.keys(fields).length) invalid(fields);

  if (!normalized) invalid({ url: 'Enter a valid HTTP/HTTPS URL' });

  return { input, normalized };
}

export function validateCategoryMove(
  id: string | undefined,
  parent: string | null,
  categories: Category[],
) {
  if (parent !== null && !isUUID(parent))
    invalid({
      parent_id: 'Choose an existing parent category (UUID required)',
    });
  if (parent === null) return;
  if (parent === id)
    invalid({ parent_id: 'A category cannot be its own parent' });
  const target = categories.find((category) => category.id === parent);
  if (!target)
    invalid({ parent_id: 'The selected parent category no longer exists' });
  if (target.parent_id !== null)
    invalid({
      parent_id:
        'Choose a root category as the parent; only two levels are supported',
    });
  if (categories.some((category) => category.parent_id === id))
    invalid({
      parent_id: "Move this category's children first before making it a child",
    });
}
