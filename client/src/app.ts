import { html, LitElement, nothing, svg } from 'lit';
import {
  api,
  type Category,
  type ErrorDetail,
  errorDetail,
  type Page,
  type Resource,
  type ResourceInput,
  type Tag,
} from './api';
import './style.css';

const paths: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  search: 'm21 21-4.5-4.5M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
  chevron: 'm9 5 7 7-7 7',
  close: 'm6 6 12 12M6 18 18 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  book: 'M4 3h13a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3Zm0 14h16M8 3v14',
  moon: 'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10',
  edit: 'm16 3 5 5-13 13H3v-5ZM14 5l5 5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  inbox: 'M4 3h16l2 12v6H2v-6ZM2 15h6l2 3h4l2-3h6',
};

const icon = (name: string) =>
  svg`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${paths[name] ?? paths.book}/></svg>`;

function stored(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

const blank = (category: string | null): ResourceInput => ({
  url: '',
  name: '',
  description: '',
  notes: '',
  keywords: '',
  rating: null,
  favorite: false,
  pricing: 'Unknown',
  category_id: category,
  tag_ids: [],
  acknowledge_duplicate: false,
});

class LinksmithApp extends LitElement {
  static properties = Object.fromEntries(
    [
      'categories',
      'tags',
      'items',
      'total',
      'loading',
      'listError',
      'notice',
      'query',
      'category',
      'favorite',
      'inbox',
      'selectedTags',
      'sort',
      'page',
      'expanded',
      'pendingFavorites',
      'form',
      'editing',
      'formError',
      'saving',
      'tagText',
      'managerType',
      'managerID',
      'managerName',
      'managerParent',
      'managerError',
      'managing',
      'confirmation',
      'deleting',
      'deleteError',
      'theme',
    ].map((k) => [k, { state: true }]),
  );

  categories: Category[] = [];
  tags: Tag[] = [];
  items: Resource[] = [];
  total = 0;

  loading = true;
  listError = '';
  notice = '';
  query = '';
  category: string | null = null;
  favorite = false;
  inbox = false;
  selectedTags: string[] = [];
  sort = 'title';
  page = 1;

  expanded = new Set<string>();
  pendingFavorites = new Set<string>();

  form = blank(null);
  editing: string | null = null;
  formError: ErrorDetail | null = null;
  saving = false;
  tagText = '';

  managerType: 'categories' | 'tags' = 'categories';
  managerID: string | null = null;
  managerName = '';
  managerParent: string | null = null;
  managerError = '';
  managing = false;

  confirmation: {
    kind: 'resources' | 'categories' | 'tags';
    id: string;
    name: string;
  } | null = null;
  deleting = false;
  deleteError = '';

  theme = stored('linksmith.theme', 'system');

  private sequence = 0;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private popstate = () => {
    this.readLocation();
    void this.load();
  };

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.readLocation();
    window.addEventListener('popstate', this.popstate);
    void this.initialize();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('popstate', this.popstate);
    clearTimeout(this.searchTimer);
  }

  private readLocation() {
    const p = new URLSearchParams(location.search);
    this.query = p.get('q') ?? '';
    this.category = p.get('category_id')?.toLowerCase() ?? null;
    this.favorite = p.get('favorite') === 'true';
    this.inbox = p.get('inbox') === 'true';
    this.selectedTags = p.getAll('tag_id').map((id) => id.toLowerCase());
    const sort = p.get('sort') ?? stored('linksmith.sort', 'title');
    this.sort = ['title', 'rating', 'recent'].includes(sort) ? sort : 'title';
    this.page = Math.max(1, Number(p.get('page')) || 1);
  }

  private params() {
    const p = new URLSearchParams();
    if (this.query.trim()) p.set('q', this.query.trim());
    if (this.category !== null) p.set('category_id', String(this.category));
    if (this.favorite) p.set('favorite', 'true');
    if (this.inbox) p.set('inbox', 'true');
    for (const id of this.selectedTags) p.append('tag_id', id);
    p.set('sort', this.sort);
    p.set('page', String(this.page));
    return p;
  }

  private async initialize() {
    try {
      await this.taxonomy();
      await this.load();
    } catch (e) {
      this.loading = false;
      this.listError = errorDetail(e).message;
    }
  }

  private async taxonomy() {
    const [categories, tags] = await Promise.all([
      api<Category[]>('/categories'),
      api<Tag[]>('/tags'),
    ]);
    this.categories = categories;
    this.tags = tags;
  }

  private async load() {
    const seq = ++this.sequence;
    this.loading = true;
    this.listError = '';
    history.replaceState(null, '', `${location.pathname}?${this.params()}`);
    try {
      const data = await api<Page>(`/resources?${this.params()}`);
      if (seq !== this.sequence) return;
      if (this.page > 1 && data.items.length === 0) {
        this.page = Math.max(1, Math.ceil(data.total / data.limit));
        await this.load();
        return;
      }
      this.items = data.items;
      this.total = data.total;
    } catch (e) {
      if (seq === this.sequence) this.listError = errorDetail(e).message;
    } finally {
      if (seq === this.sequence) this.loading = false;
    }
  }

  private applyFilters(change: () => void) {
    clearTimeout(this.searchTimer);
    change();
    this.page = 1;
    void this.load();
  }

  private clear() {
    this.applyFilters(() => {
      this.query = '';
      this.category = null;
      this.favorite = false;
      this.inbox = false;
      this.selectedTags = [];
    });
  }

  private categoryLabel(id: string | null): string {
    const c = this.categories.find((c) => c.id === id);
    if (!c) return id === null ? 'Uncategorized' : 'Deleted category';
    const parent = this.categories.find((p) => p.id === c.parent_id);
    return parent ? `${parent.name} / ${c.name}` : c.name;
  }

  private async show(id: string) {
    await this.updateComplete;
    const dialog = this.querySelector<HTMLDialogElement>(`#${id}`);
    if (!dialog) throw new Error(`Missing dialog: ${id}`);
    dialog.showModal();
    const focus = dialog.querySelector<HTMLElement>('[autofocus]');
    focus?.focus();
  }

  private close(id: string) {
    if (this.saving || this.managing || this.deleting) return;
    this.querySelector<HTMLDialogElement>(`#${id}`)?.close();
  }

  private cancel(e: Event) {
    if (this.saving || this.managing || this.deleting) e.preventDefault();
  }

  private openForm(resource?: Resource) {
    this.editing = resource?.id ?? null;
    this.form = resource
      ? {
          url: resource.url,
          name: resource.name,
          description: resource.description,
          notes: resource.notes,
          keywords: resource.keywords,
          rating: resource.rating,
          favorite: resource.favorite,
          pricing: resource.pricing,
          category_id: resource.category_id,
          tag_ids: [...resource.tag_ids],
          acknowledge_duplicate: false,
        }
      : blank(this.category);
    this.formError = null;
    this.tagText = '';
    void this.show('resource-dialog');
  }

  private setForm<K extends keyof ResourceInput>(
    key: K,
    value: ResourceInput[K],
  ) {
    this.form = {
      ...this.form,
      [key]: value,
      ...(key === 'url' ? { acknowledge_duplicate: false } : {}),
    };
    if (key === 'url') this.formError = null;
  }

  private async save(another: boolean) {
    if (this.saving) return;
    this.saving = true;
    this.formError = null;
    try {
      const item = await api<Resource>(
        this.editing ? `/resources/${this.editing}` : '/resources',
        this.editing ? 'PUT' : 'POST',
        this.form,
      );
      this.notice = `${item.name || item.domain} saved.`;
      await this.load();
      if (another) {
        this.editing = null;
        this.form = blank(this.form.category_id);
        this.tagText = '';
        await this.updateComplete;
        this.querySelector<HTMLInputElement>('#resource-url')?.focus();
      } else this.querySelector<HTMLDialogElement>('#resource-dialog')?.close();
    } catch (e) {
      this.formError = errorDetail(e);
    } finally {
      this.saving = false;
    }
  }

  private async addFormTag() {
    const name = this.tagText.trim();
    if (!name || this.saving) return;
    const existing = this.tags.find(
      (t) => t.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (existing) {
      this.setForm('tag_ids', [
        ...new Set([...this.form.tag_ids, existing.id]),
      ]);
      this.tagText = '';
      return;
    }
    this.saving = true;
    try {
      const tag = await api<Tag>('/tags', 'POST', { name });
      this.tags = [...this.tags, tag].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      this.setForm('tag_ids', [...this.form.tag_ids, tag.id]);
      this.tagText = '';
      this.formError = null;
    } catch (e) {
      this.formError = errorDetail(e);
    } finally {
      this.saving = false;
    }
  }

  private async toggleFavorite(item: Resource) {
    if (this.pendingFavorites.has(item.id)) return;
    const original = item.favorite;
    this.pendingFavorites = new Set([...this.pendingFavorites, item.id]);
    this.items = this.items.map((r) =>
      r.id === item.id ? { ...r, favorite: !original } : r,
    );
    try {
      await api(`/resources/${item.id}/favorite`, 'PATCH', {
        favorite: !original,
      });
      if (this.favorite) await this.load();
    } catch (e) {
      this.items = this.items.map((r) =>
        r.id === item.id ? { ...r, favorite: original } : r,
      );
      this.notice = errorDetail(e).message;
    } finally {
      this.pendingFavorites = new Set(
        [...this.pendingFavorites].filter((id) => id !== item.id),
      );
    }
  }

  private async existingEdit(resource: Resource) {
    try {
      const current = await api<Resource>(`/resources/${resource.id}`);
      this.openForm(current);
    } catch (e) {
      this.formError = errorDetail(e);
    }
  }

  private openManager() {
    this.managerError = '';
    this.selectManaged(null);
    void this.show('manage-dialog');
  }

  private selectManaged(id: string | null) {
    this.managerID = id;
    const item = (
      this.managerType === 'categories' ? this.categories : this.tags
    ).find((i) => i.id === id);
    this.managerName = item?.name ?? '';
    this.managerParent =
      this.categories.find((c) => c.id === id)?.parent_id ?? null;
    this.managerError = '';
  }

  private async saveManaged(e: Event) {
    e.preventDefault();
    if (this.managing) return;
    this.managing = true;
    this.managerError = '';
    try {
      await api(
        `/${this.managerType}${this.managerID ? `/${this.managerID}` : ''}`,
        this.managerID ? 'PUT' : 'POST',
        {
          name: this.managerName,
          ...(this.managerType === 'categories'
            ? { parent_id: this.managerParent }
            : {}),
        },
      );
      await this.taxonomy();
      await this.load();
      this.selectManaged(null);
    } catch (e) {
      const detail = errorDetail(e);
      this.managerError =
        Object.values(detail.fields ?? {}).join(' ') || detail.message;
    } finally {
      this.managing = false;
    }
  }

  private confirm(
    kind: 'resources' | 'categories' | 'tags',
    id: string,
    name: string,
  ) {
    this.confirmation = { kind, id, name };
    this.deleteError = '';
    void this.show('delete-dialog');
  }

  private async deleteConfirmed() {
    if (!this.confirmation || this.deleting) return;
    const item = this.confirmation;
    this.deleting = true;
    this.deleteError = '';
    try {
      await api(`/${item.kind}/${item.id}`, 'DELETE');
      this.querySelector<HTMLDialogElement>('#delete-dialog')?.close();
      if (item.kind !== 'resources') {
        await this.taxonomy();
        if (item.kind === 'categories' && this.category === item.id)
          this.category = null;
        if (item.kind === 'tags')
          this.selectedTags = this.selectedTags.filter((id) => id !== item.id);
        this.selectManaged(null);
      }
      await this.load();
      this.notice = `${item.name} deleted.`;
    } catch (e) {
      this.deleteError = errorDetail(e).message;
    } finally {
      this.deleting = false;
    }
  }

  private setTheme(e: Event) {
    this.theme = (e.target as HTMLSelectElement).value;
    persist('linksmith.theme', this.theme);
    if (this.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = this.theme;
  }

  private nav() {
    return html`<nav aria-label="Resource navigation"><div class="nav-group">
      <button class=${this.category === null && !this.favorite && !this.inbox ? 'nav selected' : 'nav'} @click=${() =>
        this.applyFilters(() => {
          this.category = null;
          this.inbox = false;
          this.favorite = false;
        })}>${icon('book')} All resources</button>
      <button class=${this.inbox ? 'nav selected' : 'nav'} aria-pressed=${this.inbox} @click=${() =>
        this.applyFilters(() => {
          this.inbox = !this.inbox;
        })}>${icon('inbox')} Inbox</button>
      <button class=${this.favorite ? 'nav selected' : 'nav'} aria-pressed=${this.favorite} @click=${() =>
        this.applyFilters(() => {
          this.favorite = !this.favorite;
        })}>${icon('star')} Favorites</button>
    </div><p class="eyebrow">Categories</p><div class="nav-group">
      ${this.categories
        .filter((c) => c.parent_id === null)
        .map(
          (
            root,
          ) => html`<button class=${this.category === root.id ? 'nav selected' : 'nav'} aria-pressed=${this.category === root.id} @click=${() =>
            this.applyFilters(() => {
              this.category = this.category === root.id ? null : root.id;
            })}>${root.name}</button>
        ${this.categories
          .filter((c) => c.parent_id === root.id)
          .map(
            (child) =>
              html`<button class=${this.category === child.id ? 'nav child selected' : 'nav child'} aria-pressed=${this.category === child.id} @click=${() =>
                this.applyFilters(() => {
                  this.category = this.category === child.id ? null : child.id;
                })}>${child.name}</button>`,
          )}`,
        )}
      ${this.categories.length ? nothing : html`<p class="muted small">A little structure goes a long way. Add your first category below.</p>`}
    </div><button class="quiet manage-button" @click=${this.openManager}>${icon('edit')} Manage categories & tags</button></nav>`;
  }

  private chip(label: string, action: () => void) {
    return html`<button class="chip" aria-label=${`Remove filter: ${label}`} @click=${() => this.applyFilters(action)}>${label}${icon('close')}</button>`;
  }

  private entry(r: Resource) {
    const expanded = this.expanded.has(r.id);
    return html`<article class="entry"><div class="entry-heading"><div class="entry-title"><a href=${r.url} target="_blank" rel="noopener noreferrer">${r.name || r.domain}</a><span class="domain">${r.domain}</span></div>
      <div class="entry-actions">${r.rating !== null ? html`<span class="rating" aria-label=${`${r.rating} out of 5 stars`}>${icon('star')} ${r.rating}</span>` : nothing}
        <button class=${r.favorite ? 'icon-button favored' : 'icon-button'} aria-label=${(r.favorite ? 'Remove favorite: ' : 'Favorite: ') + (r.name || r.domain)} aria-pressed=${r.favorite} ?disabled=${this.pendingFavorites.has(r.id)} @click=${() => this.toggleFavorite(r)}>${icon('star')}</button>
        <button class=${expanded ? 'icon-button expand open' : 'icon-button expand'} aria-label=${(expanded ? 'Collapse ' : 'Expand ') + (r.name || r.domain)} aria-expanded=${expanded} aria-controls=${`details-${r.id}`} @click=${() => {
          const set = new Set(this.expanded);
          expanded ? set.delete(r.id) : set.add(r.id);
          this.expanded = set;
        }}>${icon('chevron')}</button></div></div>
      ${r.description ? html`<p class="preview">${r.description}</p>` : nothing}
      ${r.tags.length ? html`<div class="entry-tags">${r.tags.map((t) => html`<span>${t.name}</span>`)}</div>` : nothing}
      <div id=${`details-${r.id}`} ?hidden=${!expanded} class="entry-details">
        ${r.description ? html`<h3>Description</h3><p class="plain">${r.description}</p>` : nothing}
        ${r.notes ? html`<h3>Private notes</h3><p class="plain">${r.notes}</p>` : nothing}
        ${r.keywords ? html`<h3>Keywords</h3><p class="plain">${r.keywords}</p>` : nothing}
        <dl><div><dt>Category</dt><dd>${this.categoryLabel(r.category_id)}</dd></div><div><dt>Pricing</dt><dd>${r.pricing}</dd></div><div><dt>Added</dt><dd>${new Date(r.created_at).toLocaleDateString()}</dd></div></dl>
        <p class="full-url">${r.url}</p><div class="row"><button class="quiet" @click=${() => this.openForm(r)}>${icon('edit')} Edit</button><button class="quiet danger" @click=${() => this.confirm('resources', r.id, r.name || r.domain)}>${icon('trash')} Delete</button></div>
      </div></article>`;
  }

  private fieldError(key: string) {
    const message = this.formError?.fields?.[key];
    return message
      ? html`<span class="field-error" id=${`error-${key}`}>${message}</span>`
      : nothing;
  }

  private categoryOptions() {
    return this.categories
      .filter((c) => c.parent_id === null)
      .map(
        (root) =>
          html`<option value=${root.id}>${root.name}</option>${this.categories.filter((c) => c.parent_id === root.id).map((child) => html`<option value=${child.id}>${root.name} / ${child.name}</option>`)}`,
      );
  }

  private resourceDialog() {
    const f = this.form;
    const suggestions = this.tags
      .filter(
        (t) =>
          !f.tag_ids.includes(t.id) &&
          t.name.toLocaleLowerCase().includes(this.tagText.toLocaleLowerCase()),
      )
      .slice(0, 8);

    return html`<dialog id="resource-dialog" aria-labelledby="resource-heading" @cancel=${this.cancel}>
      <header class="dialog-header"><h2 id="resource-heading">${this.editing ? 'Edit resource' : 'Add resource'}</h2><button type="button" class="icon-button" aria-label="Close resource editor" ?disabled=${this.saving} @click=${() => this.close('resource-dialog')}>${icon('close')}</button></header>
      <form @submit=${(e: Event) => {
        e.preventDefault();
        void this.save(false);
      }}>
        <fieldset ?disabled=${this.saving}><label>URL <span class="muted">required</span><input autofocus id="resource-url" type="url" required maxlength="4096" placeholder="https://example.com" .value=${f.url} aria-invalid=${Boolean(this.formError?.fields?.url)} aria-describedby="error-url" @input=${(e: Event) => this.setForm('url', (e.target as HTMLInputElement).value)}>${this.fieldError('url')}</label>
        <label>Name <span class="muted">optional</span><input maxlength="300" .value=${f.name} placeholder="Leave blank to use the domain" @input=${(e: Event) => this.setForm('name', (e.target as HTMLInputElement).value)}>${this.fieldError('name')}</label>
        <label>Description<textarea rows="3" maxlength="20000" .value=${f.description} @input=${(e: Event) => this.setForm('description', (e.target as HTMLTextAreaElement).value)}></textarea>${this.fieldError('description')}</label>
        <label>Category<select .value=${String(f.category_id ?? '')} @change=${(e: Event) => this.setForm('category_id', (e.target as HTMLSelectElement).value || null)}><option value="">Uncategorized</option>${this.categoryOptions()}</select>${this.fieldError('category_id')}</label>
        <div class="form-group"><label for="tag-input">Tags</label><div class="row"><input id="tag-input" autocomplete="off" maxlength="100" placeholder="Find or create a tag" .value=${this.tagText} @input=${(
          e: Event,
        ) => {
          this.tagText = (e.target as HTMLInputElement).value;
        }} @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void this.addFormTag();
          }
        }}><button type="button" ?disabled=${!this.tagText.trim()} @click=${this.addFormTag}>Add tag</button></div>
        <div class="tag-suggestions" aria-label="Existing tag suggestions">${suggestions.map(
          (t) =>
            html`<button type="button" class="small quiet" @click=${() => {
              this.setForm('tag_ids', [...f.tag_ids, t.id]);
              this.tagText = '';
            }}>+ ${t.name}</button>`,
        )}</div>
        <div class="tag-suggestions">${f.tag_ids.map(
          (id) =>
            html`<button type="button" class="chip" aria-label=${`Remove tag ${this.tags.find((t) => t.id === id)?.name ?? id}`} @click=${() =>
              this.setForm(
                'tag_ids',
                f.tag_ids.filter((t) => t !== id),
              )}>${this.tags.find((t) => t.id === id)?.name ?? 'Deleted tag'}${icon('close')}</button>`,
        )}</div>${this.fieldError('tag_ids')}</div>
        <div class="two-columns"><label>Rating<select .value=${String(f.rating ?? '')} @change=${(e: Event) => this.setForm('rating', Number((e.target as HTMLSelectElement).value) || null)}><option value="">Unrated</option>${[1, 2, 3, 4, 5].map((n) => html`<option value=${n}>${n} ${n === 1 ? 'star' : 'stars'}</option>`)}</select>${this.fieldError('rating')}</label>
        <label>Pricing<select .value=${f.pricing} @change=${(e: Event) => this.setForm('pricing', (e.target as HTMLSelectElement).value)}>${['Unknown', 'Free', 'Freemium', 'Paid'].map((p) => html`<option>${p}</option>`)}</select>${this.fieldError('pricing')}</label></div>
        <label class="checkbox"><input type="checkbox" .checked=${f.favorite} @change=${(e: Event) => this.setForm('favorite', (e.target as HTMLInputElement).checked)}>Favorite</label>
        <details class="secondary-fields"><summary>Private notes & keywords</summary><label>Private notes<textarea rows="4" maxlength="50000" .value=${f.notes} @input=${(e: Event) => this.setForm('notes', (e.target as HTMLTextAreaElement).value)}></textarea>${this.fieldError('notes')}</label><label>Aliases / keywords<textarea rows="2" maxlength="2000" .value=${f.keywords} @input=${(e: Event) => this.setForm('keywords', (e.target as HTMLTextAreaElement).value)}></textarea>${this.fieldError('keywords')}</label></details></fieldset>
        ${this.formError ? html`<div class="error" role="alert"><p>${this.formError.message}</p>${this.formError.existing?.map((r) => html`<div class="duplicate"><a href=${r.url} target="_blank" rel="noopener noreferrer">${r.name || r.domain}</a><button type="button" class="quiet" @click=${() => this.existingEdit(r)}>Edit existing</button></div>`)}${this.formError.code === 'duplicate' ? html`<label class="checkbox"><input type="checkbox" .checked=${f.acknowledge_duplicate} @change=${(e: Event) => this.setForm('acknowledge_duplicate', (e.target as HTMLInputElement).checked)}>I want to save another copy of this URL</label>` : nothing}</div>` : nothing}
        <footer class="dialog-footer"><button type="button" ?disabled=${this.saving} @click=${() => this.close('resource-dialog')}>Cancel</button><button type="button" ?disabled=${this.saving} @click=${() => {
          const form = this.querySelector<HTMLFormElement>(
            '#resource-dialog form',
          );
          if (form?.reportValidity()) void this.save(true);
        }}>Save & add another</button><button class="primary" type="submit" ?disabled=${this.saving}>${this.saving ? 'Saving…' : 'Save'}</button></footer>
      </form></dialog>`;
  }

  private manageDialog() {
    return html`<dialog id="manage-dialog" aria-labelledby="manage-heading" @cancel=${this.cancel}><header class="dialog-header"><h2 id="manage-heading">Categories & tags</h2><button class="icon-button" aria-label="Close management" ?disabled=${this.managing} @click=${() => this.close('manage-dialog')}>${icon('close')}</button></header>
    <div class="row tabs"><button autofocus aria-pressed=${this.managerType === 'categories'} @click=${() => {
      this.managerType = 'categories';
      this.selectManaged(null);
    }}>Categories</button><button aria-pressed=${this.managerType === 'tags'} @click=${() => {
      this.managerType = 'tags';
      this.selectManaged(null);
    }}>Tags</button></div>
    <form @submit=${this.saveManaged}><fieldset ?disabled=${this.managing}><label>Choose an item to edit<select .value=${String(this.managerID ?? '')} @change=${(e: Event) => this.selectManaged((e.target as HTMLSelectElement).value || null)}><option value="">Add new ${this.managerType === 'categories' ? 'category' : 'tag'}</option>${this.managerType === 'categories' ? this.categoryOptions() : this.tags.map((t) => html`<option value=${t.id}>${t.name}</option>`)}</select></label>
    <label>Name<input required maxlength="100" .value=${this.managerName} @input=${(
      e: Event,
    ) => {
      this.managerName = (e.target as HTMLInputElement).value;
    }}></label>
    ${
      this.managerType === 'categories'
        ? html`<label>Parent<select .value=${String(this.managerParent ?? '')} @change=${(
            e: Event,
          ) => {
            this.managerParent = (e.target as HTMLSelectElement).value || null;
          }}><option value="">None — root category</option>${this.categories.filter((c) => c.parent_id === null && c.id !== this.managerID).map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select></label><p class="muted small">Two levels: root and child. Move children and reassign resources before deleting a category.</p>`
        : html`<p class="muted small">Deleting a tag removes its associations; resources stay in your notebook.</p>`
    }</fieldset>
    ${this.managerError ? html`<p class="error" role="alert">${this.managerError}</p>` : nothing}<footer class="dialog-footer">${
      this.managerID
        ? html`<button type="button" class="danger" ?disabled=${this.managing} @click=${() => {
            if (this.managerID !== null)
              this.confirm(this.managerType, this.managerID, this.managerName);
          }}>Delete</button>`
        : nothing
    }<button class="primary" ?disabled=${this.managing}>${this.managing ? 'Saving…' : this.managerID ? 'Save changes' : 'Add'}</button></footer></form></dialog>`;
  }

  render() {
    const title =
      this.category !== null
        ? this.categoryLabel(this.category)
        : this.inbox
          ? 'Inbox'
          : this.favorite
            ? 'Favorites'
            : 'All resources';
    const active =
      this.query ||
      this.category !== null ||
      this.favorite ||
      this.inbox ||
      this.selectedTags.length;
    return html`<div class="app-shell"><aside class="sidebar"><a class="brand" href="/">${icon('book')} Linksmith</a><p class="brand-caption">A personal resource notebook</p>${this.nav()}<label class="theme-select">${icon('moon')}<span>Theme</span><select aria-label="Theme" .value=${this.theme} @change=${this.setTheme}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></aside>
      <main><header class="main-header"><div><button class="mobile-menu icon-button" aria-label="Open navigation" @click=${() => this.show('nav-dialog')}>${icon('menu')}</button><p class="eyebrow">Your notebook</p><h1>${title}</h1>${this.category !== null && this.categories.some((c) => c.parent_id === this.category) ? html`<p class="muted small">Includes this category and its children</p>` : nothing}</div><button class="primary add-resource" @click=${() => this.openForm()}>${icon('plus')} Add resource</button></header>
      <div class="toolbar"><label class="search">${icon('search')}<input type="search" aria-label="Search resources" placeholder="Search your notebook…" maxlength="200" .value=${this.query} @input=${(
        e: Event,
      ) => {
        this.query = (e.target as HTMLInputElement).value;
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
          this.page = 1;
          void this.load();
        }, 250);
      }}></label>
      <div class="filter-controls"><label>Tag<select aria-label="Add tag filter" .value=${''} @change=${(
        e: Event,
      ) => {
        const target = e.target as HTMLSelectElement;
        const id = target.value;
        if (id)
          this.applyFilters(() => {
            this.selectedTags = [...new Set([...this.selectedTags, id])];
          });
        target.value = '';
      }}><option value="">Filter by tag</option>${this.tags.filter((t) => !this.selectedTags.includes(t.id)).map((t) => html`<option value=${t.id}>${t.name}</option>`)}</select></label><label>Sort<select .value=${this.sort} @change=${(
        e: Event,
      ) =>
        this.applyFilters(() => {
          this.sort = (e.target as HTMLSelectElement).value;
          persist('linksmith.sort', this.sort);
        })}><option value="title">Alphabetical</option><option value="rating">Highest rated</option><option value="recent">Recently added</option></select></label></div></div>
      ${
        active
          ? html`<div class="active-filters" aria-label="Active filters">${
              this.category !== null
                ? this.chip(this.categoryLabel(this.category), () => {
                    this.category = null;
                  })
                : nothing
            }${
              this.favorite
                ? this.chip('Favorites', () => {
                    this.favorite = false;
                  })
                : nothing
            }${
              this.inbox
                ? this.chip('Inbox', () => {
                    this.inbox = false;
                  })
                : nothing
            }${
              this.query
                ? this.chip(`Search: ${this.query}`, () => {
                    this.query = '';
                  })
                : nothing
            }${this.selectedTags.map((id) =>
              this.chip(
                this.tags.find((t) => t.id === id)?.name ?? 'Deleted tag',
                () => {
                  this.selectedTags = this.selectedTags.filter((t) => t !== id);
                },
              ),
            )}<button class="quiet small" @click=${this.clear}>Clear filters</button>${this.selectedTags.length > 1 ? html`<span class="muted small">Matches every selected tag</span>` : nothing}</div>`
          : nothing
      }
      ${
        this.notice
          ? html`<div class="notice" role="status">${this.notice}<button class="icon-button" aria-label="Dismiss message" @click=${() => {
              this.notice = '';
            }}>${icon('close')}</button></div>`
          : nothing
      }
      <section class="results" aria-label="Resource results" aria-busy=${this.loading}>
        ${
          this.loading
            ? html`<p class="status" role="status">Loading your notebook…</p>`
            : this.listError
              ? html`<div class="error" role="alert"><p>${this.listError}</p><button @click=${this.initialize}>Retry</button></div>`
              : html`<div class="results-meta"><span>${this.total} ${this.total === 1 ? 'resource' : 'resources'}${active ? ' matching' : ''}</span><span>${this.total ? (this.page - 1) * 30 + 1 : 0}–${Math.min(this.page * 30, this.total)} of ${this.total}</span></div>
        ${this.items.length ? this.items.map((r) => this.entry(r)) : html`<div class="empty"><h2>${active ? 'No matching resources' : 'Start your notebook'}</h2><p class="muted">${active ? 'Try removing a filter or changing your search.' : 'Capture a useful link. A URL is all you need.'}</p><button @click=${active ? this.clear : () => this.openForm()}>${active ? 'Clear filters' : 'Add your first resource'}</button></div>`}
        ${
          this.total > 30
            ? html`<nav class="pagination" aria-label="Pagination"><button ?disabled=${this.page <= 1} @click=${() => {
                this.page--;
                void this.load();
              }}>Previous</button><span>Page ${this.page} of ${Math.ceil(this.total / 30)}</span><button ?disabled=${this.page * 30 >= this.total} @click=${() => {
                this.page++;
                void this.load();
              }}>Next</button></nav>`
            : nothing
        }`
        }
      </section><footer class="notebook-footer">A place for things worth remembering.</footer></main></div>
      ${this.resourceDialog()}${this.manageDialog()}
      <dialog id="delete-dialog" class="small-dialog" aria-labelledby="delete-heading" @cancel=${this.cancel}><h2 id="delete-heading">Delete ${this.confirmation?.kind === 'resources' ? 'resource' : this.confirmation?.kind === 'tags' ? 'tag' : 'category'}?</h2><p class="plain">${this.confirmation?.name}</p><p class="muted">${this.confirmation?.kind === 'tags' ? 'This removes the tag from all resources. Resources will be kept.' : 'This cannot be undone.'}</p>${this.deleteError ? html`<p class="error" role="alert">${this.deleteError}</p>` : nothing}<footer class="dialog-footer"><button autofocus ?disabled=${this.deleting} @click=${() => this.close('delete-dialog')}>Cancel</button><button class="danger" ?disabled=${this.deleting} @click=${this.deleteConfirmed}>${this.deleting ? 'Deleting…' : 'Delete'}</button></footer></dialog>
      <dialog id="nav-dialog" class="drawer" aria-label="Navigation"><header class="dialog-header"><span class="brand">${icon('book')} Linksmith</span><button autofocus class="icon-button" aria-label="Close navigation" @click=${() => this.close('nav-dialog')}>${icon('close')}</button></header><div @click=${(
        e: Event,
      ) => {
        if ((e.target as HTMLElement).closest('button.nav'))
          this.close('nav-dialog');
      }}>${this.nav()}</div><label class="theme-select">Theme<select .value=${this.theme} @change=${this.setTheme}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></dialog>`;
  }
}
customElements.define('linksmith-app', LinksmithApp);
