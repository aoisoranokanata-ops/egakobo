'use strict';
/* 選択範囲ツール・選択範囲の操作・コピーと貼り付け・選択範囲ランチャー（選択中に出る操作バー） */

const SELECT_SUBTOOLS = [
  { id: 'rect', name: '長方形' },
  { id: 'ellipse', name: '楕円' },
  { id: 'lasso', name: '投げなわ' },
  { id: 'poly', name: '折れ線' },
  { id: 'wand', name: '自動選択' },
  { id: 'selpen', name: '選択ペン' },
  { id: 'selerase', name: '選択消し' },
];
const SEL_DEFAULTS = { sub: 'rect', mode: 'new', ref: 'layer', tolerance: 10, gap: 0, size: 40, square: false };

class SelectTool {
  constructor(app) { this.app = app; this.st = null; this.poly = null; }
  get o() { return this.app.selOpts; }
  get showsHover() { return this.o.sub === 'selpen' || this.o.sub === 'selerase'; }
  modeFor(p) { return p.alt ? 'sub' : p.shift ? 'add' : this.o.mode; }
  down(p) {
    const sub = this.o.sub;
    if (sub === 'poly') {
      const v = this.app.view;
      if (this.poly && this.poly.length > 2) {
        const a = v.toScreen(this.poly[0].x, this.poly[0].y), b = v.toScreen(p.x, p.y);
        if (Math.hypot(a.x - b.x, a.y - b.y) < 16) { this.closePoly(p); return; }
      }
      if (!this.poly) this.poly = [];
      this.poly.push({ x: p.x, y: p.y });
      this.st = { poly: true };
      return;
    }
    if (sub === 'wand') { this.wand(p); return; }
    this.st = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, pts: [{ x: p.x, y: p.y }], mode: this.modeFor(p) };
  }
  move(p) {
    const st = this.st;
    if (!st || st.poly) return;
    st.x1 = p.x; st.y1 = p.y;
    const l = st.pts[st.pts.length - 1];
    if (Math.hypot(p.x - l.x, p.y - l.y) * this.app.view.s > 1.5) st.pts.push({ x: p.x, y: p.y });
  }
  up(p) {
    const st = this.st, doc = this.app.doc;
    this.st = null;
    if (!st || st.poly) return;
    const sub = this.o.sub;
    let shape = null;
    if (sub === 'rect' || sub === 'ellipse') {
      let x = Math.min(st.x0, st.x1), y = Math.min(st.y0, st.y1), w = Math.abs(st.x1 - st.x0), h = Math.abs(st.y1 - st.y0);
      if (this.o.square) { const m = Math.max(w, h); w = h = m; if (st.x1 < st.x0) x = st.x0 - m; if (st.y1 < st.y0) y = st.y0 - m; }
      if (w < 2 || h < 2) { if (st.mode === 'new') doc.setSel(null, '選択を解除'); this.app.view.request(); return; }
      const r = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      shape = sub === 'rect' ? Selection.rect(doc, r) : Selection.ellipse(doc, r);
    } else if (sub === 'lasso') {
      if (st.pts.length < 3) { if (st.mode === 'new') doc.setSel(null, '選択を解除'); this.app.view.request(); return; }
      shape = Selection.polygon(doc, st.pts);
    } else if (sub === 'selpen' || sub === 'selerase') {
      const r = this.o.size / 2;
      const xs = st.pts.map((q) => q.x), ys = st.pts.map((q) => q.y);
      const rect = { x: Math.min(...xs) - r - 2, y: Math.min(...ys) - r - 2, w: Math.max(...xs) - Math.min(...xs) + 2 * r + 4, h: Math.max(...ys) - Math.min(...ys) + 2 * r + 4 };
      shape = Selection.fromDraw(doc, rect, (g) => {
        g.lineWidth = r * 2; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); st.pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
        if (st.pts.length === 1) g.lineTo(st.pts[0].x + 0.01, st.pts[0].y);
        g.stroke();
      });
      st.mode = sub === 'selerase' ? 'sub' : 'add';
    }
    if (shape) this.apply(shape, st.mode);
  }
  apply(shape, mode) {
    const doc = this.app.doc;
    const cur = doc.sel;
    let next = shape;
    if (cur && mode !== 'new') next = cur.combine(shape, mode);
    else if (!cur && (mode === 'sub' || mode === 'and')) next = mode === 'sub' ? null : shape;
    doc.setSel(next, '選択範囲');
    this.app.view.request();
  }
  closePoly() {
    const pts = this.poly;
    this.poly = null; this.st = null;
    if (pts && pts.length > 2) this.apply(Selection.polygon(this.app.doc, pts), this.o.mode);
    this.app.view.request();
  }
  wand(p) {
    const app = this.app, doc = app.doc, o = this.o;
    const run = () => {
      const region = Fill.region(doc, doc.active, p.x, p.y, { ref: o.ref, tolerance: Math.round((o.tolerance / 100) * 255), gap: o.gap, expand: 0 });
      if (!region) return;
      this.apply(Selection.fromMask(doc, region), this.modeFor(p));
    };
    if (doc.width * doc.height > 6e6) { app.busy('選択中…'); setTimeout(() => { try { run(); } finally { app.busy(null); } }, 30); } else run();
  }
  cancel() { this.st = null; }
  drawOverlay(g, view) {
    const st = this.st, sub = this.o.sub;
    g.save();
    g.lineWidth = 1; g.setLineDash([5, 4]);
    const stroke = () => { g.strokeStyle = '#000'; g.lineDashOffset = 0; g.stroke(); g.strokeStyle = '#fff'; g.lineDashOffset = 4.5; g.stroke(); };
    if (this.poly) {
      g.beginPath();
      this.poly.forEach((q, i) => { const s = view.toScreen(q.x, q.y); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
      if (view.hover) { const s = view.toScreen(view.hover.x, view.hover.y); g.lineTo(s.x, s.y); }
      stroke();
      const s0 = view.toScreen(this.poly[0].x, this.poly[0].y);
      g.setLineDash([]); g.fillStyle = '#2b8cff'; g.beginPath(); g.arc(s0.x, s0.y, 6, 0, Math.PI * 2); g.fill();
    }
    if (st && !st.poly) {
      g.beginPath();
      if (sub === 'rect' || sub === 'ellipse') {
        const a = view.toScreen(st.x0, st.y0), b = view.toScreen(st.x1, st.y0), c = view.toScreen(st.x1, st.y1), d = view.toScreen(st.x0, st.y1);
        if (sub === 'rect' || view.rot) { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath(); }
        else g.ellipse((a.x + c.x) / 2, (a.y + c.y) / 2, Math.abs(c.x - a.x) / 2, Math.abs(c.y - a.y) / 2, 0, 0, Math.PI * 2);
        stroke();
      } else if (sub === 'lasso') {
        st.pts.forEach((q, i) => { const s = view.toScreen(q.x, q.y); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
        stroke();
      } else {
        g.setLineDash([]);
        g.lineWidth = Math.max(1, this.o.size * view.s); g.lineCap = 'round'; g.lineJoin = 'round';
        g.strokeStyle = sub === 'selerase' ? 'rgba(255,90,95,.35)' : 'rgba(43,140,255,.35)';
        st.pts.forEach((q, i) => { const s = view.toScreen(q.x, q.y); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
        g.stroke();
      }
    }
    if (!st && this.showsHover && view.hover) {
      const s = view.toScreen(view.hover.x, view.hover.y);
      g.setLineDash([]); g.strokeStyle = 'rgba(0,0,0,.7)';
      g.beginPath(); g.arc(s.x, s.y, Math.max(2, (this.o.size / 2) * view.s), 0, Math.PI * 2); g.stroke();
    }
    g.restore();
  }
}

/* ---- 選択範囲の操作 */
const SelOps = {
  all(doc) { doc.setSel(Selection.all(doc), 'すべてを選択'); },
  none(doc) { if (doc.sel) doc.setSel(null, '選択を解除'); },
  invert(doc) { doc.setSel(doc.sel ? doc.sel.invert() : Selection.all(doc), '選択範囲を反転'); },
  async grow(app, sign) {
    const doc = app.doc;
    if (!doc.sel) { toast('選択範囲がありません'); return; }
    const v = await promptBox(sign > 0 ? '選択範囲を広げる' : '選択範囲を縮める', '4', '何 px');
    if (v == null || !(+v > 0)) return;
    app.busy('計算中…');
    setTimeout(() => { try { doc.setSel(doc.sel.grow(sign * Math.round(+v)), sign > 0 ? '選択範囲を広げる' : '選択範囲を縮める'); } finally { app.busy(null); } app.view.request(); }, 30);
  },
  async feather(app) {
    const doc = app.doc;
    if (!doc.sel) { toast('選択範囲がありません'); return; }
    const v = await promptBox('境界をぼかす', '8', 'ぼかす幅 px');
    if (v == null || !(+v > 0)) return;
    app.busy('計算中…');
    setTimeout(() => { try { doc.setSel(doc.sel.feather(+v), '境界をぼかす'); } finally { app.busy(null); } app.view.request(); }, 30);
  },
  /* レイヤーの描いてある所を選択 */
  fromLayer(doc) {
    const a = doc.active;
    if (!a || !a.hasTiles) { toast('描いてあるレイヤーを選んでください'); return; }
    doc.setSel(Selection.fromTiles(doc, a.tiles), 'レイヤーから選択範囲');
  },
  /* 選択範囲の中を消す・塗る */
  clear(doc) {
    const a = doc.active;
    if (!editableRaster(doc, a)) return;
    if (!doc.sel) { LayerOps.clear(doc); return; }
    doc.pixelEdit('消去', a, (touch) => {
      for (const [k, st] of doc.sel.tiles) {
        const t = a.tiles.get(k);
        if (!t) continue;
        touch(k);
        const g = ctx2d(t); g.globalCompositeOperation = 'destination-out'; g.drawImage(st, 0, 0); g.globalCompositeOperation = 'source-over';
      }
    });
  },
  clearOutside(doc) {
    const a = doc.active;
    if (!editableRaster(doc, a) || !doc.sel) return;
    doc.pixelEdit('選択範囲外を消去', a, (touch) => {
      for (const [k, t] of a.tiles) {
        touch(k);
        const st = doc.sel.tiles.get(k), g = ctx2d(t);
        if (!st) { g.clearRect(0, 0, TILE, TILE); continue; }
        g.globalCompositeOperation = 'destination-in'; g.drawImage(st, 0, 0); g.globalCompositeOperation = 'source-over';
      }
    });
  },
  fill(doc, color) {
    const a = doc.active;
    if (!editableRaster(doc, a)) return;
    if (!doc.sel) { fillLayerSolid(doc, color); return; }
    doc.beginStroke(a, {});
    for (const k of doc.sel.tiles.keys()) { const [tx, ty] = parseKey(k); const g = ctx2d(doc.strokeTile(tx, ty)); g.fillStyle = color; g.fillRect(0, 0, TILE, TILE); }
    doc.commitStroke('塗りつぶし');
  },
};
function editableRaster(doc, a) {
  if (!a || !a.isRaster) { toast('ラスターレイヤーを選んでください'); return false; }
  if (doc.effectiveLocked(a)) { toast('レイヤーがロックされています'); return false; }
  return true;
}

/* ---- コピー・切り取り・貼り付け（アプリの中だけ。タイルの写しを持つ） */
const Clip = {
  data: null,             // {tiles: Map, name}
  copy(doc, cut = false) {
    const a = doc.active;
    if (!a || !a.hasTiles) { toast('描いてあるレイヤーを選んでください'); return false; }
    const tiles = new Map();
    for (const [k, t] of a.tiles) {
      const st = doc.sel ? doc.sel.tiles.get(k) : null;
      if (doc.sel && !st) continue;
      const c = copyTile(t);
      if (st) { const g = ctx2d(c); g.globalCompositeOperation = 'destination-in'; g.drawImage(st, 0, 0); g.globalCompositeOperation = 'source-over'; }
      tiles.set(k, c);
    }
    if (this.data) for (const t of this.data.tiles.values()) TilePool.put(t);
    this.data = { tiles, name: a.name };
    if (cut) { if (a.isRaster) SelOps.clear(doc); else toast('ラスターレイヤーでないので、元は消しません'); }
    toast(cut ? '切り取りました' : 'コピーしました', { ms: 900 });
    return true;
  },
  paste(app) {
    const doc = app.doc;
    if (!this.data) { toast('コピーしたものがありません'); return; }
    const l = new Layer('raster', this.data.name + ' のコピー');
    for (const [k, t] of this.data.tiles) { l.tiles.set(k, copyTile(t)); doc.markTile(l, k); }
    doc.structEdit('貼り付け', () => { LayerOps.placeNew(doc, l); doc.activeId = l.id; });
  },
  /* 選択範囲の中を新しいレイヤーに（コピー＆貼り付け） */
  toNewLayer(app) { if (this.copy(app.doc)) this.paste(app); },
};

/* ---- 選択範囲ランチャー（選択中だけ画面の下に出る） */
class SelLauncher {
  constructor(app) {
    this.app = app;
    this.el = el('div', { id: 'selbar', class: 'selbar', hidden: true });
    const b = (label, title, fn) => el('button', { class: 'sb', title, onclick: fn }, label);
    this.el.append(
      b('解除', '選択を解除（⌘D）', () => SelOps.none(app.doc)),
      b('反転', '選択範囲を反転', () => SelOps.invert(app.doc)),
      b('拡大縮小', '拡大・縮小・回転（⌘T）', () => app.startTransform()),
      b('消去', '選択範囲の中を消す', () => SelOps.clear(app.doc)),
      b('範囲外消去', '選択範囲の外を消す', () => SelOps.clearOutside(app.doc)),
      b('塗りつぶし', 'メインカラーで塗る', () => SelOps.fill(app.doc, app.color.main)),
      b('コピー&貼付', '新しいレイヤーに写す', () => Clip.toNewLayer(app)),
      b('広げる', '選択範囲を広げる', () => SelOps.grow(app, 1)),
      b('縮める', '選択範囲を縮める', () => SelOps.grow(app, -1)),
    );
    $('#viewport').append(this.el);
  }
  refresh() {
    const d = this.app.doc;
    this.el.hidden = !(d && d.sel && !(this.app.tool instanceof TransformTool));
  }
}
