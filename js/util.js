import DOMPurify from '../vendor/purify.es.mjs';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('rel', 'noopener noreferrer');
    node.removeAttribute('target');
  }
});

export function sanitize(html) {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe'],
    FORBID_ATTR: ['style'],
  });
}

/** HN text is HTML with <p> separators but the first paragraph has none. */
export function hnHtml(text) {
  if (!text) return '';
  let t = text;
  if (!/^\s*<p>/i.test(t)) t = '<p>' + t.replace(/<p>/i, '</p><p>');
  return sanitize(t);
}

export function domainOf(url) {
  try {
    const u = new URL(url);
    let host = u.hostname.replace(/^www\./, '');
    if (host === 'github.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length) return 'github.com/' + parts[0];
    }
    return host;
  } catch {
    return '';
  }
}

const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto', style: 'short' });
export function timeAgo(sec) {
  const diff = sec - Date.now() / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'gerade eben';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86400 * 365)), 'year');
}

export function compact(n) {
  return new Intl.NumberFormat('de', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
}

export function decodeEntities(s) {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

/** Tiny persistent store (localStorage can throw in private mode). */
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('cr:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('cr:' + key, JSON.stringify(value));
    } catch { /* ignore */ }
  },
};

export function parseGitHub(url) {
  try {
    const u = new URL(url);
    if (!/^(www\.)?github\.com$/.test(u.hostname)) return null;
    const [owner, repo, kind, ref, ...rest] = u.pathname.split('/').filter(Boolean);
    if (!owner || !repo) return null;
    const reserved = ['orgs', 'sponsors', 'settings', 'marketplace', 'topics', 'features', 'about', 'login', 'collections', 'trending', 'explore'];
    if (reserved.includes(owner)) return null;
    return { owner, repo: repo.replace(/\.git$/, ''), kind: kind || '', ref: ref || '', path: rest.join('/'), hash: u.hash };
  } catch {
    return null;
  }
}

/** First GitHub repo referenced by a story (url, then text). */
export function githubRepoOf(item) {
  const gh = item.url && parseGitHub(item.url);
  if (gh) return gh;
  const m = (item.text || '').match(/https?:\/\/(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+/i);
  return m ? parseGitHub(decodeEntities(m[0])) : null;
}

let probe;
/** Safe-area insets in px (env() can't be read from JS directly). */
export function safeArea() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0';
    document.body.append(probe);
  }
  const cs = getComputedStyle(probe);
  return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
}

export function haptic() {
  try { navigator.vibrate?.(8); } catch { /* not supported on iOS */ }
}

const I = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const icons = {
  flame: I('<path d="M12 22c4.4 0 7-2.9 7-6.6 0-3.8-2.6-6-4.3-8.9-.5 2-1.6 3.2-2.8 3.6C12.6 6.6 11 3.9 8.5 2c.3 3.6-3.5 6.2-3.5 11.3C5 18.8 7.9 22 12 22Z" fill="currentColor" stroke="none"/>'),
  sparkle: I('<path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z" fill="currentColor" stroke="none"/><path d="M19 17l.9 2.1L22 20l-2.1.9L19 23l-.9-2.1L16 20l2.1-.9z" fill="currentColor" stroke="none"/>'),
  show: I('<rect x="2.5" y="4" width="19" height="13" rx="2.5" fill="currentColor" stroke="none"/><path d="M8 21h8M12 17v4" /><path d="M10 8.2v5.6l4.6-2.8z" fill="var(--icon-cut, #fff)" stroke="none"/>'),
  ask: I('<path d="M12 2.5C6.5 2.5 2.5 6.3 2.5 11c0 2.6 1.3 4.9 3.3 6.4-.2 1.5-.9 2.8-2 3.9 2 0 3.9-.7 5.3-1.8 1 .3 1.9.4 2.9.4 5.5 0 9.5-3.8 9.5-8.5S17.5 2.5 12 2.5Z" fill="currentColor" stroke="none"/><path d="M9.8 9.2a2.3 2.3 0 1 1 3.1 2.2c-.6.3-.9.8-.9 1.5v.3" stroke="var(--icon-cut, #fff)" stroke-width="1.9"/><circle cx="12" cy="15.6" r="1.1" fill="var(--icon-cut, #fff)" stroke="none"/>'),
  bookmark: I('<path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1Z"/>'),
  bookmarkFill: I('<path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1Z" fill="currentColor"/>'),
  search: I('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/>', 'stroke-width="2.4"'),
  back: I('<path d="M15 4l-8 8 8 8"/>', 'stroke-width="2.6"'),
  close: I('<path d="M6 6l12 12M18 6L6 18"/>', 'stroke-width="2.6"'),
  share: I('<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v7A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16"/>'),
  safari: I('<circle cx="12" cy="12" r="9.5"/><path d="M15.8 8.2l-2.3 5.3-5.3 2.3 2.3-5.3z" fill="currentColor"/>'),
  reader: I('<path d="M4 6h16M4 10h16M4 14h10M4 18h13"/>'),
  globe: I('<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.8 3.8 6 3.8 9.5s-1.2 6.7-3.8 9.5c-2.6-2.8-3.8-6-3.8-9.5S9.4 5.3 12 2.5Z"/>'),
  chevron: I('<path d="M9 5l7 7-7 7"/>', 'stroke-width="2.4"'),
  up: I('<path d="M12 4l8 10h-5v6H9v-6H4z" fill="currentColor" stroke="none"/>'),
  comment: I('<path d="M12 3.5c-5 0-9 3.4-9 7.6 0 2.3 1.2 4.4 3.1 5.8-.2 1.4-.8 2.6-1.8 3.6 1.9 0 3.6-.6 4.9-1.6.9.2 1.8.3 2.8.3 5 0 9-3.4 9-7.6s-4-7.6-9-7.6Z"/>'),
  clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  person: I('<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>'),
  star: I('<path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" fill="currentColor" stroke="none"/>'),
  fork: I('<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 12v5"/>'),
  eye: I('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  github: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>',
  gear: I('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  file: I('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  folder: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor" stroke="none"/>'),
};
