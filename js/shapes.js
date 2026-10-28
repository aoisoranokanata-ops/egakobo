'use strict';
/* 図形（直線・長方形・楕円・多角形）とグラデーション。どちらも stroke タイルに描いて commitStroke（選択範囲・透明保護も効く） */

const SHAPE_SUBTOOLS = [
  { id: 'line', name: '直線' },
  { id: 'rect', name: '長方形' },
  { id: 'ellipse', name: '楕円' },
  { id: 'polygon', name: '多角形' },
];
const SHAPE_DEFAULTS = { sub: 'line', fill: 'stroke', width: 6, square: false, corner: 0, sides: 6 };
const GRAD_SUBTOOLS = [
  { id: 'main-sub', name: 'メインからサブ' },
  { id: 'main-tr', name: 'メインから透明' },
  { id: 'radial', name: '円形（メインから透明）' },
];
const GRAD_DEFAULTS = { sub: 'main-sub', opacity: 1, reverse: false };

class ShapeTool {
  constructor(app) { this.app = app; this.st = null; }
  get o() { return this.app.shapeOpts; }
  down(p) { this.st = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; }
  move(p) { if (this.st) { this.st.x1 = p.x; this.st.y1 = p.y; this.st.shift = p.shift; } }
  /* 文書座標の Path2D と、塗る・線を引く */
  path(st) {
    const o = this.o, p = new Path2D();
    let { x0, y0, x1, y1 } = st;
    if (o.sub === 'line') {
      if (st.shift || o.square) {              // 45° ごとに吸い付く
        const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(x1 - x0, y1 - y0);
        x1 = x0 + Math.cos(a) * l; y1 = y0 + Math.sin(a) * l;
      }
      p.moveTo(x0, y0); p.lineTo(x1, y1);
      return { p, line: true };
    }
    if (o.square) { const m = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * m; y1 = y0 + Math.sign(y1 - y0 || 1) * m; }
    const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    if (o.sub === 'rect') {
      if (o.corner > 0 && p.roundRect) p.roundRect(x, y, w, h, Math.min(o.corner, w / 2, h / 2)); else p.rect(x, y, w, h);
    } else if (o.sub === 'ellipse') p.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else {
      // 多角形: 中心から広げる（起点 = 中心）
      const n = Math.max(3, o.sides | 0), R = Math.hypot(x1 - x0, y1 - y0), a0 = Math.atan2(y1 - y0, x1 - x0);
      for (let i = 0; i < n; i++) { const a = a0 + (i * Math.PI * 2) / n; if (i) p.lineTo(x0 + Math.cos(a) * R, y0 + Math.sin(a) * R); else p.moveTo(x0 + Math.cos(a) * R, y0 + Math.sin(a) * R); }
      p.closePath();
      return { p, bbox: { x: x0 - R, y: y0 - R, w: 2 * R, h: 2 * R } };
    }
    return { p, bbox: { x, y, w, h } };
  }
  up() {
    const st = this.st;
    this.st = null;
    if (!st || Math.hypot(st.x1 - st.x0, st.y1 - st.y0) < 1) { this.app.view.request(); return; }
    const app = this.app, doc = app.doc, o = this.o;
    const { p, line, bbox } = this.path(st);
    const lw = o.width;
    const erase = app.color.transparent;
    const b = line ? { x: Math.min(st.x0, st.x1), y: Math.min(st.y0, st.y1), w: Math.abs(st.x1 - st.x0), h: Math.abs(st.y1 - st.y0) } : bbox;
    const r = { x: b.x - lw - 2, y: b.y - lw - 2, w: b.w + lw * 2 + 4, h: b.h + lw * 2 + 4 };
    doc.beginStroke(doc.active, { erase, target: doc.maskEdit ? 'mask' : 'tiles' });
    for (const [tx, ty] of doc.gridKeys(r)) {
      const g = ctx2d(doc.strokeTile(tx, ty));
      g.setTransform(1, 0, 0, 1, -tx * TILE, -ty * TILE);
      g.fillStyle = g.strokeStyle = erase ? '#000' : app.color.main;
      g.lineWidth = lw; g.lineJoin = 'round'; g.lineCap = 'round';
      if (!line && (o.fill === 'fill' || o.fill === 'both')) g.fill(p);
      if (line || o.fill === 'stroke' || o.fill === 'both') { if (o.fill === 'both' && !line) g.strokeStyle = app.color.sub; g.stroke(p); }
    }
    doc.commitStroke('図形');
    app.afterEdit();
    app.view.request();
  }
  cancel() { this.st = null; }
  drawOverlay(g, view) {
    if (!this.st) return;
    const { p, line } = this.path(this.st), m = view.m, dpr = view.dpr, o = this.o;
    g.save();
    g.setTransform(m.a * dpr, m.b * dpr, m.c * dpr, m.d * dpr, m.e * dpr, m.f * dpr);
    g.fillStyle = g.strokeStyle = this.app.color.main;
    g.lineWidth = o.width; g.lineJoin = 'round'; g.lineCap = 'round';
    g.globalAlpha = 0.85;
    if (!line && (o.fill === 'fill' || o.fill === 'both')) g.fill(p);
    if (line || o.fill !== 'fill') { if (o.fill === 'both' && !line) g.strokeStyle = this.app.color.sub; g.stroke(p); }
    g.restore();
  }
}

class GradientTool {
  constructor(app) { this.app = app; this.st = null; }
  get o() { return this.app.gradOpts; }
  down(p) { this.st = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; }
  move(p) {
    const st = this.st;
    if (!st) return;
    st.x1 = p.x; st.y1 = p.y;
    if (p.shift) { const a = Math.round(Math.atan2(st.y1 - st.y0, st.x1 - st.x0) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(st.x1 - st.x0, st.y1 - st.y0); st.x1 = st.x0 + Math.cos(a) * l; st.y1 = st.y0 + Math.sin(a) * l; }
    this.render();
  }
  /* 文書全体（選択範囲があればその範囲）に描く */
  render() {
    const app = this.app, doc = app.doc, st = this.st, o = this.o;
    if (Math.hypot(st.x1 - st.x0, st.y1 - st.y0) < 1) return;
    if (!doc.stroke) doc.beginStroke(doc.active, { opacity: o.opacity, target: doc.maskEdit ? 'mask' : 'tiles', erase: app.color.transparent });
    const rect = doc.sel ? doc.sel.bounds : doc.fullRect;
    if (!rect) return;
    let c0 = app.color.main, c1 = o.sub === 'main-sub' ? app.color.sub : null;
    const rgb = hexToRgb(c0);
    const tr = `rgba(${rgb.r},${rgb.g},${rgb.b},0)`;
    let stops = [[0, c0], [1, c1 || tr]];
    if (o.reverse) stops = [[0, stops[1][1]], [1, stops[0][1]]];
    for (const [tx, ty] of doc.gridKeys(rect)) {
      const g = ctx2d(doc.strokeTile(tx, ty));
      g.setTransform(1, 0, 0, 1, -tx * TILE, -ty * TILE);
      g.clearRect(tx * TILE, ty * TILE, TILE, TILE);
      const gr = o.sub === 'radial' ? g.createRadialGradient(st.x0, st.y0, 0, st.x0, st.y0, Math.hypot(st.x1 - st.x0, st.y1 - st.y0)) : g.createLinearGradient(st.x0, st.y0, st.x1, st.y1);
      for (const [t, c] of stops) gr.addColorStop(t, c);
      g.fillStyle = gr;
      g.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      doc.comp.invalidate(tx, ty);
    }
  }
  up() {
    const st = this.st, doc = this.app.doc;
    this.st = null;
    if (!st || !doc.stroke) { doc.cancelStroke(); return; }
    doc.commitStroke('グラデーション');
    this.app.afterEdit();
  }
  cancel() { this.st = null; this.app.doc.cancelStroke(); }
  drawOverlay(g, view) {
    const st = this.st;
    if (!st) return;
    const a = view.toScreen(st.x0, st.y0), b = view.toScreen(st.x1, st.y1);
    g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.setLineDash([6, 4]);
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
    for (const q of [a, b]) { g.fillStyle = '#2b8cff'; g.beginPath(); g.arc(q.x, q.y, 5, 0, Math.PI * 2); g.fill(); }
  }
}
