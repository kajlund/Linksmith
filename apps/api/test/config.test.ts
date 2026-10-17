import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { defaultEnvFile, loadEnvironment, readConfig } from '../src/config.js';

test('dotenv loads explicitly selected files without overriding shell variables', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'linksmith-env-'));
  const keys = ['ENV_FILE', 'DATABASE_URL', 'BIND_ADDR'];
  const original = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  try {
    const file = join(dir, '.env');
    await writeFile(
      file,
      'DATABASE_URL=postgres://file:file@localhost/catalog\nBIND_ADDR=127.0.0.1:8090\n',
    );
    process.env.ENV_FILE = file;
    process.env.DATABASE_URL = 'postgres://shell:shell@localhost/catalog';
    delete process.env.BIND_ADDR;
    loadEnvironment();
    assert.equal(
      process.env.DATABASE_URL,
      'postgres://shell:shell@localhost/catalog',
    );
    assert.equal(readConfig().port, 8090);
    assert.equal(
      readConfig({
        DATABASE_URL: process.env.DATABASE_URL,
        NODE_ENV: 'production',
      }).pretty,
      false,
    );
    assert.equal(
      readConfig({
        DATABASE_URL: process.env.DATABASE_URL,
        BIND_ADDR: '[::1]:8080',
      }).hostname,
      '::1',
    );
    assert.throws(() => readConfig({ DATABASE_URL: 'bad' }));
    assert.throws(() =>
      readConfig({ DATABASE_URL: process.env.DATABASE_URL, BIND_ADDR: 'bad' }),
    );
    assert.throws(() =>
      readConfig({ DATABASE_URL: process.env.DATABASE_URL, LOG_PRETTY: 'yes' }),
    );
    process.env.ENV_FILE = join(dir, 'missing');
    assert.throws(loadEnvironment);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    await rm(dir, { recursive: true });
  }
});

test('workspace paths resolve the root environment and sibling web build', () => {
  assert.equal(
    defaultEnvFile,
    fileURLToPath(new URL('../../../.env', import.meta.url)),
  );
  assert.equal(
    readConfig({ DATABASE_URL: 'postgres://localhost/catalog' })
      .clientDirectory,
    fileURLToPath(new URL('../../web/dist', import.meta.url)),
  );
});

test('legacy frontend setting follows the move while custom paths stay explicit', () => {
  const database = { DATABASE_URL: 'postgres://localhost/catalog' };
  assert.equal(
    readConfig({ ...database, CLIENT_DIR: '../client/dist' }).clientDirectory,
    readConfig(database).clientDirectory,
  );
  assert.equal(
    readConfig({ ...database, CLIENT_DIR: '../custom/dist' }).clientDirectory,
    fileURLToPath(new URL('../../custom/dist', import.meta.url)),
  );
});
