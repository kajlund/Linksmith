# Linksmith

A single-user resource notebook built with **Node.js, Hono, Drizzle ORM, PostgreSQL, Lit, and TypeScript**. Capture with only a URL, browse a two-level category tree, combine search and tag filters, and edit entries through a compact dialog.

Resources, categories, tags, ratings, favorites, pricing, private notes, and keywords are included. Markdown import with a reviewable preview is included. Exports, authentication, metadata fetching, and dashboards remain outside this version. There is **no authentication**: keep access restricted to your trusted LAN behind your reverse proxy.

## Structure and prerequisites

- `apps/api/src/index.ts`: Node HTTP server and graceful shutdown.
- `apps/api/src/app.ts`, `routes.ts`: Hono middleware, API routes, and errors.
- `apps/api/src/catalog`: Drizzle queries and catalog operations.
- `apps/api/src/db/schema.ts`: typed Drizzle schema matching the existing database.
- `apps/api/src/db/migrations.ts`, `apps/api/migrations`: explicit SQL migration runner/files.
- `apps/api/src/config.ts`, `logger.ts`: dotenv configuration and Pino logging.
- `apps/api/src/import`: Markdown parser, editable mapping suggestions, preview and atomic batch apply.
- `apps/web/src/import.ts`: bounded import preview and review controls.
- `apps/api/test`: Vitest tests and optional PostgreSQL integration tests.
- `apps/web/src`: existing Lit frontend, API types, and semantic theme tokens.
- [API contract](docs/API.md) and [verification record](docs/VERIFICATION.md).

Use **Node.js 24 LTS**, npm, and PostgreSQL **14+**. The root and workspaces declare Node `24.x`; `.nvmrc` selects major 24 for version managers that support it. Docker and Go are not required. PostgreSQL can run on your home server; `psql` is useful for initial administration.

See [DreamQuest repository conventions](docs/dreamquest-conventions.md) for the development workflow and the conventions used as a reference for the other applications.

Versions checked against registries and pinned: Hono 4.13.13, `@hono/node-server` 2.1.3, Drizzle ORM 0.45.3, `pg` 8.23.1, dotenv 18.0.6, Pino 10.4.0, pino-pretty 13.2.0, tsx 4.23.15, and TypeScript 7.0.2. The client retains Lit 3.3.3 and Vite 8.3.3. The root `package-lock.json` covers all workspaces; run `npm ci` from the repository root for reproducible installs.

## Moving from Go

Stop the existing server before upgrading. **Keep your existing PostgreSQL database and credentials.** The original `001_catalog.sql` remains unchanged, and the runner retains the same `schema_migrations` history. The new `002_uuid_ids.sql` assigns random UUIDs to existing resources, categories, and tags and converts every related foreign key. Content, timestamps, category hierarchy, and tag associations are preserved. New entries receive PostgreSQL-generated UUIDs; the Drizzle schema and client use UUID strings.

Normal startup never migrates. Drizzle handles queries, writes, and transactions; explicit SQL migrations retain the depth trigger and existing migration history. No `drizzle-kit push` or automatic schema synchronization is used.

## Database and dotenv

For an existing database, reuse its URL. For a new database, as a PostgreSQL administrator:

```sql
CREATE ROLE linksmith LOGIN;
\password linksmith
CREATE DATABASE linksmith OWNER linksmith;
```

`\password` prompts instead of putting a password in shell history. Use your PostgreSQL hostname/IP: **localhost means the machine running Node**, not your home server. Percent-encode reserved characters in URL passwords. `sslmode=disable` is an example for a trusted local/LAN connection; use your server's TLS settings where applicable.

From the repository root, copy the template and edit `.env` with your connection details:

```powershell
# PowerShell
Copy-Item .env.example .env
```

```sh
# Ubuntu
cp .env.example .env
```

dotenv automatically loads this **repository-root `.env`**, independently of the working directory and whether you run source or compiled code. Shell/service variables take precedence. To remove an old PowerShell database override from the current session, use `Remove-Item Env:DATABASE_URL`.

`ENV_FILE` selects an alternative dotenv file, with relative paths resolved from the process working directory. An explicitly selected missing/unreadable file fails startup. The default `.env` is optional when configuration is supplied by the environment. Never commit credentials.

| Variable            | Default                                      | Purpose                                               |
| ------------------- | -------------------------------------------- | ----------------------------------------------------- |
| `DATABASE_URL`      | Required                                     | PostgreSQL connection URL                             |
| `BIND_ADDR`         | `127.0.0.1:8080`                             | HTTP host:port; IPv6 uses `[::1]:8080`                |
| `CLIENT_DIR`        | `../web/dist`                                | Client build; relative paths resolve from `apps/api/` |
| `ENV_FILE`          | Repository-root `.env`                       | Alternative dotenv file                               |
| `NODE_ENV`          | Development behavior                         | Set `production` for deployment                       |
| `LOG_LEVEL`         | `info`                                       | Pino level, e.g. debug/info/warn/error                |
| `LOG_PRETTY`        | true outside production, false in production | Optional true/false format override                   |
| `TEST_DATABASE_URL` | Optional, tests only                         | Disposable database ending in `_test`                 |

## Install and migrate

From the repository root, in PowerShell or Ubuntu:

```sh
npm ci
npm run migrate -w @linksmith/api
```

Migrations apply unapplied SQL files in filename order inside one transaction, with a PostgreSQL advisory lock to serialize runs. Repeating the command is safe. Keep applied migrations unchanged and add a numbered file for schema changes. Back up before upgrades; there is no automatic down-migration.

## Upgrading an existing catalog to UUID IDs

Stop the server and make a PostgreSQL backup before running the upgrade. From the repository root:

```sh
npm run migrate -w @linksmith/api
npm run build -w @linksmith/api
npm run build -w @linksmith/web
npm start -w @linksmith/api
```

The migration locks the catalog tables and converts IDs atomically. A failure rolls back the upgrade; rerunning after success skips it and keeps the assigned UUIDs. Fresh databases apply all numbered migrations. The existing npm migration script already discovers numbered SQL files; no additional script is needed. With compiled production code, use `npm run migrate:production -w @linksmith/api` after building the server.

IDs change once during this upgrade. Previously saved integer resource links and category/tag filter URLs no longer identify entries; reopen the app and clear old filters. External clients must send UUID strings. The UUID migration itself does not import or export data. Start the updated server with the rebuilt client after migration; readiness currently requires migration `004_resource_kind_descriptions.sql`.

## Development

Root npm commands forward to the apps/web/server packages:

| Command                      | Action                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm start`                  | Start the compiled server, serving `apps/web/dist` too                                                            |
| `npm run dev`                | Start the API with automatic restart and the Vite web app                                                         |
| `npm run dev:api`            | Start only the API with automatic restart                                                                         |
| `npm run dev:web`            | Start the Vite development client in another terminal                                                             |
| `npm run build`              | Build both client and server                                                                                      |
| `npm run migrate`            | Apply pending migrations using the root `.env`                                                                    |
| `npm run migrate:production` | Apply migrations using the compiled server                                                                        |
| `npm run typecheck`          | Type-check both packages                                                                                          |
| `npm run check`              | Type-check both packages, lint, then run API tests; stops on failure                                              |
| `npm test`                   | Run server tests                                                                                                  |
| `npm run verify:start`       | Start the compiled app and check built pages/assets over HTTP using an unused local port and a dummy database URL |

For one server serving the built client, run `npm run build` once, then `npm start`. Open **http://127.0.0.1:8080** (unless you changed `BIND_ADDR`). For server development with the built client, use `npm run dev:api`. These commands still load the repository-root `.env`; migrations remain explicit.

Use the repository root for deployment commands, just like the other apps:

```sh
npm ci --include=dev
npm run build
npm start
```

The build needs development dependencies even when the deployment environment sets `NODE_ENV=production`. Start uses compiled JavaScript and needs only runtime dependencies. Keep `.env` at the repository root; on DreamQuest use `BIND_ADDR=127.0.0.1:5011`, `CLIENT_DIR=../web/dist`, and your existing `DATABASE_URL`. Set `NODE_ENV=production` for deployment. The old default `CLIENT_DIR=../client/dist` also resolves to the moved web build; other custom paths remain explicit. Services that launch Node directly must use `apps/api/dist/index.js` in the new layout.

After building, `npm run verify:start` checks the actual root start command, bundled assets, frontend routing, and API error routing. It does not connect to your database. To check a separately assembled production-only deployment, run `npm run verify:start -- /path/to/deployment` from this checkout.

The shared deploy script checks `/health`, which returns HTTP 200 JSON when the API process is running, matching Mise and Saywell. Database/migration readiness is checked separately at `/api/health` and returns 503 when unavailable. The startup smoke check verifies both endpoints.

Use two terminals from the repository root:

```sh
# Terminal 1: API with automatic restart and pretty logging
npm run dev -w @linksmith/api

# Terminal 2: Vite client
npm run dev -w @linksmith/web
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to `http://127.0.0.1:8080`; keep that address for development or update `apps/web/vite.config.ts`. The API runs without a built frontend; direct requests for a missing client return a helpful 503.

Pino logs request ID, method, path, status, and duration. Request bodies, query strings, connection URLs, and private notes are not logged. Unexpected database failures record SQLSTATE/request context without exposing SQL/parameters to clients.

## Production

From the repository root:

```sh
npm run build -w @linksmith/web
npm run build -w @linksmith/api
npm start -w @linksmith/api
```

Open **http://127.0.0.1:8080**. Set `NODE_ENV=production` in your service environment or `.env` for JSON logging. pino-pretty is a development dependency, following [its production guidance](https://github.com/pinojs/pino-pretty); explicit pretty logging requires it to be installed.

One Node process serves the API and client under the same origin with [Hono's Node HTTP/static adapter](https://hono.dev/docs/getting-started/nodejs), preserving your reverse-proxy setup without a separate frontend process or CORS configuration. The adapter streams real files and handles HEAD requests. Extensionless client routes fall back to `index.html`; unknown API routes and missing assets return errors rather than HTML.

For production-only dependencies, deploy the root `package.json` and `package-lock.json`, both workspace `package.json` files, `apps/api/dist`, `apps/api/migrations`, and `apps/web/dist` in the same layout. From the repository root, run `npm ci --omit=dev -w @linksmith/api`, set `NODE_ENV=production`, then `node apps/api/dist/index.js`. Apply migrations separately with `node apps/api/dist/migrate.js`. These compiled commands require no tsx, TypeScript, pino-pretty, or Go. SIGINT/SIGTERM close HTTP and database connections with a five-second shutdown deadline.

## First use

1. Use **Manage categories & tags** to create roots and children. Open source is a tag, independent of pricing.
2. Select a category and click **Add resource** to default the form to that category. Otherwise capture starts uncategorized; filtered tags are not inferred.
3. Enter a URL and save. Name falls back to the domain. Use tag suggestions or type a name and click **Add tag**. **Save & add another** clears entry content and keeps its category.
4. Combine categories, Inbox, Favorites, search, and tags. Selected tags use AND. Remove chips individually or **Clear filters**. Sort persists locally; filter/page state survives refresh in the URL.
5. Titles open links in a new tab. The separate chevron expands details and Edit/Delete; ordinary row text has no navigation action. The star toggles Favorite, restoring its previous state on failure.

Alphabetical display title is the default sort. Rating order puts unrated last; recently added sorts newest first. Parent categories include themselves and children. Pages default to **30 entries**, show totals, and expose Previous/Next. Search covers name, description, keywords, domain, category/ancestor names, and tags; private notes are excluded.

Duplicate detection trims the entered URL for storage and computes a conservative key: lower-case scheme/host, omit default ports, turn an empty root path into `/`, and ignore fragments. It preserves path case, dot segments, query content/order, trailing path slashes, and HTTP versus HTTPS. Valid ASCII path escapes are retained; literal Unicode/unsafe path characters use the previous server's canonical escaping so existing keys match. Credentials/whitespace in URLs are rejected. Warnings show existing entries and allow editing them or explicitly acknowledging another copy. Unchanged normalized URLs on edit do not warn again. The API enforces acknowledgment and serializes concurrent duplicate creates.

Deleting categories with children/resources is rejected; move/reassign them first. Deleting a tag removes associations after confirmation and keeps resources. Descriptions/notes render safely as plain text with line breaks. Light/dark themes follow the system initially and persist explicit choices.

## Import Markdown

Click **Import Markdown** beside Add resource. Select one or several resource-list `.md` files; other Markdown documents can be left out. A file without extractable HTTP/HTTPS links shows zero candidates. Source files are read in your browser and stay untouched. No import runs at startup.

1. Inspect file counts, heading groups, warnings, duplicates, and unmapped entries. Preview performs parsing and a database lookup only. Source excerpts and parent-list context are available under **Original source**; front matter is context only.
2. Use **Review & edit** to change name, entered URL, description, notes, category, tags, and inclusion. Warnings default to excluded. Checking Include confirms your review; **Done reviewing** marks review without forcing selection. Clear candidates may start selected. Blank category is intentional uncategorized storage.
3. Choose an existing category path/tag from suggestions or propose new names. Category paths are `Root/Child`; only the first slash separates levels, so `Infrastructure/CI/CD` creates the child `CI/CD`. Existing paths match case-insensitively and are never renamed. The group mapping panel applies category and adds tags to **all filtered entries across pages**. Review and selection are separate.
4. Preview pages contain 25 entries. Selection persists across pages. Select reviewed selects all reviewed, nonexisting entries in the filtered group; warning entries need individual review first. Deselect affects the whole filtered group. Inspect proposed new categories/tags before import.
5. For multiple links in one source, either review and include each separately, or use **Use as primary** to keep the shared source and other URLs in notes while deselecting the others. Check attribution before import, especially provider sections and historical tables. No price, rating, favorite, or current-status inference occurs.
6. Click **Import selected**. Successful results show created/skipped/failed totals and resource IDs. Invalid entries roll back the batch, highlight the problematic entry, and retain your edits and selection. After an interrupted response, retry safely: existing URLs are skipped. Back to notebook closes the preview; it is not stored across navigation or reload.

Within-file and cross-file normalized duplicates are grouped with every source occurrence retained. Different paths, HTTP versus HTTPS, and meaningful queries stay distinct. Existing catalog matches default to Skip, and apply rechecks every normalized URL against current data. Imports never overwrite existing entries and never use the ordinary duplicate override. Imports serialize taxonomy resolution and acquire the same URL locks as normal saves, in sorted order. Each selected batch commits resources, associations, and only needed taxonomy together; duplicate-only runs create no taxonomy.

Limits: 20 files, 256 KiB each, 1 MiB total Markdown, 1000 HTTP(S) link occurrences, 4 MiB extracted preview text, 500 selected entries per batch, and 2 MiB JSON per import request. Existing resource text/name/tag limits also apply. Split large selections if the request limit is reached. Code, images, front matter, non-HTTP targets, raw HTML, and malformed/unresolved links are explained in Excluded content; raw HTML links are not extracted. No remote websites are fetched.

Suggestions live in [apps/api/src/import/mappings.ts](apps/api/src/import/mappings.ts). It contains filename/heading mappings and a short override list for the five sample names. Edit it and restart/rebuild the server to change defaults; group mappings and individual edits can always override them. Unknown files default to unmapped. Do not place personal source collections in the repository unnecessarily: choose them from any folder, such as `C:\Users\Kaj\Documents\Blog`. Samples were checked read-only from that folder; nothing from it was copied into the repository. The parser uses [remark-parse](https://github.com/remarkjs/remark/tree/main/packages/remark-parse), GFM tables/reference support, and frontmatter syntax support.

This feature needs updated server dependencies and builds, but no new database migration:

```sh
npm ci
npm run build -w @linksmith/api
npm run build -w @linksmith/web
npm start -w @linksmith/api
```

## Verification

Use the shared ESLint and Prettier commands below for source checks and formatting.

```sh
npm run check -w @linksmith/api
npm test -w @linksmith/api
npm run build -w @linksmith/api
npm run build -w @linksmith/web
```

Integration tests skip unless `TEST_DATABASE_URL` is explicitly set in the process environment. Tests do **not** load dotenv or use `DATABASE_URL`. Use a dedicated disposable database ending in `_test`; tests create a unique schema, migrate twice, run actual HTTP CRUD/filter/race checks, and drop only that schema.

```powershell
$env:TEST_DATABASE_URL = 'postgres://TEST_USER:CHANGE_ME@YOUR_TEST_HOST:5432/linksmith_test?sslmode=disable'
npm test -w @linksmith/api
```

```sh
TEST_DATABASE_URL='postgres://TEST_USER:CHANGE_ME@YOUR_TEST_HOST:5432/linksmith_test?sslmode=disable' npm test -w @linksmith/api
```

## Ubuntu example behind Caddy

This is an example; no live deployment is performed. Install Node, copy/build the project under `/opt/linksmith`, and install production server dependencies as above. Create an unprivileged `linksmith` service user and a root-owned `/etc/linksmith.env`, readable by the service group with mode 0640:

```ini
DATABASE_URL=postgres://linksmith:CHANGE_ME@YOUR_DATABASE_HOST:5432/linksmith?sslmode=disable
BIND_ADDR=127.0.0.1:8080
CLIENT_DIR=../web/dist
NODE_ENV=production
LOG_LEVEL=info
LOG_PRETTY=false
```

Example `/etc/systemd/system/linksmith.service` (adjust `/usr/bin/node` to your installation):

```ini
[Unit]
Description=Linksmith resource notebook
After=network.target

[Service]
User=linksmith
Group=linksmith
WorkingDirectory=/opt/linksmith
EnvironmentFile=/etc/linksmith.env
ExecStart=/usr/bin/node /opt/linksmith/apps/api/dist/index.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Before first start, apply migrations using the same environment:

```sh
sudo systemd-run --wait --pipe --collect --unit=linksmith-migrate \
  --property=User=linksmith --property=Group=linksmith \
  --property=WorkingDirectory=/opt/linksmith \
  --property=EnvironmentFile=/etc/linksmith.env \
  /usr/bin/node /opt/linksmith/apps/api/dist/migrate.js
sudo systemctl daemon-reload
sudo systemctl enable --now linksmith
sudo journalctl -u linksmith
```

Example Caddy block for a trusted LAN hostname and internal TLS:

```caddyfile
links.home.arpa {
    tls internal
    reverse_proxy 127.0.0.1:8080
}
```

Configure local DNS, trust Caddy's local CA on your devices, and restrict ingress to your trusted network. Use your existing PostgreSQL backup procedures.

## Linting and formatting

Linksmith uses root ESLint and Prettier configuration as a reference for DreamQuest standardization. Run these commands from the repository root:

```sh
npm run lint
npm run lint:fix
npm run format
npm run format:check
```

ESLint checks supported JavaScript and TypeScript files and treats warnings as failures. Prettier formats its supported source, configuration, and documentation files with single quotes, trailing commas, and LF line endings. Dependencies, generated builds and test output, local data, editor settings, archived artifacts, and dependency lockfiles are excluded. SQL and Nunjucks templates are outside the installed tools' supported file types.

## Resource Kind

Resource Kind describes form (such as Course or Tool), separately from subject
categories and tags. Create/edit resources with an optional Resource Kind, browse
with the secondary All kinds filter, and manage kinds using **Manage categories,
tags & kinds ? Resource Kinds**. Lower sort orders appear first. Archive/reactivate
kinds there; archived labels remain visible on existing resources. Kinds assigned
to resources cannot be deleted until those resources are reassigned.

Run `npm run migrate` before starting the upgraded app (or
`npm run migrate:production` from a compiled deployment). Migration
`003_resource_kinds.sql` creates the nullable relationship and seeds Tool,
Article, Tutorial, Course, Book, Video, Documentation, Curated List, and Community.
Existing resources remain unclassified. The migration runner records the seed once;
repeat migration runs preserve edits, ordering, archived state, and deletions.
There is no separate seed command.

Migration `004_resource_kind_descriptions.sql` adds optional Resource Kind descriptions. Edit descriptions in the Resource Kinds management tab. Run the normal migration command before starting the upgraded app.
