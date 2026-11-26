// In-app link overlay: native GitHub view, embedded web view or reader view.
import { marked } from '../vendor/marked.esm.js';
import { h, $, icons, esc, sanitize, store, parseGitHub, timeAgo } from './util.js';
import { addLayer, back } from './nav.js';
import { repoInfo, repoCard, readmeHtml, listDir, fileView, fixGitHubLinks, RateLimitError } from './github.js';
import { toast } from './ui.js';

// Sites known to forbid embedding (X-Frame-Options / CSP frame-ancestors).
const NO_FRAME = [
  'github.com', 'gist.github.com', 'gitlab.com', 'twitter.com', 'x.com', 'reddit.com', 'old.reddit.com', 'linkedin.com',
  'facebook.com', 'instagram.com', 'nytimes.com', 'wsj.com', 'bloomberg.com', 'ft.com', 'economist.com', 'washingtonpost.com',
  'stackoverflow.com', 'stackexchange.com', 'superuser.com', 'serverfault.com', 'google.com', 'apple.com', 'microsoft.com',
  'amazon.com', 'news.ycombinator.com', 'theverge.com', 'wired.com', 'arstechnica.com', 'bsky.app', 'threads.net',
  'mastodon.social', 'npmjs.com', 'crates.io', 'pypi.org', 'codeberg.org', 'sr.ht', 'huggingface.co', 'notion.so',
  'theguardian.com', 'bbc.com', 'bbc.co.uk', 'reuters.com', 'cnn.com', 'arxiv.org', 'substack.com', 'medium.com',
];

const readerCache = new Map();

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function blockedHost(host) {
  return NO_FRAME.some((d) => host === d || host.endsWith('.' + d));
}

function youtubeEmbed(url) {
  try {
    const u = new URL(url);
    let id = '';
    if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
    else if (/youtube\.com$/.test(u.hostname)) id = u.searchParams.get('v') || (u.pathname.match(/\/(shorts|embed|live)\/([\w-]+)/) || [])[2] || '';
    return id ? `https://www.youtube-nocookie.com/embed/${id}?playsinline=1` : '';
  } catch { return ''; }
}

function defaultMode(url) {
  const gh = parseGitHub(url);
  if (gh && ['', 'tree', 'blob'].includes(gh.kind)) return 'github';
  const host = hostOf(url);
  const prefs = store.get('modePrefs', {});
  if (prefs[host]) return prefs[host];
  if (youtubeEmbed(url)) return 'web';
  if (/\.pdf($|\?)/i.test(url)) return 'reader';
  if (blockedHost(host)) return 'reader';
  return store.get('linkMode', 'web');
}

let current = null;

/** Open a URL in the overlay. Re-uses the open overlay (pushes onto its history). */
export function openLink(url, opts = {}) {
  if (!/^https?:/i.test(url)) return;
  if (current) return current.go(url, opts.mode);
  current = new Browser();
  current.go(url, opts.mode);
}

class Browser {
  constructor() {
    this.hist = [];
    this.idx = -1;
    this.addr = h('div', { class: 'browser-addr' });
    this.progress = h('div', { class: 'browser-progress' });
    this.modeBtn = h('button', { class: 'glass-btn', 'aria-label': 'Ansicht wechseln', onclick: () => this.toggleMode() });
    const bar = h('div', { class: 'browser-bar' },
      h('button', { class: 'glass-btn text', onclick: () => back() }, 'Fertig'),
      this.addr,
      this.modeBtn,
      this.progress);
    this.main = h('div', { class: 'browser-main' });
    this.backBtn = h('button', { 'aria-label': 'Zurück', html: icons.back, onclick: () => this.step(-1) });
    this.fwdBtn = h('button', { 'aria-label': 'Vor', html: icons.chevron, onclick: () => this.step(1) });
    this.tools = h('div', { class: 'browser-tools' },
      this.backBtn, this.fwdBtn,
      h('button', { 'aria-label': 'Teilen', html: icons.share, onclick: () => this.share() }),
      h('button', { 'aria-label': 'In Safari öffnen', html: icons.safari, onclick: () => window.open(this.url, '_blank', 'noopener') }));
    this.hint = h('div', { class: 'browser-hint' });
    this.el = h('div', { class: 'browser' }, bar, this.main, this.tools, this.hint);
    $('#root').append(this.el);
    this.el.getBoundingClientRect();
    requestAnimationFrame(() => this.el.classList.add('in'));
    this.bindDismissDrag(bar);
    addLayer({
      type: 'overlay',
      recess: true,
      el: this.el,
      dismiss: () => this.close(),
    });
  }

  get entry() { return this.hist[this.idx]; }
  get url() { return this.entry?.url; }

  go(url, mode) {
    this.hist = this.hist.slice(0, this.idx + 1);
    this.hist.push({ url, mode: mode || defaultMode(url), scroll: 0 });
    this.idx++;
    this.render();
  }

  step(d) {
    const n = this.idx + d;
    if (n < 0 || n >= this.hist.length) return;
    this.saveScroll();
    this.idx = n;
    this.render();
  }

  saveScroll() {
    const sc = this.main.querySelector('.scroller');
    if (sc && this.entry) this.entry.scroll = sc.scrollTop;
  }

  toggleMode() {
    const e = this.entry;
    const gh = parseGitHub(e.url);
    const host = hostOf(e.url);
    const prefs = store.get('modePrefs', {});
    if (e.mode === 'reader') {
      e.mode = gh && ['', 'tree', 'blob'].includes(gh.kind) ? 'github' : 'web';
      if (e.mode === 'web') {
        if (store.get('linkMode', 'web') === 'web') delete prefs[host]; else prefs[host] = 'web';
      }
    } else {
      e.mode = 'reader';
      if (!gh) prefs[host] = 'reader';
    }
    store.set('modePrefs', prefs);
    this.render();
  }

  setAddr() {
    const e = this.entry;
    const gh = parseGitHub(e.url);
    const host = hostOf(e.url);
    const label = gh ? `${gh.owner}/${gh.repo}${gh.path ? ' · ' + gh.path.split('/').pop() : ''}` : host;
    const ico = gh ? icons.github : e.mode === 'reader' ? icons.reader : icons.globe;
    this.addr.innerHTML = `${ico}<span>${esc(label)}</span>`;
    this.modeBtn.innerHTML = e.mode === 'reader' ? (gh ? icons.github : icons.globe) : icons.reader;
    this.modeBtn.setAttribute('aria-label', e.mode === 'reader' ? 'Originalansicht' : 'Reader-Ansicht');
    this.modeBtn.classList.toggle('active', e.mode === 'reader');
    this.backBtn.disabled = this.idx <= 0;
    this.fwdBtn.disabled = this.idx >= this.hist.length - 1;
  }

  loading(on) {
    this.progress.style.opacity = on ? 1 : 0;
    this.progress.style.width = on ? '70%' : '100%';
    if (!on) setTimeout(() => { this.progress.style.width = '0'; }, 400);
  }

  showHint(text, action, fn, ms = 6000) {
    clearTimeout(this.hintT);
    this.hint.innerHTML = `<span>${esc(text)}</span>`;
    if (action) this.hint.append(h('button', { onclick: () => { this.hint.classList.remove('show'); fn(); } }, action));
    this.hint.classList.add('show');
    this.hintT = setTimeout(() => this.hint.classList.remove('show'), ms);
  }

  render() {
    clearTimeout(this.hintT);
    this.hint.classList.remove('show');
    const e = this.entry;
    this.setAddr();
    this.main.replaceChildren();
    const token = (this.renderToken = {});
    if (e.mode === 'web') return this.renderWeb(e);
    const sc = h('div', { class: 'scroller' });
    this.main.append(sc);
    sc.addEventListener('click', (ev) => this.onContentClick(ev, sc));
    const restore = () => { if (e.scroll) sc.scrollTop = e.scroll; };
    this.loading(true);
    const p = e.mode === 'github' ? this.renderGitHub(e, sc, token) : this.renderReader(e, sc, token);
    p.then(restore).finally(() => this.renderToken === token && this.loading(false));
  }

  renderWeb(e) {
    const src = youtubeEmbed(e.url) || e.url;
    const frame = h('iframe', {
      src,
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-modals',
      allow: 'fullscreen; autoplay; encrypted-media; picture-in-picture; clipboard-write',
      referrerpolicy: 'strict-origin-when-cross-origin',
      title: hostOf(e.url),
    });
    this.loading(true);
    let loaded = false;
    frame.addEventListener('load', () => {
      loaded = true;
      this.loading(false);
      this.showHint('Seite bleibt leer? Manche Seiten verbieten die Einbettung.', 'Reader', () => this.toggleMode(), 5000);
    });
    setTimeout(() => {
      if (!loaded && this.entry === e) this.showHint('Lädt langsam – Reader-Ansicht probieren?', 'Reader', () => this.toggleMode(), 8000);
    }, 9000);
    this.main.append(frame);
  }

  async renderReader(e, sc, token) {
    const box = h('div', { class: 'reader' }, h('div', { class: 'spinner', style: 'margin-top:40px', html: spinnerHtml() }));
    sc.append(box);
    try {
      let data = readerCache.get(e.url);
      if (!data) {
        const res = await fetch('https://r.jina.ai/' + e.url, { headers: { 'X-Return-Format': 'markdown' } });
        if (!res.ok) throw new Error(res.status === 429 ? 'Reader-Limit erreicht (20/min) – kurz warten.' : `Reader-Fehler ${res.status}`);
        data = parseReader(await res.text());
        readerCache.set(e.url, data);
      }
      if (this.renderToken !== token) return;
      const body = h('div', { class: 'prose', html: sanitize(marked.parse(data.markdown)) });
      body.querySelectorAll('a[href]').forEach((a) => {
        try { a.href = new URL(a.getAttribute('href'), e.url).href; } catch { /* ignore */ }
      });
      body.querySelectorAll('img').forEach((img) => { img.loading = 'lazy'; });
      box.replaceChildren(
        h('h1', { class: 'r-title' }, data.title || hostOf(e.url)),
        h('div', { class: 'r-src' }, `${hostOf(e.url)}${data.published ? ' · ' + data.published : ''} · Reader-Ansicht`),
        body);
    } catch (err) {
      if (this.renderToken !== token) return;
      box.replaceChildren(errorBox(err.message || 'Seite konnte nicht geladen werden.', [
        ['Web-Ansicht', () => { e.mode = 'web'; this.render(); }],
        ['In Safari öffnen', () => window.open(e.url, '_blank', 'noopener')],
      ]));
    }
  }

  async renderGitHub(e, sc, token) {
    const gh = parseGitHub(e.url);
    const wrap = h('div', { class: 'ghv' });
    sc.append(wrap);
    const head = h('div', { class: 'gh-head' });
    wrap.append(head);
    let info = null;
    try {
      info = await repoInfo(gh.owner, gh.repo);
    } catch (err) {
      if (err instanceof RateLimitError) wrap.append(rateNotice());
      else if (err.status === 404) {
        head.replaceWith(errorBox('Repository nicht gefunden oder privat.', [['In Safari öffnen', () => window.open(e.url, '_blank', 'noopener')]]));
        return;
      }
    }
    if (this.renderToken !== token) return;
    const ref = gh.ref || info?.default_branch || 'HEAD';
    head.append(repoCard(gh, info, { button: false }));
    if (info?.homepage) {
      const hp = h('a', { class: 'btn-tinted', href: info.homepage, style: 'margin-top:14px;width:100%' }, h('span', { html: icons.globe, style: 'width:18px;height:18px' }), 'Website');
      head.append(hp);
    }

    const isRoot = !gh.kind;
    const content = h('div');
    if (isRoot) {
      const seg = segmented(['README', 'Dateien'], e.tab || 0, (i) => { e.tab = i; show(i); });
      wrap.append(h('div', { class: 'gh-tabs' }, seg), content);
      const show = (i) => (i === 0 ? this.ghReadme(gh, ref, content, token) : this.ghDir(gh, ref, '', content, token));
      return show(e.tab || 0);
    }
    wrap.append(crumbs(gh, ref, (url) => this.go(url)), content);
    if (gh.kind === 'tree') return this.ghDir(gh, ref, gh.path, content, token);
    return this.ghFile(gh, ref, content, token, e);
  }

  async ghReadme(gh, ref, content, token) {
    content.replaceChildren(h('div', { class: 'spinner', style: 'margin:40px auto', html: spinnerHtml() }));
    try {
      const { html, limited } = await readmeHtml(gh.owner, gh.repo, ref);
      if (this.renderToken !== token) return;
      const md = h('article', { class: 'markdown-body', html });
      fixGitHubLinks(md, { owner: gh.owner, repo: gh.repo, ref });
      content.replaceChildren(...(limited ? [rateNotice()] : []), md);
    } catch (err) {
      if (this.renderToken !== token) return;
      content.replaceChildren(err instanceof RateLimitError ? rateNotice() : errorBox(err.message, []));
    }
  }

  async ghDir(gh, ref, path, content, token) {
    content.replaceChildren(h('div', { class: 'spinner', style: 'margin:40px auto', html: spinnerHtml() }));
    try {
      const items = await listDir(gh.owner, gh.repo, path, ref);
      if (this.renderToken !== token) return;
      if (!items) return this.ghFile({ ...gh, path }, ref, content, token, this.entry);
      const group = h('div', { class: 'group gh-files' });
      for (const it of items) {
        const url = `https://github.com/${gh.owner}/${gh.repo}/${it.type === 'dir' ? 'tree' : 'blob'}/${ref}/${it.path}`;
        group.append(h('button', { class: 'cell', onclick: () => this.go(url) },
          h('span', { class: 'fi-wrap', html: (it.type === 'dir' ? icons.folder : icons.file).replace('<svg', `<svg class="fi${it.type === 'dir' ? ' dir' : ''}"`) }),
          h('span', { class: 'cell-title' }, it.name),
          it.type === 'file' && it.size ? h('span', { class: 'cell-value', style: 'font-size:13px' }, fmtSize(it.size)) : '',
          h('span', { class: 'cell-chev', html: icons.chevron })));
      }
      content.replaceChildren(group);
    } catch (err) {
      if (this.renderToken !== token) return;
      content.replaceChildren(err instanceof RateLimitError ? rateNotice() : errorBox('Ordner konnte nicht geladen werden.', [
        ['Reader-Ansicht', () => { this.entry.mode = 'reader'; this.render(); }],
      ]));
    }
  }

  async ghFile(gh, ref, content, token, e) {
    content.replaceChildren(h('div', { class: 'spinner', style: 'margin:40px auto', html: spinnerHtml() }));
    try {
      const f = await fileView(gh.owner, gh.repo, ref, gh.path);
      if (this.renderToken !== token) return;
      if (f.kind === 'image') content.replaceChildren(h('div', { style: 'padding:16px;text-align:center' }, h('img', { src: f.url, style: 'max-width:100%' })));
      else if (f.kind === 'markdown') {
        const md = h('article', { class: 'markdown-body', html: f.html });
        fixGitHubLinks(md, { owner: gh.owner, repo: gh.repo, ref, dir: gh.path.split('/').slice(0, -1).join('/') });
        content.replaceChildren(md);
      } else {
        const pre = h('pre', { class: 'code-view' });
        pre.textContent = f.text;
        content.replaceChildren(pre);
        if (f.truncated) content.append(h('div', { class: 'notice' }, 'Datei gekürzt angezeigt.'));
      }
      if (gh.hash) jumpTo(content, gh.hash.slice(1));
    } catch (err) {
      if (this.renderToken !== token) return;
      if (err.status === 404 && gh.kind === 'blob') {
        // Might be a directory linked via /blob/
        return this.ghDir(gh, ref, gh.path, content, token);
      }
      content.replaceChildren(errorBox(err.message, [['Reader-Ansicht', () => { e.mode = 'reader'; this.render(); }]]));
    }
  }

  onContentClick(ev, sc) {
    const a = ev.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    ev.preventDefault();
    if (href.startsWith('#')) return jumpTo(sc, decodeURIComponent(href.slice(1)));
    const abs = a.href;
    if (!/^https?:/i.test(abs)) return;
    const hn = abs.match(/news\.ycombinator\.com\/item\?id=(\d+)/);
    if (hn) {
      back();
      setTimeout(() => import('./detail.js').then((m) => m.openStory(Number(hn[1]))), 350);
      return;
    }
    this.saveScroll();
    this.go(abs);
  }

  async share() {
    const url = this.url;
    try {
      if (navigator.share) await navigator.share({ url });
      else { await navigator.clipboard.writeText(url); toast('Link kopiert'); }
    } catch { /* cancelled */ }
  }

  bindDismissDrag(bar) {
    let sy = 0, dy = 0, t0 = 0, active = false;
    bar.addEventListener('touchstart', (e) => {
      if (e.target.closest('button')) return;
      active = true; sy = e.touches[0].clientY; dy = 0; t0 = e.timeStamp;
      this.el.classList.add('dragging');
    }, { passive: true });
    bar.addEventListener('touchmove', (e) => {
      if (!active) return;
      e.preventDefault();
      dy = Math.max(0, e.touches[0].clientY - sy);
      this.el.style.transform = `translateY(${dy}px)`;
    }, { passive: false });
    const end = (e) => {
      if (!active) return;
      active = false;
      this.el.classList.remove('dragging');
      const v = dy / Math.max(1, e.timeStamp - t0);
      if (dy > 140 || (v > 0.6 && dy > 30)) back();
      else this.el.style.transform = '';
    };
    bar.addEventListener('touchend', end);
    bar.addEventListener('touchcancel', end);
  }

  close() {
    this.el.style.transform = '';
    this.el.classList.remove('in');
    setTimeout(() => this.el.remove(), 550);
    if (current === this) current = null;
  }
}

// ---- helpers --------------------------------------------------------------

export function spinnerHtml() {
  return Array.from({ length: 8 }, (_, i) => `<i style="transform:rotate(${i * 45}deg);animation-delay:${(i - 8) / 8}s"></i>`).join('');
}

function parseReader(text) {
  const title = (text.match(/^Title:\s*(.*)$/m) || [])[1] || '';
  const published = (text.match(/^Published Time:\s*(.*)$/m) || [])[1] || '';
  const idx = text.indexOf('Markdown Content:');
  const markdown = idx >= 0 ? text.slice(idx + 'Markdown Content:'.length) : text;
  let pub = '';
  if (published) {
    const t = Date.parse(published);
    if (!isNaN(t)) pub = timeAgo(t / 1000);
  }
  return { title, published: pub, markdown };
}

function errorBox(msg, actions) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-ico', html: icons.globe }),
    h('h3', {}, 'Nicht verfügbar'),
    h('p', {}, msg),
    h('div', { style: 'display:flex;flex-direction:column;gap:10px;align-items:center' },
      actions.map(([label, fn], i) => h('button', { class: i ? 'btn-tinted' : 'btn-filled', onclick: fn }, label))));
}

function rateNotice() {
  return h('div', { class: 'notice', html: '<b>GitHub-API-Limit erreicht.</b> README wird ohne API geladen. Hinterlege unter <b>Mehr → GitHub-Token</b> einen Token für 5.000 statt 60 Abrufe pro Stunde.' });
}

export function segmented(labels, active, onChange) {
  const el = h('div', { class: 'segmented', role: 'tablist' });
  const thumb = h('div', { class: 'thumb' });
  el.append(thumb);
  const btns = labels.map((l, i) => h('button', { role: 'tab', onclick: () => set(i, true) }, l));
  el.append(...btns);
  const place = () => {
    const b = btns[el._active];
    if (!b || !b.offsetWidth) return;
    thumb.style.width = b.offsetWidth + 'px';
    thumb.style.transform = `translateX(${b.offsetLeft - 2}px)`;
  };
  const set = (i, user) => {
    if (user && el._active === i) return;
    el._active = i;
    btns.forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-selected', j === i); });
    place();
    if (user) onChange?.(i);
  };
  el.set = set;
  set(active, false);
  new ResizeObserver(place).observe(el);
  return el;
}

function crumbs(gh, ref, go) {
  const el = h('div', { class: 'gh-crumbs' });
  const parts = gh.path ? gh.path.split('/') : [];
  el.append(h('button', { onclick: () => go(`https://github.com/${gh.owner}/${gh.repo}`) }, gh.repo));
  parts.forEach((p, i) => {
    el.append(' / ');
    const path = parts.slice(0, i + 1).join('/');
    if (i === parts.length - 1) el.append(h('span', {}, p));
    else el.append(h('button', { onclick: () => go(`https://github.com/${gh.owner}/${gh.repo}/tree/${ref}/${path}`) }, p));
  });
  return el;
}

function jumpTo(root, id) {
  const t = root.querySelector(`[id="user-content-${CSS.escape(id)}"], [id="${CSS.escape(id)}"], [name="${CSS.escape(id)}"]`);
  t?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
