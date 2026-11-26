// Filter model and filter-aware feed loading.
import { loadBase, searchAlgolia, BASES } from './api.js';
import { store, githubRepoOf, domainOf } from './util.js';

export const DEFAULT_FILTER = {
  range: 'all', // all | day | week | month | year
  sort: 'rank', // rank | points | comments | date
  minPoints: 0,
  minComments: 0,
  source: 'all', // all | github | text | link
  domains: [], // only these domains (empty = all)
  hideRead: false,
};

export const RANGES = { all: 0, day: 86400, week: 7 * 86400, month: 30 * 86400, year: 365 * 86400 };
export const RANGE_LABEL = { all: 'Aktuell', day: '24 Std.', week: 'Woche', month: 'Monat', year: 'Jahr' };
export const SORT_LABEL = { rank: 'HN-Ranking', points: 'Punkte', comments: 'Kommentare', date: 'Neueste' };
export const SOURCE_LABEL = { all: 'Alle', github: 'GitHub', text: 'Text', link: 'Links' };
export const POINT_STEPS = [0, 5, 10, 25, 50, 100, 250, 500, 1000];
export const COMMENT_STEPS = [0, 5, 10, 25, 50, 100, 250, 500];

/** Built-in feeds: base list + fixed filter parts. */
export const BUILTIN = {
  top: { title: 'Top', base: 'top' },
  new: { title: 'Neu', base: 'new' },
  best: { title: 'Beste', base: 'best' },
  jobs: { title: 'Jobs', base: 'jobs' },
  show: { title: 'Show HN', base: 'show' },
  'show-new': { title: 'Show HN · Neu', base: 'show-new' },
  'show-github': { title: 'Show HN · GitHub', base: 'show', fixed: { source: 'github' } },
  ask: { title: 'Ask HN', base: 'ask' },
  'ask-new': { title: 'Ask HN · Neu', base: 'ask-new' },
};

export const BASE_LABEL = {
  top: 'Top', new: 'Neu', best: 'Beste', jobs: 'Jobs', show: 'Show HN', ask: 'Ask HN',
  'show-new': 'Show HN (neu)', 'ask-new': 'Ask HN (neu)', all: 'Alle Stories',
};

// ---- persistence -------------------------------------------------------

let readIds = new Set(store.get('read', []));
export function markRead(id) {
  if (readIds.has(id)) return;
  readIds.add(id);
  const arr = [...readIds];
  store.set('read', arr.slice(-4000));
}
export const isRead = (id) => readIds.has(id);

export function userFilter(key) {
  return store.get('filter:' + key, {});
}
export function setUserFilter(key, f) {
  store.set('filter:' + key, f);
}

export function customFeeds() {
  return store.get('customFeeds', null) ?? [
    {
      id: 'c-gh-week',
      title: 'GitHub-Perlen der Woche',
      base: 'show',
      filter: { range: 'week', sort: 'points', source: 'github', minPoints: 20 },
    },
  ];
}
export function saveCustomFeeds(list) {
  store.set('customFeeds', list);
}

export function feedDef(key) {
  if (BUILTIN[key]) return { key, ...BUILTIN[key], fixed: BUILTIN[key].fixed || {} };
  const c = customFeeds().find((f) => f.id === key);
  if (c) return { key, title: c.title, base: c.base, fixed: c.filter || {}, custom: true };
  return null;
}

/** Effective filter = defaults + feed's fixed parts + user's tweaks. */
export function effectiveFilter(key) {
  const def = feedDef(key);
  return { ...DEFAULT_FILTER, ...(def?.fixed || {}), ...userFilter(key) };
}

export function isFiltered(f, fixed = {}) {
  const base = { ...DEFAULT_FILTER, ...fixed };
  return ['range', 'sort', 'minPoints', 'minComments', 'source', 'hideRead'].some((k) => f[k] !== base[k]) ||
    f.domains.join() !== base.domains.join();
}

export function filterSummary(f) {
  const parts = [];
  if (f.range !== 'all') parts.push(RANGE_LABEL[f.range]);
  if (f.sort !== 'rank') parts.push('nach ' + SORT_LABEL[f.sort]);
  if (f.minPoints) parts.push(`≥ ${f.minPoints} Pkt.`);
  if (f.minComments) parts.push(`≥ ${f.minComments} Komm.`);
  if (f.source !== 'all') parts.push(SOURCE_LABEL[f.source]);
  if (f.domains.length) parts.push(f.domains.join(', '));
  if (f.hideRead) parts.push('ungelesen');
  return parts.join(' · ');
}

// ---- matching ----------------------------------------------------------

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

export function matches(item, f, readSet = readIds) {
  if (f.minPoints && (item.score || 0) < f.minPoints) return false;
  if (f.minComments && (item.descendants || 0) < f.minComments) return false;
  if (f.range !== 'all' && item.time < Date.now() / 1000 - RANGES[f.range]) return false;
  if (f.source === 'github' && !githubRepoOf(item)) return false;
  if (f.source === 'text' && item.url) return false;
  if (f.source === 'link' && !item.url) return false;
  if (f.domains.length) {
    const host = hostOf(item.url);
    const dom = domainOf(item.url);
    if (!f.domains.some((d) => host === d || host.endsWith('.' + d) || dom === d)) return false;
  }
  if (f.hideRead && readSet.has(item.id)) return false;
  return true;
}

function sortItems(items, sort) {
  const by = {
    points: (a, b) => b.score - a.score,
    comments: (a, b) => b.descendants - a.descendants,
    date: (a, b) => b.time - a.time,
  }[sort];
  return by ? [...items].sort(by) : items;
}

// ---- source ------------------------------------------------------------

const MIN_BATCH = 12; // keep fetching until at least this many new visible items
const MAX_PAGES_PER_LOAD = 6;

/**
 * Loads a feed with a filter applied.
 * - range "Aktuell": walks the live HN list (exact ranking) and filters client-side.
 * - other ranges: queries the Algolia archive of that category with server-side
 *   numeric filters (time, points, comments), then refines client-side.
 */
export class FeedSource {
  constructor(base, filter, { query = '' } = {}) {
    this.base = base;
    this.f = filter;
    this.query = query.trim();
    this.page = 0;
    this.done = false;
    this.all = [];
    this.seen = new Set();
    this.archive = filter.range !== 'all' || !!this.query;
    // Snapshot of read state: items opened now stay visible until the next refresh.
    this.readSnapshot = new Set(readIds);
  }

  /** Fresh instance with identical parameters (pull-to-refresh). */
  reset() {
    return new FeedSource(this.base, this.f, { query: this.query });
  }

  numeric() {
    const n = [];
    if (this.f.range !== 'all') n.push(`created_at_i>${Math.floor(Date.now() / 1000) - RANGES[this.f.range]}`);
    if (this.f.minPoints) n.push(`points>=${this.f.minPoints}`);
    if (this.f.minComments) n.push(`num_comments>=${this.f.minComments}`);
    return n;
  }

  async fetchPage(fresh) {
    const page = this.page++;
    if (!this.archive) {
      return loadBase(this.base, page, { fresh, numeric: this.numeric() });
    }
    const tags = BASES[this.base]?.tags || 'story';
    const q = {};
    if (this.query) {
      q.query = this.query;
      if (this.f.source === 'github') q.query += ' github.com';
    } else if (this.f.source === 'github') {
      q.query = 'github.com';
      q.restrictSearchableAttributes = 'url,story_text';
    } else if (this.f.domains.length) {
      q.query = this.f.domains.join(' ');
      q.optionalWords = q.query;
      q.restrictSearchableAttributes = 'url';
    }
    const endpoint = this.f.sort === 'date' ? 'search_by_date' : 'search';
    return searchAlgolia({ endpoint, tags, page, numeric: this.numeric(), ...q });
  }

  /** Returns the full, filtered + sorted list after loading more. */
  async more({ fresh = false } = {}) {
    if (this.done) return this.visible();
    const before = this.visible().length;
    for (let i = 0; i < MAX_PAGES_PER_LOAD && !this.done; i++) {
      const { items, done } = await this.fetchPage(fresh && i === 0);
      this.done = done || !items.length;
      for (const it of items) {
        if (this.seen.has(it.id)) continue;
        this.seen.add(it.id);
        this.all.push(it);
      }
      if (this.visible().length - before >= MIN_BATCH) break;
    }
    return this.visible();
  }

  visible() {
    // Read-state is evaluated at load time so items don't vanish while you look at them.
    const list = this.all.filter((it) => matches(it, this.f, this.readSnapshot));
    // Archive results are already ordered by Algolia (relevance/points or date).
    if (this.archive && this.f.sort !== 'comments') return list;
    const sort = this.f.sort;
    return sortItems(list, sort);
  }
}
