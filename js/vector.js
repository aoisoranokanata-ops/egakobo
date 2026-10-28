'use strict';
/* ベクターレイヤー: 線 = 補正済みの点の列＋ブラシの設定。画素（tiles）は線から描いた結果のキャッシュ。
   線の消し方: 触れた部分 / 線全体 / 交点まで。線幅修正: 触れた線を太く・細く。
   線は作ったら変えない（変える時は新しい線を作る）→ 履歴は strokes 配列の差し替え（SwapCmd）。 */

const VEC_KEYS = ['size', 'opacity', 'density', 'hardness', 'tip', 'flatRatio', 'flatAngle', 'spacing', 'pSize', 'pMin', 'pDensity', 'pDensityMin', 'tiltSize', 'tiltDensity', 'azimuth', 'taperIn', 'taperOut', 'grain', 'grainStrength'];
let _vecSeq = 1;

function makeVecStroke(pts, b, color, w = 1) {
  const s = { id: _vecSeq++, pts, b, color, w };
  s.bbox = strokeBBox(s);
  return s;
}
function strokeBBox(s) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < s.pts.length; i += 5) { const x = s.pts[i], y = s.pts[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const m = (s.b.size * s.w) / 2 + 3;
  return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
}
const ptCount = (s) => s.pts.length / 5;
function toPts(arr) {        // [{x,y,pr,alt,az}] → Float32Array
  const f = new Float32Array(arr.length * 5);
  arr.forEach((q, i) => { f[i * 5] = q.x; f[i * 5 + 1] = q.y; f[i * 5 + 2] = q.pr; f[i * 5 + 3] = q.alt ?? 1; f[i * 5 + 4] = q.az == null ? NaN : q.az; });
  return f;
}
function fromPts(f) {
  const out = [];
  for (let i = 0; i < f.length; i += 5) out.push({ x: f[i], y: f[i + 1], pr: f[i + 2], alt: f[i + 3], az: isNaN(f[i + 4]) ? null : f[i + 4], tw: 0 });
  return out;
}

/* ブラシで描き終わった線をベクターに加える（見た目は描いた時の stroke タイルをそのまま焼く） */
function vectorCommit(bs) {
  const doc = bs.doc, layer = bs.layer, s = doc.stroke;
  doc.stroke = null;
  if (!bs.pts.length) { if (s) for (const t of s.tiles.values()) TilePool.put(t); return; }
  const b = {}; for (const k of VEC_KEYS) b[k] = bs.b[k];
  const stk = makeVecStroke(toPts(bs.pts), b, bs.color);
  for (const [k, st] of s.tiles) {
    let cur = layer.tiles.get(k);
    if (!cur) { cur = TilePool.get(); layer.tiles.set(k, cur); }
    applyStrokeTile(ctx2d(cur), st, { ...s, sel: null }, k);
    TilePool.put(st);
    doc.invalidateKey(k); doc.markTile(layer, k);
  }
  const before = layer.strokes, after = [...before, stk];
  layer.strokes = after;
  layer.ver++;
  doc.history.push(new SwapCmd('ベクター線', layer, 'strokes', before, after, rerenderVectorDiff));
  doc.changed();
}

/* 線1本を描く。keys を渡すとそのタイルだけ */
function renderVecStroke(doc, layer, stk, keys) {
  const tmp = new Map();
  const sink = {
    tile: (tx, ty) => {
      const k = tkey(tx, ty);
      if (keys && !keys.has(k)) return null;
      let c = tmp.get(k); if (!c) { c = TilePool.get(); tmp.set(k, c); } return c;
    },
    clear: () => { for (const c of tmp.values()) TilePool.put(c); tmp.clear(); },
  };
  const b = { ...BRUSH_DEFAULTS, ...stk.b, size: stk.b.size * stk.w, stab: 0, erase: false };
  const bs = new BrushStroke(doc, layer, b, stk.color, { sink });
  bs.replay(fromPts(stk.pts));
  for (const [k, st] of tmp) {
    let cur = layer.tiles.get(k);
    if (!cur) { cur = TilePool.get(); layer.tiles.set(k, cur); }
    applyStrokeTile(ctx2d(cur), st, { opacity: b.opacity, grain: bs.grain, erase: false, alphaLock: false, sel: null }, k);
    TilePool.put(st);
  }
}
/* 範囲を線から描き直す */
function renderVectorRegion(doc, layer, rect) {
  const keys = new Set();
  for (const [, , k] of doc.gridKeys(rect)) keys.add(k);
  for (const k of keys) { const t = layer.tiles.get(k); if (t) { TilePool.put(t); layer.tiles.delete(k); } }
  for (const stk of layer.strokes) if (rectsOverlap(stk.bbox, rect)) renderVecStroke(doc, layer, stk, keys);
  for (const k of keys) { doc.invalidateKey(k); doc.markTile(layer, k); }
  layer.ver++;
}
function rectsOverlap(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
function unionRect(a, b) { if (!a) return b; if (!b) return a; const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; }
/* 差し替えの前後で変わった線の範囲だけ描き直す */
function rerenderVectorDiff(doc, layer, from, to) {
  const A = new Set(from), B = new Set(to);
  let r = null;
  for (const s of from) if (!B.has(s)) r = unionRect(r, s.bbox);
  for (const s of to) if (!A.has(s)) r = unionRect(r, s.bbox);
  if (r) renderVectorRegion(doc, layer, r);
  doc.changed();
}
function vectorBounds(layer) {
  let r = null;
  for (const s of layer.strokes) r = unionRect(r, s.bbox);
  return r ? { x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.w), h: Math.ceil(r.h) } : null;
}
/* 変形・移動: 点を写して描き直す */
function transformVectorLayer(doc, layer, mapFn, scaleAt) {
  const before = layer.strokes;
  const after = before.map((s) => {
    const n = ptCount(s), f = new Float32Array(s.pts);
    let sc = 0;
    for (let i = 0; i < n; i++) {
      const p = mapFn(s.pts[i * 5], s.pts[i * 5 + 1]);
      f[i * 5] = p.x; f[i * 5 + 1] = p.y;
      if (scaleAt && i % 8 === 0) sc += scaleAt(s.pts[i * 5], s.pts[i * 5 + 1]);
    }
    const k = scaleAt ? sc / Math.ceil(n / 8) : 1;
    return makeVecStroke(f, s.b, s.color, s.w * k);
  });
  layer.strokes = after;
  rerenderVectorDiff(doc, layer, before, after);
  doc.history.push(new SwapCmd('ベクターの変形', layer, 'strokes', before, after, rerenderVectorDiff));
}

/* ---- 当たり判定 */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return { d: Math.hypot(px - ax - t * dx, py - ay - t * dy), t };
}
/* 線分の交点のパラメータ（a 側の 0..1）。交わらなければ -1 */
function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return -1;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}
/* 点の列の一部（位置 a..b、小数は補間）を新しい線に */
function sliceStroke(s, a, b) {
  const n = ptCount(s);
  a = clamp(a, 0, n - 1); b = clamp(b, 0, n - 1);
  if (b - a < 0.5) return null;
  const at = (q) => { const i = Math.min(n - 2, Math.floor(q)), t = q - i, o = []; for (let c = 0; c < 5; c++) o.push(lerp(s.pts[i * 5 + c], s.pts[(i + 1) * 5 + c], t)); return o; };
  const out = [...at(a)];
  for (let i = Math.ceil(a + 1e-6); i < b; i++) for (let c = 0; c < 5; c++) out.push(s.pts[i * 5 + c]);
  out.push(...at(b));
  if (out.length < 10) return null;
  return makeVecStroke(new Float32Array(out), s.b, s.color, s.w);
}
/* 消す: mode = 'touch' | 'whole' | 'intersect'。新しい配列（変わらなければ同じ配列）を返す */
function vectorErase(strokes, x, y, r, mode) {
  let changed = false;
  const out = [];
  for (const s of strokes) {
    const bb = s.bbox;
    if (x + r < bb.x || x - r > bb.x + bb.w || y + r < bb.y || y - r > bb.y + bb.h) { out.push(s); continue; }
    const n = ptCount(s), hw = (s.b.size * s.w) / 2, R = r + hw * 0.8;
    // 一番近い所
    let best = Infinity, bi = -1, bt = 0;
    for (let i = 0; i < n - 1; i++) {
      const q = segDist(x, y, s.pts[i * 5], s.pts[i * 5 + 1], s.pts[(i + 1) * 5], s.pts[(i + 1) * 5 + 1]);
      if (q.d < best) { best = q.d; bi = i; bt = q.t; }
    }
    if (n === 1) { best = Math.hypot(x - s.pts[0], y - s.pts[1]); bi = 0; }
    if (best > R) { out.push(s); continue; }
    changed = true;
    if (mode === 'whole') continue;
    if (mode === 'touch') {
      // 円の中の点を除いた残りを、つながった所ごとに線にする
      let start = -1;
      for (let i = 0; i <= n; i++) {
        const inside = i < n && Math.hypot(s.pts[i * 5] - x, s.pts[i * 5 + 1] - y) <= R;
        if (i < n && !inside) { if (start < 0) start = i; continue; }
        if (start >= 0) { const p = sliceStroke(s, start, i - 1); if (p) out.push(p); start = -1; }
      }
      continue;
    }
    // 交点まで: この線と他の線（と自分の離れた所）の交点を集め、触った所の前後で一番近い交点の間を消す
    const hit = bi + bt;
    let lo = -Infinity, hi = Infinity;
    for (const o of strokes) {
      if (!rectsOverlap(o.bbox, s.bbox)) continue;
      const m = ptCount(o);
      for (let j = 0; j < m - 1; j++) {
        const cx = o.pts[j * 5], cy = o.pts[j * 5 + 1], dx = o.pts[(j + 1) * 5], dy = o.pts[(j + 1) * 5 + 1];
        if (Math.max(cx, dx) < s.bbox.x || Math.min(cx, dx) > s.bbox.x + s.bbox.w || Math.max(cy, dy) < s.bbox.y || Math.min(cy, dy) > s.bbox.y + s.bbox.h) continue;
        for (let i = 0; i < n - 1; i++) {
          if (o === s && Math.abs(i - j) < 3) continue;
          const t = segCross(s.pts[i * 5], s.pts[i * 5 + 1], s.pts[(i + 1) * 5], s.pts[(i + 1) * 5 + 1], cx, cy, dx, dy);
          if (t < 0) continue;
          const q = i + t;
          if (q < hit - 1e-6 && q > lo) lo = q;
          if (q > hit + 1e-6 && q < hi) hi = q;
        }
      }
    }
    if (lo > -Infinity) { const p = sliceStroke(s, 0, lo); if (p) out.push(p); }
    if (hi < Infinity) { const p = sliceStroke(s, hi, n - 1); if (p) out.push(p); }
  }
  return changed ? out : strokes;
}

/* 消しゴムをベクターレイヤーで使った時 */
class VectorEraseTool {
  constructor(app) { this.app = app; this.showsHover = true; this.st = null; }
  down(p) { const l = this.app.doc.active; this.st = { layer: l, before: l.strokes }; this.move(p); }
  move(p) {
    const st = this.st;
    if (!st) return;
    const b = this.app.brush, L = st.layer;
    const r = Math.max(1, b.size / 2);
    const next = vectorErase(L.strokes, p.x, p.y, r, b.vectorMode || 'touch');
    if (next !== L.strokes) { const prev = L.strokes; L.strokes = next; rerenderVectorDiff(this.app.doc, L, prev, next); }
  }
  up() {
    const st = this.st;
    this.st = null;
    if (st && st.layer.strokes !== st.before) this.app.doc.history.push(new SwapCmd('ベクター消去', st.layer, 'strokes', st.before, st.layer.strokes, rerenderVectorDiff));
    this.app.afterEdit();
  }
  cancel() { if (this.st) { const L = this.st.layer, cur = L.strokes; L.strokes = this.st.before; rerenderVectorDiff(this.app.doc, L, cur, L.strokes); this.st = null; } }
}

/* 線修正ツール: 触れた線の太さを変える（1回のなぞりで1本につき1回） */
class VectorWidthTool {
  constructor(app) { this.app = app; this.showsHover = true; this.st = null; }
  get radius() { return (this.app.toolOpts.vecedit || {}).size || 30; }
  down(p) {
    const l = this.app.doc.active;
    if (!l || l.kind !== 'vector') { toast('ベクターレイヤーを選んでください'); return; }
    this.st = { layer: l, before: l.strokes, done: new Set() }; this.move(p);
  }
  move(p) {
    const st = this.st;
    if (!st) return;
    const o = this.app.vecOpts, L = st.layer, r = this.radius / 2;
    const k = o.mode === 'thin' ? 1 / (1 + o.amount / 100) : 1 + o.amount / 100;
    let changed = false;
    const next = L.strokes.map((s) => {
      if (st.done.has(s.id) || !rectsOverlap(s.bbox, { x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r })) return s;
      const n = ptCount(s);
      let hit = false;
      for (let i = 0; i < n && !hit; i++) if (Math.hypot(s.pts[i * 5] - p.x, s.pts[i * 5 + 1] - p.y) <= r + (s.b.size * s.w) / 2) hit = true;
      if (!hit) return s;
      changed = true;
      const ns = makeVecStroke(s.pts, s.b, s.color, Math.max(0.05, s.w * k));
      st.done.add(ns.id);
      return ns;
    });
    if (changed) { const prev = L.strokes; L.strokes = next; rerenderVectorDiff(this.app.doc, L, prev, next); }
  }
  up() {
    const st = this.st;
    this.st = null;
    if (st && st.layer.strokes !== st.before) this.app.doc.history.push(new SwapCmd('線幅修正', st.layer, 'strokes', st.before, st.layer.strokes, rerenderVectorDiff));
    this.app.afterEdit();
  }
  cancel() { this.st = null; }
  drawOverlay(g, view) {
    const h = view.hover;
    if (!h || view.mode === 'tool') return;
    const s = view.toScreen(h.x, h.y);
    g.strokeStyle = 'rgba(43,140,255,.9)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(s.x, s.y, (this.radius / 2) * view.s, 0, Math.PI * 2); g.stroke();
  }
}

/* 保存用 */
function vecToJSON(strokes) {
  return strokes.map((s) => ({ p: Array.from(s.pts, (v) => (isNaN(v) ? null : Math.round(v * 100) / 100)), b: s.b, c: s.color, w: s.w }));
}
function vecFromJSON(arr) {
  return (arr || []).map((o) => makeVecStroke(new Float32Array(o.p.map((v) => (v == null ? NaN : v))), o.b, o.c, o.w || 1));
}
