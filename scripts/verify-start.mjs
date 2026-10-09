import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Accept a separate deployment directory to verify a production-only install.
const directory = resolve(process.argv[2] || '.');
const npm = process.env.npm_execpath;
assert(npm, 'Run this check with npm run verify:start');
const expectedHtml = await readFile(
  resolve(directory, 'apps/web/dist/index.html'),
  'utf8',
);

for (const clientDirectory of ['', '../web/dist', '../client/dist']) {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  const child = spawn(process.execPath, [npm, 'start'], {
    cwd: directory,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused_test',
      BIND_ADDR: `127.0.0.1:${port}`,
      CLIENT_DIR: clientDirectory,
      NODE_ENV: 'production',
      LOG_PRETTY: 'false',
      ENV_FILE: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  let spawnError;
  child.on('error', (error) => {
    spawnError = error;
  });
  child.stdout.on('data', (data) => {
    logs = (logs + data).slice(-4000);
  });
  child.stderr.on('data', (data) => {
    logs = (logs + data).slice(-4000);
  });
  const origin = `http://127.0.0.1:${port}`;
  try {
    let response;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, `npm start exited early:\n${logs}`);
      try {
        response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
        break;
      } catch {
        await delay(100);
      }
    }
    assert(response, `npm start did not listen:\n${logs}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), expectedHtml);
    const health = await fetch(`${origin}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: 'OK',
      message: 'Linksmith API is running',
    });
    const readiness = await fetch(`${origin}/api/health`);
    assert.equal(readiness.status, 503);
    assert.equal((await readiness.json()).error.code, 'not_ready');
    const route = await fetch(`${origin}/catalog/reading`);
    assert.equal(route.status, 200);
    assert.equal(await route.text(), expectedHtml);
    const assets = [
      ...expectedHtml.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g),
    ];
    assert(assets.length > 0, 'Built HTML should reference bundled assets');
    for (const [, asset] of assets) {
      const result = await fetch(`${origin}${asset}`);
      assert.equal(result.status, 200, asset);
      assert(!(result.headers.get('content-type') || '').includes('text/html'));
      await result.arrayBuffer();
    }
    const missing = await fetch(`${origin}/api/not-a-route`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'not_found');
    console.log(
      `npm start serves /health, built pages and assets: CLIENT_DIR=${clientDirectory || '(default)'}`,
    );
  } finally {
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill', [
        '/PID',
        String(child.pid),
        '/T',
        '/F',
      ]);
      assert.equal(
        result.status,
        0,
        'Could not stop the smoke-test process tree',
      );
    } else {
      // Stop npm and its workspace child together.
      process.kill(-child.pid, 'SIGTERM');
    }
  }
}
