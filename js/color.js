'use strict';
/* 色: メイン・サブ・透明色、色相環＋四角（彩度・明度）、スライダー、履歴、カラーセット */

const DEFAULT_PALETTE = [
  '#000000', '#3c3c3c', '#7a7a7a', '#b4b4b4', '#ffffff', '#ffe9dc', '#f7cdb4', '#e8a888',
  '#c27552', '#7a4630', '#e60033', '#ff7b00', '#ffd400', '#a7d400', '#00a04a', '#00a5a8',
  '#0095d9', '#1e50a2', '#5a3d9a', '#c1328e', '#f5b2b2', '#ffe0a3', '#b8e1f2', '#c7b8e8',
];

class ColorState {
  constructor() {
    const s = loadLS('color', {});
    this.main = s.main || '#1a1a1a';
    this.sub = s.sub || '#ffffff';
    this.transparent = false;
    this.hsv = rgbToHsv(hexToRgb(this.main));
    this.history = s.history || [];
    this.palette = s.palette || DEFAULT_PALETTE.slice();
    this.listeners = [];
  }
  on(fn) { this.listeners.push(fn); }
  emit() { for (const f of this.listeners) f(); this.save(); }
  save() { saveLS('color', { main: this.main, sub: this.sub, history: this.history, palette: this.palette }); }
  setMain(hex, { hsv = null } = {}) {
    this.main = hex.toLowerCase();
    if (hsv) this.hsv = hsv;
    else {
      const n = rgbToHsv(hexToRgb(this.main));
      if (n.s < 0.001 || n.v < 0.001) n.h = this.hsv.h;        // 白黒になっても色相を覚えておく
      if (n.v < 0.001) n.s = this.hsv.s;
      this.hsv = n;
    }
    this.transparent = false;
    this.emit();
  }
  setHsv(h, s, v) { this.setMain(rgbToHex(hsvToRgb({ h, s, v })), { hsv: { h, s, v } }); }
  swap() { const m = this.main; this.setMain(this.sub); this.sub = m; this.emit(); }
  setTransparent(on) { this.transparent = on; this.emit(); }
  commitHistory() {
    if (this.transparent) return;
    if (this.history[0] === this.main) return;
    this.history = [this.main, ...this.history.filter((c) => c !== this.main)].slice(0, 24);
    this.emit();
  }
}

class ColorPanel {
  constructor(app, root) {
    this.app = app;
    this.st = app.color;
    this.root = root;
    this.size = 200;
    this.build();
    this.st.on(() => this.refresh());
    this.refresh();
  }
  build() {
    const R = this.root;
    R.innerHTML = '';
    this.wheel = el('canvas', { class: 'cwheel' });
    R.append(el('div', { class: 'cwheel-wrap' }, this.wheel));
    this.chipMain = el('button', { class: 'chip main', title: 'メインカラー' });
    this.chipSub = el('button', { class: 'chip sub', title: 'サブカラー（押すと入れ替え）', onclick: () => this.st.swap() });
    this.chipTr = el('button', { class: 'chip tr', title: '透明色（描くと消える）', onclick: () => this.st.setTransparent(!this.st.transparent) });
    this.chipMain.onclick = () => this.st.setTransparent(false);
    this.hex = el('input', { class: 'hex', maxlength: 7, spellcheck: 'false', autocapitalize: 'off' });
    this.hex.addEventListener('change', () => { const v = this.hex.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) { this.st.setMain(v[0] === '#' ? v : '#' + v); this.st.commitHistory(); } else this.refresh(); });
    R.append(el('div', { class: 'chips' }, el('div', { class: 'chip-stack' }, this.chipSub, this.chipMain), this.chipTr,
      el('button', { class: 'mini', title: 'メインとサブを入れ替え（X）', onclick: () => this.st.swap() }, '⇄'), this.hex));
    // スライダー
    this.sliders = {};
    const sw = el('div', { class: 'csliders' });
    for (const [k, label, max] of [['h', 'H', 360], ['s', 'S', 100], ['v', 'V', 100]]) {
      const inp = el('input', { type: 'range', min: 0, max, step: 1 });
      const num = el('span', { class: 'cnum' });
      inp.addEventListener('input', () => {
        const h = { ...this.st.hsv };
        h[k] = k === 'h' ? +inp.value % 360 : +inp.value / 100;
        this.st.setHsv(h.h, h.s, h.v);
      });
      inp.addEventListener('change', () => this.st.commitHistory());
      this.sliders[k] = { inp, num };
      sw.append(el('label', { class: 'crow' }, el('b', {}, label), inp, num));
    }
    R.append(sw);
    R.append(el('div', { class: 'sub-h' }, '履歴'));
    this.histEl = el('div', { class: 'swatches hist' });
    R.append(this.histEl);
    R.append(el('div', { class: 'sub-h' }, 'カラーセット', el('button', { class: 'mini', title: 'いまの色を追加', onclick: () => { this.st.palette.push(this.st.main); this.st.emit(); } }, '＋')));
    this.palEl = el('div', { class: 'swatches pal' });
    R.append(this.palEl);
    this.bindWheel();
    new ResizeObserver(() => this.layout()).observe(this.root);
  }
  layout() {
    const w = Math.min(260, Math.max(150, this.root.clientWidth - 8));
    if (Math.abs(w - this.size) < 2 && this.wheel.width) return;
    this.size = w;
    const dpr = window.devicePixelRatio || 1;
    this.wheel.style.width = w + 'px'; this.wheel.style.height = w + 'px';
    this.wheel.width = Math.round(w * dpr); this.wheel.height = Math.round(w * dpr);
    this._ring = null;
    this.drawWheel();
  }
  geo() {
    const W = this.size, ring = Math.max(14, W * 0.09), R0 = W / 2 - 2, R1 = R0 - ring;
    const half = (R1 - 6) / Math.SQRT2;
    return { W, c: W / 2, R0, R1, half };
  }
  drawWheel() {
    const g = this.wheel.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const { W, c, R0, R1, half } = this.geo();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, W);
    // 色相環
    if (g.createConicGradient) {
      const cg = g.createConicGradient(-Math.PI / 2, c, c);
      for (let i = 0; i <= 12; i++) cg.addColorStop(i / 12, `hsl(${i * 30},100%,50%)`);
      g.fillStyle = cg;
    } else g.fillStyle = '#888';
    g.beginPath(); g.arc(c, c, R0, 0, Math.PI * 2); g.arc(c, c, R1, 0, Math.PI * 2, true); g.fill('evenodd');
    // 四角
    const h = this.st.hsv.h;
    g.fillStyle = `hsl(${h},100%,50%)`;
    g.fillRect(c - half, c - half, half * 2, half * 2);
    const gw = g.createLinearGradient(c - half, 0, c + half, 0);
    gw.addColorStop(0, '#fff'); gw.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gw; g.fillRect(c - half, c - half, half * 2, half * 2);
    const gb = g.createLinearGradient(0, c - half, 0, c + half);
    gb.addColorStop(0, 'rgba(0,0,0,0)'); gb.addColorStop(1, '#000');
    g.fillStyle = gb; g.fillRect(c - half, c - half, half * 2, half * 2);
    // 印
    const a = ((h - 90) * Math.PI) / 180, rm = (R0 + R1) / 2;
    g.lineWidth = 2.5; g.strokeStyle = '#fff';
    g.beginPath(); g.arc(c + Math.cos(a) * rm, c + Math.sin(a) * rm, (R0 - R1) / 2 + 1, 0, Math.PI * 2); g.stroke();
    const sx = c - half + this.st.hsv.s * half * 2, sy = c - half + (1 - this.st.hsv.v) * half * 2;
    g.lineWidth = 2; g.strokeStyle = this.st.hsv.v > 0.55 ? '#000' : '#fff';
    g.beginPath(); g.arc(sx, sy, 6, 0, Math.PI * 2); g.stroke();
  }
  bindWheel() {
    let mode = null;
    const at = (e) => {
      const r = this.wheel.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const { c, R1, half } = this.geo();
      const dx = x - c, dy = y - c;
      if (!mode) mode = Math.hypot(dx, dy) > R1 - 2 ? 'ring' : 'sq';
      const hsv = { ...this.st.hsv };
      if (mode === 'ring') hsv.h = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
      else { hsv.s = clamp((x - (c - half)) / (half * 2), 0, 1); hsv.v = clamp(1 - (y - (c - half)) / (half * 2), 0, 1); }
      this.st.setHsv(hsv.h, hsv.s, hsv.v);
    };
    this.wheel.addEventListener('pointerdown', (e) => { e.preventDefault(); this.wheel.setPointerCapture(e.pointerId); mode = null; at(e); });
    this.wheel.addEventListener('pointermove', (e) => { if (e.buttons || e.pressure > 0) { if (mode) at(e); } });
    this.wheel.addEventListener('pointerup', () => { mode = null; this.st.commitHistory(); });
    this.wheel.addEventListener('pointercancel', () => { mode = null; });
  }
  refresh() {
    const st = this.st;
    this.drawWheel();
    this.chipMain.style.background = st.main;
    this.chipSub.style.background = st.sub;
    this.chipMain.classList.toggle('on', !st.transparent);
    this.chipTr.classList.toggle('on', st.transparent);
    if (document.activeElement !== this.hex) this.hex.value = st.main;
    for (const k of ['h', 's', 'v']) {
      const v = k === 'h' ? Math.round(st.hsv.h) : Math.round(st.hsv[k] * 100);
      this.sliders[k].inp.value = v; this.sliders[k].num.textContent = v;
    }
    const sat = `linear-gradient(to right, ${rgbToHex(hsvToRgb({ h: st.hsv.h, s: 0, v: st.hsv.v }))}, ${rgbToHex(hsvToRgb({ h: st.hsv.h, s: 1, v: st.hsv.v }))})`;
    this.sliders.s.inp.style.background = sat;
    this.sliders.v.inp.style.background = `linear-gradient(to right, #000, ${rgbToHex(hsvToRgb({ h: st.hsv.h, s: st.hsv.s, v: 1 }))})`;
    this.sliders.h.inp.classList.add('hue');
    this.fillSwatches(this.histEl, st.history, false);
    this.fillSwatches(this.palEl, st.palette, true);
  }
  fillSwatches(box, list, editable) {
    const sig = list.join() + '|' + this.st.main;
    if (box._sig === sig) return;
    box._sig = sig;
    box.innerHTML = '';
    list.forEach((c, i) => {
      const b = el('button', { class: 'sw' + (c === this.st.main ? ' on' : ''), style: `background:${c}`, title: c });
      let hold = 0;
      b.addEventListener('pointerdown', () => {
        if (!editable) return;
        hold = setTimeout(async () => {
          hold = -1;
          if (await confirmBox('カラーセット', `${c} をカラーセットから外しますか？`, '外す', true)) { this.st.palette.splice(i, 1); this.st.emit(); }
        }, 600);
      });
      b.addEventListener('pointerup', () => { if (hold !== -1) { clearTimeout(hold); this.st.setMain(c); this.st.commitHistory(); } hold = 0; });
      b.addEventListener('pointerleave', () => { if (hold > 0) clearTimeout(hold); });
      box.append(b);
    });
  }
}
