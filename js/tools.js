'use strict';
/* 道具。どれも down(p) / move(p) / up(p) / cancel() を持つ（p は文書座標＋筆圧など）。
   showsHover = ペン先の輪郭を出す、drawOverlay(g, view) = 画面座標の補助表示。 */

/* 道具の一覧（左のツールバーの順）。subtools があるものはサブツールを選べる */
const TOOL_DEFS = [
  { id: 'select', name: '選択範囲', key: 'm', icon: 'select' },
  { id: 'pen', name: 'ペン', key: 'p', icon: 'pen' },
  { id: 'pencil', name: '鉛筆', key: 'n', icon: 'pencil' },
  { id: 'brush', name: '筆', key: 'b', icon: 'brush' },
  { id: 'airbrush', name: 'エアブラシ', key: 'a', icon: 'air' },
  { id: 'eraser', name: '消しゴム', key: 'e', icon: 'eraser' },
  { id: 'vecedit', name: '線修正', key: 'q', icon: 'vecedit' },
  { id: 'fill', name: '塗りつぶし', key: 'g', icon: 'bucket' },
  { id: 'gradient', name: 'グラデーション', key: 'j', icon: 'gradient' },
  { id: 'shape', name: '図形', key: 'u', icon: 'shape' },
  { id: 'text', name: 'テキスト', key: 't', icon: 'text' },
  { id: 'frame', name: 'コマ枠', key: 'k', icon: 'frame' },
  { id: 'balloon', name: 'フキダシ', key: 'f', icon: 'balloon' },
  { id: 'fx', name: '効果線', key: 'l', icon: 'fx' },
  { id: 'ruler', name: '定規', key: 'r', icon: 'ruler' },
  { id: 'eyedropper', name: 'スポイト', key: 'i', icon: 'dropper' },
  { id: 'move', name: 'レイヤー移動', key: 'v', icon: 'move' },
  { id: 'hand', name: '手のひら', key: 'h', icon: 'hand' },
  { id: 'zoom', name: '虫めがね', key: 'z', icon: 'zoom' },
];
const BRUSH_TOOLS = ['pen', 'pencil', 'brush', 'airbrush', 'eraser'];
const FILL_SUBTOOLS = [
  { id: 'fill-ref', name: '他レイヤーを参照', s: { mode: 'flood', ref: 'all' } },
  { id: 'fill-layer', name: '編集レイヤーのみ参照', s: { mode: 'flood', ref: 'layer' } },
  { id: 'fill-refl', name: '参照レイヤーを参照', s: { mode: 'flood', ref: 'ref' } },
  { id: 'lasso', name: '囲って塗る（投げなわ）', s: { mode: 'lasso' } },
  { id: 'lasso-erase', name: '囲って消す', s: { mode: 'lasso', erase: true } },
];
const FILL_DEFAULTS = { mode: 'flood', ref: 'all', tolerance: 10, gap: 2, expand: 1, opacity: 1, erase: false };

class BrushTool {
  constructor(app) { this.app = app; this.showsHover = true; this.stroke = null; this.lastEnd = null; }
  down(p) {
    const app = this.app, layer = app.doc.active;
    const b = app.brush;
    this.stroke = new BrushStroke(app.doc, layer, b, app.color.main, { gamma: app.pressureGamma(), transparent: app.color.transparent && !b.erase, target: app.doc.maskEdit ? 'mask' : 'tiles' });
    // 定規: 対称は写す、それ以外は吸い付き
    const r = app.doc.ruler;
    this.stroke.mirrors = r && r.type === 'symmetry' && app.settings.snap ? symmetryMatrices(r) : null;
    this.snap = RulerSnap.begin(app, p);
    if (this.snap) { this.stroke.add(this.snap.start); return; }
    // Shift: 前のストロークの終わりから直線
    if (p.shift && this.lastEnd && this.lastEnd.layer === layer) {
      const a = this.lastEnd;
      const n = Math.max(2, Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / 2));
      for (let i = 0; i <= n; i++) this.stroke.add({ ...p, x: lerp(a.x, p.x, i / n), y: lerp(a.y, p.y, i / n) });
    } else this.stroke.add(p);
  }
  move(p) {
    if (!this.stroke) return;
    if (this.snap) { for (const q of this.snap.feed(p)) this.stroke.add(q); }
    else this.stroke.add(p);
  }
  up(p) {
    if (!this.stroke) return;
    if (this.snap) { for (const q of this.snap.feed(p)) this.stroke.add(q); this.snap = null; }
    this.stroke.end();
    this.lastEnd = { x: p.x, y: p.y, layer: this.stroke.layer };
    this.stroke = null;
    this.app.afterEdit();
  }
  cancel() { if (this.stroke) { this.stroke.cancel(); this.stroke = null; } }
}

class FillTool {
  constructor(app) { this.app = app; this.pts = null; }
  get opts() { return this.app.fillOpts; }
  down(p) {
    if (this.opts.mode === 'lasso') { this.pts = [{ x: p.x, y: p.y }]; return; }
    const app = this.app, o = this.opts;
    const W = app.doc.width * app.doc.height;
    const run = () => {
      const ok = Fill.run(app.doc, app.doc.active, p.x, p.y, {
        ...o, color: app.color.main, erase: o.erase || app.color.transparent, alphaLock: app.doc.active.alphaLock, tolerance: Math.round((o.tolerance / 100) * 255),
        target: app.doc.maskEdit ? 'mask' : 'tiles',
      });
      if (!ok) toast('塗れる所がありませんでした');
      app.afterEdit();
      app.view.request();
    };
    if (W > 6e6) { app.busy('塗りつぶし中…'); setTimeout(() => { try { run(); } finally { app.busy(null); } }, 30); }
    else run();
  }
  move(p) {
    if (!this.pts) return;
    const l = this.pts[this.pts.length - 1];
    if (Math.hypot(p.x - l.x, p.y - l.y) * this.app.view.s > 2) this.pts.push({ x: p.x, y: p.y });
  }
  up() {
    const pts = this.pts;
    this.pts = null;
    if (!pts || pts.length < 3) { this.app.view.request(); return; }
    const app = this.app, doc = app.doc, o = this.opts;
    const erase = o.erase || app.color.transparent;
    doc.beginStroke(doc.active, { erase, opacity: o.opacity, target: doc.maskEdit ? 'mask' : 'tiles' });
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const { tx0, ty0, tx1, ty1 } = tilesOfRect({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 });
    for (let ty = Math.max(0, ty0); ty <= Math.min(doc.rows - 1, ty1); ty++) for (let tx = Math.max(0, tx0); tx <= Math.min(doc.cols - 1, tx1); tx++) {
      const g = ctx2d(doc.strokeTile(tx, ty));
      g.setTransform(1, 0, 0, 1, -tx * TILE, -ty * TILE);
      g.fillStyle = erase ? '#000' : app.color.main;
      g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath();
      g.fill();
    }
    doc.commitStroke(erase ? '囲って消す' : '囲って塗る');
    app.afterEdit();
    app.view.request();
  }
  cancel() { this.pts = null; }
  drawOverlay(g, view) {
    if (!this.pts || this.pts.length < 2) return;
    g.beginPath();
    this.pts.forEach((q, i) => { const s = view.toScreen(q.x, q.y); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
    g.lineWidth = 1.5; g.strokeStyle = '#000'; g.setLineDash([5, 4]); g.stroke();
    g.strokeStyle = '#fff'; g.lineDashOffset = 4.5; g.stroke(); g.setLineDash([]); g.lineDashOffset = 0;
    g.fillStyle = 'rgba(80,140,255,.15)'; g.fill();
  }
}

class EyedropperTool {
  constructor(app) { this.app = app; }
  down(p) { this.app.pickColorAt(p, this.app.toolOpts.eyedropper || 'all'); }
  move(p) { this.app.pickColorAt(p, this.app.toolOpts.eyedropper || 'all'); }
  up() { this.app.color.commitHistory(); }
}

class MoveTool {
  constructor(app) { this.app = app; this.st = null; }
  targets() {
    const a = this.app.doc.active;
    if (!a) return [];
    if (a.hasTiles) return [a];
    if (a.isFolder) return [...this.app.doc.walk(a.children)].filter((l) => l.hasTiles && !l.locked);
    return [];
  }
  down(p) {
    const ts = this.targets();
    if (!ts.length) { toast('動かせるレイヤーがありません'); return; }
    this.st = { x: p.x, y: p.y, ts };
  }
  move(p) {
    if (!this.st) return;
    let dx = p.x - this.st.x, dy = p.y - this.st.y;
    if (p.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const off = { dx: Math.round(dx), dy: Math.round(dy) };
    for (const l of this.st.ts) l.offset = off;
    this.app.doc.invalidateAll();
  }
  up() {
    const st = this.st;
    this.st = null;
    if (!st) return;
    const doc = this.app.doc, off = st.ts[0].offset || { dx: 0, dy: 0 };
    for (const l of st.ts) l.offset = null;
    if (off.dx || off.dy) {
      doc.history.begin();
      for (const l of st.ts) {
        if (l.kind === 'text') {
          const before = l.text;
          l.text = { ...before, x: before.x + off.dx, y: before.y + off.dy };
          renderText(doc, l);
          doc.history.push(new SwapCmd('テキストの移動', l, 'text', before, l.text, rerenderTextCmd));
        } else if (l.kind === 'vector') transformVectorLayer(doc, l, (x, y) => ({ x: x + off.dx, y: y + off.dy }), null);
        else moveLayerPixels(doc, l, off.dx, off.dy);
        if (l.mask && l.mask.size) moveLayerPixels(doc, l, off.dx, off.dy, 'mask');
      }
      doc.history.end('レイヤー移動');
    }
    doc.invalidateAll();
    this.app.afterEdit();
  }
  cancel() { if (this.st) { for (const l of this.st.ts) l.offset = null; this.app.doc.invalidateAll(); } this.st = null; }
}

/* レイヤーの画素を整数 px ずらす（タイルを作り直し、古いタイルは履歴が持つ） */
function moveLayerPixels(doc, layer, dx, dy, prop = 'tiles') {
  const old = layer[prop], nt = new Map();
  for (const [k, c] of old) {
    const [tx, ty] = parseKey(k);
    const X = tx * TILE + dx, Y = ty * TILE + dy;
    const ux0 = Math.floor(X / TILE), uy0 = Math.floor(Y / TILE);
    for (let uy = uy0; uy <= uy0 + 1; uy++) for (let ux = ux0; ux <= ux0 + 1; ux++) {
      const ox = X - ux * TILE, oy = Y - uy * TILE;
      if (ox >= TILE || oy >= TILE || ox <= -TILE || oy <= -TILE) continue;
      const nk = tkey(ux, uy);
      let t = nt.get(nk);
      if (!t) { t = TilePool.get(); nt.set(nk, t); }
      ctx2d(t).drawImage(c, ox, oy);
    }
  }
  const before = new Map();
  for (const k of new Set([...old.keys(), ...nt.keys()])) before.set(k, old.get(k) || null);
  old.clear();
  for (const [k, t] of nt) old.set(k, t);
  for (const k of before.keys()) { doc.invalidateKey(k); doc.markTile(layer, k, prop === 'mask'); }
  layer.ver++;
  doc.history.push(new PixelCmd('レイヤー移動', layer, before, prop));
  doc.changed();
}

class NullTool { constructor() {} down() {} move() {} up() {} }
