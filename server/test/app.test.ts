import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/database.js';

test('production static serving and JSON errors cannot fall back to HTML', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'linksmith-static-'));
  const { db, pool } = createDatabase(
    'postgres://unused:unused@127.0.0.1:1/unused_test',
  );
  try {
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<html>Notebook</html>');
    await writeFile(join(dir, 'assets', 'app.js'), "console.log('app')");
    const app = createApp(db, pino({ enabled: false }), dir);
    for (const [path, status, type] of [
      ['/', 200, 'text/html'],
      ['/catalog/reading', 200, 'text/html'],
      ['/api/unknown', 404, 'application/json'],
      ['/api', 404, 'application/json'],
      ['/assets/missing.js', 404, 'text/plain'],
      ['/assets/missing', 404, 'text/plain'],
      ['/favicon.ico', 404, 'text/plain'],
      ['/assets/app.js', 200, 'javascript'],
    ] as const) {
      const response = await app.request(path);
      assert.equal(response.status, status, path);
      assert(response.headers.get('content-type')?.includes(type), path);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      await response.arrayBuffer();
    }
    const head = await app.request('/assets/app.js', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const unknown = await app.request('/api/not-a-route');
    assert.equal((await unknown.json()).error.code, 'not_found');
    for (const [body, status] of [
      [{ url: 'javascript:alert(1)' }, 422],
      [{ url: 'https://example.com', rating: 0 }, 422],
      [{ url: 'https://example.com', favorite: null }, 422],
      [{ url: 'https://example.com', unexpected: true }, 400],
      [{ url: 'https://example.com', rating: '3' }, 400],
      [{ url: 'https://example.com', notes: 'x'.repeat(140000) }, 413],
    ] as const) {
      const response = await app.request('/api/resources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, status);
      assert((await response.json()).error);
    }
    assert.equal(
      (await app.request('/api/resources', { method: 'POST', body: '{}' }))
        .status,
      415,
    );
    assert.equal((await app.request('/api/resources?sort=bad')).status, 400);
    assert.equal((await app.request('/api/resources/nope')).status, 400);
    assert.equal((await app.request('/api/health')).status, 503);
  } finally {
    await pool.end();
    await rm(dir, { recursive: true });
  }
});
