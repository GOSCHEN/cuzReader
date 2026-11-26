import { store } from './util.js';
import { matches, DEFAULT_FILTER } from './feeds.js';

let list = store.get('bookmarks', []);
const listeners = new Set();

export const bookmarks = {
  all: () => list,
  has: (id) => list.some((b) => b.id === id),
  toggle(item) {
    if (this.has(item.id)) list = list.filter((b) => b.id !== item.id);
    else {
      const { id, title, url, text, by, time, score, descendants, type } = item;
      list = [{ id, title, url, text: (text || '').slice(0, 4000), by, time, score, descendants, type, saved: Date.now() }, ...list];
    }
    store.set('bookmarks', list);
    listeners.forEach((fn) => fn());
    return this.has(item.id);
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

/** Source-compatible provider for the bookmarks feed. */
export class BookmarkSource {
  constructor(filter = DEFAULT_FILTER) {
    this.done = true;
    this.isBookmarks = true;
    this.f = filter;
  }
  async more() { return this.visible(); }
  visible() {
    const f = { ...this.f, hideRead: false };
    const list = bookmarks.all().filter((it) => matches(it, f));
    const by = {
      points: (a, b) => b.score - a.score,
      comments: (a, b) => b.descendants - a.descendants,
      date: (a, b) => b.time - a.time,
    }[f.sort];
    return by ? [...list].sort(by) : list;
  }
}
