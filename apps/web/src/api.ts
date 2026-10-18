export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface Tag {
  id: string;
  name: string;
}

export interface ResourceKind {
  id: string;
  name: string;
  key: string;
  description: string;
  sort_order: number;
  archived: boolean;
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

export interface Resource extends ResourceInput {
  id: string;
  domain: string;
  kind: ResourceKind | null;
  category: Category | null;
  tags: Tag[];
  created_at: string;
  updated_at: string;
}

export interface Page {
  items: Resource[];
  total: number;
  page: number;
  limit: number;
}

export interface ErrorDetail {
  code: string;
  message: string;
  fields?: Record<string, string>;
  existing?: Resource[];
}

export class APIError extends Error {
  constructor(public detail: ErrorDetail) {
    super(detail.message);
  }
}

export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new APIError({
      code: 'network',
      message:
        'Could not reach Linksmith. Check your connection and try again.',
    });
  }

  if (response.status === 204) return undefined as T;
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new APIError({
      code: 'response',
      message: 'The server returned an unreadable response.',
    });
  }

  if (!response.ok)
    throw new APIError(
      (data as { error?: ErrorDetail } | null)?.error ?? {
        code: 'server',
        message: 'The request failed.',
      },
    );
  return data as T;
}

export function errorDetail(error: unknown): ErrorDetail {
  return error instanceof APIError
    ? error.detail
    : {
        code: 'unexpected',
        message: 'Could not complete this action. Try again.',
      };
}
