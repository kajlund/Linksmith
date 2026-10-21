# DreamQuest repository conventions — Linksmith

Implemented reference as of 2026-10-21. These conventions describe Linksmith today. They are a starting point for reviewing the other seven DreamQuest applications, not a requirement to copy its architecture or directory layout.

## Required conventions in Linksmith

### Runtime and dependency management

- Use Node.js 24 LTS and npm. Root and workspace `engines.node` are `24.x`; root `.nvmrc` contains `24`. Engine declarations communicate support but do not enforce it unless the local npm configuration does so. Use your existing version manager; no particular manager is required.
- Run commands from the repository root. Use `npm ci` for reproducible installs from the single committed root `package-lock.json` (version 3). No workspace lockfiles or alternative package managers.
- Include development dependencies when building, including when NODE_ENV is production: `npm ci --include=dev`. Production uses compiled JavaScript and the existing production-only installation procedure in README.
- Change dependencies intentionally, commit manifest and lockfile changes together, and review audit results before selecting fixes. No automatic `npm audit fix` convention. Runtime packages belong in dependencies; build/test/type/lint tools belong in devDependencies. Lit is a browser runtime dependency even though Vite bundles it.
- Keep existing version specifications: most are exact, while concurrently and Vitest use caret ranges. This phase did not upgrade packages or change resolved dependency versions. No exact npm version is mandated yet.

### Organization and workspace boundaries

| Location                            | Responsibility                                                       |
| ----------------------------------- | -------------------------------------------------------------------- |
| `package.json`, `package-lock.json` | Private npm workspace root, shared tools and command entry points    |
| `apps/api`                          | Private ESM Hono API, configuration, Drizzle queries, server startup |
| `apps/api/src`                      | TypeScript application source                                        |
| `apps/api/test`                     | Vitest tests, including optional PostgreSQL integration tests        |
| `apps/api/migrations`               | Versioned SQL migrations; preserve applied files                     |
| `apps/web/src`, `apps/web/public`   | Lit application source and public assets                             |
| `scripts`                           | Repository tooling, including compiled-start smoke verification      |
| `docs`                              | API documentation, verification history, conventions                 |

Root workspaces remain `apps/*`. Each workspace owns its runtime and build dependencies; lint/format tools live at root. No shared package or directory reorganization was introduced. Keep business logic out of root tooling scripts.

### Standard commands

| Root command           | Actual behavior                                                        |
| ---------------------- | ---------------------------------------------------------------------- |
| `npm run dev`          | Run API tsx watcher and loopback-bound Vite client concurrently        |
| `npm run build`        | Type-check and bundle web, then compile API source to JavaScript       |
| `npm start`            | Start compiled API; serve built web assets from the same process       |
| `npm test`             | Run the API Vitest suite once; exits on test failures                  |
| `npm run lint`         | ESLint supported source/config files; zero warnings allowed            |
| `npm run format`       | Write Prettier formatting to supported, nonignored files               |
| `npm run format:check` | Check formatting without writing                                       |
| `npm run typecheck`    | Run required typecheck script in every workspace; missing scripts fail |
| `npm run check`        | Run typecheck, lint, then API tests in sequence; stop on first failure |

`check` does not build or rewrite files. Run build and format:check separately before submitting changes. `test` explicitly targets the workspace with real tests; there is no dummy web test script. Add a real suite to root test orchestration if another workspace gains tests. Workspace `check` remains a compatibility alias for its own `typecheck`; root `check` is the broader repository gate.

Existing useful commands remain: `dev:api`, `dev:web`, compatibility alias `dev:client`, `lint:fix`, `migrate`, `migrate:production`, and `verify:start`. Fix/format commands intentionally modify files; validation commands do not automatically apply fixes. Build generates ignored dist output.

### TypeScript

Retain the shared base because strict checking, ES2022, skipLibCheck, and interoperability settings are common. API uses NodeNext/ESM and `.js` relative imports in TypeScript source. Its normal config checks source and tests without emission; the build config emits source only into `apps/api/dist`, with source maps.

The browser overrides module resolution to bundler/ESNext and enables DOM libraries. It checks `src` without emitting JavaScript; Vite handles bundling into `apps/web/dist`. Keep `useDefineForClassFields: false` for the current Lit implementation. Build configuration files are not part of the web source typecheck. No broad compiler changes or application refactoring were needed.

Both workspaces declare TypeScript 7.0.2. Root typescript-eslint currently resolves a separate TypeScript 6 compiler within its peer range; do not override that range just to deduplicate. Lint is recommended syntax/rule validation, not a replacement for workspace type checking.

### Linting and formatting

Use the existing root ESLint flat configuration: recommended JavaScript and TypeScript rules, underscore-prefixed unused-variable exceptions, and eslint-config-prettier last. Node globals apply to API files, repository scripts, and tooling configs; browser globals apply to web source. Keep environment-specific globals scoped when adding files.

Use Prettier with single quotes, trailing commas, and LF. Generated output, dependencies, caches, verification artifacts, local data, and dependency lockfiles are excluded from formatting; SQL has no installed formatter. Do not introduce a second lint/format framework. Avoid repository-wide formatting churn during unrelated changes.

### Tests and verification

Vitest discovers `apps/api/test/**/*.test.ts`. Root test runs only that real suite. Unit tests do not require the production database. Integration tests require an explicit process `TEST_DATABASE_URL` pointing to a disposable database ending in `_test`; they isolate schemas and intentionally perform test database writes. Never substitute DATABASE_URL or a live catalog. A passing suite with skipped integration tests is not full database verification.

Run `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run check` when changing tooling. Root check deliberately repeats the relevant gates when run alongside the individual verification commands. `npm run verify:start` is an optional additional smoke check after building, using a dummy database URL; it is not a readiness check against a real database. Record unavailable checks and skipped tests explicitly.

### Hygiene and configuration

- Commit the root lockfile and `.env.example`. Do not commit actual `.env` files, connection credentials, private keys, or local database contents. Examples use placeholders; tests use local dummy credentials.
- Root dotenv loading is independent of working directory; service variables take precedence. Explicit ENV_FILE paths depend on process cwd. Keep the existing validation and precedence behavior.
- For development, copy `.env.example`, configure your database, and keep the default API port 8080 to match Vite's proxy. Production must override its development NODE_ENV: use `NODE_ENV=production` and `LOG_PRETTY=false` with production-only dependencies, since pino-pretty is development-only.
- Ignore node_modules, API/web dist, TypeScript build metadata, coverage, test reports, caches, temporary compilation, and verification artifacts. Preserve useful tracked documentation and editor configuration; no cleanup of historical evidence is required.
- Startup never runs migrations. Apply numbered migrations explicitly with the existing scripts and backups. Keep the compiled deployment layout and SQL migration directory described in README. The existing PowerShell deployment workflow and systemd architecture are unchanged; README's systemd examples now use the repository root as working directory.

## Development workflow

1. Select an installed Node 24 runtime, confirm `node --version` and `npm --version`, then run `npm ci` from root.
2. Copy `.env.example` to `.env` and configure the development database. Apply migrations explicitly with `npm run migrate` when needed.
3. Run `npm run dev`, or the API/web commands separately. No build is needed for the Vite development client.
4. Make focused changes. Run `npm run format` only with a reviewed scope of changes, or invoke the existing Prettier tool on the changed files to avoid unrelated rewrites.
5. Run `npm run check`, `npm run format:check`, and `npm run build`. Use a disposable test database when database integration verification is needed.
6. Review the diff, including generated/ignored status and lockfile changes. Follow the existing README deployment process; do not deploy as part of routine repository checks.

## Optional patterns and decisions for the other applications

The consistent root command names, honest validation gates, npm lockfile handling, supported Node baseline, secret handling, and explicit verification results are the reusable conventions. Adopt only commands that do real work. Apps without a frontend or TypeScript should not add dummy workspaces or checks to imitate Linksmith.

The `apps/api`/`apps/web` layout, shared TypeScript base, Hono/Lit stack, database choice, one-process static serving, test isolation strategy, and optional migration/smoke scripts are patterns to use only where relevant. Do not reorganize working applications or introduce cross-repository packages for visual consistency.

Before applying this reference elsewhere, decide whether to pin an npm version and Node patch, whether dependency declarations should consistently use exact pins or ranges, and whether formatting belongs in every application's aggregate check. Linksmith currently keeps format:check separate. Evaluate TypeScript/compiler-linter peer support individually, and distinguish existing browser tests from a missing suite rather than adding placeholders. `.nvmrc` support varies by version manager; engines remains the portable declaration.

## Phase 2A verification record

On 2026-10-21, Node initially reported no active runtime. A later invocation reported Node 24.22.0. No runtime installation, NVM trust change, dependency installation, package upgrade, migration, or deployment was performed by this work.

| Check                  | Result                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `npm run build`        | Passed: Vite web bundle and API TypeScript compilation                                |
| `npm run typecheck`    | Passed in both workspaces                                                             |
| `npm test`             | Passed: 5 files, 14 tests; 2 files/tests skipped without TEST_DATABASE_URL            |
| `npm run lint`         | Blocked before ESLint: NVM4306 delegated npm script trust error; same result on retry |
| `npm run check`        | Blocked before npm scripts: same NVM4306 error; same result on retry                  |
| `npm run format:check` | Not run; npm execution is blocked by NVM trust enforcement                            |

The NVM error says the delegated `npm-cli.js` is not trusted and suggests a trusted reinstall or `nvm reshim`. Resolving local version-manager trust is outside these repository changes; the security check was not bypassed. Lint and the aggregate check need to be rerun after the environment is repaired. Successful build/tests do not establish that lint passed.

A tracked-file credential-pattern review found only documented placeholders and local test/dummy connection URLs, with no apparent committed secrets. This is a scoped repository review, not a historical secret-scanning guarantee. Only package engine metadata was synchronized in the lockfile; dependency records were retained. The user's zero-vulnerability audit result is context, not a new security audit executed in this phase.
