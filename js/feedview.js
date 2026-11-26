// Story list: rows, infinite scroll, pull-to-refresh, swipe-to-bookmark.
import { h, icons, esc, domainOf, timeAgo, compact, store, githubRepoOf, haptic } from './util.js';
import { isRead } from './feeds.js';
import { bookmarks } from './bookmarks.js';
import { spinnerHtml } from './browser.js';
import { toast } from './ui.js';

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function favicon(item) {
  if (!item.url) return '';
  if (githubRepoOf(item) && /github\.com/.test(item.url)) return `<span class="favicon gh">${icons.github}</span>`;
  if (!store.get('favicons', true)) return '';
  try {
    const host = new URL(item.url).hostname;
    return `<img class="favicon" src="https://icons.duckduckgo.com/ip3/${esc(host)}.ico" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
  } catch { return ''; }
}

function kindTag(item) {
  const t = item.title || '';
  if (/^Show HN/i.test(t)) return '<span class="tag show">Show</span>';
  if (/^(Ask|Tell) HN/i.test(t)) return '<span class="tag ask">Ask</span>';
  if (item.type === 'job') return '<span class="tag">Job</span>';
  if (!item.url) return '<span class="tag">Text</span>';
  return '';
}

export function stripPrefix(title) {
  return title.replace(/^(Show|Ask|Tell|Launch) HN:\s*/i, '');
}

export function storyRow(item) {
  const row = h('article', { class: 'row' + (isRead(item.id) ? ' read' : ''), 'data-id': item.id });
  const hot = item.score >= 300;
  const gh = githubRepoOf(item);
  const domain = item.url ? domainOf(item.url) : gh ? `github.com/${gh.owner}` : 'news.ycombinator.com';
  row.innerHTML = `
    <div class="swipe-bg">${icons.bookmarkFill}<span></span></div>
    <div class="row-inner">
      <div class="row-main">
        <div class="row-title">${esc(stripPrefix(item.title))}</div>
        <div class="row-domain">${kindTag(item)}${favicon(item)}<span>${esc(domain)}</span>${!item.url && gh ? `<span class="tag gh">Repo</span>` : ''}</div>
        <div class="row-meta">
          ${item.type !== 'job' ? `<span class="meta-i pts${hot ? ' hot' : ''}">${icons.up}${compact(item.score)}</span>` : ''}
          <span class="meta-i">${icons.clock}${timeAgo(item.time)}</span>
          ${item.by ? `<span class="meta-i">${icons.person}${esc(item.by)}</span>` : ''}
          ${bookmarks.has(item.id) ? `<span class="row-bm">${icons.bookmarkFill}</span>` : ''}
        </div>
      </div>
      ${item.type !== 'job' ? `<button class="row-side" aria-label="${item.descendants} Kommentare">${icons.comment}<span>${compact(item.descendants)}</span></button>` : ''}
    </div>`;
  return row;
}

/**
 * FeedView renders a source ({more, visible, done}) into `list` inside `scroller`.
 */
export class FeedView {
  constructor({ scroller, list, onOpen, emptyAction }) {
    this.sc = scroller;
    this.list = list;
    this.onOpen = onOpen;
    this.emptyAction = emptyAction;
    this.rows = new Map();
    this.footer = h('div', { class: 'list-footer' });
    this.list.after(this.footer);
    this.ptr = h('div', { class: 'ptr', html: `<div class="spinner">${spinnerHtml()}</div>` });
    this.sc.parentElement.append(this.ptr);
    this.io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) this.more();
    }, { root: this.sc, rootMargin: '900px 0px' });
    this.io.observe(this.footer);
    this.bindTaps();
    this.bindSwipe();
    this.bindPull();
    bookmarks.onChange(() => this.refreshBookmarkMarks());
  }

  setSource(src, { keepScroll = false } = {}) {
    this.src = src;
    this.gen = (this.gen || 0) + 1;
    this.loadingMore = false;
    this.error = null;
    if (!keepScroll) this.sc.scrollTop = 0;
    this.list.replaceChildren(...Array.from({ length: 8 }, () => h('div', { class: 'skel', html: '<div></div><div></div><div></div>' })));
    this.footer.replaceChildren();
    this.started = false;
    return this.more();
  }

  async more({ fresh = false } = {}) {
    if (!this.src || this.loadingMore || (this.started && this.src.done && !fresh)) return;
    this.loadingMore = true;
    const gen = this.gen;
    if (this.started) this.footer.innerHTML = `<div class="spinner">${spinnerHtml()}</div>`;
    try {
      const items = await this.src.more({ fresh });
      if (gen !== this.gen) return;
      this.started = true;
      this.error = null;
      this.render(items);
    } catch (e) {
      if (gen !== this.gen) return;
      this.error = e;
      if (!this.started) this.list.replaceChildren();
      this.footer.replaceChildren(h('div', {}, 'Laden fehlgeschlagen. '), h('button', { class: 'btn-plain', onclick: () => { this.loadingMore = false; this.more(); } }, 'Erneut versuchen'));
    } finally {
      if (gen === this.gen) this.loadingMore = false;
    }
    // Keep filling if the filtered page is shorter than the viewport.
    if (gen === this.gen && !this.src.done && !this.error && this.sc.scrollHeight <= this.sc.clientHeight + 900) {
      requestAnimationFrame(() => this.more());
    }
  }

  render(items) {
    const nodes = items.map((it) => {
      let r = this.rows.get(it.id);
      if (!r || r._item !== it) {
        r = storyRow(it);
        r._item = it;
        this.rows.set(it.id, r);
      }
      return r;
    });
    this.list.replaceChildren(...nodes);
    this.items = items;
    if (!items.length && this.src.done) {
      this.footer.replaceChildren(h('div', { class: 'empty' },
        h('div', { class: 'empty-ico', html: icons.search }),
        h('h3', {}, 'Keine Beiträge'),
        h('p', {}, this.emptyAction ? 'Kein Beitrag passt zu den aktuellen Filtern.' : 'Hier ist noch nichts.'),
        this.emptyAction ? h('button', { class: 'btn-tinted', onclick: this.emptyAction }, 'Filter bearbeiten') : ''));
    } else if (this.src.done) {
      this.footer.textContent = items.length ? `${items.length} Beiträge · Ende der Liste` : '';
    } else {
      this.footer.innerHTML = `<div class="spinner">${spinnerHtml()}</div>`;
    }
  }

  async refresh() {
    if (this.refreshing || !this.src) return;
    this.refreshing = true;
    this.ptr.style.opacity = 1;
    this.ptr.querySelector('.spinner').style.transform = 'none';
    const fresh = this.src.reset ? this.src.reset() : null;
    try {
      if (fresh) {
        this.src = fresh;
        this.gen++;
        this.loadingMore = false;
        this.started = false;
        await this.more({ fresh: true });
      } else this.render(this.src.visible());
    } finally {
      this.refreshing = false;
      this.ptr.style.opacity = 0;
    }
  }

  refreshBookmarkMarks() {
    for (const [id, row] of this.rows) {
      const meta = row.querySelector('.row-meta');
      const has = bookmarks.has(id);
      const mark = meta?.querySelector('.row-bm');
      if (has && !mark) meta.insertAdjacentHTML('beforeend', `<span class="row-bm">${icons.bookmarkFill}</span>`);
      if (!has && mark) mark.remove();
    }
    if (this.src?.isBookmarks) this.render(this.src.visible());
  }

  markRead(id) {
    this.rows.get(id)?.classList.add('read');
  }

  bindTaps() {
    this.list.addEventListener('click', (e) => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      const row = e.target.closest('.row');
      if (!row) return;
      const item = row._item;
      const comments = !!e.target.closest('.row-side');
      this.markRead(item.id);
      this.onOpen(item, { comments });
    });
  }

  bindSwipe() {
    let row = null, inner = null, bg = null, sx = 0, sy = 0, dx = 0, decided = false, armed = false;
    const TH = 90;
    this.list.addEventListener('touchstart', (e) => {
      row = e.target.closest('.row');
      if (!row || e.touches[0].clientX < 24) { row = null; return; }
      inner = row.querySelector('.row-inner');
      bg = row.querySelector('.swipe-bg');
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; decided = false; armed = false;
    }, { passive: true });
    this.list.addEventListener('touchmove', (e) => {
      if (!row) return;
      const t = e.touches[0];
      const mx = t.clientX - sx, my = t.clientY - sy;
      if (!decided) {
        if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
        if (Math.abs(my) > Math.abs(mx) || mx < 0) { row = null; return; }
        decided = true;
        row.classList.add('swiping');
        bg.querySelector('span').textContent = bookmarks.has(row._item.id) ? 'Entfernen' : 'Merken';
      }
      e.preventDefault();
      dx = Math.max(0, mx);
      const eased = dx > TH ? TH + (dx - TH) * 0.5 : dx;
      inner.style.transform = `translateX(${eased}px)`;
      if ((dx > TH) !== armed) { armed = dx > TH; bg.classList.toggle('armed', armed); if (armed) haptic(); }
    }, { passive: false });
    const end = () => {
      if (!row) return;
      const r = row;
      row = null;
      if (!decided) return;
      this.suppressClick = true;
      setTimeout(() => { this.suppressClick = false; }, 350);
      inner.style.transform = '';
      setTimeout(() => { r.classList.remove('swiping'); bg.classList.remove('armed'); }, 350);
      if (armed) {
        const on = bookmarks.toggle(r._item);
        toast(on ? 'Gemerkt' : 'Aus „Gemerkt“ entfernt', on ? 'bookmarkFill' : 'bookmark');
      }
    };
    this.list.addEventListener('touchend', end);
    this.list.addEventListener('touchcancel', end);
  }

  bindPull() {
    let sy = 0, pulling = false, dist = 0;
    const spin = this.ptr.querySelector('.spinner');
    const show = (d) => {
      if (this.refreshing) return;
      const p = Math.min(1, d / 80);
      this.ptr.style.opacity = p;
      spin.style.transform = `rotate(${d * 3}deg) scale(${0.6 + p * 0.4})`;
    };
    this.sc.addEventListener('touchstart', (e) => {
      if (this.sc.scrollTop > 0 || this.refreshing) return;
      sy = e.touches[0].clientY; pulling = true; dist = 0;
    }, { passive: true });
    this.sc.addEventListener('touchmove', (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - sy;
      dist = IS_IOS ? Math.max(-this.sc.scrollTop, 0) : Math.max(0, dy * 0.5);
      if (!IS_IOS) this.list.parentElement.style.transform = dist ? `translateY(${Math.min(dist, 110)}px)` : '';
      show(dist);
    }, { passive: true });
    const end = () => {
      if (!pulling) return;
      pulling = false;
      if (!IS_IOS) {
        this.list.parentElement.style.transition = 'transform .35s var(--ease)';
        this.list.parentElement.style.transform = '';
        setTimeout(() => { this.list.parentElement.style.transition = ''; }, 400);
      }
      if (dist > 75) { haptic(); this.refresh(); } else this.ptr.style.opacity = 0;
    };
    this.sc.addEventListener('touchend', end);
    this.sc.addEventListener('touchcancel', end);
    if (IS_IOS) this.sc.addEventListener('scroll', () => { if (pulling) { dist = Math.max(-this.sc.scrollTop, 0); show(dist); } }, { passive: true });
  }
}
