import { h, $, icons } from './util.js';

let toastEl, toastT;
export function toast(text, icon = 'bookmarkFill') {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast', role: 'status' });
    $('#root').append(toastEl);
  }
  toastEl.innerHTML = (icons[icon] || '') + `<span></span>`;
  toastEl.querySelector('span').textContent = text;
  toastEl.getBoundingClientRect();
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

export function switchEl(checked, onChange) {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span'));
}
