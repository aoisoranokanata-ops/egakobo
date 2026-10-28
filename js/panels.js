'use strict';
/* 左のツールバー・サブツールと設定（ツールプロパティ）・画面左端のサイズ／不透明度スライダー */

const ICONS = {
  pen: '<path d="M4 20l2-6L16 4l4 4-10 10z"/><path d="M14 6l4 4"/>',
  pencil: '<path d="M5 19l1.5-5L17 3.5l3.5 3.5L10 17.5z"/><path d="M5 19l3.5-1.5"/><path d="M15 5.5l3.5 3.5"/>',
  brush: '<path d="M14 4c3-2 6 1 4 4l-7 7-4-4z"/><path d="M7 11c-3 0-4 3-4 6 0 1 0 2-1 3 4 0 8-1 8-5z"/>',
  air: '<circle cx="9" cy="15" r="5"/><path d="M13 11l6-6M17 3l4 4"/><circle cx="9" cy="15" r="1.5" fill="currentColor"/>',
  eraser: '<path d="M8 20h12"/><path d="M3.5 14.5l9-9a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3L11 19H8z"/><path d="M8 10l6 6"/>',
  bucket: '<path d="M5 11l7-7 7 7-7 7z"/><path d="M5 11h14"/><path d="M20 15c0 2-1 3-1 4a1 1 0 0 0 2 0c0-1-1-2-1-4z" fill="currentColor"/>',
  dropper: '<path d="M14 4l6 6-2 2-6-6z"/><path d="M13 9L5 17v2h2l8-8"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5V4.5a1.5 1.5 0 0 1 3 0V11V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6 7-3 0-4.5-1.5-6-4l-2-3.5a1.5 1.5 0 0 1 2.5-1.5z"/>',
  zoom: '<circle cx="10" cy="10" r="6"/><path d="M15 15l5 5M7.5 10h5M10 7.5v5"/>',
};
const svgIcon = (name) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;

class ToolPanels {
  constructor(app) {
    this.app = app;
    this.bar = $('#toolbar');
    this.props = $('#toolprops');
    this.buildBar();
    this.buildQuick();
  }
  buildBar() {
    this.bar.innerHTML = '';
    for (const t of TOOL_DEFS) {
      const b = el('button', { class: 'tool', 'data-tool': t.id, title: `${t.name}（${t.key.toUpperCase()}）`, html: svgIcon(t.icon) });
      b.addEventListener('click', () => {
        if (this.app.toolName === t.id) this.app.toggleLeftPanel();
        else this.app.setTool(t.id);
      });
      this.bar.append(b);
    }
  }
  refreshBar() { for (const b of $$('.tool', this.bar)) b.classList.toggle('on', b.dataset.tool === this.app.toolName); }

  /* ---- ツールプロパティ */
  refreshProps() {
    const app = this.app, P = this.props, t = app.toolName;
    P.innerHTML = '';
    const def = TOOL_DEFS.find((d) => d.id === t);
    P.append(el('div', { class: 'pp-title' }, def ? def.name : ''));
    if (BRUSH_TOOLS.includes(t)) this.brushProps(P);
    else if (t === 'fill') this.fillProps(P);
    else if (t === 'eyedropper') {
      P.append(this.choice('取得する色', [['all', '表示色'], ['layer', '作業中のレイヤー']], app.toolOpts.eyedropper || 'all', (v) => { app.toolOpts.eyedropper = v; app.saveTools(); }));
      P.append(el('p', { class: 'hint' }, '指の長押しでも、どの道具からでもスポイトになります。'));
    } else if (t === 'move') P.append(el('p', { class: 'hint' }, '作業中のレイヤー（フォルダーなら中身すべて）をドラッグで動かします。Shift で縦横だけ。'));
    else if (t === 'hand') P.append(el('p', { class: 'hint' }, 'ドラッグで画面を動かします。2本指でつまむと拡大縮小・回転できます。'));
    else if (t === 'zoom') P.append(el('p', { class: 'hint' }, 'タップで拡大、Alt を押しながらで縮小。'));
  }
  subList(P, items, current, onPick) {
    const box = el('div', { class: 'subtools' });
    for (const s of items) box.append(el('button', { class: 'subtool' + (s.id === current ? ' on' : ''), onclick: () => onPick(s.id) }, s.name));
    P.append(box);
  }
  brushProps(P) {
    const app = this.app, t = app.toolName;
    this.subList(P, SUBTOOLS.filter((s) => s.tool === t), app.subFor(t), (id) => app.setSubtool(id));
    const b = app.brush, set = (k, v) => app.updateBrush({ [k]: v });
    P.append(this.slider('ブラシサイズ', b.size, { min: 0.5, max: 1000, log: true, unit: 'px', fmt: (v) => (v < 10 ? v.toFixed(1) : Math.round(v)) }, (v) => set('size', v)));
    P.append(this.slider('不透明度', b.opacity * 100, { min: 1, max: 100, unit: '%' }, (v) => set('opacity', v / 100)));
    P.append(this.slider('ブラシ濃度', b.density * 100, { min: 1, max: 100, unit: '%' }, (v) => set('density', v / 100)));
    P.append(this.slider('手ブレ補正', b.stab, { min: 0, max: 50 }, (v) => set('stab', v)));
    const det = el('details', { class: 'pp-more', open: loadLS('ppMore', false) || null });
    det.addEventListener('toggle', () => saveLS('ppMore', det.open));
    det.append(el('summary', {}, '詳しい設定'));
    det.append(this.slider('硬さ', b.hardness * 100, { min: 0, max: 100, unit: '%' }, (v) => { set('hardness', v / 100); }));
    det.append(this.slider('間隔', b.spacing * 100, { min: 2, max: 100, unit: '%' }, (v) => set('spacing', v / 100)));
    det.append(this.toggle('筆圧でサイズ', b.pSize, (v) => { set('pSize', v); this.refreshProps(); }));
    if (b.pSize) det.append(this.slider('最小サイズ', b.pMin * 100, { min: 0, max: 100, unit: '%' }, (v) => set('pMin', v / 100)));
    det.append(this.toggle('筆圧で濃度', b.pDensity, (v) => { set('pDensity', v); this.refreshProps(); }));
    if (b.pDensity) det.append(this.slider('最小濃度', b.pDensityMin * 100, { min: 0, max: 100, unit: '%' }, (v) => set('pDensityMin', v / 100)));
    det.append(this.slider('傾きで太く', b.tiltSize * 50, { min: 0, max: 100 }, (v) => set('tiltSize', v / 50)));
    det.append(this.slider('傾きで薄く', b.tiltDensity * 100, { min: 0, max: 100 }, (v) => set('tiltDensity', v / 100)));
    det.append(this.slider('入り', b.taperIn, { min: 0, max: 30, step: 0.5 }, (v) => set('taperIn', v)));
    det.append(this.slider('抜き', b.taperOut, { min: 0, max: 30, step: 0.5 }, (v) => set('taperOut', v)));
    det.append(this.choice('ブラシ先端', [['round', '円'], ['flat', '平筆']], b.tip, (v) => { set('tip', v); this.refreshProps(); }));
    if (b.tip === 'flat') {
      det.append(this.slider('厚さ', b.flatRatio * 100, { min: 5, max: 100, unit: '%' }, (v) => set('flatRatio', v / 100)));
      det.append(this.slider('向き', b.flatAngle, { min: 0, max: 180, unit: '°' }, (v) => set('flatAngle', v)));
      det.append(this.toggle('ペンの向きに合わせる', b.azimuth, (v) => set('azimuth', v)));
    }
    det.append(this.choice('紙の質感', [['', 'なし'], ['paper', '画用紙'], ['canvas', 'キャンバス'], ['rough', '粗い紙']], b.grain || '', (v) => { set('grain', v || null); this.refreshProps(); }));
    if (b.grain) det.append(this.slider('質感の強さ', b.grainStrength * 100, { min: 0, max: 100, unit: '%' }, (v) => set('grainStrength', v / 100)));
    det.append(el('button', { class: 'btn small', onclick: () => { app.resetBrush(); } }, 'このサブツールを初期設定に戻す'));
    P.append(det);
  }
  fillProps(P) {
    const app = this.app;
    this.subList(P, FILL_SUBTOOLS, app.toolOpts.fillSub, (id) => app.setFillSub(id));
    const o = app.fillOpts, set = (k, v) => app.updateFill({ [k]: v });
    if (o.mode === 'flood') {
      P.append(this.slider('色の誤差', o.tolerance, { min: 0, max: 100, unit: '%' }, (v) => set('tolerance', v)));
      P.append(this.slider('隙間閉じ', o.gap, { min: 0, max: 20, unit: 'px' }, (v) => set('gap', Math.round(v))));
      P.append(this.slider('領域拡縮', o.expand, { min: -10, max: 10, unit: 'px' }, (v) => set('expand', Math.round(v))));
    }
    P.append(this.slider('不透明度', o.opacity * 100, { min: 1, max: 100, unit: '%' }, (v) => set('opacity', v / 100)));
    P.append(el('p', { class: 'hint' }, o.mode === 'flood' ? '「他レイヤーを参照」は線画のレイヤーと別のレイヤーに色を塗るときに使います。隙間閉じで線の切れ目を越えません。' : 'ペンで囲んだ所を塗ります（消します）。'));
  }

  /* ---- 部品 */
  slider(label, value, { min, max, step = 1, log = false, unit = '', fmt = null }, onInput) {
    const toPos = (v) => (log ? (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (v - min) / (max - min)) * 1000;
    const fromPos = (p) => { const t = p / 1000; let v = log ? Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min))) : min + t * (max - min); if (!log) v = Math.round(v / step) * step; return v; };
    const inp = el('input', { type: 'range', min: 0, max: 1000, step: 1, value: toPos(value) });
    const show = (v) => (fmt ? fmt(v) : Number.isInteger(step) ? Math.round(v) : v.toFixed(1)) + unit;
    const num = el('span', { class: 'pv' }, show(value));
    inp.addEventListener('input', () => { const v = fromPos(+inp.value); num.textContent = show(v); onInput(v); });
    // 数値を押すと直接入力
    num.addEventListener('click', async () => {
      const r = await promptBox(label, String(Math.round(value * 10) / 10));
      if (r == null || r === '' || isNaN(+r)) return;
      const v = clamp(+r, min, max);
      value = v; inp.value = toPos(v); num.textContent = show(v); onInput(v);
    });
    return el('label', { class: 'pp' }, el('span', { class: 'pl' }, label), inp, num);
  }
  toggle(label, on, onChange) {
    const b = el('button', { class: 'tog' + (on ? ' on' : ''), onclick: () => { on = !on; b.classList.toggle('on', on); onChange(on); } });
    return el('div', { class: 'pp' }, el('span', { class: 'pl' }, label), b);
  }
  choice(label, opts, value, onChange) {
    const box = el('div', { class: 'seg' });
    for (const [v, t] of opts) box.append(el('button', { class: v === value ? 'on' : '', onclick: () => { for (const x of box.children) x.classList.remove('on'); box.children[opts.findIndex((o) => o[0] === v)].classList.add('on'); onChange(v); } }, t));
    return el('div', { class: 'pp col' }, el('span', { class: 'pl' }, label), box);
  }

  /* ---- 画面左端のスライダー（ブラシサイズ・不透明度） */
  buildQuick() {
    const mk = (cls, title, get, set, fmt) => {
      const track = el('div', { class: 'qtrack ' + cls, title });
      const knob = el('div', { class: 'qknob' });
      const tip = el('div', { class: 'qtip' });
      track.append(knob, tip);
      const upd = () => { const t = get(); knob.style.bottom = `calc(${t * 100}% - 10px)`; tip.textContent = fmt(); };
      let drag = null;
      track.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        track.setPointerCapture(e.pointerId);
        drag = { y: e.clientY, t: get(), h: track.getBoundingClientRect().height };
        track.classList.add('drag');
      });
      track.addEventListener('pointermove', (e) => {
        if (!drag) return;
        set(clamp(drag.t + (drag.y - e.clientY) / drag.h, 0, 1));
        upd();
      });
      const end = () => { if (drag) { drag = null; track.classList.remove('drag'); this.app.saveTools(); this.refreshProps(); } };
      track.addEventListener('pointerup', end);
      track.addEventListener('pointercancel', end);
      return { track, upd };
    };
    const app = this.app;
    const LMIN = Math.log(0.5), LMAX = Math.log(600);
    this.qSize = mk('qsize', 'ブラシサイズ', () => (app.brush ? (Math.log(app.brush.size) - LMIN) / (LMAX - LMIN) : 0),
      (t) => app.updateBrush({ size: Math.round(Math.exp(LMIN + t * (LMAX - LMIN)) * 10) / 10 }, true), () => (app.brush ? (app.brush.size < 10 ? app.brush.size.toFixed(1) : Math.round(app.brush.size)) + 'px' : ''));
    this.qOpa = mk('qopa', '不透明度', () => (app.brush ? app.brush.opacity : 0), (t) => app.updateBrush({ opacity: Math.max(0.01, Math.round(t * 100) / 100) }, true), () => (app.brush ? Math.round(app.brush.opacity * 100) + '%' : ''));
    const box = $('#quick');
    box.append(this.qSize.track, this.qOpa.track);
  }
  refreshQuick() {
    const on = BRUSH_TOOLS.includes(this.app.toolName);
    $('#quick').hidden = !on || !this.app.settings.quickSliders;
    if (on) { this.qSize.upd(); this.qOpa.upd(); }
  }
}
