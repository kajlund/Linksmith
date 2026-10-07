# Linksmith

A single-user resource notebook built with **Node.js, Hono, Drizzle ORM, PostgreSQL, Lit, and TypeScript**. Capture with only a URL, browse a two-level category tree, combine search and tag filters, and edit entries through a compact dialog.

Resources, categories, tags, ratings, favorites, pricing, private notes, and keywords are included. Imports, exports, authentication, metadata fetching, and dashboards remain outside this version. There is **no authentication**: keep access restricted to your trusted LAN behind your reverse proxy.

## Structure and prerequisites

- `server/src/index.ts`: Node HTTP server and graceful shutdown.
- `server/src/app.ts`, `routes.ts`: Hono middleware, API routes, and errors.
- `server/src/catalog`: Drizzle queries and catalog operations.
- `server/src/db/schema.ts`: typed Drizzle schema matching the existing database.
- `server/src/db/migrations.ts`, `server/migrations`: explicit SQL migration runner/files.
- `server/src/config.ts`, `logger.ts`: dotenv configuration and Pino logging.
- `server/test`: Node's built-in tests and optional PostgreSQL integration tests.
- `client/src`: existing Lit frontend, API types, and semantic theme tokens.
- [API contract](docs/API.md) and [verification record](docs/VERIFICATION.md).

Use **Node.js 22.12+** (Node 24 recommended), npm, and PostgreSQL **14+**. Docker and Go are not required. PostgreSQL can run on your home server; `psql` is useful for initial administration.

Versions checked against registries and pinned: Hono 4.13.13, `@hono/node-server` 2.1.3, Drizzle ORM 0.45.3, `pg` 8.23.1, dotenv 18.0.6, Pino 10.4.0, pino-pretty 13.2.0, tsx 4.23.15, and TypeScript 7.0.2. The client retains Lit 3.3.3 and Vite 8.3.3. Both directories have `package-lock.json`; use `npm ci` for reproducible installs.

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

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required | PostgreSQL connection URL |
| `BIND_ADDR` | `127.0.0.1:8080` | HTTP host:port; IPv6 uses `[::1]:8080` |
| `CLIENT_DIR` | `../client/dist` | Client build; relative paths resolve from `server/` |
| `ENV_FILE` | Repository-root `.env` | Alternative dotenv file |
| `NODE_ENV` | Development behavior | Set `production` for deployment |
| `LOG_LEVEL` | `info` | Pino level, e.g. debug/info/warn/error |
| `LOG_PRETTY` | true outside production, false in production | Optional true/false format override |
| `TEST_DATABASE_URL` | Optional, tests only | Disposable database ending in `_test` |

## Install and migrate

From the repository root, in PowerShell or Ubuntu:

```sh
npm ci --prefix server
npm ci --prefix client
npm run migrate --prefix server
```

Migrations apply unapplied SQL files in filename order inside one transaction, with a PostgreSQL advisory lock to serialize runs. Repeating the command is safe. Keep applied migrations unchanged and add a numbered file for schema changes. Back up before upgrades; there is no automatic down-migration.

## Upgrading an existing catalog to UUID IDs

Stop the server and make a PostgreSQL backup before running the upgrade. From the repository root:

```sh
npm run migrate --prefix server
npm run build --prefix server
npm run build --prefix client
npm start --prefix server
```

The migration locks the catalog tables and converts IDs atomically. A failure rolls back the upgrade; rerunning after success skips it and keeps the assigned UUIDs. Fresh databases apply both migrations. The existing npm migration script already discovers numbered SQL files; no additional script is needed. With compiled production code, use `npm run migrate:production --prefix server` after building the server.

IDs change once during this upgrade. Previously saved integer resource links and category/tag filter URLs no longer identify entries; reopen the app and clear old filters. External clients must send UUID strings. Imports/exports are not implemented by this migration. Start the updated server with the rebuilt client after migration; readiness requires the UUID migration.

## Development

Use two terminals from the repository root:

```sh
# Terminal 1: API with automatic restart and pretty logging
npm run dev --prefix server

# Terminal 2: Vite client
npm run dev --prefix client
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to `http://127.0.0.1:8080`; keep that address for development or update `client/vite.config.ts`. The API runs without a built frontend; direct requests for a missing client return a helpful 503.

Pino logs request ID, method, path, status, and duration. Request bodies, query strings, connection URLs, and private notes are not logged. Unexpected database failures record SQLSTATE/request context without exposing SQL/parameters to clients.

## Production

From the repository root:

```sh
npm run build --prefix client
npm run build --prefix server
npm start --prefix server
```

Open **http://127.0.0.1:8080**. Set `NODE_ENV=production` in your service environment or `.env` for JSON logging. pino-pretty is a development dependency, following [its production guidance](https://github.com/pinojs/pino-pretty); explicit pretty logging requires it to be installed.

One Node process serves the API and client under the same origin with [Hono's Node HTTP/static adapter](https://hono.dev/docs/getting-started/nodejs), preserving your reverse-proxy setup without a separate frontend process or CORS configuration. The adapter streams real files and handles HEAD requests. Extensionless client routes fall back to `index.html`; unknown API routes and missing assets return errors rather than HTML.

For production-only dependencies, deploy `server/dist`, `server/migrations`, the server package files, and `client/dist` in the same layout. Run `npm ci --omit=dev --prefix server`, set `NODE_ENV=production`, then `node server/dist/index.js`. Apply migrations separately with `node server/dist/migrate.js`. These compiled commands require no tsx, TypeScript, pino-pretty, or Go. SIGINT/SIGTERM close HTTP and database connections with a five-second shutdown deadline.

## First use

1. Use **Manage categories & tags** to create roots and children. Open source is a tag, independent of pricing.
2. Select a category and click **Add resource** to default the form to that category. Otherwise capture starts uncategorized; filtered tags are not inferred.
3. Enter a URL and save. Name falls back to the domain. Use tag suggestions or type a name and click **Add tag**. **Save & add another** clears entry content and keeps its category.
4. Combine categories, Inbox, Favorites, search, and tags. Selected tags use AND. Remove chips individually or **Clear filters**. Sort persists locally; filter/page state survives refresh in the URL.
5. Titles open links in a new tab. The separate chevron expands details and Edit/Delete; ordinary row text has no navigation action. The star toggles Favorite, restoring its previous state on failure.

Alphabetical display title is the default sort. Rating order puts unrated last; recently added sorts newest first. Parent categories include themselves and children. Pages default to **30 entries**, show totals, and expose Previous/Next. Search covers name, description, keywords, domain, category/ancestor names, and tags; private notes are excluded.

Duplicate detection trims the entered URL for storage and computes a conservative key: lower-case scheme/host, omit default ports, turn an empty root path into `/`, and ignore fragments. It preserves path case, dot segments, query content/order, trailing path slashes, and HTTP versus HTTPS. Valid ASCII path escapes are retained; literal Unicode/unsafe path characters use the previous server's canonical escaping so existing keys match. Credentials/whitespace in URLs are rejected. Warnings show existing entries and allow editing them or explicitly acknowledging another copy. Unchanged normalized URLs on edit do not warn again. The API enforces acknowledgment and serializes concurrent duplicate creates.

Deleting categories with children/resources is rejected; move/reassign them first. Deleting a tag removes associations after confirmation and keeps resources. Descriptions/notes render safely as plain text with line breaks. Light/dark themes follow the system initially and persist explicit choices.

## Verification

Run [Biome](https://biomejs.dev/reference/cli/) from the repository root to check formatting, lint rules, and imports across supported client/server source and configuration files:

```sh
npm ci
npm run biome
npm run biome:fix
```

`biome:fix` applies safe fixes. Generated builds, dependencies, lockfiles, and temporary verification tooling are excluded by `biome.json`; Git ignore rules are respected. SQL and Markdown are outside Biome's supported checks. Formatting/lint findings cause the check command to exit unsuccessfully until addressed.

```sh
npm run check --prefix server
npm test --prefix server
npm run build --prefix server
npm run build --prefix client
```

Integration tests skip unless `TEST_DATABASE_URL` is explicitly set in the process environment. Tests do **not** load dotenv or use `DATABASE_URL`. Use a dedicated disposable database ending in `_test`; tests create a unique schema, migrate twice, run actual HTTP CRUD/filter/race checks, and drop only that schema.

```powershell
$env:TEST_DATABASE_URL = 'postgres://TEST_USER:CHANGE_ME@YOUR_TEST_HOST:5432/linksmith_test?sslmode=disable'
npm test --prefix server
```

```sh
TEST_DATABASE_URL='postgres://TEST_USER:CHANGE_ME@YOUR_TEST_HOST:5432/linksmith_test?sslmode=disable' npm test --prefix server
```

## Ubuntu example behind Caddy

This is an example; no live deployment is performed. Install Node, copy/build the project under `/opt/linksmith`, and install production server dependencies as above. Create an unprivileged `linksmith` service user and a root-owned `/etc/linksmith.env`, readable by the service group with mode 0640:

```ini
DATABASE_URL=postgres://linksmith:CHANGE_ME@YOUR_DATABASE_HOST:5432/linksmith?sslmode=disable
BIND_ADDR=127.0.0.1:8080
CLIENT_DIR=../client/dist
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
WorkingDirectory=/opt/linksmith/server
EnvironmentFile=/etc/linksmith.env
ExecStart=/usr/bin/node /opt/linksmith/server/dist/index.js
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
  --property=WorkingDirectory=/opt/linksmith/server \
  --property=EnvironmentFile=/etc/linksmith.env \
  /usr/bin/node /opt/linksmith/server/dist/migrate.js
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
