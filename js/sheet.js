// Draggable bottom sheet with detents (UISheetPresentationController style).
import { h } from './util.js';

/**
 * opts:
 *  container   element the sheet lives in (positioned)
 *  detents     () => array of visible heights in px (ascending)
 *  initial     index into detents
 *  dismissible drag below the smallest detent closes it
 *  backdrop    'always' | 'largest' | false
 *  head, body  elements
 *  onDismiss, onDetent
 */
export class Sheet {
  constructor(opts) {
    this.o = { initial: 0, dismissible: true, backdrop: 'always', ...opts };
    this.layer = h('div', { class: 'sheet-layer' });
    this.backdrop = h('div', { class: 'sheet-backdrop' });
    this.grab = h('div', { class: 'sheet-grab' });
    this.body = opts.body || h('div');
    this.body.classList.add('sheet-body');
    this.el = h('div', { class: 'sheet ' + (opts.className || '') }, this.grab, opts.head || '', this.body);
    this.layer.append(this.backdrop, this.el);
    this.index = -1;
    this.backdrop.addEventListener('click', () => {
      if (this.o.dismissible) this.o.requestDismiss ? this.o.requestDismiss() : this.dismiss();
      else this.snap(0);
    });
    this.bindDrag();
    this.onResize = () => this.index >= 0 && this.apply(this.heightFor(this.index), false);
    window.addEventListener('resize', this.onResize);
  }

  get detents() { return this.o.detents(); }
  get maxH() { return Math.max(...this.detents); }
  heightFor(i) { return this.detents[Math.max(0, Math.min(i, this.detents.length - 1))]; }
  atLargest() { return this.index === this.detents.length - 1; }

  mount() {
    this.o.container.append(this.layer);
    this.el.style.height = this.maxH + 'px';
    this.el.style.transform = 'translateY(100%)';
    this.el.getBoundingClientRect();
    requestAnimationFrame(() => this.snap(this.o.initial));
    return this;
  }

  apply(hgt, animate = true) {
    this.el.style.height = this.maxH + 'px';
    this.el.classList.toggle('dragging', !animate);
    this.cur = hgt;
    this.el.style.transform = `translateY(${this.maxH - hgt}px)`;
    const ds = this.detents;
    let p = 1;
    if (this.o.backdrop === 'largest' && ds.length > 1) {
      const a = ds[ds.length - 2], b = ds[ds.length - 1];
      p = Math.max(0, Math.min(1, (hgt - a) / (b - a)));
    } else if (this.o.backdrop === false) p = 0;
    else p = Math.max(0, Math.min(1, hgt / ds[0]));
    this.backdrop.style.transition = animate ? '' : 'none';
    this.backdrop.style.opacity = p;
    this.backdrop.style.pointerEvents = p > 0.05 ? 'auto' : 'none';
    this.layer.classList.toggle('open', p > 0);
  }

  snap(i, animate = true) {
    this.index = Math.max(0, Math.min(i, this.detents.length - 1));
    this.apply(this.heightFor(this.index), animate);
    this.body.classList.toggle('locked', !this.atLargest());
    this.o.onDetent?.(this.index);
  }

  dismiss() {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('resize', this.onResize);
    this.el.classList.remove('dragging');
    this.el.style.transform = 'translateY(100%)';
    this.backdrop.style.transition = '';
    this.backdrop.style.opacity = 0;
    setTimeout(() => this.layer.remove(), 500);
    this.o.onDismiss?.();
  }

  bindDrag() {
    let startY = 0, startH = 0, mode = null, samples = [], fromBody = false, touching = false;
    const y = (e) => (e.touches ? e.touches[0].clientY : e.clientY);
    const start = (e) => {
      if (this.closed) return;
      if (e.target.closest('input, textarea, select, .no-drag')) return;
      touching = true;
      startY = y(e);
      startH = this.cur ?? this.heightFor(this.index);
      fromBody = this.body.contains(e.target);
      mode = null;
      samples = [{ y: startY, t: e.timeStamp }];
    };
    const move = (e) => {
      if (!touching) return;
      const cy = y(e);
      const dy = cy - startY;
      if (!mode) {
        if (fromBody && this.atLargest()) {
          if (this.body.scrollTop <= 0 && dy > 0) mode = 'drag';
          else if (Math.abs(dy) > 4) mode = 'scroll';
          else return;
        } else {
          if (Math.abs(dy) < 5) return;
          mode = 'drag';
        }
      }
      if (mode !== 'drag') return;
      if (e.cancelable) e.preventDefault();
      let hgt = startH - dy;
      const max = this.maxH, min = this.detents[0];
      if (hgt > max) hgt = max + (hgt - max) * 0.15; // rubber band
      if (!this.o.dismissible && hgt < min) hgt = min - (min - hgt) * 0.25;
      this.apply(Math.max(0, hgt), false);
      samples.push({ y: cy, t: e.timeStamp });
      if (samples.length > 5) samples.shift();
    };
    const end = () => {
      if (!touching) return;
      touching = false;
      if (mode !== 'drag') return;
      const a = samples[0], b = samples[samples.length - 1];
      const v = b && a && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0; // px/ms, + = down
      const projected = this.cur - v * 180;
      const ds = this.detents;
      if (this.o.dismissible && (projected < ds[0] * 0.55 || (v > 1.1 && this.index === 0))) {
        this.o.requestDismiss ? this.o.requestDismiss() : this.dismiss();
        return;
      }
      let best = 0;
      ds.forEach((d, i) => { if (Math.abs(d - projected) < Math.abs(ds[best] - projected)) best = i; });
      this.snap(best);
    };
    this.el.addEventListener('touchstart', start, { passive: true });
    this.el.addEventListener('touchmove', move, { passive: false });
    this.el.addEventListener('touchend', end);
    this.el.addEventListener('touchcancel', end);
    // Mouse: drag via grabber/header only
    const mdown = (e) => {
      if (e.button !== 0 || e.target.closest('button, input, a')) return;
      start(e);
      const mm = (ev) => move(ev);
      const mu = () => { end(); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
    };
    this.grab.addEventListener('mousedown', mdown);
    this.o.head?.addEventListener('mousedown', mdown);
  }
}
