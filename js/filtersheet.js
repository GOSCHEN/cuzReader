// Filter sheet: per-feed filters + saving combinations as custom feeds.
import { h, icons, $ } from './util.js';
import { addLayer, back } from './nav.js';
import { Sheet } from './sheet.js';
import { segmented } from './browser.js';
import { switchEl, toast } from './ui.js';
import {
  DEFAULT_FILTER, RANGE_LABEL, SORT_LABEL, SOURCE_LABEL, POINT_STEPS, COMMENT_STEPS,
  feedDef, effectiveFilter, setUserFilter, customFeeds, saveCustomFeeds,
} from './feeds.js';

const RANGE_KEYS = Object.keys(RANGE_LABEL);
const SORT_KEYS = Object.keys(SORT_LABEL);
const SOURCE_KEYS = Object.keys(SOURCE_LABEL);
const CUSTOM_BASES = [['top', 'Top'], ['new', 'Neu'], ['best', 'Beste'], ['show', 'Show'], ['ask', 'Ask']];
const DOMAIN_SUGGEST = ['github.com', 'gitlab.com', 'codeberg.org', 'arxiv.org', 'youtube.com', 'substack.com', 'medium.com'];

/**
 * key: feed key. opts.noRange hides the time range (e.g. bookmarks), opts.onApply(result)
 * result = { changed, deleted, renamed }
 */
export function openFilterSheet(key, { onApply, noRange = false, title = 'Filter' } = {}) {
  const def = feedDef(key) || { key, base: null, fixed: {} };
  const custom = def.custom ? customFeeds().find((c) => c.id === key) : null;
  const start = custom ? { ...DEFAULT_FILTER, ...custom.filter } : effectiveFilter(key);
  const draft = { ...start, domains: [...start.domains] };
  let base = custom?.base;
  let name = custom?.title;
  let result = { changed: false };

  const body = h('div');
  const rebuild = () => body.replaceChildren(...sections());
  const section = (head, content, foot) => h('div', { class: 'section' },
    head ? h('div', { class: 'section-h' }, head) : '',
    h('div', { class: 'group' }, ...[].concat(content)),
    foot ? h('div', { class: 'section-f' }, foot) : '');

  const segCell = (labels, keys, val, onChange) =>
    h('div', { class: 'cell' }, segmented(labels, Math.max(0, keys.indexOf(val)), (i) => onChange(keys[i])));

  const stepper = (label, steps, val, onChange) => {
    const valEl = h('span', { class: 'cell-value' });
    const minus = h('button', { 'aria-label': label + ' verringern' }, '−');
    const plus = h('button', { 'aria-label': label + ' erhöhen' }, '+');
    let i = Math.max(0, steps.indexOf(val));
    if (steps.indexOf(val) < 0) i = steps.findIndex((s) => s >= val);
    const upd = () => {
      valEl.textContent = steps[i] ? `≥ ${steps[i]}` : 'egal';
      minus.disabled = i === 0;
      plus.disabled = i === steps.length - 1;
    };
    minus.onclick = () => { i = Math.max(0, i - 1); upd(); onChange(steps[i]); };
    plus.onclick = () => { i = Math.min(steps.length - 1, i + 1); upd(); onChange(steps[i]); };
    upd();
    return h('div', { class: 'cell' }, h('span', { class: 'cell-title' }, label), valEl, h('div', { class: 'stepper' }, minus, plus));
  };

  function domainCell() {
    const input = h('input', { type: 'text', placeholder: 'Domain hinzufügen, z. B. lwn.net', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done', inputmode: 'url' });
    const add = (d) => {
      d = d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      if (!d || !d.includes('.') || draft.domains.includes(d)) return;
      draft.domains.push(d);
      rebuild();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(input.value); } });
    input.addEventListener('blur', () => input.value && add(input.value));
    const chips = h('div', { class: 'chips' },
      draft.domains.map((d) => h('button', { class: 'chip on', onclick: () => { draft.domains = draft.domains.filter((x) => x !== d); rebuild(); } }, d, h('span', { class: 'x', html: icons.close }))),
      DOMAIN_SUGGEST.filter((d) => !draft.domains.includes(d)).map((d) => h('button', { class: 'chip add', onclick: () => add(d) }, '+ ' + d)));
    return [h('div', { class: 'cell' }, input), h('div', { class: 'cell' }, chips)];
  }

  function sections() {
    const out = [];
    if (custom) {
      const nameInput = h('input', { type: 'text', value: name, placeholder: 'Name', enterkeyhint: 'done' });
      nameInput.addEventListener('input', () => { name = nameInput.value; });
      out.push(section('Eigener Feed', [
        h('div', { class: 'cell' }, nameInput),
        segCell(CUSTOM_BASES.map((b) => b[1]), CUSTOM_BASES.map((b) => b[0]), base, (v) => { base = v; }),
      ], 'Grundliste, auf die die Filter angewendet werden.'));
    }
    if (!noRange) {
      out.push(section('Zeitraum', segCell(RANGE_KEYS.map((k) => RANGE_LABEL[k]), RANGE_KEYS, draft.range, (v) => { draft.range = v; }),
        '„Aktuell“ filtert die Live-Liste von Hacker News. Ein Zeitraum durchsucht stattdessen das gesamte HN-Archiv dieser Kategorie.'));
    }
    out.push(section('Sortierung', segCell(['Ranking', 'Punkte', 'Komm.', 'Neueste'], SORT_KEYS, draft.sort, (v) => { draft.sort = v; })));
    out.push(section('Mindestwerte', [
      stepper('Punkte', POINT_STEPS, draft.minPoints, (v) => { draft.minPoints = v; }),
      stepper('Kommentare', COMMENT_STEPS, draft.minComments, (v) => { draft.minComments = v; }),
    ]));
    out.push(section('Quelle', [
      segCell(SOURCE_KEYS.map((k) => SOURCE_LABEL[k]), SOURCE_KEYS, draft.source, (v) => { draft.source = v; }),
    ], '„GitHub“ zeigt Beiträge, die auf ein Repository verlinken – auch wenn der Link nur im Text steht.'));
    out.push(section('Nur diese Domains', domainCell(), draft.domains.length ? 'Mehrere Domains werden mit ODER verknüpft.' : 'Leer = alle Domains.'));
    out.push(section('', h('div', { class: 'cell' }, h('span', { class: 'cell-title' }, 'Gelesene ausblenden'), switchEl(draft.hideRead, (v) => { draft.hideRead = v; }))));
    if (custom) {
      out.push(section('', h('button', { class: 'cell destructive', onclick: del }, 'Feed löschen')));
    } else if (!noRange) {
      out.push(section('', h('button', { class: 'cell action', onclick: saveAsCustom }, h('span', { class: 'cell-title' }, 'Als eigenen Feed sichern …')),
        'Eigene Feeds findest du unter „Mehr“.'));
    }
    return out;
  }

  function saveAsCustom() {
    const n = prompt('Name des neuen Feeds', def.title ? `${def.title} (gefiltert)` : 'Mein Feed');
    if (!n) return;
    const list = customFeeds();
    list.push({ id: 'c-' + Date.now().toString(36), title: n.trim(), base: def.base || 'top', filter: { ...draft } });
    saveCustomFeeds(list);
    toast(`„${n.trim()}“ gespeichert`, 'sparkle');
    result.created = true;
  }

  function del() {
    if (!confirm(`Feed „${custom.title}“ löschen?`)) return;
    saveCustomFeeds(customFeeds().filter((c) => c.id !== key));
    result.deleted = true;
    back();
  }

  const reset = () => {
    const fixed = custom ? {} : def.fixed || {};
    Object.assign(draft, { ...DEFAULT_FILTER, ...fixed, domains: [...(fixed.domains || [])] });
    rebuild();
  };

  const head = h('div', { class: 'sheet-head' },
    h('div', { class: 'side' }, h('button', { class: 'glass-btn text', style: 'font-weight:500', onclick: reset }, 'Zurücksetzen')),
    h('h2', {}, title),
    h('div', { class: 'side r' }, h('button', { class: 'glass-btn text tinted', onclick: () => back() }, 'Fertig')));
  rebuild();

  const root = $('#root');
  const sheet = new Sheet({
    container: root,
    className: 'grouped-bg filter-sheet',
    head,
    body,
    detents: () => [Math.round(root.clientHeight * 0.62), root.clientHeight - 54],
    initial: 1,
    requestDismiss: () => back(),
  }).mount();

  addLayer({
    type: 'sheet',
    el: sheet.el,
    dismiss: () => {
      document.activeElement?.blur?.();
      sheet.dismiss();
      if (result.deleted) return onApply?.(result);
      if (custom) {
        const list = customFeeds();
        const c = list.find((x) => x.id === key);
        if (c) {
          c.filter = { ...draft };
          c.base = base;
          c.title = (name || '').trim() || c.title;
          saveCustomFeeds(list);
        }
      } else {
        // Store only the user's deviation from the feed's built-in filter.
        const fixed = { ...DEFAULT_FILTER, ...(def.fixed || {}) };
        const diff = {};
        for (const k of Object.keys(draft)) {
          if (JSON.stringify(draft[k]) !== JSON.stringify(fixed[k])) diff[k] = draft[k];
        }
        setUserFilter(key, diff);
      }
      result.changed = JSON.stringify(draft) !== JSON.stringify(start) || (custom && (base !== custom.base || name !== custom.title));
      onApply?.(result);
    },
  });
}
