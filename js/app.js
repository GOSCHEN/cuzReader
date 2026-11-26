// cuzReader – app shell: tabs, feed screens, "Mehr", search, settings.
import { h, $, $$, icons, store } from './util.js';
import { initNav, pushScreen, back, bindNavbar, layerCount, popTo } from './nav.js';
import { FeedView } from './feedview.js';
import {
  FeedSource, feedDef, effectiveFilter, isFiltered, filterSummary, setUserFilter, customFeeds, saveCustomFeeds, BASE_LABEL,
} from './feeds.js';
import { BookmarkSource, bookmarks } from './bookmarks.js';
import { openStory } from './detail.js';
import { openFilterSheet } from './filtersheet.js';
import { segmented } from './browser.js';
import { switchEl, toast } from './ui.js';

const VERSION = '1.0.0';

// ---- theme -------------------------------------------------------------
function applyTheme() {
  const t = store.get('theme', 'system');
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#ffffff');
}

// ---- feed screen ---------------------------------------------------------

/**
 * A screen showing a feed with large title, optional segments, filter chip and filter button.
 * opts: { title, segments: [{key,label}], key, pushed, bookmarks }
 */
function feedScreen(opts) {
  const screen = h('section', { class: 'screen' + (opts.pushed ? '' : ' tab-screen'), 'data-tab': opts.tab || '' });
  let key = opts.segments ? store.get('seg:' + opts.tab, opts.segments[0].key) : opts.key;
  if (opts.segments && !opts.segments.some((s) => s.key === key)) key = opts.segments[0].key;

  const filterBtn = h('button', { 'aria-label': 'Filter', html: filterIcon, onclick: () => editFilter() });
  const right = h('div', { class: 'glass-group' }, filterBtn);
  if (!opts.pushed) right.append(h('button', { 'aria-label': 'Suche', html: icons.search, onclick: () => openSearch() }));
  const titleEl = h('h1', { class: 'large-title' });
  const navTitle = h('div', { class: 'nav-title' });
  const nav = h('header', { class: 'navbar' }, h('div', { class: 'nav-row' },
    h('div', { class: 'nav-left' }, opts.pushed ? h('button', { class: 'glass-btn', 'aria-label': 'Zurück', html: icons.back, onclick: () => back() }) : ''),
    navTitle,
    h('div', { class: 'nav-right' }, right)));
  const chipSlot = h('div');
  const list = h('div', { class: 'list' });
  const body = h('div', { class: 'feed-body' }, list);
  const scroller = h('div', { class: 'scroller' }, titleEl);
  if (opts.sub) scroller.append(h('div', { class: 'large-sub' }, opts.sub));
  let seg;
  if (opts.segments) {
    seg = segmented(opts.segments.map((s) => s.label), opts.segments.findIndex((s) => s.key === key), (i) => {
      key = opts.segments[i].key;
      store.set('seg:' + opts.tab, key);
      load();
    });
    scroller.append(seg);
  }
  scroller.append(chipSlot, body);
  screen.append(scroller, nav);

  const view = new FeedView({
    scroller,
    list,
    onOpen: (item, o) => openStory(item, o),
    emptyAction: () => editFilter(),
  });

  const title = () => (opts.bookmarks ? 'Gemerkt' : feedDef(key)?.title || opts.title);
  const filterKey = () => (opts.bookmarks ? 'bookmarks' : key);
  const filter = () => effectiveFilter(filterKey());

  function updateChrome() {
    const t = opts.title || title();
    titleEl.textContent = t;
    navTitle.textContent = t;
    const def = feedDef(filterKey());
    const f = filter();
    const active = def?.custom ? false : isFiltered(f, def?.fixed);
    filterBtn.classList.toggle('active', active);
    filterBtn.classList.toggle('badge-dot', active);
    filterBtn.innerHTML = active ? filterIconFill : filterIcon;
    const summary = def?.custom || active ? filterSummary(f) : '';
    chipSlot.replaceChildren();
    if (summary) {
      const chip = h('div', { class: 'filter-chip' }, h('span', { onclick: () => editFilter() }, summary));
      if (!def?.custom) chip.append(h('button', { 'aria-label': 'Filter entfernen', html: icons.close, onclick: () => { setUserFilter(filterKey(), {}); load(); } }));
      chipSlot.append(chip);
    }
  }

  function load() {
    updateChrome();
    if (opts.bookmarks) return view.setSource(new BookmarkSource(filter()));
    const def = feedDef(key);
    if (!def) return;
    return view.setSource(new FeedSource(def.base, filter()));
  }

  function editFilter() {
    const def = feedDef(filterKey());
    openFilterSheet(filterKey(), {
      noRange: !!opts.bookmarks,
      title: def?.custom ? 'Feed bearbeiten' : 'Filter',
      onApply: (r) => {
        if (r.deleted) { back(); opts.onDeleted?.(); return; }
        if (r.changed) load();
        if (r.changed || r.created) opts.onChanged?.();
      },
    });
  }

  bindNavbar(screen);
  if (opts.bookmarks) bookmarks.onChange(() => { if (!view.loadingMore) view.render(view.src.visible()); });
  return { screen, load, scroller, view, get loaded() { return !!view.src; } };
}

const filterIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M7 12h10M10 17h4"/></svg>';
const filterIconFill = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M4 7h16M7 12h10M10 17h4"/></svg>';

// ---- tabs -----------------------------------------------------------------

const TABS = [
  { tab: 'top', label: 'Top', icon: icons.flame, make: () => feedScreen({ tab: 'top', key: 'top', title: 'Top' }) },
  { tab: 'new', label: 'Neu', icon: icons.sparkle, make: () => feedScreen({ tab: 'new', key: 'new', title: 'Neu' }) },
  {
    tab: 'show', label: 'Show', icon: icons.show,
    make: () => feedScreen({
      tab: 'show', title: 'Show HN',
      segments: [{ key: 'show', label: 'Aktuell' }, { key: 'show-new', label: 'Neu' }, { key: 'show-github', label: 'GitHub' }],
    }),
  },
  {
    tab: 'ask', label: 'Ask', icon: icons.ask,
    make: () => feedScreen({ tab: 'ask', title: 'Ask HN', segments: [{ key: 'ask', label: 'Aktuell' }, { key: 'ask-new', label: 'Neu' }] }),
  },
  { tab: 'more', label: 'Mehr', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg>', make: () => moreScreen() },
];

const tabState = {};
let activeTab = null;

function selectTab(tab) {
  const t = TABS.find((x) => x.tab === tab) || TABS[0];
  if (activeTab === t.tab) {
    // iOS: tapping the active tab pops to root, then scrolls to top.
    if (layerCount() > 0) popTo(0);
    else tabState[t.tab]?.scroller?.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  activeTab = t.tab;
  store.set('tab', t.tab);
  if (!tabState[t.tab]) {
    tabState[t.tab] = t.make();
    $('#app-body').prepend(tabState[t.tab].screen);
  }
  $$('.tab-screen').forEach((s) => s.classList.toggle('active', s === tabState[t.tab].screen));
  $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t.tab));
  const st = tabState[t.tab];
  if (st.load && !st.loaded) st.load();
  else st.refreshList?.();
}

// ---- "Mehr" -----------------------------------------------------------------

function cell({ icon, color, title, sub, value, onClick, chevron = true }) {
  return h('button', { class: 'cell has-icon', onclick: onClick },
    icon ? h('span', { class: 'cell-icon', style: `background:${color}`, html: icon }) : '',
    h('span', { class: 'cell-title' }, title, sub ? h('small', {}, sub) : ''),
    value != null ? h('span', { class: 'cell-value' }, value) : '',
    chevron ? h('span', { class: 'cell-chev', html: icons.chevron }) : '');
}

function section(head, rows, foot) {
  return h('div', { class: 'section' },
    head ? h('div', { class: 'section-h' }, head) : '',
    h('div', { class: 'group' }, ...rows),
    foot ? h('div', { class: 'section-f', html: foot }) : '');
}

function openFeed(key, extra = {}) {
  const fs = feedScreen({ key, pushed: true, ...extra });
  pushScreen(fs.screen);
  fs.load();
  return fs;
}

function moreScreen() {
  const screen = h('section', { class: 'screen grouped tab-screen', 'data-tab': 'more' });
  const content = h('div');
  const scroller = h('div', { class: 'scroller' }, h('h1', { class: 'large-title' }, 'Mehr'), content);
  const nav = h('header', { class: 'navbar' }, h('div', { class: 'nav-row' }, h('div', { class: 'nav-left' }), h('div', { class: 'nav-title' }, 'Mehr'), h('div', { class: 'nav-right' })));
  screen.append(scroller, nav);
  bindNavbar(screen);

  function render() {
    const customs = customFeeds();
    content.replaceChildren(
      section('Feeds', [
        cell({ icon: icons.star, color: '#af52de', title: 'Beste', sub: 'Höchstbewertete der letzten Tage', onClick: () => openFeed('best') }),
        cell({ icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 4h6a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3V6a2 2 0 0 1 2-2Zm0 3h6V6H9z"/></svg>', color: '#a2845e', title: 'Jobs', onClick: () => openFeed('jobs') }),
        cell({ icon: icons.bookmarkFill, color: 'var(--tint)', title: 'Gemerkt', value: String(bookmarks.all().length || ''), onClick: () => openFeed(null, { bookmarks: true, title: 'Gemerkt' }) }),
        cell({ icon: icons.search, color: '#8e8e93', title: 'Suche', sub: 'Komplettes HN-Archiv', onClick: () => openSearch() }),
      ]),
      section('Eigene Feeds', [
        ...customs.map((c) => cell({
          icon: icons.sparkle, color: '#30b0c7', title: c.title,
          sub: [BASE_LABEL[c.base] || c.base, filterSummary({ ...effectiveFilter(c.id) })].filter(Boolean).join(' · '),
          onClick: () => openFeed(c.id, { onDeleted: render, onChanged: render }),
        })),
        h('button', { class: 'cell action', onclick: newFeed }, h('span', { class: 'cell-title' }, '+ Neuer Feed …')),
      ], 'Kombiniere Kategorie, Zeitraum, Mindestpunkte, Quelle und Domains zu einem eigenen Feed. Jeder Feed lässt sich über den Filter-Button bearbeiten.'),
      settingsSections(render),
      h('div', { class: 'section-f', style: 'text-align:center;padding-bottom:20px' }, `cuzReader ${VERSION} · Daten: Hacker News API & Algolia`),
    );
  }

  function newFeed() {
    const n = prompt('Name des neuen Feeds', 'Mein Feed');
    if (!n) return;
    const list = customFeeds();
    const c = { id: 'c-' + Date.now().toString(36), title: n.trim(), base: 'top', filter: {} };
    list.push(c);
    saveCustomFeeds(list);
    render();
    const fs = openFeed(c.id, { onDeleted: render, onChanged: render });
    setTimeout(() => fs.screen.querySelector('.glass-group button')?.click(), 450);
  }

  render();
  bookmarks.onChange(render);
  return { screen, scroller, refreshList: render };
}

function settingsSections(rerender) {
  const theme = store.get('theme', 'system');
  const themeKeys = ['system', 'light', 'dark'];
  const linkKeys = ['web', 'reader'];
  const token = h('input', { type: 'password', placeholder: 'ghp_… (optional)', value: store.get('ghToken', ''), autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
  token.addEventListener('change', () => { store.set('ghToken', token.value.trim()); toast(token.value ? 'Token gespeichert' : 'Token entfernt', 'github'); });
  const frag = h('div');
  frag.append(
    section('Darstellung', [
      h('div', { class: 'cell' }, h('span', { class: 'cell-title' }, 'Design'),
        segmented(['System', 'Hell', 'Dunkel'], themeKeys.indexOf(theme), (i) => { store.set('theme', themeKeys[i]); applyTheme(); })),
      h('div', { class: 'cell' }, h('span', { class: 'cell-title' }, 'Favicons anzeigen'), switchEl(store.get('favicons', true), (v) => store.set('favicons', v))),
      h('div', { class: 'cell' }, h('span', { class: 'cell-title' }, 'Links öffnen als'),
        segmented(['Web', 'Reader'], linkKeys.indexOf(store.get('linkMode', 'web')), (i) => store.set('linkMode', linkKeys[i]))),
    ], 'Seiten, die keine Einbettung erlauben (z. B. X, Reddit, Paywalls), öffnen automatisch im Reader. Wechselst du bei einer Domain die Ansicht, merkt sich cuzReader das.'),
    section('GitHub', [
      h('div', { class: 'cell' }, h('span', { class: 'cell-icon', style: 'background:#24292f', html: icons.github }), token),
    ], 'Repositories werden nativ angezeigt (README, Dateien, Stars). Ohne Token erlaubt GitHub 60 Abrufe pro Stunde, mit <b>Fine-grained Token ohne Berechtigungen</b> 5.000. Der Token bleibt nur auf diesem Gerät.'),
    section('Daten', [
      h('button', { class: 'cell destructive', onclick: () => {
        if (!confirm('Alle „Gelesen“-Markierungen löschen?')) return;
        store.set('read', []);
        toast('Verlauf gelöscht', 'clock');
        setTimeout(() => location.reload(), 600);
      } }, 'Gelesen-Verlauf löschen'),
    ]),
  );
  return frag;
}

// ---- search -------------------------------------------------------------------

function openSearch() {
  const screen = h('section', { class: 'screen' });
  const input = h('input', { type: 'search', placeholder: 'Hacker News durchsuchen', enterkeyhint: 'search', autocapitalize: 'none', autocorrect: 'off' });
  const clear = h('button', { class: 'search-clear', html: icons.close, style: 'visibility:hidden', 'aria-label': 'Löschen', onclick: () => { input.value = ''; run(); input.focus(); } });
  const filterBtn = h('button', { 'aria-label': 'Filter', html: filterIcon });
  const nav = h('header', { class: 'navbar' }, h('div', { class: 'nav-row' },
    h('div', { class: 'nav-left' }, h('button', { class: 'glass-btn', 'aria-label': 'Zurück', html: icons.back, onclick: () => back() })),
    h('div', { class: 'nav-title' }, 'Suche'),
    h('div', { class: 'nav-right' }, h('div', { class: 'glass-group' }, filterBtn))));
  const scopes = [['all', 'Alle'], ['show', 'Show HN'], ['ask', 'Ask HN']];
  let scope = 'all';
  const seg = segmented(scopes.map((s) => s[1]), 0, (i) => { scope = scopes[i][0]; run(); });
  const chipSlot = h('div');
  const list = h('div', { class: 'list' });
  const hint = h('div', { class: 'empty' }, h('div', { class: 'empty-ico', html: icons.search }), h('h3', {}, 'Archiv durchsuchen'), h('p', {}, 'Titel, URLs und Texte aller Stories – kombinierbar mit Filtern wie „nur GitHub“ oder „≥ 100 Punkte“.'));
  const body = h('div', { class: 'feed-body' }, list);
  const scroller = h('div', { class: 'scroller' },
    h('h1', { class: 'large-title' }, 'Suche'),
    h('div', { class: 'searchbar' }, h('label', { class: 'search-field' }, h('span', { html: icons.search }), input, clear)),
    seg, chipSlot, hint, body);
  screen.append(scroller, nav);
  pushScreen(screen);
  bindNavbar(screen);
  const view = new FeedView({ scroller, list, onOpen: (item, o) => openStory(item, o), emptyAction: () => editFilter() });

  const updateChip = () => {
    const f = effectiveFilter('search');
    const active = isFiltered(f);
    filterBtn.classList.toggle('active', active);
    filterBtn.classList.toggle('badge-dot', active);
    chipSlot.replaceChildren();
    if (active) chipSlot.append(h('div', { class: 'filter-chip' }, h('span', {}, filterSummary(f)),
      h('button', { html: icons.close, 'aria-label': 'Filter entfernen', onclick: () => { setUserFilter('search', {}); updateChip(); run(); } })));
  };
  const editFilter = () => openFilterSheet('search', { onApply: (r) => { if (r.changed) { updateChip(); run(); } } });
  filterBtn.addEventListener('click', editFilter);

  let t;
  function run() {
    clearTimeout(t);
    clear.style.visibility = input.value ? 'visible' : 'hidden';
    const q = input.value.trim();
    hint.style.display = q ? 'none' : '';
    body.style.display = q ? '' : 'none';
    if (!q) return;
    t = setTimeout(() => view.setSource(new FeedSource(scope, effectiveFilter('search'), { query: q })), 280);
  }
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  scroller.addEventListener('touchstart', () => document.activeElement === input && input.blur(), { passive: true });
  updateChip();
  body.style.display = 'none';
  setTimeout(() => input.focus(), 460);
}

// ---- boot ---------------------------------------------------------------------

function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  initNav();
  const tabbar = $('#tabbar');
  for (const t of TABS) {
    tabbar.append(h('button', { 'data-tab': t.tab, 'aria-label': t.label, onclick: () => selectTab(t.tab) }, h('span', { html: t.icon, style: 'width:25px;height:25px' }), t.label));
  }
  selectTab(store.get('tab', 'top'));

  // Deep link: #/item/123
  const m = location.hash.match(/^#\/item\/(\d+)/);
  if (m) {
    history.replaceState({ cr: 0 }, '', location.pathname + location.search);
    openStory(Number(m[1]));
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
