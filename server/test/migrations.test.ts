import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../src/db/database.js';
import { applyMigrations } from '../src/db/migrations.js';

const url = process.env.TEST_DATABASE_URL;
test('UUID upgrade preserves populated integer catalog, rolls back failures, and runs once', {
  skip: !url && 'TEST_DATABASE_URL not set',
}, async () => {
  assert(url, 'TEST_DATABASE_URL must be set');
  assert(decodeURIComponent(new URL(url).pathname.slice(1)).endsWith('_test'));
  const schema = `uuid_test_${randomUUID().replaceAll('-', '')}`;
  const admin = createDatabase(url);
  const directory = await mkdtemp(join(tmpdir(), 'linksmith-migrations-'));
  let isolated: ReturnType<typeof createDatabase> | undefined;
  try {
    await admin.pool.query(`CREATE SCHEMA ${schema}`);
    isolated = createDatabase(url, { options: `-c search_path=${schema}` });
    const pool = isolated.pool;
    const migrations = fileURLToPath(
      new URL('../migrations/', import.meta.url),
    );
    await copyFile(
      join(migrations, '001_catalog.sql'),
      join(directory, '001_catalog.sql'),
    );
    await applyMigrations(isolated.db, directory);
    await pool.query(
      "INSERT INTO categories(name) VALUES ('Root'), ('Empty'); INSERT INTO categories(name,parent_id) SELECT 'Child',id FROM categories WHERE name='Root'; INSERT INTO tags(name) VALUES ('One'), ('Two'), ('Unused')",
    );
    await pool.query(`INSERT INTO resources(url,normalized_url,domain,name,description,notes,keywords,rating,favorite,pricing,category_id,created_at,updated_at)
      SELECT 'https://example.com/#x','https://example.com/','example.com','Saved','Description ä','Private notes','keywords',5,true,'Paid',id,'2020-01-02T03:04:05Z','2021-02-03T04:05:06Z' FROM categories WHERE name='Child'`);
    await pool.query(
      "INSERT INTO resources(url,normalized_url,domain) VALUES ('https://inbox.example','https://inbox.example/','inbox.example'); INSERT INTO resource_tags SELECT r.id,t.id FROM resources r,tags t WHERE r.name='Saved' AND t.name IN ('One','Two')",
    );
    async function content() {
      return (
        await pool.query(`SELECT jsonb_build_object(
        'categories', (SELECT jsonb_agg(jsonb_build_object('name',c.name,'parent',p.name) ORDER BY c.name) FROM categories c LEFT JOIN categories p ON p.id=c.parent_id),
        'tags', (SELECT jsonb_agg(name ORDER BY name) FROM tags),
        'resources', (SELECT jsonb_agg((to_jsonb(r)-'id'-'category_id') || jsonb_build_object('category',c.name) ORDER BY r.url) FROM resources r LEFT JOIN categories c ON c.id=r.category_id),
        'associations', (SELECT jsonb_agg(jsonb_build_object('url',r.url,'tag',t.name) ORDER BY r.url,t.name) FROM resource_tags rt JOIN resources r ON r.id=rt.resource_id JOIN tags t ON t.id=rt.tag_id)) AS data`)
      ).rows[0].data;
    }
    const before = await content();
    await copyFile(
      join(migrations, '002_uuid_ids.sql'),
      join(directory, '002_uuid_ids.sql'),
    );
    await writeFile(
      join(directory, '003_fail.sql'),
      "DO $$ BEGIN RAISE EXCEPTION 'Intentional rollback test'; END $$;",
    );
    await assert.rejects(applyMigrations(isolated.db, directory));
    assert.equal(
      (
        await pool.query(
          'SELECT pg_typeof(id)::text AS type FROM resources LIMIT 1',
        )
      ).rows[0].type,
      'bigint',
    );
    assert.deepEqual(
      (await pool.query('SELECT version FROM schema_migrations')).rows,
      [{ version: '001_catalog.sql' }],
    );
    assert.deepEqual(await content(), before);
    await applyMigrations(isolated.db);
    assert.deepEqual(await content(), before);
    const ids = (
      await pool.query(
        'SELECT id FROM categories UNION ALL SELECT id FROM tags UNION ALL SELECT id FROM resources ORDER BY id',
      )
    ).rows;
    assert.equal(ids.length, 8);
    assert.equal(new Set(ids.map((row) => row.id)).size, 8);
    for (const row of ids)
      assert.match(
        row.id,
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
      );
    const columns = await pool.query(
      "SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND column_name IN ('id','parent_id','category_id','resource_id','tag_id') AND table_name != 'schema_migrations'",
      [schema],
    );
    assert.equal(columns.rows.length, 7);
    assert(columns.rows.every((row) => row.data_type === 'uuid'));
    await applyMigrations(isolated.db);
    assert.deepEqual(
      (
        await pool.query(
          'SELECT id FROM categories UNION ALL SELECT id FROM tags UNION ALL SELECT id FROM resources ORDER BY id',
        )
      ).rows,
      ids,
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO categories(name,parent_id) SELECT 'Third',id FROM categories WHERE name='Child'",
      ),
      { code: '23514' },
    );
    await assert.rejects(
      pool.query("INSERT INTO categories(name) VALUES ('root')"),
      { code: '23505' },
    );
    await assert.rejects(
      pool.query("DELETE FROM categories WHERE name='Child'"),
      (error: unknown) =>
        ['23503', '23001'].includes((error as { code: string }).code),
    );
    const added = await pool.query(
      "INSERT INTO tags(name) VALUES ('New UUID') RETURNING id",
    );
    assert.match(added.rows[0].id, /^[\da-f-]{36}$/);
    await pool.query("DELETE FROM tags WHERE name='One'");
    assert.equal(
      (await pool.query('SELECT count(*)::integer AS count FROM resource_tags'))
        .rows[0].count,
      1,
    );
  } finally {
    await isolated?.pool.end();
    await admin.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
