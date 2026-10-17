import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseMarkdown } from '../src/import/parser.js';

const parse = (text: string, name = 'test.md') =>
  parseMarkdown([{ name, text }]);
test('Markdown lists, references, emphasis, line breaks and parent context', () => {
  const preview = parse(
    '# Root\n- [Pino][p] - Very **low** overhead.\n  More details.\n  - [Child](https://child.example) - Child description\n\n[p]: https://getpino.io/#/\n',
  );
  assert.equal(preview.candidates.length, 2);
  assert.equal(preview.candidates[0].name, 'Pino');
  assert.equal(preview.candidates[0].url, 'https://getpino.io/#/');
  assert.equal(
    preview.candidates[0].description,
    'Very low overhead.\nMore details.',
  );
  assert.equal(preview.candidates[1].description, 'Child description');
  assert.match(preview.candidates[1].occurrences[0].parent, /Pino/);
  assert.deepEqual(preview.candidates[0].occurrences[0].headings, ['Root']);
  assert.equal(preview.candidates[0].occurrences[0].line, 2);
});
test('Ignored code, frontmatter, images, HTML and non-HTTP links are explained', () => {
  const preview = parse(
    '---\ntags: resources\nimageUrl: https://image.example\n---\n```md\n[Code](https://code.example)\n```\n`[Inline](https://inline.example)` ![Image](https://image.example) [Email](mailto:x@y.example)\n\n<a href="https://html.example">HTML</a>\n\n[Unresolved][missing]\n',
  );
  assert.equal(preview.candidates.length, 0);
  for (const reason of [
    'Front matter',
    'code',
    'inlineCode',
    'image',
    'Non-HTTP',
    'Raw HTML',
    'Malformed or unresolved',
  ])
    assert(
      preview.exclusions.some((exclusion) => exclusion.reason.includes(reason)),
      reason,
    );
});
test('Multiple links, misleading titles and joined list items require review', () => {
  for (const text of [
    '- [A](https://a.example) and [B](https://b.example)',
    '- [Rsmq](https://rsmq.example) - Queue server.- [Sarus](https://sarus.example) - WebSockets',
  ]) {
    const preview = parse(text);
    assert.equal(preview.candidates.length, 2);
    assert(
      preview.candidates.every(
        (candidate) =>
          !candidate.included &&
          candidate.description === '' &&
          candidate.warnings.length,
      ),
    );
  }
  assert.equal(
    parse('Watch [this talk](https://talk.example)').candidates[0].included,
    false,
  );
  const mixed = parse(
    '## Auth\n### Books\n- [Bun](https://bun.sh)',
    'node-resources.md',
  ).candidates[0];
  assert.equal(mixed.category, '');
  assert.equal(mixed.included, false);
});
test('Provider historical notes and tables are attributed only to a single primary', () => {
  const preview = parse(
    '## Lynda\n[Lynda](https://lynda.example) historical prose\n\n| Cost | Score |\n|---|---|\n| $399 | 5 |\n\n## Summary\nMulti-provider summary\n',
    'webdev-learning.md',
  );
  assert.match(preview.candidates[0].notes, /\$399/);
  assert(!preview.candidates[0].notes.includes('Multi-provider'));
  const ambiguous = parse(
    "## O'Reilly\n[Safari](https://safari.example) or [LinkedIn Learning](https://www.oreilly.com/online-learning/index.html)\n\n| Cost |\n|---|\n| $399 |",
    'webdev-learning.md',
  );
  assert(ambiguous.candidates.every((candidate) => !candidate.included));
  assert(
    ambiguous.candidates[1].warnings.some((warning) =>
      warning.includes('mismatch'),
    ),
  );
  assert.match(ambiguous.candidates[0].occurrences[0].excerpt, /\$399/);
});
test('Normalized duplicates retain every occurrence and conflicting descriptions', () => {
  const preview = parse(
    '- [Same](https://EXAMPLE.com#first) - First\n- [Same](https://example.com/#second) - Second\n- [Different path](https://example.com/docs)',
  );
  assert.equal(preview.candidates.length, 2);
  assert.equal(preview.files[0].occurrences, 3);
  assert.equal(preview.files[0].duplicates, 1);
  assert.deepEqual(
    preview.candidates[0].occurrences.map(
      (occurrence) => occurrence.description,
    ),
    ['First', 'Second'],
  );
  assert.equal(preview.candidates[0].included, false);
  assert.equal(preview.candidates[0].url, 'https://EXAMPLE.com#first');
  assert.throws(() => parseMarkdown([{ name: '../bad.md', text: '' }]));
  assert.equal(
    parse('- [Guide](https://guide.example)', 'unknown.md').candidates[0]
      .category,
    '',
  );
  assert.equal(
    parse('## constructor\n- [Tool](https://tool.example)', 'node-resources.md')
      .candidates[0].category,
    '',
  );
});
