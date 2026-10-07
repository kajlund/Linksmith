# Verification record: Node server and UUID upgrade

Checked on 2026-10-07 on Windows using Node 24.17.0, npm 11.13.0, isolated PostgreSQL 18.4, and headless Chromium 153. No real catalog, home-server connection, or live deployment was used.

## Automated checks

- Biome formatting, import organization, and lint checks across 34 supported source/configuration files: no diagnostics. The hidden-attribute display override retains a documented local exception for its required `!important` declaration.
- Server TypeScript check and compiled production build.
- Node's built-in suite: URL normalization/rejection, category moves/depth, list parameter validation, dotenv loading/shell precedence, static serving/HEAD/client-route fallback, JSON errors, request/text/type limits, and unavailable-database readiness.
- PostgreSQL integration suite in a disposable `linksmith_test` database and unique schema: repeatable migrations/history, reading a direct SQL insert with a UUID default, matching its normalized duplicate key, resource/category/tag CRUD, case-insensitive names, category moves, cycle/third-level prevention, atomic failed saves, duplicate acknowledgment on create/edit, unchanged-URL edits, simultaneous duplicate creates, combined category/tag/favorite/search filtering, literal `%` search, pagination totals, rating/recent sort order, and deletion restrictions/cleanup.
- Populated legacy-schema migration test: preserves all resource fields and timestamps, root/child category relationships, nullable category references, unused taxonomy rows, and tag associations; verifies UUID column types/defaults, uniqueness/depth/delete constraints, failure rollback to integer IDs/history, and unchanged UUIDs after repeat runs. All seven server tests passed with PostgreSQL enabled.
- Client TypeScript check and Vite production build.
- Existing browser smoke suite against the production Node/Hono server: 35 seeded entries across pages, parent inclusion, tag AND, ancestor search/filter refresh, default category, inline tag creation, Save & add another clearing content, editing/clearing ratings, safe multiline text, duplicates/acknowledgment, favorite success/failure rollback, deletion confirmation/restrictions, tag rename, light/dark persistence, mobile navigation/editor/no horizontal overflow, and focus/Escape restoration. No JavaScript page errors.
- Node restart against the same isolated database, readiness 503 with an unavailable database, pretty development logs, JSON production logs, and startup from a different working directory.

Dependencies were pinned from registry versions. Installation reported zero npm vulnerabilities. Temporary PostgreSQL data/binaries and browser tooling remain in ignored `.verification/`; browser binaries use Playwright's normal user cache. Neither is an application dependency. No connected in-app browser was available, so browser checks used a dedicated headless browser.

The original SQL migration remains unchanged. Migration 002 converts IDs and foreign keys to UUIDs without resetting catalog data or switching the migration-history table. Server source and tests are TypeScript; Go is no longer required.

## Limits and manual checklist

Ubuntu/systemd/Caddy and PostgreSQL 14–17 were not executed here. The deployment example needs your hostnames, Node executable path, credentials, and network setup. Screen readers, touch keyboards, and non-Chromium browsers need a brief device check.

1. Stop the existing server and back up PostgreSQL. Copy `.env.example` to root `.env`, set your existing database URL, and remove old shell overrides if you want file values to win.
2. Install both packages, run the explicit migration command, build both, and start Node. Confirm `/api/health` is ready and your existing entries appear.
3. Add/edit a resource, acknowledge duplicates, move a category, combine filters, and traverse pages. Save & add another should clear content and retain category context.
4. Check both themes, mobile navigation/editor, keyboard focus/Escape, and new-tab links.
5. Restart the service and confirm persistence; keep the reverse proxy restricted to your trusted LAN.
