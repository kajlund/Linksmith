import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class APIError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function invalid(fields: Record<string, string>): never {
  throw new APIError(422, 'validation', 'Please check the highlighted fields', {
    fields,
  });
}

export function notFound(): never {
  throw new APIError(404, 'not_found', 'This item no longer exists');
}

// Drizzle wraps driver errors. Read only the SQLSTATE, never log queries or params
// (which may contain private notes), and never send SQL details to the client.

export function databaseCode(error: unknown): string | undefined {
  let cause = error;
  for (let i = 0; i < 8 && cause && typeof cause === 'object'; i++) {
    if ('code' in cause && typeof cause.code === 'string') return cause.code;
    cause = 'cause' in cause ? cause.cause : undefined;
  }
}

export function databaseError(code?: string): APIError | undefined {
  switch (code) {
    case '23505':
      return new APIError(
        409,
        'name_conflict',
        'That name is already used here. Choose a different name.',
      );
    case '23503':
    case '23001':
      return new APIError(
        409,
        'references',
        'Move child categories and reassign resources before deleting. For saves, refresh and choose existing categories/tags.',
      );
    case '23514':
      return new APIError(
        422,
        'validation',
        'Invalid value or category depth. Categories support only root and child levels.',
      );
  }
}
