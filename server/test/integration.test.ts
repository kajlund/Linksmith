import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/database.js';
import { applyMigrations } from '../src/db/migrations.js';

// No dotenv loading here: opt in via TEST_DATABASE_URL, never DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
test('PostgreSQL catalog CRUD, migration compatibility, filters, and concurrent duplicates', {
  skip:
    !url &&
    'TEST_DATABASE_URL not set; use an isolated database ending in _test',
}, async () => {
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
    ]);
    // Verify direct SQL inserts receive UUID defaults and are readable by the API.
    const legacy = await isolated.pool.query(
      "INSERT INTO resources(url,normalized_url,domain,name) VALUES('https://legacy.example.com','https://legacy.example.com/','legacy.example.com','Existing catalog entry') RETURNING id",
    );
    const app = createApp(
      isolated.db,
      pino({ enabled: false }),
      fileURLToPath(new URL('../../client/dist', import.meta.url)),
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
    const other = await request('POST', '/categories', { name: 'Other' }, 201);
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
      category_id: child.id,
      favorite: true,
      tag_ids: [tagA.id, tagB.id],
    };
    const first = await request('POST', '/resources', input, 201);
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
});
