# API contract

Base path: `/api`. Bodies use `Content-Type: application/json`. Unknown fields, wrong types, malformed JSON, and explicit nulls for non-nullable fields are rejected. Requests are limited to 128 KiB. Resource, category, and tag IDs are UUID strings. PUT replaces editable fields; omitted optional fields take defaults. Server-generated IDs/timestamps/domain/category/tag objects are read-only and must not be sent as input.

Drizzle handles database operations and transactions. Migration `002_uuid_ids.sql` converts integer IDs and their references to UUIDs while retaining catalog data. UUID input accepts upper/lowercase hexadecimal and is normalized to lowercase; integer IDs are rejected. New IDs are PostgreSQL-generated random UUIDs. Responses include `X-Request-ID` for matching Pino request logs.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/health` | 200 `{ "status": "ready" }` or 503 when DB/schema is not ready |
| GET | `/resources` | Filtered, sorted page |
| GET | `/resources/{id}` | Full resource or 404 |
| POST | `/resources` | Create; 201 |
| PUT | `/resources/{id}` | Replace editable values; 200 |
| PATCH | `/resources/{id}/favorite` | Body `{ "favorite": true }`; 200 `{ "id": "123e4567-e89b-42d3-a456-426614174000", "favorite": true }` |
| DELETE | `/resources/{id}` | Delete resource and its tag associations; 204 |
| GET | `/categories` | Alphabetically sorted category array |
| POST | `/categories` | Create; 201 |
| PUT | `/categories/{id}` | Rename/move; 200 |
| DELETE | `/categories/{id}` | 204 or 409 if children/resources remain |
| GET | `/tags` | Alphabetically sorted tag array |
| POST | `/tags` | Create; 201 |
| PUT | `/tags/{id}` | Rename; 200; conflicting name gives 409 |
| DELETE | `/tags/{id}` | Remove tag and associations only; 204 |

Lists return empty arrays rather than null. Deleting/updating missing items returns 404. Categories/tags are small shared taxonomy lists; bounded pagination applies to resources.

## Resource input

```json
{
  "url": "https://example.com/docs",
  "name": "Example docs",
  "description": "Plain text description",
  "notes": "Private plain text notes",
  "keywords": "guide reference",
  "rating": null,
  "favorite": false,
  "pricing": "Unknown",
  "category_id": null,
  "tag_ids": [],
  "acknowledge_duplicate": false
}
```

Only `url` is mandatory: an absolute HTTP/HTTPS URL without credentials or whitespace, at most 4096 bytes. Stored URL is trimmed. Name is at most 300 characters, description 20,000, notes 50,000, keywords 2,000. Text must be valid UTF-8 and contain no null characters. Total request byte limit still applies. Rating is null or integer 1–5. Pricing is exactly Unknown/Free/Freemium/Paid, default Unknown. Favorite defaults false. Category defaults null, and tags default empty; references must exist. At most 50 distinct UUID tag IDs are accepted. Saves and tag associations use one transaction.

Responses contain those values plus `id`, `domain`, `created_at`, `updated_at`, `category` (object or null), and `tags` (objects). Dates are ISO timestamps. `acknowledge_duplicate` is transient and is false in stored-resource responses.

Duplicate comparison follows the normalization described in README. Create or a changed normalized URL matching another resource returns 409 with code `duplicate` and up to ten matching full resources in `error.existing`. Retry with `acknowledge_duplicate: true` only after explicit user acknowledgment. Editing a URL with its existing normalized value does not rewarn; self is excluded. URL-based transaction locks serialize concurrent duplicate checks.

## List query

All supplied filters combine with AND. Category matches itself and direct children. Tag IDs repeat and require *all* selected tags. Unknown query parameters, repeated scalar parameters, and invalid values return 400. Missing category/tag references also give 400 with a removable-filter message.

| Parameter | Values/default |
| --- | --- |
| `q` | Case-insensitive literal substring; trimmed; up to 200 characters; `%`/`_` are literal |
| `category_id` | Category UUID |
| `tag_id` | Repeatable distinct tag UUID, maximum 50 |
| `favorite` | `true` restricts to favorites; `false` applies no favorite restriction |
| `inbox` | `true` restricts to uncategorized; `false` applies no inbox restriction |
| `sort` | `title` (default), `rating`, or `recent` |
| `page` | 1–1,000,000; default 1 |
| `limit` | 1–100; default 30 |

Example: `/api/resources?category_id=123e4567-e89b-42d3-a456-426614174000&tag_id=123e4567-e89b-42d3-a456-426614174001&tag_id=123e4567-e89b-42d3-a456-426614174002&favorite=true&q=go&sort=rating&page=1&limit=30`.

Response: `{ "items": [...], "total": 42, "page": 1, "limit": 30 }`. Total and items share a repeatable-read snapshot. Category and tag data are fetched in the page query without per-resource network/database calls.

Search checks name, description, keywords, domain, category/ancestor names, and tags. Notes are excluded. Title order uses lower-case name, falling back to domain, then ID ascending. Rating uses descending numeric rating, nulls last, then title/ID. Recently added uses creation timestamp descending, then ID descending. SQL values are parameterized; sort expressions are whitelisted.

## Category/tag input

Category: `{ "name": "Development", "parent_id": null }`. Child: `{ "name": "Libraries", "parent_id": "123e4567-e89b-42d3-a456-426614174000" }`. Tag: `{ "name": "Open source" }`.

Names are trimmed, nonblank, and at most 100 characters. Case-insensitive uniqueness is enforced by PostgreSQL indexes: tags globally; categories within a parent, including roots. Parent must be a root; self-parenting, cycles, and moving categories that have children underneath another root are rejected. Category writes lock the tree before validation, and a database trigger also enforces depth.

## Errors

```json
{
  "error": {
    "code": "validation",
    "message": "Please check the highlighted fields",
    "fields": { "rating": "Choose Unrated or 1–5" }
  }
}
```

400: malformed body/types/unknown fields or list parameters; 413: body too large; 415: missing/wrong JSON content type; 422: invalid field values/hierarchy; 409: duplicate URL, conflicting names, or deletion/reference conflict; 404: missing record/route; 500: unexpected failure; 503: not ready. Unexpected database failures are logged server-side; SQL internals and connection details are not sent to clients. No CORS or authentication is provided.
