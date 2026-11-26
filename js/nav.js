// History-driven navigation stack: pushed screens, sheets and overlays.
// Every layer pushes a history entry, so Android/desktop back and our own
// back buttons/gestures all go through history.back() → popstate → dismiss.
import { $ } from './util.js';

const layers = [];
let appBody, tabbar;
let suppressPop = 0;

export function initNav() {
  appBody = $('#app-body');
  tabbar = $('#tabbar');
  history.replaceState({ cr: 0 }, '');
  window.addEventListener('popstate', () => {
    if (suppressPop > 0) { suppressPop--; return; }
    const top = layers.pop();
    if (top) top.dismiss(top.gesture);
    sync();
  });
}

export function layerCount() {
  return layers.length;
}

function sync() {
  const screens = layers.filter((l) => l.type === 'screen');
  tabbar.classList.toggle('hidden', screens.length > 0);
  appBody.classList.toggle('recessed', layers.some((l) => l.recess));
}

/** Register a layer. `dismiss(fromGesture)` must animate it away. */
export function addLayer(layer) {
  layers.push(layer);
  history.pushState({ cr: layers.length }, '');
  sync();
}

export function back(fromGesture = false) {
  const top = layers[layers.length - 1];
  if (top) top.gesture = fromGesture;
  history.back();
}

/** Close all layers above (and including) the given one without animation of others. */
export function popTo(count) {
  const n = layers.length - count;
  if (n <= 0) return;
  for (let i = 0; i < n; i++) {
    const l = layers.pop();
    l.dismiss(false);
  }
  suppressPop++;
  history.go(-n);
  sync();
}

export function topScreenEl() {
  for (let i = layers.length - 1; i >= 0; i--) if (layers[i].type === 'screen') return layers[i].el;
  return document.querySelector('.tab-screen.active');
}

/** Push a full screen from the right (UINavigationController style). */
export function pushScreen(el, { onClose } = {}) {
  const prev = topScreenEl();
  el.classList.add('screen', 'stack-screen');
  if (!el.querySelector(':scope > .cover-dim')) el.append(Object.assign(document.createElement('div'), { className: 'cover-dim' }));
  appBody.append(el);
  el.getBoundingClientRect();
  requestAnimationFrame(() => {
    el.classList.add('in');
    prev?.classList.add('covered');
  });
  attachEdgeSwipe(el, prev);
  addLayer({
    type: 'screen',
    el,
    dismiss(fromGesture) {
      el.classList.remove('in');
      prev?.classList.remove('covered');
      prev && (prev.style.transform = '');
      const done = () => { el.remove(); onClose?.(); };
      if (fromGesture) {
        el.style.transform = '';
        setTimeout(done, 300);
      } else {
        el.addEventListener('transitionend', done, { once: true });
        setTimeout(done, 600);
      }
    },
  });
}

function attachEdgeSwipe(el, prev) {
  let sx = 0, sy = 0, active = false, decided = false, lastX = 0, lastT = 0, v = 0;
  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t.clientX > 28 || layers[layers.length - 1]?.el !== el) return;
    sx = lastX = t.clientX; sy = t.clientY; lastT = e.timeStamp;
    active = true; decided = false; v = 0;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!active) return;
    const t = e.touches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (!decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx) || dx < 0) { active = false; return; }
      decided = true;
      el.classList.add('dragging');
      prev?.classList.add('dragging');
    }
    e.preventDefault();
    const x = Math.max(0, dx);
    const w = el.clientWidth;
    el.style.transform = `translateX(${x}px)`;
    if (prev) prev.style.transform = `translateX(${-28 + (x / w) * 28}%)`;
    v = (t.clientX - lastX) / Math.max(1, e.timeStamp - lastT);
    lastX = t.clientX; lastT = e.timeStamp;
  }, { passive: false });
  const end = () => {
    if (!active) return;
    active = false;
    if (!decided) return;
    el.classList.remove('dragging');
    prev?.classList.remove('dragging');
    const x = lastX - sx;
    if (x > el.clientWidth * 0.35 || v > 0.45) {
      el.style.transform = 'translateX(100%)';
      if (prev) prev.style.transform = 'translateX(0)';
      back(true);
    } else {
      el.style.transform = '';
      if (prev) prev.style.transform = '';
    }
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}

/** Large-title nav bar behaviour: show compact title + glass once scrolled. */
export function bindNavbar(screen) {
  const nav = screen.querySelector('.navbar');
  const sc = screen.querySelector('.scroller');
  if (!nav || !sc) return;
  const threshold = screen.querySelector('.large-title') ? 38 : 2;
  const on = () => nav.classList.toggle('scrolled', sc.scrollTop > threshold);
  sc.addEventListener('scroll', on, { passive: true });
  on();
}
