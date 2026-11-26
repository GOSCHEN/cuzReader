// Single story view with draggable comments sheet.
import { h, icons, esc, hnHtml, timeAgo, compact, domainOf, githubRepoOf, parseGitHub, safeArea } from './util.js';
import { getItem, cachedItem, getCommentTree } from './api.js';
import { markRead } from './feeds.js';
import { bookmarks } from './bookmarks.js';
import { pushScreen, back, bindNavbar } from './nav.js';
import { Sheet } from './sheet.js';
import { openLink, spinnerHtml, segmented } from './browser.js';
import { repoInfo, repoCard } from './github.js';
import { stripPrefix } from './feedview.js';
import { toast } from './ui.js';

export async function openStory(itemOrId, { comments = false } = {}) {
  const id = typeof itemOrId === 'object' ? itemOrId.id : Number(itemOrId);
  let item = typeof itemOrId === 'object' ? itemOrId : cachedItem(id);
  markRead(id);

  const screen = h('section', { class: 'screen' });
  const bmBtn = h('button', { 'aria-label': 'Merken' });
  const navTitle = h('div', { class: 'nav-title' });
  const nav = h('header', { class: 'navbar' },
    h('div', { class: 'nav-row' },
      h('div', { class: 'nav-left' }, h('button', { class: 'glass-btn', 'aria-label': 'Zurück', html: icons.back, onclick: () => back() })),
      navTitle,
      h('div', { class: 'nav-right' },
        h('div', { class: 'glass-group' }, bmBtn,
          h('button', { 'aria-label': 'Teilen', html: icons.share, onclick: () => share(item) })))));
  const content = h('div', { class: 'detail-content' });
  const spacer = h('div', { style: 'height:150px' });
  const scroller = h('div', { class: 'scroller' }, content, spacer);
  screen.append(scroller, nav);

  const setBm = () => {
    const on = item && bookmarks.has(item.id);
    bmBtn.innerHTML = on ? icons.bookmarkFill : icons.bookmark;
    bmBtn.classList.toggle('active', !!on);
  };
  bmBtn.addEventListener('click', () => {
    if (!item) return;
    const on = bookmarks.toggle(item);
    setBm();
    toast(on ? 'Gemerkt' : 'Aus „Gemerkt“ entfernt', on ? 'bookmarkFill' : 'bookmark');
  });
  const unBm = bookmarks.onChange(setBm);

  pushScreen(screen, { onClose: () => unBm() });
  bindNavbar(screen);

  const fill = () => {
    navTitle.textContent = stripPrefix(item.title || '');
    renderContent(content, item);
    setBm();
  };
  if (item) fill();
  else content.innerHTML = `<div class="spinner" style="margin:60px auto">${spinnerHtml()}</div>`;

  const cs = new CommentsSheet(screen, id, () => item, comments);
  if (!item) {
    try {
      item = await getItem(id);
      fill();
      cs.updateCount();
    } catch {
      content.innerHTML = '<div class="empty"><h3>Beitrag nicht gefunden</h3></div>';
    }
  }

  // Links inside the post text
  content.addEventListener('click', (e) => handleLink(e));
}

function handleLink(e) {
  const a = e.target.closest('a[href]');
  if (!a) return false;
  e.preventDefault();
  const url = a.href;
  const hn = url.match(/news\.ycombinator\.com\/item\?id=(\d+)/);
  if (hn) openStory(Number(hn[1]));
  else openLink(url);
  return true;
}

function renderContent(el, item) {
  const gh = githubRepoOf(item);
  const tags = [];
  if (/^Show HN/i.test(item.title)) tags.push('<span class="tag show">Show HN</span>');
  if (/^(Ask|Tell) HN/i.test(item.title)) tags.push('<span class="tag ask">Ask HN</span>');
  if (item.type === 'job') tags.push('<span class="tag">Job</span>');
  el.innerHTML = `
    ${tags.length ? `<div class="detail-kicker">${tags.join('')}</div>` : ''}
    <h1 class="detail-title">${esc(stripPrefix(item.title))}</h1>
    <div class="detail-meta">
      ${item.type !== 'job' ? `<span class="meta-i pts">${icons.up}${compact(item.score)} Punkte</span>` : ''}
      <span class="meta-i">${icons.person}${esc(item.by)}</span>
      <span class="meta-i">${icons.clock}${timeAgo(item.time)}</span>
    </div>`;
  if (item.url && !(gh && /github\.com/.test(item.url) && !gh.kind)) {
    const host = domainOf(item.url);
    const card = h('button', { class: 'link-card', onclick: () => openLink(item.url) });
    let iconHtml = icons.globe;
    try { iconHtml = `<img src="https://icons.duckduckgo.com/ip3/${new URL(item.url).hostname}.ico" alt="" onerror="this.replaceWith(document.createTextNode(''))">`; } catch { /* ignore */ }
    card.innerHTML = `<div class="lc-icon">${parseGitHub(item.url) ? icons.github : iconHtml}</div>
      <div class="lc-text"><div class="lc-host">${esc(host)}</div><div class="lc-url">${esc(item.url.replace(/^https?:\/\/(www\.)?/, ''))}</div></div>
      <span class="cell-chev">${icons.chevron}</span>`;
    el.append(card);
  }
  if (gh) {
    const url = `https://github.com/${gh.owner}/${gh.repo}`;
    const slot = h('div');
    el.append(slot);
    const put = (info) => slot.replaceChildren(repoCard(gh, info, { onOpen: () => openLink(url) }));
    put(null);
    repoInfo(gh.owner, gh.repo).then(put).catch(() => {});
  }
  if (item.text) el.append(h('div', { class: 'prose detail-text', html: hnHtml(item.text) }));
  const actions = h('div', { class: 'detail-actions' });
  const urlIsRepo = gh && item.url && parseGitHub(item.url);
  if (item.url && !urlIsRepo) actions.append(h('button', { class: 'btn-filled', onclick: () => openLink(item.url) }, h('span', { html: icons.safari }), 'Link öffnen'));
  el.append(actions);
}

async function share(item) {
  if (!item) return;
  const hnUrl = `https://news.ycombinator.com/item?id=${item.id}`;
  try {
    if (navigator.share) await navigator.share({ title: item.title, url: item.url || hnUrl, text: item.url ? `HN: ${hnUrl}` : undefined });
    else { await navigator.clipboard.writeText(item.url || hnUrl); toast('Link kopiert', 'share'); }
  } catch { /* cancelled */ }
}

// ---- Comments -------------------------------------------------------------

class CommentsSheet {
  constructor(screen, id, getItem, expanded) {
    this.screen = screen;
    this.id = id;
    this.getItem = getItem;
    this.order = 0;
    this.countEl = h('span', { class: 'count' });
    this.collapseBtn = h('button', { class: 'glass-btn', 'aria-label': 'Alle Threads einklappen', html: icons.reader, onclick: () => this.toggleAll() });
    const head = h('div', { class: 'sheet-head' },
      h('h2', {}, 'Kommentare ', this.countEl),
      h('div', { class: 'side r' }, this.collapseBtn));
    this.list = h('div', { class: 'cmt-list' });
    this.sortSeg = segmented(['Top', 'Neueste', 'Älteste'], 0, (i) => { this.order = i; this.render(); });
    this.sortSeg.classList.add('cmt-sort');
    const body = h('div', {}, this.sortSeg, this.list);
    this.fab = h('button', { class: 'fab-next off', 'aria-label': 'Nächster Thread', html: icons.chevron, onclick: () => this.nextThread() });

    const H = () => screen.clientHeight;
    const top = () => {
      const nav = screen.querySelector('.navbar');
      return nav ? nav.offsetHeight + 6 : 60;
    };
    const safeB = () => safeArea().bottom;
    this.sheet = new Sheet({
      container: screen,
      className: 'comments-sheet',
      head,
      body,
      dismissible: false,
      backdrop: 'largest',
      detents: () => [96 + safeB(), Math.round(H() * 0.58), H() - top()],
      initial: expanded ? 2 : 0,
      onDetent: (i) => this.fab.classList.toggle('off', i !== 2 || !this.flat?.length),
    }).mount();
    this.sheet.el.append(this.fab);
    this.updateCount();
    this.load();
    this.list.addEventListener('click', (e) => this.onClick(e));
  }

  updateCount() {
    const it = this.getItem();
    this.countEl.textContent = it ? compact(it.descendants || 0) : '';
  }

  async load() {
    this.list.innerHTML = `<div class="spinner" style="margin:28px auto">${spinnerHtml()}</div>`;
    try {
      this.tree = await getCommentTree(this.id);
      this.updateCount();
      this.render();
    } catch {
      this.list.replaceChildren(h('div', { class: 'list-footer' }, 'Kommentare konnten nicht geladen werden. ',
        h('button', { class: 'btn-plain', onclick: () => this.load() }, 'Erneut versuchen')));
    }
  }

  render() {
    const op = this.getItem()?.by;
    let roots = [...(this.tree || [])];
    if (this.order === 1) roots.sort((a, b) => b.time - a.time);
    if (this.order === 2) roots.sort((a, b) => a.time - b.time);
    const flat = [];
    const walk = (nodes, d) => {
      for (const n of nodes) {
        if (n.deleted && !n.kids.length) continue;
        const entry = { n, d, desc: 0 };
        flat.push(entry);
        const before = flat.length;
        walk(n.kids, d + 1);
        entry.desc = flat.length - before;
      }
    };
    walk(roots, 0);
    this.flat = flat;
    if (!flat.length) {
      this.list.innerHTML = '<div class="empty" style="padding:28px 32px"><p>Noch keine Kommentare.</p></div>';
      this.sortSeg.style.display = 'none';
      return;
    }
    this.sortSeg.style.display = '';
    const html = flat.map(({ n, d, desc }, i) => {
      const indent = Math.min(d, 7) * 13;
      const rail = d > 0 ? `--rail: var(--rail-${((d - 1) % 6) + 1});` : '';
      return `<div class="cmt${n.deleted ? ' deleted' : ''}" data-i="${i}" data-d="${d}" style="--indent:${indent}px;${rail}">
        <div class="cmt-head"><span class="cmt-user${n.by === op ? ' op' : ''}">${esc(n.by || '[gelöscht]')}</span><span>${timeAgo(n.time)}</span>${desc ? `<span class="cmt-coll">+${desc}</span>` : ''}</div>
        <div class="prose">${n.deleted ? '[gelöscht]' : hnHtml(n.text)}</div>
      </div>`;
    }).join('');
    this.list.innerHTML = html;
    this.els = [...this.list.children];
    this.fab.classList.toggle('off', this.sheet.index !== 2);
  }

  onClick(e) {
    if (handleLink(e)) return;
    if (e.target.closest('pre') || window.getSelection()?.toString()) return;
    const c = e.target.closest('.cmt');
    if (!c) return;
    this.toggle(Number(c.dataset.i));
  }

  toggle(i, force) {
    const el = this.els[i];
    const collapsed = force ?? !el.classList.contains('collapsed');
    el.classList.toggle('collapsed', collapsed);
    this.applyVisibility(i);
  }

  /** Re-evaluate hidden state for descendants of comment i. */
  applyVisibility(i) {
    const d = this.flat[i].d;
    const hideStack = [];
    let parentCollapsed = this.els[i].classList.contains('collapsed');
    for (let j = i + 1; j < this.flat.length && this.flat[j].d > d; j++) {
      const dj = this.flat[j].d;
      while (hideStack.length && hideStack[hideStack.length - 1] >= dj) hideStack.pop();
      const hidden = parentCollapsed || hideStack.length > 0;
      this.els[j].classList.toggle('hidden', hidden);
      if (this.els[j].classList.contains('collapsed')) hideStack.push(dj);
    }
  }

  toggleAll() {
    if (!this.flat?.length) return;
    const anyOpen = this.flat.some((f, i) => f.d === 0 && !this.els[i].classList.contains('collapsed'));
    this.flat.forEach((f, i) => {
      if (f.d === 0) this.els[i].classList.toggle('collapsed', anyOpen);
      else this.els[i].classList.toggle('hidden', anyOpen);
      if (!anyOpen) this.els[i].classList.remove('collapsed');
    });
    toast(anyOpen ? 'Threads eingeklappt' : 'Threads ausgeklappt', 'reader');
    if (this.sheet.index < 2) this.sheet.snap(2);
  }

  nextThread() {
    const body = this.sheet.body;
    const bTop = body.getBoundingClientRect().top;
    const pos = (el) => el.getBoundingClientRect().top - bTop + body.scrollTop;
    const y = body.scrollTop + 6;
    const next = this.els.find((el, i) => this.flat[i].d === 0 && !el.classList.contains('hidden') && pos(el) > y);
    if (next) {
      body.scrollTo({ top: pos(next), behavior: 'smooth' });
      next.classList.remove('flash');
      void next.offsetWidth;
      next.classList.add('flash');
    }
  }
}
