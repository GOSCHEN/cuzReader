// GitHub: repo metadata, README, file browsing – rendered natively because github.com can't be framed.
import { marked } from '../vendor/marked.esm.js';
import { h, sanitize, store, compact, timeAgo, icons, esc } from './util.js';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const repoCache = new Map();

export class RateLimitError extends Error {}

function headers(accept = 'application/vnd.github+json') {
  const hd = { Accept: accept };
  const token = store.get('ghToken', '');
  if (token) hd.Authorization = `Bearer ${token}`;
  return hd;
}

async function api(path, accept) {
  const res = await fetch(API + path, { headers: headers(accept) });
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    throw new RateLimitError('GitHub API-Limit erreicht');
  }
  if (!res.ok) {
    const e = new Error(`GitHub ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return accept && accept.includes('html') ? res.text() : res.json();
}

export async function repoInfo(owner, repo) {
  const key = `${owner}/${repo}`.toLowerCase();
  if (repoCache.has(key)) return repoCache.get(key);
  try {
    const cached = JSON.parse(sessionStorage.getItem('gh:' + key) || 'null');
    if (cached) { repoCache.set(key, cached); return cached; }
  } catch { /* ignore */ }
  const p = api(`/repos/${owner}/${repo}`).then((d) => {
    const info = {
      full_name: d.full_name,
      owner: d.owner?.login,
      name: d.name,
      avatar: d.owner?.avatar_url,
      description: d.description,
      stars: d.stargazers_count,
      forks: d.forks_count,
      watchers: d.subscribers_count,
      issues: d.open_issues_count,
      language: d.language,
      license: d.license?.spdx_id && d.license.spdx_id !== 'NOASSERTION' ? d.license.spdx_id : '',
      topics: d.topics || [],
      homepage: d.homepage,
      pushed_at: d.pushed_at,
      created_at: d.created_at,
      default_branch: d.default_branch,
      archived: d.archived,
    };
    try { sessionStorage.setItem('gh:' + key, JSON.stringify(info)); } catch { /* ignore */ }
    repoCache.set(key, info);
    return info;
  });
  repoCache.set(key, p);
  p.catch(() => repoCache.delete(key));
  return p;
}

const LANG = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Go: '#00ADD8', Rust: '#dea584', C: '#555555',
  'C++': '#f34b7d', 'C#': '#178600', Java: '#b07219', Kotlin: '#A97BFF', Swift: '#F05138', Ruby: '#701516',
  PHP: '#4F5D95', Shell: '#89e051', HTML: '#e34c26', CSS: '#563d7c', Zig: '#ec915c', Elixir: '#6e4a7e',
  Haskell: '#5e5086', Lua: '#000080', Dart: '#00B4AB', Nix: '#7e7eff', OCaml: '#ef7a08', Scala: '#c22d40',
  Clojure: '#db5855', Julia: '#a270ba', R: '#198CE7', Vue: '#41b883', Svelte: '#ff3e00', 'Jupyter Notebook': '#DA5B0B',
  Odin: '#60AFFE', Gleam: '#ffaff3', Erlang: '#B83998', 'Objective-C': '#438eff', Assembly: '#6E4C13', Nim: '#ffc200',
};

/** Repo card used in the story detail and in the GitHub view header. */
export function repoCard(gh, info, { button = true, onOpen } = {}) {
  const el = h(button ? 'button' : 'div', { class: 'repo-card' });
  const name = `${info?.owner || gh.owner}/${info?.name || gh.repo}`;
  el.innerHTML = `
    <div class="repo-head">
      ${info?.avatar ? `<img src="${esc(info.avatar)}&s=88" alt="" loading="lazy">` : `<div class="lc-icon">${icons.github}</div>`}
      <div class="repo-name"><small>${esc(info?.owner || gh.owner)}</small>${esc(info?.name || gh.repo)}</div>
    </div>
    ${info?.description ? `<p class="repo-desc">${esc(info.description)}</p>` : ''}
    ${info ? `<div class="repo-stats">
      <span class="meta-i"><span class="star">${icons.star}</span>${compact(info.stars)}</span>
      <span class="meta-i">${icons.fork}${compact(info.forks)}</span>
      ${info.language ? `<span class="meta-i"><i class="lang-dot" style="background:${LANG[info.language] || 'var(--label-3)'}"></i>${esc(info.language)}</span>` : ''}
      ${info.license ? `<span class="meta-i">${esc(info.license)}</span>` : ''}
      ${info.pushed_at ? `<span class="meta-i">${icons.clock}${timeAgo(Date.parse(info.pushed_at) / 1000)}</span>` : ''}
      ${info.archived ? `<span class="meta-i" style="color:var(--yellow)">archiviert</span>` : ''}
    </div>` : ''}
    ${info?.topics?.length ? `<div class="repo-topics">${info.topics.slice(0, 8).map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
    ${button ? `<div class="repo-open"><span>Repository ansehen</span>${icons.chevron}</div>` : ''}`;
  el.setAttribute('aria-label', name);
  if (onOpen) el.addEventListener('click', onOpen);
  return el;
}

// ---- content ------------------------------------------------------------

export async function readmeHtml(owner, repo, ref) {
  try {
    const q = ref && ref !== 'HEAD' ? `?ref=${encodeURIComponent(ref)}` : '';
    const html = await api(`/repos/${owner}/${repo}/readme${q}`, 'application/vnd.github.html+json');
    return { html: sanitize(html), dir: '' };
  } catch (e) {
    // Rate limit or network: raw.githubusercontent has no API limit.
    for (const name of ['README.md', 'readme.md', 'Readme.md', 'README.markdown', 'README', 'README.rst', 'README.txt']) {
      const res = await fetch(`${RAW}/${owner}/${repo}/${ref || 'HEAD'}/${name}`).catch(() => null);
      if (res?.ok) {
        const text = await res.text();
        const isMd = /\.(md|markdown)$/i.test(name);
        return { html: isMd ? sanitize(marked.parse(text)) : `<pre>${esc(text)}</pre>`, dir: '', limited: e instanceof RateLimitError };
      }
    }
    if (e instanceof RateLimitError) throw e;
    const err = new Error('Kein README gefunden');
    err.status = 404;
    throw err;
  }
}

export async function listDir(owner, repo, path, ref) {
  const q = ref && ref !== 'HEAD' ? `?ref=${encodeURIComponent(ref)}` : '';
  const data = await api(`/repos/${owner}/${repo}/contents/${path}${q}`);
  if (!Array.isArray(data)) return null; // it's a file
  return data.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
}

const IMG = /\.(png|jpe?g|gif|webp|svg|avif|ico)$/i;
const MD = /\.(md|markdown|mdx)$/i;

export async function fileView(owner, repo, ref, path) {
  const url = `${RAW}/${owner}/${repo}/${ref || 'HEAD'}/${path}`;
  if (IMG.test(path)) return { kind: 'image', url };
  const res = await fetch(url);
  if (!res.ok) {
    const e = new Error(`Datei nicht gefunden (${res.status})`);
    e.status = res.status;
    throw e;
  }
  let text = await res.text();
  if (MD.test(path)) return { kind: 'markdown', html: sanitize(marked.parse(text)) };
  const truncated = text.length > 300000;
  if (truncated) text = text.slice(0, 300000);
  return { kind: 'code', text, truncated };
}

/** Resolve relative links/images inside rendered markdown so they point at GitHub. */
export function fixGitHubLinks(root, { owner, repo, ref = 'HEAD', dir = '' }) {
  const base = `https://github.com/${owner}/${repo}/blob/${ref}/${dir ? dir + '/' : ''}`;
  const rootBase = `https://github.com/${owner}/${repo}/blob/${ref}/`;
  const resolve = (v) => {
    if (!v || /^(https?:|mailto:|data:|#)/i.test(v)) return v;
    if (v.startsWith('//')) return 'https:' + v;
    if (v.startsWith(`/${owner}/${repo}/`)) return 'https://github.com' + v;
    if (v.startsWith('/')) return new URL(v.slice(1), rootBase).href;
    return new URL(v, base).href;
  };
  const toRaw = (u) => {
    const m = u.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
    return m ? `${RAW}/${m[1]}/${m[2]}/${m[3].replace(/\?raw=true$/, '')}` : u;
  };
  root.querySelectorAll('img[src]').forEach((img) => {
    img.src = toRaw(resolve(img.getAttribute('src')));
    img.loading = 'lazy';
  });
  root.querySelectorAll('source[srcset]').forEach((s) => {
    s.srcset = toRaw(resolve(s.getAttribute('srcset')));
  });
  root.querySelectorAll('a[href]').forEach((a) => {
    const v = a.getAttribute('href');
    if (v.startsWith('#')) return;
    a.setAttribute('href', resolve(v));
  });
}
