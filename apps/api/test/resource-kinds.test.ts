import assert from 'node:assert/strict';
import { test } from 'vitest';
import { validateResource } from '../src/validation.js';
import { parseFilter } from '../src/catalog/query.js';
test('optional kinds and UUID validation', () => {
  assert.equal(
    validateResource({ url: 'https://example.com' }).input.kind_id,
    null,
  );
  assert.equal(
    validateResource({ url: 'https://example.com', kind_id: null }).input
      .kind_id,
    null,
  );
  assert.throws(() =>
    validateResource({ url: 'https://example.com', kind_id: 'bad' }),
  );
  const id = 'ABCDEF00-0000-4000-8000-000000000001';
  assert.equal(
    validateResource({ url: 'https://example.com', kind_id: id }).input.kind_id,
    id.toLowerCase(),
  );
  const filter = parseFilter(
    new URLSearchParams({ kind_id: id, category_id: id, q: 'testing' }),
  );
  assert.equal(filter.kind_id, id.toLowerCase());
  assert.equal(filter.category_id, id.toLowerCase());
  for (const q of [
    'kind_id=bad',
    'kind_id=',
    'kind_id=' + id + '&kind_id=' + id,
  ])
    assert.throws(() => parseFilter(new URLSearchParams(q)));
});
