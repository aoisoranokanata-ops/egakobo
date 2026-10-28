'use strict';
/* 定規。doc.ruler = { type, pts: [{x, y}...], count, mirror } | null。app.settings.snap で吸い付きのオン・オフ。
   直線: 近くから描き始めた線を定規の上に。平行線・放射線（集中線定規）・パース: 描き始めの向きに一番近い線に乗せる。
   同心円: 中心のまわりの円に。対称: 描いた線を鏡・回転で写す（ブラシの点を写すので画素もベクターも同じ）。 */

const RULER_SUBTOOLS = [
  { id: 'line', name: '直線定規', hint: 'ドラッグで定規を引きます。' },
  { id: 'parallel', name: '平行線定規', hint: 'ドラッグで向きを決めます。どこから描いても、その向きの線になります。' },
  { id: 'radial', name: '放射線定規（集中線）', hint: '中心を押します。中心へ向かう線になります。' },
  { id: 'circle', name: '同心円定規', hint: '中心を押します。中心のまわりの円になります。' },
  { id: 'persp1', name: 'パース 1点透視', hint: '消失点を押します。消失点へ向かう線・水平線・垂直線に吸い付きます。' },
  { id: 'persp2', name: 'パース 2点透視', hint: '消失点を2つ押します（左と右）。2つの消失点へ向かう線と垂直線に吸い付きます。' },
  { id: 'symmetry', name: '対称定規', hint: 'ドラッグで対称の軸を引きます。描いた線が鏡写しになります。' },
];
const RULER_COLOR = '#e4007f';

class RulerTool {
  constructor(app) { this.app = app; this.st = null; }
  get o() { return this.app.rulerOpts; }
  down(p) {
    const app = this.app, doc = app.doc, v = app.view, r = doc.ruler;
    // 今の定規の点を動かす
    if (r) {
      const sp = v.toScreen(p.x, p.y);
      const i = r.pts.findIndex((q) => { const s = v.toScreen(q.x, q.y); return Math.hypot(s.x - sp.x, s.y - sp.y) < 22; });
      if (i >= 0) { this.st = { drag: i }; return; }
    }
    const t = this.o.sub;
    if (t === 'persp2') {
      if (this.pending) { doc.ruler = { type: 'persp2', pts: [this.pending, { x: p.x, y: p.y }] }; this.pending = null; this.done(); }
      else { this.pending = { x: p.x, y: p.y }; toast('2つ目の消失点を押してください', { ms: 1500 }); }
      return;
    }
    if (t === 'radial' || t === 'circle' || t === 'persp1') { doc.ruler = { type: t, pts: [{ x: p.x, y: p.y }] }; this.done(); return; }
    this.st = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  }
  move(p) {
    const st = this.st, doc = this.app.doc;
    if (!st) return;
    if (st.drag != null) { const r = doc.ruler; r.pts = r.pts.map((q, i) => (i === st.drag ? { x: p.x, y: p.y } : q)); doc.metaDirty = true; return; }
    st.x1 = p.x; st.y1 = p.y;
  }
  up() {
    const st = this.st, doc = this.app.doc;
    this.st = null;
    if (!st) return;
    if (st.drag != null) { this.done(); return; }
    if (Math.hypot(st.x1 - st.x0, st.y1 - st.y0) < 4) return;
    const t = this.o.sub;
    doc.ruler = { type: t, pts: [{ x: st.x0, y: st.y0 }, { x: st.x1, y: st.y1 }], count: this.o.count, mirror: this.o.mirror };
    this.done();
  }
  done() {
    const app = this.app;
    app.settings.snap = true; app.saveSettings();
    app.doc.metaDirty = true; app.scheduleSave();
    app.onViewFlags();
    app.view.request();
  }
  cancel() { this.st = null; }
  drawOverlay() {}
}

/* 定規を画面に描く（どの道具でも見える） */
function drawRuler(g, view, r, active) {
  if (!r) return;
  const W = view.cssW, H = view.cssH, S = (q) => view.toScreen(q.x, q.y);
  g.save();
  g.strokeStyle = RULER_COLOR; g.fillStyle = RULER_COLOR;
  g.globalAlpha = active ? 0.9 : 0.45;
  g.lineWidth = 1.2;
  const infinite = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, k = (W + H) * 2 / l;
    g.beginPath(); g.moveTo(a.x - dx * k, a.y - dy * k); g.lineTo(b.x + dx * k, b.y + dy * k); g.stroke();
  };
  const dot = (q) => { g.beginPath(); g.arc(q.x, q.y, 6, 0, Math.PI * 2); g.fill(); };
  const pts = r.pts.map(S);
  if (r.type === 'line') { infinite(pts[0], pts[1]); pts.forEach(dot); }
  else if (r.type === 'parallel') {
    const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    g.setLineDash([4, 6]);
    for (let i = -6; i <= 6; i++) infinite({ x: pts[0].x + nx * i * 60, y: pts[0].y + ny * i * 60 }, { x: pts[1].x + nx * i * 60, y: pts[1].y + ny * i * 60 });
    g.setLineDash([]); pts.forEach(dot);
  } else if (r.type === 'radial') {
    g.setLineDash([4, 6]);
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; infinite(pts[0], { x: pts[0].x + Math.cos(a), y: pts[0].y + Math.sin(a) }); }
    g.setLineDash([]); dot(pts[0]);
  } else if (r.type === 'circle') {
    g.setLineDash([4, 6]);
    for (let i = 1; i <= 8; i++) { g.beginPath(); g.arc(pts[0].x, pts[0].y, i * 60, 0, Math.PI * 2); g.stroke(); }
    g.setLineDash([]); dot(pts[0]);
  } else if (r.type === 'persp1' || r.type === 'persp2') {
    // 地平線（アイレベル）と消失点
    if (pts.length === 2) infinite(pts[0], pts[1]); else infinite(pts[0], S({ x: r.pts[0].x + 100, y: r.pts[0].y }));
    g.setLineDash([4, 6]); g.globalAlpha *= 0.6;
    for (const q of pts) for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; infinite(q, { x: q.x + Math.cos(a), y: q.y + Math.sin(a) }); }
    g.setLineDash([]); g.globalAlpha = active ? 0.9 : 0.45; pts.forEach(dot);
  } else if (r.type === 'symmetry') {
    const n = Math.max(1, r.count || 1);
    const c = pts[0], a0 = Math.atan2(pts[1].y - c.y, pts[1].x - c.x);
    for (let i = 0; i < Math.max(1, n); i++) { const a = a0 + (i * Math.PI) / Math.max(1, n); infinite(c, { x: c.x + Math.cos(a), y: c.y + Math.sin(a) }); }
    pts.forEach(dot);
  }
  g.restore();
}

/* 対称定規の写し方（文書座標のアフィン [a,b,c,d,e,f] の一覧。元の線は含まない） */
function symmetryMatrices(r) {
  if (!r || r.type !== 'symmetry') return [];
  const c = r.pts[0], a0 = Math.atan2(r.pts[1].y - c.y, r.pts[1].x - c.x), n = Math.max(1, r.count || 1), mirror = r.mirror !== false;
  const out = [];
  const T = (m) => { const [a, b, cc, d, e, f] = m; return [a, b, cc, d, c.x - a * c.x - cc * c.y + e, c.y - b * c.x - d * c.y + f]; };   // 中心まわりに
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n, ct = Math.cos(t), st = Math.sin(t);
    if (k > 0) out.push(T([ct, st, -st, ct, 0, 0]));
    if (mirror) {
      // 軸 a0 で鏡、そのあと t 回す
      const c2 = Math.cos(2 * a0), s2 = Math.sin(2 * a0);
      const m = [c2, s2, s2, -c2];
      out.push(T([ct * m[0] - st * m[1], st * m[0] + ct * m[1], ct * m[2] - st * m[3], st * m[2] + ct * m[3], 0, 0]));
    }
  }
  return out;
}

/* ブラシの吸い付き。begin で作り、点を feed すると描く点の配列を返す（向きが決まるまでは貯める） */
class RulerSnap {
  static begin(app, p) {
    const doc = app.doc, r = doc.ruler;
    if (!r || !app.settings.snap || r.type === 'symmetry') return null;
    const s = new RulerSnap(app, r, p);
    return s.ok ? s : null;
  }
  constructor(app, r, p) {
    this.app = app; this.r = r; this.p0 = { ...p }; this.line = null; this.circle = null; this.buf = [];
    this.ok = true;
    const v = app.view, pts = r.pts;
    if (r.type === 'line') {
      const d = distToLine(p, pts[0], pts[1]);
      if (d * v.s > 60) { this.ok = false; return; }          // 定規から遠い所で描き始めたら吸い付かない
      this.line = { a: pts[0], b: pts[1] };
    } else if (r.type === 'parallel') this.line = { a: p, b: { x: p.x + pts[1].x - pts[0].x, y: p.y + pts[1].y - pts[0].y } };
    else if (r.type === 'radial') this.line = { a: pts[0], b: p };
    else if (r.type === 'circle') this.circle = { c: pts[0], r: Math.hypot(p.x - pts[0].x, p.y - pts[0].y) };
    else if (r.type === 'persp1' || r.type === 'persp2') this.pending = true;
    if (this.line && Math.hypot(this.line.b.x - this.line.a.x, this.line.b.y - this.line.a.y) < 1e-6) this.line = null, this.pending = true;
  }
  get start() { return this.project(this.p0); }
  project(p) {
    if (this.line) { const q = projToLine(p, this.line.a, this.line.b); return { ...p, x: q.x, y: q.y }; }
    if (this.circle) { const c = this.circle.c, a = Math.atan2(p.y - c.y, p.x - c.x); return { ...p, x: c.x + Math.cos(a) * this.circle.r, y: c.y + Math.sin(a) * this.circle.r }; }
    return p;
  }
  feed(p) {
    if (!this.pending) return [this.project(p)];
    this.buf.push(p);
    const v = this.app.view, dx = p.x - this.p0.x, dy = p.y - this.p0.y;
    if (Math.hypot(dx, dy) * v.s < 8) return [];
    // 動いた向きに一番近い候補を選ぶ
    const cands = [];
    for (const q of this.r.pts) cands.push({ x: q.x - this.p0.x, y: q.y - this.p0.y });
    if (this.r.type === 'persp1') cands.push({ x: 1, y: 0 });              // 水平（原稿の向き）
    cands.push({ x: 0, y: 1 });                                             // 垂直
    const m = Math.hypot(dx, dy);
    let best = null, bs = -1;
    for (const c of cands) { const l = Math.hypot(c.x, c.y) || 1, s = Math.abs((c.x * dx + c.y * dy) / (l * m)); if (s > bs) { bs = s; best = c; } }
    this.line = { a: this.p0, b: { x: this.p0.x + best.x, y: this.p0.y + best.y } };
    this.pending = false;
    const out = this.buf.map((q) => this.project(q));
    this.buf = [];
    return out;
  }
}
function projToLine(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1, t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  return { x: a.x + dx * t, y: a.y + dy * t };
}
function distToLine(p, a, b) { const q = projToLine(p, a, b); return Math.hypot(p.x - q.x, p.y - q.y); }
