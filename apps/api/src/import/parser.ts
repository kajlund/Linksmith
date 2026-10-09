import { randomUUID } from 'node:crypto';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { APIError } from '../errors.js';
import { normalizeURL } from '../validation.js';
import { suggestMapping } from './mappings.js';
import {
  type Exclusion,
  type ImportCandidate,
  type ImportPreview,
  importLimits,
  type MarkdownFile,
} from './types.js';

interface Node {
  type: string;
  value?: string;
  url?: string;
  identifier?: string;
  depth?: number;
  children?: Node[];
  position?: {
    start: { line: number; offset?: number };
    end: { line: number; offset?: number };
  };
}
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml', 'toml']);

function plain(node: Node): string {
  if (['image', 'imageReference'].includes(node.type)) return '';
  if (node.type === 'break') return '\n';
  return node.value ?? node.children?.map(plain).join('') ?? '';
}

function walk(node: Node, visit: (node: Node) => void) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

export function parseMarkdown(files: MarkdownFile[]): ImportPreview {
  if (
    !Array.isArray(files) ||
    !files.length ||
    files.length > importLimits.files
  )
    throw new APIError(422, 'import_limits', 'Choose 1–20 Markdown files');
  let bytes = 0;
  let previewBytes = 0;
  if (new Set(files.map((file) => file?.name)).size !== files.length)
    throw new APIError(
      422,
      'import_file',
      'Choose files with distinct filenames',
    );
  const candidates: ImportCandidate[] = [];
  const exclusions: Exclusion[] = [];
  const reports: ImportPreview['files'] = [];
  for (const file of files) {
    if (
      !file ||
      typeof file.name !== 'string' ||
      typeof file.text !== 'string' ||
      !/\.md$/i.test(file.name) ||
      file.name.length > 200 ||
      /[\\/\0]/.test(file.name)
    )
      throw new APIError(
        422,
        'import_file',
        'Each file needs a plain .md filename and text',
      );
    const size = Buffer.byteLength(file.text);
    bytes += size;
    if (size > importLimits.fileBytes || bytes > importLimits.totalBytes)
      throw new APIError(
        413,
        'import_limits',
        'Maximum 256 KiB per file and 1 MiB total',
      );
    const root = parser.parse(file.text) as Node;
    const definitions = new Map<string, string>();
    walk(root, (node) => {
      if (node.type === 'definition' && node.identifier && node.url)
        definitions.set(node.identifier.toLowerCase(), node.url);
    });
    const headings: string[] = [];
    const headingNodes = (root.children ?? []).filter(
      (node) => node.type === 'heading',
    );
    const source = (node: Node) =>
      file.text.slice(
        node.position?.start.offset ?? 0,
        node.position?.end.offset ?? 0,
      );
    const linksIn = (node: Node) => {
      const links: Node[] = [];
      walk(node, (child) => {
        if (['link', 'linkReference'].includes(child.type)) links.push(child);
      });
      return links;
    };
    const sectionFor = (node: Node) => {
      const start = node.position?.start.offset ?? 0;
      const preceding = headingNodes.filter(
        (heading) => (heading.position?.start.offset ?? 0) < start,
      );
      const heading = preceding.at(-1);
      if (!heading) return undefined;
      const end =
        headingNodes.find((next) => (next.position?.start.offset ?? 0) > start)
          ?.position?.start.offset ?? file.text.length;
      return {
        text: file.text.slice(heading.position?.end.offset ?? 0, end).trim(),
        nodes: (root.children ?? []).filter(
          (child) =>
            (child.position?.start.offset ?? 0) >=
              (heading.position?.end.offset ?? 0) &&
            (child.position?.start.offset ?? 0) < end,
        ),
      };
    };
    let context = '';
    const first = candidates.length;
    const excludedStart = exclusions.length;
    function exclude(node: Node, reason: string) {
      exclusions.push({
        file: file.name,
        line: node.position?.start.line ?? 1,
        reason,
        excerpt: source(node),
      });
    }
    function process(node: Node, parent = '') {
      if (node.type === 'heading') {
        headings.length = (node.depth ?? 1) - 1;
        headings[(node.depth ?? 1) - 1] = plain(node);
      }
      if (['yaml', 'toml'].includes(node.type)) {
        context = node.value ?? '';
        exclude(node, 'Front matter is file context only');
        return;
      }
      if (
        ['code', 'inlineCode', 'image', 'imageReference', 'html'].includes(
          node.type,
        )
      ) {
        exclude(
          node,
          node.type === 'html'
            ? 'Raw HTML is not extracted; review source if it contains links'
            : `${node.type} is not a resource`,
        );
        return;
      }
      if (node.type === 'definition') return;
      if (['paragraph', 'heading', 'table'].includes(node.type)) {
        const links = linksIn(node);
        const shared = links.length > 1;
        const joined = /\.\s*-\s*\[/.test(source(node)) && shared;
        for (const link of links) {
          const url =
            link.url ?? definitions.get((link.identifier ?? '').toLowerCase());
          if (!url) {
            exclude(link, 'Unresolved reference link');
            continue;
          }
          if (!/^https?:/i.test(url)) {
            exclude(link, 'Non-HTTP/HTTPS target');
            continue;
          }
          const name = plain(link).trim();
          const mapping = suggestMapping(
            file.name.toLowerCase(),
            headings.filter(Boolean),
            name,
          );
          const warnings = [...mapping.warnings];
          try {
            normalizeURL(url);
          } catch (error) {
            warnings.push((error as Error).message);
          }
          if (shared)
            warnings.push(
              joined
                ? 'Joined list items: separate descriptions require review'
                : 'Multiple links share this source; keep separate or choose a primary',
            );
          const prefix = file.text
            .slice(
              node.position?.start.offset ?? 0,
              link.position?.start.offset ?? 0,
            )
            .trim();
          if (prefix || !name || ['heading', 'table'].includes(node.type))
            warnings.push('Link label may not be a standalone resource title');
          if (/oreilly\.com/i.test(url) && /linkedin/i.test(name))
            warnings.push(
              "Source label/URL mismatch: LinkedIn label points to O'Reilly",
            );
          let description = shared
            ? ''
            : plain(node)
                .replace(name, '')
                .replace(/^\s*[-–—:]\s*/, '')
                .trim();
          let notes = shared
            ? `Shared source (review attribution):\n${source(node)}`
            : '';
          if (file.name.toLowerCase() === 'webdev-learning.md') {
            const section = sectionFor(node);
            if (section) {
              const sectionLinks = section.nodes.flatMap(linksIn);
              if (sectionLinks.length === 1) {
                notes = section.text;
                description = '';
              } else
                warnings.push(
                  'Provider section has multiple URLs; assign historical notes to a primary after review',
                );
            }
          }
          if (
            description.length > 20000 ||
            notes.length > 50000 ||
            name.length > 300
          )
            warnings.push(
              'Content exceeds resource limits; shorten it before importing',
            );
          const excerpt =
            file.name.toLowerCase() === 'webdev-learning.md'
              ? (sectionFor(node)?.text ?? source(node))
              : source(node);
          previewBytes += Buffer.byteLength(
            name + url + description + notes + excerpt + parent,
          );
          if (previewBytes > importLimits.previewBytes)
            throw new APIError(
              413,
              'import_limits',
              'Extracted preview text exceeds 4 MiB; choose fewer files or split dense blocks',
            );
          candidates.push({
            id: randomUUID(),
            name,
            url,
            description,
            notes,
            category: mapping.category,
            tags: mapping.tags,
            warnings: [...new Set(warnings)],
            included: warnings.length === 0,
            reviewed: warnings.length === 0,
            existing: [],
            occurrences: [
              {
                file: file.name,
                line: link.position?.start.line ?? 1,
                endLine: node.position?.end.line ?? 1,
                headings: headings.filter(Boolean),
                parent,
                excerpt,
                description,
              },
            ],
          });
          if (candidates.length > importLimits.candidates)
            throw new APIError(
              422,
              'import_limits',
              'Maximum 1000 HTTP/HTTPS link occurrences per preview',
            );
        }
        // Explain excluded inline code/images and unresolved Markdown-looking text.
        walk(node, (child) => {
          if (
            ['inlineCode', 'image', 'imageReference', 'html'].includes(
              child.type,
            )
          )
            exclude(
              child,
              child.type === 'html'
                ? 'Raw HTML is not extracted; review source if it contains links'
                : `${child.type} is not a resource`,
            );
          if (
            child.type === 'text' &&
            /\[[^\]]+\](?:\([^)]*|\[[^\]]*\])/.test(child.value ?? '')
          )
            exclude(
              child,
              'Malformed or unresolved Markdown link; inspect source',
            );
        });
        return;
      }
      if (node.type === 'listItem') {
        const own = (node.children ?? [])
          .filter((child) => child.type !== 'list')
          .map(plain)
          .join('\n');
        for (const child of node.children ?? [])
          process(child, child.type === 'list' ? own : parent);
      } else for (const child of node.children ?? []) process(child, parent);
    }
    process(root);
    reports.push({
      name: file.name,
      context,
      occurrences: candidates.length - first,
      candidates: 0,
      duplicates: 0,
      warnings: 0,
      exclusions: exclusions.length - excludedStart,
    });
  }
  const grouped = new Map<string, ImportCandidate>();
  for (const candidate of candidates) {
    let key = candidate.url;
    try {
      key = normalizeURL(candidate.url).normalized_url;
    } catch {
      /* Invalid URLs stay visible for review. */
    }
    const previous = grouped.get(key);
    if (!previous) {
      grouped.set(key, candidate);
      continue;
    }
    previous.occurrences.push(...candidate.occurrences);
    previous.warnings = [
      ...new Set([...previous.warnings, ...candidate.warnings]),
    ];
    if (
      previous.category !== candidate.category ||
      previous.tags.join() !== candidate.tags.join()
    )
      previous.warnings.push(
        'Duplicate occurrences have conflicting mappings; review',
      );
    if (
      previous.description !== candidate.description ||
      previous.name !== candidate.name ||
      previous.notes !== candidate.notes
    )
      previous.warnings.push(
        'Duplicate occurrences have alternative titles/descriptions/notes; inspect sources',
      );
    if (candidate.notes && !previous.notes.includes(candidate.notes))
      previous.notes = [previous.notes, candidate.notes]
        .filter(Boolean)
        .join('\n\n');
    if (previous.warnings.length) {
      previous.included = false;
      previous.reviewed = false;
    }
  }
  const distinct = [...grouped.values()];
  for (const report of reports) {
    const relevant = distinct.filter((candidate) =>
      candidate.occurrences.some(
        (occurrence) => occurrence.file === report.name,
      ),
    );
    report.candidates = relevant.length;
    report.duplicates = report.occurrences - relevant.length;
    report.warnings = relevant.filter(
      (candidate) => candidate.warnings.length,
    ).length;
  }
  return {
    candidates: distinct,
    exclusions,
    files: reports,
    limits: importLimits,
  };
}
