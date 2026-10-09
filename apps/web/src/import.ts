import { html, LitElement, nothing } from 'lit';
import {
  api,
  type Category,
  errorDetail,
  type Resource,
  type Tag,
} from './api';

interface Occurrence {
  file: string;
  line: number;
  endLine: number;
  headings: string[];
  parent: string;
  excerpt: string;
  description: string;
}
interface Candidate {
  id: string;
  name: string;
  url: string;
  description: string;
  notes: string;
  category: string;
  tags: string[];
  included: boolean;
  reviewed: boolean;
  warnings: string[];
  occurrences: Occurrence[];
  existing: { id: string; name: string; url: string }[];
}
interface Preview {
  candidates: Candidate[];
  exclusions: { file: string; line: number; reason: string; excerpt: string }[];
  files: {
    name: string;
    context: string;
    occurrences: number;
    candidates: number;
    duplicates: number;
    warnings: number;
    exclusions: number;
  }[];
}
interface Result {
  created: number;
  skipped: number;
  failed: number;
  results: { id: string; status: string; resourceId: string; name: string }[];
}

class MarkdownImport extends LitElement {
  static properties = Object.fromEntries(
    [
      'categories',
      'tags',
      'preview',
      'busy',
      'error',
      'result',
      'page',
      'filter',
      'group',
      'editing',
      'mappingCategory',
      'mappingTags',
      'failedEntry',
      'existingView',
    ].map((key) => [key, { state: key !== 'categories' && key !== 'tags' }]),
  );
  categories: Category[] = [];
  tags: Tag[] = [];
  preview: Preview | null = null;
  busy = false;
  error = '';
  result: Result | null = null;
  page = 1;
  filter = 'all';
  group = '';
  editing = '';
  mappingCategory = '';
  mappingTags = '';
  failedEntry = '';
  existingView: Resource | null = null;

  protected createRenderRoot() {
    return this;
  }

  private groupName(occurrence: Occurrence) {
    return `${occurrence.file} / ${occurrence.headings.join(' / ') || '(unheaded)'}`;
  }

  private filtered() {
    return (this.preview?.candidates ?? []).filter(
      (candidate) =>
        (!this.group ||
          candidate.occurrences.some(
            (occurrence) => this.groupName(occurrence) === this.group,
          )) &&
        (this.filter === 'all' ||
          (this.filter === 'warnings' && candidate.warnings.length > 0) ||
          (this.filter === 'duplicates' &&
            (candidate.occurrences.length > 1 ||
              candidate.existing.length > 0)) ||
          (this.filter === 'unmapped' && !candidate.category) ||
          (this.filter === 'selected' && candidate.included)),
    );
  }

  private updateCandidate(candidate: Candidate, changes: Partial<Candidate>) {
    if (!this.preview) return;
    this.preview = {
      ...this.preview,
      candidates: this.preview.candidates.map((item) =>
        item.id === candidate.id ? { ...item, ...changes } : item,
      ),
    };
  }

  private async chooseFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    if (!files.length || this.busy) return;
    this.error = '';
    if (
      files.length > 20 ||
      files.some(
        (file) => file.size > 256 * 1024 || !/\.md$/i.test(file.name),
      ) ||
      files.reduce((size, file) => size + file.size, 0) > 1024 * 1024
    ) {
      this.error = 'Choose up to 20 .md files: 256 KiB each, 1 MiB total.';
      input.value = '';
      return;
    }
    this.busy = true;
    try {
      const payload = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          text: await file.text(),
        })),
      );
      const preview = await api<Preview>('/import/preview', 'POST', {
        files: payload,
      });
      this.preview = preview;
      this.result = null;
      this.page = 1;
      this.group = '';
      this.filter = 'all';
      this.editing = '';
      this.failedEntry = '';
    } catch (error) {
      this.error = errorDetail(error).message;
    } finally {
      this.busy = false;
      input.value = '';
    }
  }

  private selectFiltered(include: boolean) {
    for (const candidate of this.filtered())
      if (!include || (candidate.reviewed && !candidate.existing.length))
        this.updateCandidate(candidate, { included: include });
  }

  private applyMapping() {
    const names = this.mappingTags
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    for (const candidate of this.filtered())
      this.updateCandidate(candidate, {
        category: this.mappingCategory.trim(),
        tags: [...new Set([...candidate.tags, ...names])],
      });
  }

  private makePrimary(candidate: Candidate) {
    const context = candidate.occurrences[0];
    const related = (this.preview?.candidates ?? []).filter(
      (item) =>
        item.id !== candidate.id &&
        item.occurrences.some(
          (occurrence) =>
            occurrence.file === context.file &&
            occurrence.excerpt === context.excerpt,
        ),
    );
    const notes = [
      ...new Set(
        [
          candidate.notes,
          context.excerpt,
          ...related.map((item) => `${item.name}: ${item.url}`),
        ].filter(Boolean),
      ),
    ].join('\n\n');
    this.updateCandidate(candidate, { notes, included: true, reviewed: true });
    for (const other of related)
      this.updateCandidate(other, { included: false });
  }

  private async apply() {
    if (this.busy || !this.preview) return;
    const selected = this.preview.candidates.filter(
      (candidate) => candidate.included,
    );
    if (
      !selected.length ||
      selected.length > 500 ||
      selected.some((candidate) => !candidate.reviewed)
    ) {
      this.error =
        'Select 1–500 reviewed entries. Check Include after reviewing warnings.';
      return;
    }
    this.busy = true;
    this.error = '';
    this.result = null;
    this.failedEntry = '';
    try {
      const entries = selected.map(
        ({ id, reviewed, name, url, description, notes, category, tags }) => ({
          id,
          reviewed,
          name,
          url,
          description,
          notes,
          category,
          tags,
        }),
      );
      const result = await api<Result>('/import/apply', 'POST', { entries });
      this.result = result;
      for (const candidate of selected)
        this.updateCandidate(candidate, { included: false });
      this.dispatchEvent(new CustomEvent('import-complete', { bubbles: true }));
    } catch (error) {
      const detail = errorDetail(error);
      this.failedEntry =
        (detail as typeof detail & { entry_id?: string }).entry_id ?? '';
      const rolledBack =
        (detail as typeof detail & { rolled_back?: boolean }).rolled_back ===
        true;
      if (rolledBack)
        this.result = {
          created: 0,
          skipped: 0,
          failed: selected.length,
          results: [],
        };
      this.error = `${rolledBack ? 'No entries imported; batch rolled back.' : 'Import did not return a successful result. Retry safely; existing URLs will be skipped.'} ${detail.message}${
        detail.fields
          ? ` (${Object.entries(detail.fields)
              .map(([field, message]) => `${field}: ${message}`)
              .join('; ')})`
          : ''
      }`;
      if (this.failedEntry) this.editing = this.failedEntry;
    } finally {
      this.busy = false;
    }
  }

  private async viewExisting(id: string) {
    try {
      this.existingView = await api<Resource>(`/resources/${id}`);
    } catch (error) {
      this.error = errorDetail(error).message;
    }
  }

  private categoryOptions() {
    return this.categories.map((category) => {
      const parent = this.categories.find(
        (item) => item.id === category.parent_id,
      );
      return parent ? `${parent.name}/${category.name}` : category.name;
    });
  }

  private editor(candidate: Candidate) {
    return html`<section class="import-editor" aria-label="Edit import candidate"><h2>Review entry</h2>
      <div class="two-columns"><label>Name<input .value=${candidate.name} maxlength="300" @input=${(event: Event) => this.updateCandidate(candidate, { name: (event.target as HTMLInputElement).value })}></label>
      <label>URL<input type="url" .value=${candidate.url} maxlength="4096" @input=${(event: Event) => this.updateCandidate(candidate, { url: (event.target as HTMLInputElement).value, existing: [] })}></label></div>
      <label>Description<textarea rows="3" maxlength="20000" .value=${candidate.description} @input=${(event: Event) => this.updateCandidate(candidate, { description: (event.target as HTMLTextAreaElement).value })}></textarea></label>
      <label>Notes<textarea rows="5" maxlength="50000" .value=${candidate.notes} @input=${(event: Event) => this.updateCandidate(candidate, { notes: (event.target as HTMLTextAreaElement).value })}></textarea></label>
      <div class="two-columns"><label>Category<input list="import-category-options" .value=${candidate.category} placeholder="Uncategorized, Root, or Root/Child" @input=${(event: Event) => this.updateCandidate(candidate, { category: (event.target as HTMLInputElement).value })}></label>
      <label>Tags (comma separated)<input list="import-tag-options" .value=${candidate.tags.join(', ')} @change=${(
        event: Event,
      ) =>
        this.updateCandidate(candidate, {
          tags: (event.target as HTMLInputElement).value
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        })}></label></div>
      ${candidate.warnings.map((warning) => html`<p class="import-warning">${warning}</p>`)}
      <div class="row"><label class="checkbox"><input type="checkbox" .checked=${candidate.included} @change=${(event: Event) => this.updateCandidate(candidate, { included: (event.target as HTMLInputElement).checked, reviewed: true })}>Include (I have reviewed this entry)</label>
      <button type="button" @click=${() => this.makePrimary(candidate)}>Use as primary; retain shared source and other URLs in notes</button><button type="button" @click=${() => {
        this.updateCandidate(candidate, { reviewed: true });
        this.editing = '';
      }}>Done reviewing</button></div>
      ${this.sources(candidate)}</section>`;
  }

  private sources(candidate: Candidate) {
    return html`<details><summary>Original source (${candidate.occurrences.length} occurrences)</summary>${candidate.occurrences.map((occurrence) => html`<p class="small">${occurrence.file}:${occurrence.line}–${occurrence.endLine} · ${occurrence.headings.join(' / ') || 'Unheaded'}</p>${occurrence.parent ? html`<p class="plain muted">Parent item: ${occurrence.parent}</p>` : nothing}<pre class="import-source">${occurrence.excerpt}</pre>${occurrence.description ? html`<p class="plain">Extracted description: ${occurrence.description}</p>` : nothing}`)}</details>`;
  }

  render() {
    const filtered = this.filtered();
    const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
    const page = Math.min(this.page, pageCount);
    const selected =
      this.preview?.candidates.filter((candidate) => candidate.included)
        .length ?? 0;
    const groups = [
      ...new Set(
        this.preview?.candidates.flatMap((candidate) =>
          candidate.occurrences.map((occurrence) => this.groupName(occurrence)),
        ) ?? [],
      ),
    ];
    const editing = this.preview?.candidates.find(
      (candidate) => candidate.id === this.editing,
    );
    const proposedCategories = [
      ...new Set(
        this.preview?.candidates
          .filter((candidate) => candidate.included)
          .flatMap((candidate) => {
            const separator = candidate.category.indexOf('/');
            return separator < 0
              ? [candidate.category]
              : [candidate.category.slice(0, separator), candidate.category];
          })
          .filter(
            (category) =>
              category &&
              !this.categoryOptions().some(
                (existing) => existing.toLowerCase() === category.toLowerCase(),
              ),
          ) ?? [],
      ),
    ];
    const proposedTags = [
      ...new Set(
        this.preview?.candidates
          .filter((candidate) => candidate.included)
          .flatMap((candidate) => candidate.tags)
          .filter(
            (tag) =>
              !this.tags.some(
                (existing) => existing.name.toLowerCase() === tag.toLowerCase(),
              ),
          ) ?? [],
      ),
    ];
    return html`<section class="markdown-import"><h1>Import Markdown</h1><p>Choose resource lists, review the preview, then import selected entries. Source files stay untouched. Files without resource links create no candidates.</p>
      <label>Markdown files<input type="file" accept=".md,text/markdown" multiple ?disabled=${this.busy} @change=${this.chooseFiles}></label><p class="muted small">20 files · 256 KiB per file · 1 MiB total · 1000 link occurrences · 500 entries per import</p>
      ${this.busy ? html`<p role="status">Working…</p>` : nothing}${this.error ? html`<p role="alert" class="error">${this.error}</p>` : nothing}
      ${this.result ? html`<section role="status" class="notice"><p>${this.result.created} created · ${this.result.skipped} skipped · ${this.result.failed} failed</p><details><summary>Import results</summary>${this.result.results.map((result) => html`<p>${result.status}: ${result.name} (${result.resourceId})</p>`)}</details></section>` : nothing}
      ${
        this.preview
          ? html`<fieldset ?disabled=${this.busy}>
        <details><summary>File counts and context</summary>${this.preview.files.map((file) => html`<p>${file.name}: ${file.occurrences} HTTP(S) occurrences · ${file.candidates} distinct candidates · ${file.duplicates} repeated occurrences · ${file.warnings} candidates with warnings · ${file.exclusions} exclusions</p><pre class="import-source">${file.context}</pre>`)}</details>
        <datalist id="import-category-options">${this.categoryOptions().map((category) => html`<option value=${category}></option>`)}</datalist><datalist id="import-tag-options">${this.tags.map((tag) => html`<option value=${tag.name}></option>`)}</datalist>
        <div class="two-columns"><label>Group<select aria-label="Group" .value=${this.group} @change=${(
          event: Event,
        ) => {
          this.group = (event.target as HTMLSelectElement).value;
          this.page = 1;
        }}><option value="">All groups</option>${groups.map((group) => html`<option value=${group}>${group} (${this.preview?.candidates.filter((candidate) => candidate.occurrences.some((occurrence) => this.groupName(occurrence) === group)).length})</option>`)}</select></label>
        <label>Show<select aria-label="Show" .value=${this.filter} @change=${(
          event: Event,
        ) => {
          this.filter = (event.target as HTMLSelectElement).value;
          this.page = 1;
        }}>${['all', 'warnings', 'duplicates', 'unmapped', 'selected'].map((filter) => html`<option value=${filter}>${filter}</option>`)}</select></label></div>
        <details><summary>Apply category and tags to all ${filtered.length} filtered entries (across pages)</summary><div class="two-columns"><label>Category<input list="import-category-options" .value=${this.mappingCategory} placeholder="Blank means intentionally uncategorized" @input=${(
          event: Event,
        ) => {
          this.mappingCategory = (event.target as HTMLInputElement).value;
        }}></label><label>Add tags (comma separated)<input list="import-tag-options" .value=${this.mappingTags} @input=${(
          event: Event,
        ) => {
          this.mappingTags = (event.target as HTMLInputElement).value;
        }}></label></div><button type="button" @click=${this.applyMapping}>Apply mapping to whole filtered group</button></details>
        <div class="row import-toolbar"><button type="button" @click=${() => this.selectFiltered(true)}>Select reviewed, nonexisting entries across filtered pages</button><button type="button" @click=${() => this.selectFiltered(false)}>Deselect all filtered entries across pages</button><span>${selected} selected overall · ${filtered.length} shown</span></div>
        ${
          this.existingView
            ? html`<section class="import-editor" aria-label="Existing resource"><h2>${this.existingView.name || this.existingView.domain}</h2><p class="plain">${this.existingView.url}</p><p class="plain">${this.existingView.description}</p><p class="plain">${this.existingView.notes}</p><p>Rating: ${this.existingView.rating ?? 'Unrated'} · Pricing: ${this.existingView.pricing} · Favorite: ${this.existingView.favorite ? 'yes' : 'no'} · Category: ${this.existingView.category?.name ?? 'Uncategorized'} · Tags: ${this.existingView.tags.map((tag) => tag.name).join(', ') || 'none'}</p><button type="button" @click=${() => {
                this.existingView = null;
              }}>Close existing resource</button></section>`
            : nothing
        }
        ${editing ? this.editor(editing) : nothing}
        ${filtered.slice((page - 1) * 25, page * 25).map(
          (
            candidate,
          ) => html`<article class="import-candidate ${candidate.id === this.failedEntry ? 'error' : ''}"><div class="row"><label class="checkbox"><input type="checkbox" .checked=${candidate.included} @change=${(event: Event) => this.updateCandidate(candidate, { included: (event.target as HTMLInputElement).checked, reviewed: true })}>Include ${candidate.name || '(untitled)'}</label><button type="button" @click=${() => {
            this.editing = candidate.id;
          }}>Review & edit</button></div><p class="plain small">${candidate.url}</p><p class="muted small">${candidate.category || 'Unmapped / uncategorized'} · Tags: ${candidate.tags.join(', ') || 'none'} · ${candidate.occurrences[0].file}:${candidate.occurrences[0].line}</p>
          ${candidate.warnings.length ? html`<p class="import-warning">${candidate.reviewed ? 'Reviewed' : 'Review required'}: ${candidate.warnings.join('; ')}</p>` : nothing}${candidate.occurrences.length > 1 ? html`<p>${candidate.occurrences.length} normalized duplicate occurrences grouped</p>` : nothing}
          ${candidate.existing.length ? html`<p>Already in catalog; default Skip. ${candidate.existing.map((match) => html`<a href=${match.url} target="_blank" rel="noopener noreferrer">${match.name || match.url}</a> (${match.id}) <button type="button" @click=${() => this.viewExisting(match.id)}>View existing ${match.name || match.url}</button>`)}</p>` : nothing}${this.sources(candidate)}</article>`,
        )}
        ${!filtered.length ? html`<p>No candidates match this filter.</p>` : nothing}
        <nav class="pagination" aria-label="Import pagination"><button type="button" ?disabled=${page <= 1} @click=${() => {
          this.page = page - 1;
        }}>Previous</button><span>Page ${page} of ${pageCount}</span><button type="button" ?disabled=${page >= pageCount} @click=${() => {
          this.page = page + 1;
        }}>Next</button></nav>
        <details><summary>Proposed new categories/tags for selected entries</summary><p>Categories: ${proposedCategories.join(', ') || 'none'}</p><p>Tags: ${proposedTags.join(', ') || 'none'}</p><p>Only needed categories/tags are created on import; duplicate entries create none.</p></details>
        <details><summary>Excluded content (${this.preview.exclusions.length})</summary>${this.preview.exclusions.map((exclusion) => html`<p>${exclusion.file}:${exclusion.line} — ${exclusion.reason}</p><pre class="import-source">${exclusion.excerpt}</pre>`)}</details>
        <p class="muted">Unmapped entries may stay uncategorized. Checking Include confirms review. Existing matches are skipped again by the server. Pricing stays Unknown, rating Unrated, favorite off.</p><button type="button" class="primary" ?disabled=${selected === 0 || selected > 500} @click=${this.apply}>Import selected (${selected})</button>
      </fieldset>`
          : nothing
      }</section>`;
  }
}
customElements.define('linksmith-import', MarkdownImport);
