import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/database.js';
import { applyMigrations } from '../src/db/migrations.js';

// No dotenv loading here: opt in via TEST_DATABASE_URL, never DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
test.skipIf(!url)(
  'PostgreSQL catalog CRUD, migration compatibility, filters, and concurrent duplicates',
  async () => {
    assert(url, 'TEST_DATABASE_URL must be set');
    const database = decodeURIComponent(new URL(url).pathname.slice(1));
    assert(
      database.endsWith('_test'),
      'Refusing database that does not end in _test',
    );
    const schema = `linksmith_test_${randomUUID().replaceAll('-', '')}`;
    const admin = createDatabase(url);
    let isolated: ReturnType<typeof createDatabase> | undefined;
    let server: ReturnType<typeof serve> | undefined;
    try {
      await admin.pool.query(`CREATE SCHEMA ${schema}`);
      isolated = createDatabase(url, { options: `-c search_path=${schema}` });
      await applyMigrations(isolated.db);
      await applyMigrations(isolated.db);
      const history = await isolated.pool.query(
        'SELECT version FROM schema_migrations ORDER BY version',
      );
      assert.deepEqual(history.rows, [
        { version: '001_catalog.sql' },
        { version: '002_uuid_ids.sql' },
        { version: '003_resource_kinds.sql' },
        { version: '004_resource_kind_descriptions.sql' },
      ]);
      // Verify direct SQL inserts receive UUID defaults and are readable by the API.
      const legacy = await isolated.pool.query(
        "INSERT INTO resources(url,normalized_url,domain,name) VALUES('https://legacy.example.com','https://legacy.example.com/','legacy.example.com','Existing catalog entry') RETURNING id",
      );
      const app = createApp(
        isolated.db,
        pino({ enabled: false }),
        fileURLToPath(new URL('../../web/dist', import.meta.url)),
      );
      const httpServer = serve({
        fetch: app.fetch,
        hostname: '127.0.0.1',
        port: 0,
      });
      server = httpServer;
      await new Promise<void>((resolve) => httpServer.on('listening', resolve));
      const address = server.address();
      assert(address && typeof address !== 'string');
      const base = `http://127.0.0.1:${address.port}/api`;
      async function request(
        method: string,
        path: string,
        body: unknown = undefined,
        status = 200,
      ) {
        const response = await fetch(base + path, {
          method,
          headers:
            body === undefined ? {} : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = response.status === 204 ? null : await response.json();
        assert.equal(
          response.status,
          status,
          `${method} ${path}: ${JSON.stringify(data)}`,
        );
        return data;
      }
      const legacyID = legacy.rows[0].id as string;
      const legacyRead = await request('GET', `/resources/${legacyID}`);
      assert.equal(legacyRead.kind_id, null);
      assert.equal(legacyRead.kind, null);
      await request('PUT', `/resources/${legacyID}`, {
        url: legacyRead.url,
        name: legacyRead.name,
      });
      const kinds = await request('GET', '/kinds');
      assert.equal(kinds.length, 9);
      const tool = kinds.find((k: { key: string }) => k.key === 'tool');
      await request('PUT', `/kinds/${tool.id}`, {
        name: 'My tool',
        sort_order: 3,
        archived: true,
      });
      await applyMigrations(isolated.db);
      const preservedKinds = await request('GET', '/kinds');
      assert.equal(preservedKinds.length, 9);
      assert.equal(
        preservedKinds.find((k: { id: string }) => k.id === tool.id).name,
        'My tool',
      );
      await request(
        'POST',
        '/resources',
        { url: 'https://kind-invalid.example', kind_id: tool.id },
        422,
      );
      await request('PUT', `/kinds/${tool.id}`, {
        name: 'Tool',
        sort_order: 10,
        archived: false,
      });
      await request('POST', '/kinds', { name: 'TOOL' }, 409);
      const customKind = await request(
        'POST',
        '/kinds',
        { name: 'Podcast', description: ' Audio episodes ', sort_order: 1 },
        201,
      );
      assert.equal(customKind.description, 'Audio episodes');
      const renamedKind = await request('PUT', `/kinds/${customKind.id}`, {
        name: 'Audio',
      });
      assert.equal(renamedKind.description, 'Audio episodes');
      await request('PUT', `/kinds/${customKind.id}`, {
        name: 'Audio',
        description: '',
      });
      assert.equal(
        (await request('GET', '/kinds')).find(
          (k: { id: string }) => k.id === customKind.id,
        ).description,
        '',
      );
      for (const description of ['x'.repeat(2001), 'bad\0text']) {
        await request('POST', '/kinds', { name: 'Invalid', description }, 422);
        await request(
          'PUT',
          `/kinds/${customKind.id}`,
          { name: 'Audio', description },
          422,
        );
      }
      await request('DELETE', `/kinds/${customKind.id}`, undefined, 204);
      for (const kind_id of ['bad', '00000000-0000-4000-8000-000000000099']) {
        await request(
          'POST',
          '/resources',
          { url: 'https://kind-invalid.example', kind_id },
          422,
        );
        await request(
          'PUT',
          `/resources/${legacyID}`,
          { url: legacyRead.url, kind_id },
          422,
        );
      }
      assert.equal(legacyRead.name, 'Existing catalog entry');
      assert.equal(typeof legacyRead.id, 'string');
      assert.equal('normalized_url' in legacyRead, false);
      await request(
        'POST',
        '/resources',
        { url: 'HTTPS://LEGACY.EXAMPLE.COM:443/#fragment' },
        409,
      );
      await request('DELETE', `/resources/${legacyID}`, undefined, 204);
      const root = await request(
        'POST',
        '/categories',
        { name: ' Development ' },
        201,
      );
      const child = await request(
        'POST',
        '/categories',
        { name: 'Libraries', parent_id: root.id },
        201,
      );
      const other = await request(
        'POST',
        '/categories',
        { name: 'Other' },
        201,
      );
      await request('POST', '/categories', { name: 'development' }, 409);
      await request(
        'POST',
        '/categories',
        { name: 'Third', parent_id: child.id },
        422,
      );
      await request(
        'PUT',
        `/categories/${root.id}`,
        { name: 'Development', parent_id: other.id },
        422,
      );
      await request(
        'PUT',
        `/categories/${root.id}`,
        { name: 'Development', parent_id: root.id },
        422,
      );
      await request('PUT', `/categories/${child.id}`, {
        name: 'Renamed',
        parent_id: other.id,
      });
      await request('PUT', `/categories/${child.id}`, {
        name: 'Libraries',
        parent_id: root.id,
      });
      const tagA = await request('POST', '/tags', { name: 'Open source' }, 201);
      const tagB = await request('POST', '/tags', { name: 'Go' }, 201);
      await request('PUT', `/tags/${tagB.id}`, { name: 'open SOURCE' }, 409);
      const input = {
        url: 'https://EXAMPLE.com:443/Docs?a=1#intro',
        name: 'Alpha',
        description: 'Safe <script> text',
        notes: 'Private',
        keywords: 'toolkit',
        kind_id: tool.id,
        category_id: child.id,
        favorite: true,
        tag_ids: [tagA.id, tagB.id],
      };
      const first = await request('POST', '/resources', input, 201);
      assert.equal(first.kind.name, 'Tool');
      await request('DELETE', `/kinds/${tool.id}`, undefined, 409);
      await request('PUT', `/kinds/${tool.id}`, {
        name: 'Tool archived',
        sort_order: 2,
        archived: true,
      });
      await request('PUT', `/resources/${first.id}`, input);
      assert.equal(
        (await request('GET', `/resources/${first.id}`)).kind.name,
        'Tool archived',
      );
      await request(
        'POST',
        '/resources',
        { url: 'https://archived.example', kind_id: tool.id },
        422,
      );
      await request('PUT', `/kinds/${tool.id}`, {
        name: 'Tool',
        sort_order: 10,
        archived: false,
      });
      assert.equal(first.url, input.url);
      assert.equal(first.domain, 'example.com');
      assert.equal(first.tags.length, 2);
      assert.equal(first.pricing, 'Unknown');
      await request(
        'POST',
        '/resources',
        { url: 'https://example.com/Docs?a=1#different' },
        409,
      );
      const second = await request(
        'POST',
        '/resources',
        { url: 'https://example.com/Docs?a=1', acknowledge_duplicate: true },
        201,
      );
      await request('PUT', `/resources/${first.id}`, input);
      await request('PUT', `/resources/${second.id}`, {
        url: 'https://example.com/Docs?a=1&extra=1',
      });
      await request('PUT', `/resources/${second.id}`, { url: input.url }, 409);
      await request('PUT', `/resources/${second.id}`, {
        url: input.url,
        acknowledge_duplicate: true,
      });
      async function matches(query: string, total: number) {
        assert.equal(
          (await request('GET', `/resources?${query}`)).total,
          total,
          query,
        );
      }
      await matches(
        `kind_id=${tool.id}&category_id=${root.id}&tag_id=${tagA.id}&q=Alpha`,
        1,
      );
      await matches(`kind_id=${tool.id}&inbox=true`, 0);
      await matches(
        `category_id=${root.id}&tag_id=${tagA.id}&tag_id=${tagB.id}&favorite=true&q=development`,
        1,
      );
      await matches('inbox=true', 1);
      await matches('q=toolkit', 1);
      await matches('q=open+source', 1);
      await matches('q=example.com', 2);
      await matches('q=private', 0);
      await matches('q=100%25', 0);
      await matches(`category_id=${root.id}&inbox=true`, 0);
      await request('GET', '/resources?sort=bad', undefined, 400);
      await request('GET', '/resources?tag_id=999999', undefined, 400);
      const page = await request('GET', '/resources?limit=1&page=2');
      assert.equal(page.items.length, 1);
      assert.equal(page.total, 2);
      await request('DELETE', `/categories/${root.id}`, undefined, 409);
      await request('DELETE', `/categories/${child.id}`, undefined, 409);
      await request(
        'PUT',
        `/resources/${first.id}`,
        {
          ...input,
          tag_ids: ['00000000-0000-4000-8000-000000000099'],
          name: 'should not persist',
        },
        422,
      );
      const after = await request('GET', `/resources/${first.id}`);
      assert.equal(after.name, 'Alpha');
      assert.equal(after.tags.length, 2);
      await request('PATCH', `/resources/${first.id}/favorite`, {
        favorite: false,
      });
      await matches('favorite=true', 0);
      await request('PATCH', `/resources/${first.id}/favorite`, {}, 422);
      await request('DELETE', `/tags/${tagA.id}`, undefined, 204);
      assert.equal(
        (await request('GET', `/resources/${first.id}`)).tags.length,
        1,
      );
      await request('DELETE', `/resources/${first.id}`, undefined, 204);
      await request('DELETE', `/resources/${first.id}`, undefined, 404);
      await request('DELETE', `/categories/${child.id}`, undefined, 204);
      await request('DELETE', `/categories/${root.id}`, undefined, 204);
      await request(
        'PUT',
        '/resources/00000000-0000-4000-8000-000000000099',
        { url: 'https://example.net' },
        404,
      );
      await request('GET', '/health');
      await request('GET', '/unknown', undefined, 404);
      const race = await Promise.all(
        [1, 2].map(() =>
          fetch(`${base}/resources`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"url":"https://race.example.com"}',
          }),
        ),
      );
      assert.deepEqual(
        race.map((response) => response.status).sort(),
        [201, 409],
      );
      await Promise.all(race.map((response) => response.arrayBuffer()));
      for (const [name, rating] of [
        ['Zebra', null],
        ['Beta', 5],
        ['Alpha', 5],
        ['Low', 1],
      ])
        await request(
          'POST',
          '/resources',
          { url: `https://sort.example.com/${name}`, name, rating },
          201,
        );
      const rated = await request(
        'GET',
        '/resources?q=sort.example.com&sort=rating',
      );
      assert.deepEqual(
        rated.items.map((r: { name: string }) => r.name),
        ['Alpha', 'Beta', 'Low', 'Zebra'],
      );
      assert.equal(rated.items[3].rating, null);
      const recent = await request(
        'GET',
        '/resources?q=sort.example.com&sort=recent',
      );
      assert.equal(recent.items[0].name, 'Low');
      assert.equal(recent.items[3].name, 'Zebra');

      const preview = await request('POST', '/import/preview', {
        files: [
          {
            name: 'batch.md',
            text: '- [Import A](https://import.example/a) - Existing notes\n- [Import B](https://import.example/b)',
          },
        ],
      });
      assert.equal(preview.candidates.length, 2);
      const entries = preview.candidates.map(
        (candidate: {
          id: string;
          name: string;
          url: string;
          description: string;
          notes: string;
        }) => ({
          ...candidate,
          reviewed: true,
          category: 'Import root/Import child',
          tags: ['Import tag'],
        }),
      );
      const imported = await request('POST', '/import/apply', { entries });
      assert.equal(imported.created, 2);
      assert.equal(imported.skipped, 0);
      const preserved = await request(
        'GET',
        `/resources/${imported.results[0].resourceId}`,
      );
      const rerun = await request('POST', '/import/apply', {
        entries: entries.map((entry: object) => ({
          ...entry,
          name: 'Must not overwrite',
          notes: 'Must not overwrite',
          category: 'Unused root/Unused child',
          tags: ['Unused tag'],
        })),
      });
      assert.equal(rerun.created, 0);
      assert.equal(rerun.skipped, 2);
      assert.deepEqual(
        await request('GET', `/resources/${imported.results[0].resourceId}`),
        preserved,
      );
      assert(
        !(await request('GET', '/categories')).some(
          (category: { name: string }) => category.name.startsWith('Unused'),
        ),
      );
      assert(
        !(await request('GET', '/tags')).some(
          (tag: { name: string }) => tag.name === 'Unused tag',
        ),
      );
      const existingPreview = await request('POST', '/import/preview', {
        files: [
          {
            name: 'again.md',
            text: '- [Again](https://import.example/a#fragment)',
          },
        ],
      });
      assert.equal(existingPreview.candidates[0].included, false);
      assert.equal(existingPreview.candidates[0].existing.length, 1);

      const beforeRollback = (await request('GET', '/resources')).total;
      await isolated.pool.query(
        "CREATE FUNCTION reject_import_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.url = 'https://rollback.example/two' THEN RAISE EXCEPTION 'Injected storage failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_import_test BEFORE INSERT ON resources FOR EACH ROW EXECUTE FUNCTION reject_import_test()",
      );
      const rollback = await request(
        'POST',
        '/import/apply',
        {
          entries: [
            {
              ...entries[0],
              id: 'rollback-one',
              url: 'https://rollback.example/one',
              category: 'Rollback root/Child',
              tags: ['Rollback tag'],
            },
            {
              ...entries[1],
              id: 'rollback-two',
              url: 'https://rollback.example/two',
              category: 'Rollback root/Child',
              tags: [],
            },
          ],
        },
        422,
      );
      assert.equal(rollback.error.entry_id, 'rollback-two');
      assert.equal(rollback.error.rolled_back, true);
      assert.equal((await request('GET', '/resources')).total, beforeRollback);
      assert(
        !(await request('GET', '/categories')).some(
          (category: { name: string }) => category.name === 'Rollback root',
        ),
      );
      assert(
        !(await request('GET', '/tags')).some(
          (tag: { name: string }) => tag.name === 'Rollback tag',
        ),
      );
      await isolated.pool.query(
        'DROP TRIGGER reject_import_test ON resources; DROP FUNCTION reject_import_test()',
      );
      const concurrentPayload = {
        entries: [
          {
            ...entries[0],
            id: 'concurrent-import',
            url: 'https://import-race.example',
          },
        ],
      };
      const concurrentImports = await Promise.all([
        request('POST', '/import/apply', concurrentPayload),
        request('POST', '/import/apply', concurrentPayload),
      ]);
      assert.equal(
        concurrentImports.reduce((total, result) => total + result.created, 0),
        1,
      );
      assert.equal(
        concurrentImports.reduce((total, result) => total + result.skipped, 0),
        1,
      );
      await request(
        'POST',
        '/import/apply',
        { entries: [{ ...entries[0], reviewed: false }] },
        422,
      );
      await request(
        'POST',
        '/import/preview',
        { files: [{ name: '../bad.md', text: '' }] },
        422,
      );
      await request(
        'POST',
        '/import/preview',
        { files: [{ name: 'large.md', text: 'x'.repeat(256 * 1024 + 1) }] },
        413,
      );

      const ci = await request('POST', '/import/apply', {
        entries: [
          {
            ...entries[0],
            id: 'ci-import',
            url: 'https://ci-import.example',
            category: 'Infrastructure/CI/CD',
          },
        ],
      });
      assert.equal(ci.created, 1);
      const ciEntry = await request(
        'GET',
        `/resources/${ci.results[0].resourceId}`,
      );
      assert.equal(ciEntry.category.name, 'CI/CD');
      const categoryCount = (await request('GET', '/categories')).length;
      await request('POST', '/import/apply', {
        entries: [
          {
            ...entries[0],
            id: 'ci-case',
            url: 'https://ci-case.example',
            category: 'infrastructure/ci/cd',
          },
        ],
      });
      assert.equal((await request('GET', '/categories')).length, categoryCount);
    } finally {
      const httpServer = server;
      if (httpServer)
        await new Promise<void>((resolve, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolve())),
        );
      if (isolated) await isolated.pool.end();
      await admin.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.pool.end();
    }
  },
  60_000,
);
