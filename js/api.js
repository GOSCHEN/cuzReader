// Data layer: Hacker News Firebase API (exact HN rankings) + Algolia (search, comment trees, filtered feeds).
const FB = 'https://hacker-news.firebaseio.com/v0';
const ALGOLIA = 'https://hn.algolia.com/api/v1';
export const PAGE_SIZE = 30;

const itemCache = new Map();
const listCache = new Map();

async function getJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.response = res;
    throw err;
  }
  return res.json();
}

/** Normalise an item to one shape regardless of source. */
function normFirebase(it) {
  if (!it) return null;
  return {
    id: it.id,
    type: it.type,
    title: it.title || '',
    url: it.url || '',
    text: it.text || '',
    by: it.by || '',
    time: it.time || 0,
    score: it.score ?? 0,
    descendants: it.descendants ?? 0,
    dead: !!it.dead,
    deleted: !!it.deleted,
  };
}

function normAlgoliaHit(h) {
  const tags = h._tags || [];
  return {
    id: Number(h.objectID),
    type: tags.includes('job') ? 'job' : 'story',
    title: h.title || '',
    url: h.url || '',
    text: h.story_text || '',
    by: h.author || '',
    time: h.created_at_i || 0,
    score: h.points ?? 0,
    descendants: h.num_comments ?? 0,
  };
}

export async function getItem(id, { fresh = false } = {}) {
  if (!fresh && itemCache.has(id)) return itemCache.get(id);
  const it = normFirebase(await getJSON(`${FB}/item/${id}.json`));
  if (it) itemCache.set(id, it);
  return it;
}

export function cachedItem(id) {
  return itemCache.get(Number(id));
}

/** Base lists. `fb` = Firebase id list (exact HN ranking), `algolia` = search params. */
export const BASES = {
  top: { fb: 'topstories', tags: 'story' },
  new: { fb: 'newstories', tags: 'story' },
  best: { fb: 'beststories', tags: 'story' },
  jobs: { fb: 'jobstories', tags: 'job' },
  show: { fb: 'showstories', tags: 'show_hn' },
  ask: { fb: 'askstories', tags: 'ask_hn' },
  'show-new': { algolia: 'search_by_date', tags: 'show_hn' },
  'ask-new': { algolia: 'search_by_date', tags: 'ask_hn' },
  all: { algolia: 'search_by_date', tags: 'story' },
};

/** Load page `page` (0-based) of a base list. `numeric` is pushed to Algolia when possible. */
export async function loadBase(base, page = 0, { fresh = false, numeric = [] } = {}) {
  const def = BASES[base];
  if (!def) throw new Error('Unknown feed ' + base);
  if (def.fb) {
    let ids = listCache.get(base);
    if (!ids || (fresh && page === 0)) {
      ids = await getJSON(`${FB}/${def.fb}.json`);
      listCache.set(base, ids);
    }
    const slice = ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const items = await Promise.all(slice.map((id) => getItem(id, { fresh }).catch(() => null)));
    return {
      items: items.filter((i) => i && !i.deleted && !i.dead),
      done: (page + 1) * PAGE_SIZE >= ids.length,
    };
  }
  return searchAlgolia({ endpoint: def.algolia, tags: def.tags, page, numeric });
}

export async function searchAlgolia({
  endpoint = 'search',
  query = '',
  tags = 'story',
  page = 0,
  numeric = [],
  restrictSearchableAttributes,
  optionalWords,
  hitsPerPage = PAGE_SIZE,
}) {
  const p = new URLSearchParams({ tags, page: String(page), hitsPerPage: String(hitsPerPage) });
  if (query) p.set('query', query);
  if (restrictSearchableAttributes) p.set('restrictSearchableAttributes', restrictSearchableAttributes);
  if (optionalWords) p.set('optionalWords', optionalWords);
  if (numeric.length) p.set('numericFilters', numeric.join(','));
  const data = await getJSON(`${ALGOLIA}/${endpoint}?${p}`);
  const items = data.hits.map(normAlgoliaHit);
  for (const it of items) if (!itemCache.has(it.id)) itemCache.set(it.id, it);
  return { items, done: page + 1 >= data.nbPages, total: data.nbHits };
}

/** Full comment tree in one request (Algolia), falls back to Firebase. */
export async function getCommentTree(id) {
  try {
    const data = await getJSON(`${ALGOLIA}/items/${id}`);
    const conv = (n) => ({
      id: n.id,
      by: n.author || '',
      time: n.created_at_i || 0,
      text: n.text || '',
      deleted: !n.author && !n.text,
      kids: (n.children || []).map(conv),
    });
    // Algolia doesn't keep HN's ranking order for top-level comments; use Firebase kids order when available.
    const tree = conv(data).kids;
    try {
      const fb = await getJSON(`${FB}/item/${id}.json`);
      if (fb?.kids) {
        const order = new Map(fb.kids.map((k, i) => [k, i]));
        tree.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
        if (itemCache.has(id)) {
          const cached = itemCache.get(id);
          cached.descendants = fb.descendants ?? cached.descendants;
          cached.score = fb.score ?? cached.score;
        }
      }
    } catch { /* ordering is best-effort */ }
    return tree;
  } catch (e) {
    return firebaseTree(id);
  }
}

async function firebaseTree(id) {
  const root = await getJSON(`${FB}/item/${id}.json`);
  const load = async (kid) => {
    const c = await getJSON(`${FB}/item/${kid}.json`).catch(() => null);
    if (!c) return null;
    return {
      id: c.id,
      by: c.by || '',
      time: c.time || 0,
      text: c.text || '',
      deleted: !!(c.deleted || c.dead),
      kids: (await Promise.all((c.kids || []).map(load))).filter(Boolean),
    };
  };
  return (await Promise.all((root?.kids || []).map(load))).filter(Boolean);
}
