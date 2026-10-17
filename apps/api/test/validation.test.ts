import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseFilter } from '../src/catalog/query.js';
import { normalizeURL, validateCategoryMove } from '../src/validation.js';

test('URL keys match conservative normalization and retain meaningful parts', () => {
  for (const [input, key, domain] of [
    [' HTTPS://EXAMPLE.com:443#intro ', 'https://example.com/', 'example.com'],
    [
      'http://Example.com:80/Docs?q=A&q=b#x',
      'http://example.com/Docs?q=A&q=b',
      'example.com',
    ],
    ['http://[::1]:80', 'http://[::1]/', '::1'],
    [
      'https://example.com/a/../B?x=1&x=2',
      'https://example.com/a/../B?x=1&x=2',
      'example.com',
    ],
    [
      'https://example.com/@user?q=a@b',
      'https://example.com/@user?q=a@b',
      'example.com',
    ],
    [
      'https://example.com/%2f?q=%2F',
      'https://example.com/%2f?q=%2F',
      'example.com',
    ],
    ['https://example.com/ä', 'https://example.com/%C3%A4', 'example.com'],
    [
      'https://example.com/[docs]!%2f',
      'https://example.com/[docs]!%2f',
      'example.com',
    ],
    [
      'https://example.com/ä!%2f[docs]',
      'https://example.com/%C3%A4%21/%5Bdocs%5D',
      'example.com',
    ],
    ['https://Ö.example/', 'https://%C3%B6.example/', 'ö.example'],
    ['https://%C3%96.example/', 'https://%C3%B6.example/', 'ö.example'],
  ]) {
    const normalized = normalizeURL(input);
    assert.equal(normalized.normalized_url, key);
    assert.equal(normalized.domain, domain);
  }
  for (const bad of [
    '',
    '/path',
    'javascript:alert(1)',
    'ftp://example.com',
    'https://',
    'https://exa mple.com',
    'https://user:password@example.com',
    'https://example.com:99999',
    'https://example.com:0',
    'https://-bad.com',
    'https://example.com:',
    'https://[invalid]/',
    'https://example.com/\\x',
    'https://example.com/%ZZ',
  ])
    assert.throws(() => normalizeURL(bad), bad);
  assert.notEqual(
    normalizeURL('http://example.com').normalized_url,
    normalizeURL('https://example.com').normalized_url,
  );
  assert.notEqual(
    normalizeURL('https://example.com/Docs').normalized_url,
    normalizeURL('https://example.com/docs').normalized_url,
  );
});

test('category moves reject cycles and third levels, including roots with children', () => {
  const tree = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Root',
      parent_id: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Child',
      parent_id: '00000000-0000-4000-8000-000000000001',
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Other',
      parent_id: null,
    },
  ];
  for (const [id, parent] of [
    ['00000000-0000-4000-8000-000000000001', null],
    [
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ],
    ['00000000-0000-4000-8000-000000000002', null],
    [
      '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000001',
    ],
  ] as const)
    assert.doesNotThrow(() => validateCategoryMove(id, parent, tree));
  for (const [id, parent] of [
    [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003',
    ],
    [
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000002',
    ],
    [
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000002',
    ],
    [
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000099',
    ],
  ] as const)
    assert.throws(() => validateCategoryMove(id, parent, tree));
});

test('list filters combine and reject invalid scalar/repeated parameters', () => {
  const filter = parseFilter(
    new URLSearchParams(
      'category_id=00000000-0000-4000-8000-000000000007&tag_id=00000000-0000-4000-8000-000000000002&tag_id=00000000-0000-4000-8000-000000000003&favorite=true&inbox=true&q=100%25&sort=rating&page=2&limit=10',
    ),
  );
  assert.deepEqual(filter, {
    kind_id: undefined,
    category_id: '00000000-0000-4000-8000-000000000007',
    tag_ids: [
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ],
    favorite: true,
    inbox: true,
    q: '100%',
    sort: 'rating',
    page: 2,
    limit: 10,
  });
  for (const bad of [
    'sort=DROP+TABLE',
    'limit=101',
    'page=0',
    'favorite=yes',
    'tag_id=2&tag_id=2',
    'category_id=x',
    'surprise=true',
    'limit=',
    'q=a&q=b',
    'page=1.5',
    'category_id=9007199254740992',
  ])
    assert.throws(() => parseFilter(new URLSearchParams(bad)), bad);
});
