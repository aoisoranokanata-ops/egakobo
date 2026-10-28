'use strict';
/* マンガの機能: コマ枠（枠の形を持つフォルダー）・トーン（濃さ → 網点）・モノクロ（2値）・効果線・フキダシ */

const mmToPx = (mm, dpi) => (mm / 25.4) * dpi;

/* ================= コマ枠 =================
   folder.frame = { pts: [{x, y}...], width: 線の太さ px, color }（差し替えて使う）
   合成では、中身を枠の形で切り抜き、上に枠線を描く（compose.js の renderList から呼ぶ） */
function framePath(pts) { const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y))); p.closePath(); return p; }
function applyFrame(F, frame, tx, ty) {
  const g = F.getContext('2d');
  g.save();
  g.setTransform(1, 0, 0, 1, -tx * TILE, -ty * TILE);
  const path = framePath(frame.pts);
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = '#000'; g.fill(path);
  g.globalCompositeOperation = 'source-over';
  if (frame.width > 0) { g.lineWidth = frame.width; g.lineJoin = 'miter'; g.miterLimit = 10; g.strokeStyle = frame.color || '#000'; g.stroke(path); }
  g.restore();
}
function frameBBox(frame) {
  const xs = frame.pts.map((p) => p.x), ys = frame.pts.map((p) => p.y), m = frame.width;
  return { x: Math.min(...xs) - m, y: Math.min(...ys) - m, w: Math.max(...xs) - Math.min(...xs) + 2 * m, h: Math.max(...ys) - Math.min(...ys) + 2 * m };
}
function polyArea(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y); return Math.abs(a / 2); }
/* 多角形を「直線より側 side（+1/-1）に offset 以上離れた所」で切る（Sutherland–Hodgman） */
function clipHalf(pts, A, B, side, offset) {
  const dx = B.x - A.x, dy = B.y - A.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  const f = (p) => ((p.x - A.x) * nx + (p.y - A.y) * ny) * side - offset;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }); }
  }
  return out.length >= 3 ? out : null;
}
function pointInPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const FrameOps = {
  /* コマ枠フォルダーを作る（中にラスターレイヤー1枚） */
  make(doc, pts, width, name) {
    const f = new Layer('folder', name);
    f.blend = 'normal';
    f.frame = { pts: pts.map((p) => ({ x: p.x, y: p.y })), width, color: '#000000' };
    const l = new Layer('raster', 'コマの中');
    f.children.push(l);
    return { f, l };
  },
  nextName(doc) { let n = 1; const names = new Set(doc.layers().map((l) => l.name)); while (names.has(`コマ ${n}`)) n++; return `コマ ${n}`; },
  /* 基本枠のダイアログ */
  async createDialog(app) {
    const doc = app.doc, dpi = doc.dpi;
    const W = (doc.width / dpi) * 25.4, H = (doc.height / dpi) * 25.4;
    // B5 同人誌（188×263mm）なら基本枠 150×220mm、それ以外は縦横 8% ずつ
    const b5 = Math.abs(W - 188) < 2 && Math.abs(H - 263) < 2;
    const mx = b5 ? 19 : Math.round(W * 0.08), my = b5 ? 21.5 : Math.round(H * 0.08);
    const f = (label, v) => { const i = el('input', { type: 'number', class: 'inp', value: v, step: 0.5 }); return [i, el('div', {}, el('label', { class: 'lbl' }, label), i)]; };
    const [iT, eT] = f('上の余白 mm', my), [iB, eB] = f('下の余白 mm', my), [iL, eL] = f('左の余白 mm', mx), [iR, eR] = f('右の余白 mm', mx), [iW, eW] = f('枠線の太さ mm', 0.6);
    const body = el('div', {}, el('div', { class: 'row3' }, eT, eB, eW), el('div', { class: 'row3' }, eL, eR),
      el('p', { class: 'hint' }, `原稿 ${W.toFixed(1)}×${H.toFixed(1)}mm（${dpi}dpi）。できた枠は「コマ枠」ツールの「枠線分割」で割れます。`));
    const ok = await modal({ title: 'コマ枠を作成（基本枠）', body, buttons: [{ label: 'キャンセル', value: false }, { label: '作成', value: true, primary: true }] });
    if (!ok) return;
    const px = (v) => mmToPx(+v || 0, dpi);
    const x0 = px(iL.value), y0 = px(iT.value), x1 = doc.width - px(iR.value), y1 = doc.height - px(iB.value);
    if (x1 - x0 < 10 || y1 - y0 < 10) { toast('余白が大きすぎます', { error: true }); return; }
    const { f: fold, l } = this.make(doc, [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], px(iW.value), this.nextName(doc));
    doc.structEdit('コマ枠を作成', () => { LayerOps.placeNew(doc, fold); doc.activeId = l.id; });
    app.setTool('frame');
  },
  /* 線 A–B で割る。割れたフォルダーの数を返す */
  split(app, A, B) {
    const doc = app.doc, o = app.frameOpts, dpi = doc.dpi;
    const horiz = Math.abs(B.x - A.x) >= Math.abs(B.y - A.y);
    const gap = mmToPx(horiz ? o.gapV : o.gapH, dpi);          // 横に割る線 = 上下の間隔
    const frames = doc.layers().filter((l) => l.frame && doc.effectiveVisible(l));
    const jobs = [];
    for (const f of frames) {
      const p1 = clipHalf(f.frame.pts, A, B, 1, gap / 2), p2 = clipHalf(f.frame.pts, A, B, -1, gap / 2);
      if (!p1 || !p2) continue;
      // 線が枠を横切っているか（線分の中に枠の中の点がある）
      let crosses = false;
      for (let t = 0; t <= 1 && !crosses; t += 0.02) if (pointInPoly(f.frame.pts, A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t)) crosses = true;
      if (crosses) jobs.push({ f, p1, p2 });
    }
    if (!jobs.length) return 0;
    doc.structEdit('枠線分割', () => {
      for (const { f, p1, p2 } of jobs) {
        const [keep, other] = polyArea(p1) >= polyArea(p2) ? [p1, p2] : [p2, p1];
        f.frame = { ...f.frame, pts: keep };
        const { f: nf } = this.make(doc, other, f.frame.width, this.nextName(doc));
        const p = doc.parentOf(f);
        p.children.splice(p.children.indexOf(f) + 1, 0, nf);
      }
    });
    return jobs.length;
  },
};

const FRAME_SUBTOOLS = [{ id: 'split', name: '枠線分割' }, { id: 'rect', name: '長方形のコマ' }, { id: 'edit', name: 'コマの角を動かす' }];
const FRAME_DEFAULTS = { sub: 'split', gapH: 2, gapV: 5, width: 0.6 };

class FrameTool {
  constructor(app) { this.app = app; this.st = null; }
  get o() { return this.app.frameOpts; }
  down(p) {
    const app = this.app, doc = app.doc, v = app.view;
    if (this.o.sub === 'edit') {
      let best = null;
      for (const f of doc.layers().filter((l) => l.frame)) f.frame.pts.forEach((q, i) => {
        const s = v.toScreen(q.x, q.y), d = Math.hypot(s.x - v.toScreen(p.x, p.y).x, s.y - v.toScreen(p.x, p.y).y);
        if (d < 24 && (!best || d < best.d)) best = { f, i, d };
      });
      if (best) this.st = { edit: best, before: doc.snapshot() };
      return;
    }
    this.st = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  }
  move(p) {
    const st = this.st;
    if (!st) return;
    if (st.edit) {
      const { f, i } = st.edit;
      const pts = f.frame.pts.map((q, j) => (j === i ? { x: p.x, y: p.y } : q));
      f.frame = { ...f.frame, pts };
      this.app.doc.invalidateAll();
      return;
    }
    st.x1 = p.x; st.y1 = p.y;
    if (this.o.sub === 'split') {
      // 縦横 5° 以内は吸い付く
      const a = Math.atan2(st.y1 - st.y0, st.x1 - st.x0), snap = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(a - snap) < (5 * Math.PI) / 180 || p.shift) { const l = Math.hypot(st.x1 - st.x0, st.y1 - st.y0); st.x1 = st.x0 + Math.cos(snap) * l; st.y1 = st.y0 + Math.sin(snap) * l; }
    }
  }
  up() {
    const st = this.st, app = this.app, doc = app.doc;
    this.st = null;
    if (!st) return;
    if (st.edit) { doc.history.push(new StructCmd('コマの角', st.before, doc.snapshot())); doc.changed('struct'); return; }
    if (Math.hypot(st.x1 - st.x0, st.y1 - st.y0) < 4) { app.view.request(); return; }
    if (this.o.sub === 'split') {
      // 引いた線分が枠を横切った所だけ割る（割る線そのものは無限に延ばして切る）
      const n = FrameOps.split(app, { x: st.x0, y: st.y0 }, { x: st.x1, y: st.y1 });
      if (!n) toast('コマ枠を横切るように線を引いてください');
    } else {
      const x = Math.min(st.x0, st.x1), y = Math.min(st.y0, st.y1), w = Math.abs(st.x1 - st.x0), h = Math.abs(st.y1 - st.y0);
      const { f, l } = FrameOps.make(doc, [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], mmToPx(this.o.width, doc.dpi), FrameOps.nextName(doc));
      doc.structEdit('コマ枠を作成', () => { LayerOps.placeNew(doc, f); doc.activeId = l.id; });
    }
    app.view.request();
  }
  cancel() { this.st = null; }
  drawOverlay(g, view) {
    const doc = this.app.doc;
    g.save();
    for (const f of doc.layers().filter((l) => l.frame)) {
      const pts = f.frame.pts.map((q) => view.toScreen(q.x, q.y));
      g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath();
      g.lineWidth = 1; g.strokeStyle = 'rgba(43,140,255,.8)'; g.stroke();
      if (this.o.sub === 'edit') for (const q of pts) { g.fillStyle = '#fff'; g.strokeStyle = '#2b8cff'; g.beginPath(); g.rect(q.x - 5, q.y - 5, 10, 10); g.fill(); g.stroke(); }
    }
    const st = this.st;
    if (st && !st.edit) {
      const a = view.toScreen(st.x0, st.y0), b = view.toScreen(st.x1, st.y1);
      g.lineWidth = 1.5; g.strokeStyle = '#e4007f'; g.setLineDash([6, 4]);
      g.beginPath();
      if (this.o.sub === 'split') { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
      else { const c = view.toScreen(st.x1, st.y0), d = view.toScreen(st.x0, st.y1); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.lineTo(b.x, b.y); g.lineTo(d.x, d.y); g.closePath(); }
      g.stroke();
    }
    g.restore();
  }
}

/* ================= トーン・モノクロ =================
   layer.tone = { lpi 線数, angle 角度°, shape 'dot'|'line'|'cross'|'noise', color }
   濃さ = 不透明度 ×（1 − 明るさ）。黒 30% で描けば 30% のトーン。グラデーションでグラデーショントーン。 */
const TONE_SHAPES = [['dot', '網点（丸）'], ['line', '線'], ['cross', '格子'], ['noise', '砂目']];
const TONE_DEFAULTS = { lpi: 60, angle: 45, shape: 'dot', color: '#000000' };

/* 網の形の値 s（0..1）。濃さ d のとき「s が t より大きい所の面積 = d」になる t を表にしておく（印刷の濃度どおりになる） */
function toneSpot(shape, fu, fv) {
  if (shape === 'line') return 1 - Math.abs(fv) * 2;
  if (shape === 'cross') return Math.max(1 - Math.abs(fu) * 2, 1 - Math.abs(fv) * 2);
  return (Math.cos(fu * 2 * Math.PI) + Math.cos(fv * 2 * Math.PI)) / 4 + 0.5;
}
const _toneLUT = {};
function toneLUT(shape) {
  if (_toneLUT[shape]) return _toneLUT[shape];
  const N = 128, v = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) v[j * N + i] = toneSpot(shape, (i + 0.5) / N - 0.5, (j + 0.5) / N - 0.5);
  v.sort();
  const lut = new Float32Array(257);
  for (let k = 0; k <= 256; k++) lut[k] = k === 0 ? 1.01 : v[Math.max(0, Math.round((1 - k / 256) * (N * N - 1)))];
  _toneLUT[shape] = lut;
  return lut;
}
function toneTile(src, tmp, tone, tx, ty, dpi) {
  const img = readTilePixels(src), d = img.data;
  const cell = Math.max(2, dpi / tone.lpi), a = (tone.angle * Math.PI) / 180, ca = Math.cos(a) / cell, sa = Math.sin(a) / cell;
  const { r: cr, g: cg, b: cb } = hexToRgb(tone.color || '#000000');
  const k = cell * 0.9;                         // 縁のなめらかさ（1画素ぶん）
  const X0 = tx * TILE, Y0 = ty * TILE, shape = tone.shape, lut = toneLUT(shape);
  for (let y = 0; y < TILE; y++) {
    const Y = Y0 + y + 0.5;
    for (let x = 0; x < TILE; x++) {
      const i = (y * TILE + x) * 4, al = d[i + 3];
      if (!al) continue;
      const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      const den = (al / 255) * (1 - lum);
      let cov;
      if (den <= 0.004) cov = 0;
      else if (den >= 0.996) cov = 1;
      else if (shape === 'noise') cov = hash2(X0 + x, Y0 + y, 11) < den ? 1 : 0;
      else {
        const X = X0 + x + 0.5;
        const u = X * ca + Y * sa, v = -X * sa + Y * ca;
        const fu = u - Math.floor(u) - 0.5, fv = v - Math.floor(v) - 0.5;
        const s = toneSpot(shape, fu, fv);
        cov = (s - lut[Math.round(den * 256)]) * k + 0.5;
        cov = cov < 0 ? 0 : cov > 1 ? 1 : cov;
      }
      d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = cov * 255;
    }
  }
  return putTemp(img, tmp);
}
/* モノクロ（2値）: 半分より透明なら透明、暗ければ黒・明るければ白 */
function monoTile(src, tmp) {
  const img = readTilePixels(src), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) { d[i + 3] = 0; continue; }
    const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 128 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return putTemp(img, tmp);
}
/* 画面のモノクロ2値表示（合成結果の明るさで白黒） */
function monoView(g) {
  const img = readTilePixels(g.canvas), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * (d[i + 3] / 255) + 255 * (1 - d[i + 3] / 255) < 128 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  _readC.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'copy'; g.drawImage(_readC, 0, 0); g.restore();
}
function putTemp(img, tmp) {
  _readC.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
  const g = clearTemp(tmp);
  g.drawImage(_readC, 0, 0);
  return tmp;
}

const ToneOps = {
  async dialog(app, { layer = null } = {}) {
    const doc = app.doc;
    const cur = layer && layer.tone ? layer.tone : { ...TONE_DEFAULTS, ...(app.toolOpts.tone || {}) };
    const lpi = el('input', { type: 'number', class: 'inp', value: cur.lpi, min: 5, max: 200, step: 0.5 });
    const ang = el('input', { type: 'number', class: 'inp', value: cur.angle, min: -180, max: 180 });
    const den = el('input', { type: 'number', class: 'inp', value: 30, min: 1, max: 100 });
    const shape = el('select', { class: 'sel' }, ...TONE_SHAPES.map(([v, t]) => el('option', { value: v, selected: cur.shape === v || null }, t)));
    const body = el('div', {},
      el('div', { class: 'row3' }, el('div', {}, el('label', { class: 'lbl' }, '線数（線/インチ）'), lpi), el('div', {}, el('label', { class: 'lbl' }, '角度 °'), ang),
        layer ? el('div') : el('div', {}, el('label', { class: 'lbl' }, '濃度 %'), den)),
      el('label', { class: 'lbl' }, '網の種類'), shape,
      el('p', { class: 'hint' }, layer ? 'このレイヤーのトーンの設定を変えます。' : (doc.sel ? '選択範囲にトーンを貼ります。' : '選択範囲が無いので、空のトーンレイヤーを作ります。') +
        '黒で描くとトーン、消しゴムで削れます。グラデーションでグラデーショントーンになります。よく使う線数: 50〜65（印刷）、32.5〜42.5（粗め）。'));
    const ok = await modal({ title: layer ? 'トーンの設定' : 'トーンを貼る', body, buttons: [{ label: 'キャンセル', value: false }, { label: 'OK', value: true, primary: true }] });
    if (!ok) return;
    const tone = { lpi: clamp(+lpi.value || 60, 5, 200), angle: +ang.value || 0, shape: shape.value, color: '#000000' };
    app.toolOpts.tone = tone; app.saveTools();
    if (layer) { doc.setProps(layer, { tone }, 'トーンの設定'); return; }
    const l = new Layer('raster', `トーン ${tone.lpi}線 ${den.value}%`);
    l.tone = tone;
    doc.history.begin();
    doc.structEdit('トーンを貼る', () => { LayerOps.placeNew(doc, l); doc.activeId = l.id; });
    if (doc.sel) {
      const a = clamp(+den.value || 30, 1, 100) / 100;
      doc.beginStroke(l, { opacity: a });
      for (const k of doc.sel.tiles.keys()) { const [tx, ty] = parseKey(k); const g = ctx2d(doc.strokeTile(tx, ty)); g.fillStyle = '#000'; g.fillRect(0, 0, TILE, TILE); }
      doc.commitStroke('トーンを貼る');
    }
    doc.history.end('トーンを貼る');
  },
  toggle(app) {
    const doc = app.doc, a = doc.active;
    if (!a || !a.hasTiles) { toast('描いてあるレイヤーを選んでください'); return; }
    if (a.tone) doc.setProps(a, { tone: null }, 'トーンをやめる');
    else this.dialog(app, { layer: a });
  },
};

/* ================= 効果線 =================
   集中線: 内側の楕円から外へ。流線: ドラッグの向きに平行。ウニフラ: 楕円のまわりにトゲ。
   線 = 先細りの三角形（流線・ウニフラは両端が細い）。新しいレイヤーに描く。 */
const FX_SUBTOOLS = [{ id: 'focus', name: '集中線' }, { id: 'flow', name: '流線' }, { id: 'flash', name: 'ウニフラ' }];
const FX_DEFAULTS = { sub: 'focus', count: 160, width: 8, jitter: 50, lenVar: 40, bundle: 0, seed: 1 };

function rng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
/* 線の形の一覧: [{a:{x,y}, b:{x,y}, w, both}] */
function fxLines(doc, o, st) {
  const R = rng(o.seed), out = [];
  const { x0, y0, x1, y1 } = st;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.max(4, Math.abs(x1 - x0) / 2), ry = Math.max(4, Math.abs(y1 - y0) / 2);
  const n = Math.max(2, o.count | 0), jit = o.jitter / 100, lv = o.lenVar / 100;
  if (o.sub === 'focus' || o.sub === 'flash') {
    const far = Math.hypot(Math.max(cx, doc.width - cx), Math.max(cy, doc.height - cy)) * 1.1;
    let bundleLeft = 0, bundleA = 0;
    for (let i = 0; i < n; i++) {
      let a = ((i + (R() - 0.5) * jit) / n) * Math.PI * 2;
      if (o.bundle > 0) { if (bundleLeft <= 0) { bundleLeft = 1 + Math.floor(R() * (o.bundle / 10)); bundleA = a; } else a = bundleA + (R() - 0.5) * 0.02; bundleLeft--; }
      const ex = Math.cos(a), ey = Math.sin(a);
      // 楕円の上の点（ばらつき分だけ外へ）
      const k = 1 + R() * lv;
      const sx = cx + ex * rx * k, sy = cy + ey * ry * k;
      const w = o.width * (0.5 + R() * 0.7);
      if (o.sub === 'focus') out.push({ a: { x: sx, y: sy }, b: { x: cx + ex * far, y: cy + ey * far }, w, both: false });
      else {
        const len = Math.max(rx, ry) * (0.25 + 0.75 * (1 - R() * lv)) * 0.8;
        out.push({ a: { x: sx, y: sy }, b: { x: sx + ex * len, y: sy + ey * len }, w, both: true });
      }
    }
  } else {
    // 流線: 選択範囲（なければ文書）を向きに直交する方向で埋める
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, px = -uy, py = ux;
    const r = doc.sel ? doc.sel.bounds : doc.fullRect;
    const corners = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
    const ps = corners.map(([x, y]) => x * px + y * py), us = corners.map(([x, y]) => x * ux + y * uy);
    const pmin = Math.min(...ps), pmax = Math.max(...ps), umin = Math.min(...us), umax = Math.max(...us);
    for (let i = 0; i < n; i++) {
      const pp = pmin + ((i + 0.5 + (R() - 0.5) * jit) / n) * (pmax - pmin);
      const len = L * (1 - R() * lv);
      const u0 = umin + R() * Math.max(0, umax - umin - len * 0.3) - len * 0.35;
      const a = { x: px * pp + ux * u0, y: py * pp + uy * u0 };
      out.push({ a, b: { x: a.x + ux * len, y: a.y + uy * len }, w: o.width * (0.5 + R() * 0.7), both: true });
    }
  }
  return out;
}
function fxPath(lines) {
  const p = new Path2D();
  for (const { a, b, w, both } of lines) {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * (w / 2), ny = (dx / l) * (w / 2);
    if (both) { const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; p.moveTo(a.x, a.y); p.lineTo(mx + nx, my + ny); p.lineTo(b.x, b.y); p.lineTo(mx - nx, my - ny); p.closePath(); }
    else { p.moveTo(a.x, a.y); p.lineTo(b.x + nx, b.y + ny); p.lineTo(b.x - nx, b.y - ny); p.closePath(); }
  }
  return p;
}

class EffectLineTool {
  constructor(app) { this.app = app; this.st = null; }
  get o() { return this.app.fxOpts; }
  down(p) { this.st = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; }
  move(p) { if (this.st) { this.st.x1 = p.x; this.st.y1 = p.y; } }
  up() {
    const st = this.st, app = this.app, doc = app.doc;
    this.st = null;
    if (!st || Math.hypot(st.x1 - st.x0, st.y1 - st.y0) < 6) { app.view.request(); return; }
    const o = this.o;
    const lines = fxLines(doc, o, st), path = fxPath(lines);
    const l = new Layer('raster', FX_SUBTOOLS.find((s) => s.id === o.sub).name);
    doc.history.begin();
    doc.structEdit('効果線', () => { LayerOps.placeNew(doc, l); doc.activeId = l.id; });
    doc.beginStroke(l, {});
    for (const [tx, ty] of doc.gridKeys()) {
      const g = ctx2d(doc.strokeTile(tx, ty));
      g.setTransform(1, 0, 0, 1, -tx * TILE, -ty * TILE);
      g.fillStyle = app.color.main; g.fill(path);
    }
    // 何も描かれなかったタイルは捨てる
    for (const [k, t] of [...doc.stroke.tiles]) if (!tileHasAlpha(t)) { TilePool.put(t); doc.stroke.tiles.delete(k); }
    doc.commitStroke('効果線');
    doc.history.end('効果線');
    o.seed = (o.seed % 9999) + 1; app.saveTools();          // 次は違う並びに
    app.afterEdit();
  }
  cancel() { this.st = null; }
  drawOverlay(g, view) {
    const st = this.st;
    if (!st) return;
    const o = this.o, m = view.m, dpr = view.dpr;
    g.save();
    g.setTransform(m.a * dpr, m.b * dpr, m.c * dpr, m.d * dpr, m.e * dpr, m.f * dpr);
    g.globalAlpha = 0.7; g.fillStyle = this.app.color.main;
    g.fill(fxPath(fxLines(this.app.doc, { ...o, count: Math.min(o.count, 120) }, st)));
    g.restore();
    g.save();
    g.strokeStyle = '#e4007f'; g.lineWidth = 1.5; g.setLineDash([6, 4]);
    const a = view.toScreen(st.x0, st.y0), b = view.toScreen(st.x1, st.y1);
    g.beginPath();
    if (o.sub === 'flow') { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
    else g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
    g.stroke(); g.restore();
  }
}

/* ================= フキダシ =================
   レイヤー kind 'balloon'、layer.balloons = [{id, shape, x, y, w, h, line, lineColor, fill, tails: [{x, y, w}]}]（差し替えて使う）
   描き方: 全部の形を線の2倍の太さでなぞってから、上を塗る → しっぽと本体がつながった1本の輪郭になる */
const BALLOON_SUBTOOLS = [{ id: 'ellipse', name: '楕円' }, { id: 'rounded', name: '角丸' }, { id: 'cloud', name: 'モコモコ（考え中）' }, { id: 'spike', name: 'トゲ（叫び）' }, { id: 'tail', name: 'しっぽを描く' }, { id: 'edit', name: '選んで動かす' }];
const BALLOON_DEFAULTS = { sub: 'ellipse', line: 4, fillWhite: true };
let _balloonSeq = 1;

function balloonPath(b) {
  const p = new Path2D(), cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2, ry = b.h / 2;
  if (b.shape === 'rounded') { const r = Math.min(b.w, b.h) * 0.28; if (p.roundRect) p.roundRect(b.x, b.y, b.w, b.h, r); else p.rect(b.x, b.y, b.w, b.h); }
  else if (b.shape === 'cloud') {
    const per = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    const n = Math.max(7, Math.round(per / Math.max(20, Math.min(rx, ry) * 0.45)));
    const pt = (a) => ({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    let q0 = pt(0);
    p.moveTo(q0.x, q0.y);
    for (let i = 1; i <= n; i++) {
      const a0 = ((i - 1) / n) * Math.PI * 2, a1 = (i / n) * Math.PI * 2, am = (a0 + a1) / 2;
      const q1 = pt(a1), bulge = 1.32;
      p.quadraticCurveTo(cx + Math.cos(am) * rx * bulge, cy + Math.sin(am) * ry * bulge, q1.x, q1.y);
      q0 = q1;
    }
    p.closePath();
  } else if (b.shape === 'spike') {
    const R = rng(b.id * 7 + 3), n = Math.max(10, Math.round((rx + ry) / 14));
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2, out = i % 2 === 0, k = out ? 1.28 + R() * 0.25 : 0.92;
      const x = cx + Math.cos(a) * rx * k, y = cy + Math.sin(a) * ry * k;
      if (i) p.lineTo(x, y); else p.moveTo(x, y);
    }
    p.closePath();
  } else p.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  return p;
}
function tailPath(b, t) {
  const p = new Path2D(), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = t.x - cx, dy = t.y - cy, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, w = t.w / 2;
  // 少し曲がった三角形（根元は本体の中）
  const mx = cx + dx * 0.55 + nx * l * 0.06, my = cy + dy * 0.55 + ny * l * 0.06;
  p.moveTo(cx + nx * w, cy + ny * w);
  p.quadraticCurveTo(mx + nx * w * 0.4, my + ny * w * 0.4, t.x, t.y);
  p.quadraticCurveTo(mx - nx * w * 0.4, my - ny * w * 0.4, cx - nx * w, cy - ny * w);
  p.closePath();
  return p;
}
function balloonBBox(b) {
  let x0 = b.x - b.w * 0.2, y0 = b.y - b.h * 0.2, x1 = b.x + b.w * 1.2, y1 = b.y + b.h * 1.2;
  for (const t of b.tails) { x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x); y1 = Math.max(y1, t.y); }
  const m = b.line * 2 + 4;
  return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
}
function renderBalloons(doc, layer) {
  for (const [k, t] of layer.tiles) { doc.invalidateKey(k); doc.markTile(layer, k); TilePool.put(t); }
  layer.tiles.clear();
  for (const b of layer.balloons) {
    const paths = [balloonPath(b), ...b.tails.map((t) => tailPath(b, t))];
    for (const [tx, ty, k] of doc.gridKeys(balloonBBox(b))) {
      let c = layer.tiles.get(k);
      const fresh = !c;
      if (fresh) c = TilePool.get();
      const g = ctx2d(c);
      g.setTransform(1, 0, 0, 1, -tx * TILE, -ty * TILE);
      g.lineJoin = 'round'; g.lineWidth = b.line * 2; g.strokeStyle = b.lineColor;
      for (const p of paths) g.stroke(p);
      g.fillStyle = b.fill || '#ffffff';
      if (!b.fill) g.globalCompositeOperation = 'destination-out';
      for (const p of paths) g.fill(p);
      g.globalCompositeOperation = 'source-over';
      if (fresh) { if (tileHasAlpha(c)) layer.tiles.set(k, c); else { TilePool.put(c); continue; } }
      doc.markTile(layer, k); doc.invalidateKey(k);
    }
  }
  layer.ver++;
}
function rerenderBalloonsCmd(doc, layer) { renderBalloons(doc, layer); doc.changed('struct'); }
function hitBalloon(layer, x, y) {
  for (let i = layer.balloons.length - 1; i >= 0; i--) {
    const b = layer.balloons[i], cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (((x - cx) / (b.w / 2)) ** 2 + ((y - cy) / (b.h / 2)) ** 2 <= 1.15) return b;
  }
  return null;
}

class BalloonTool {
  constructor(app) { this.app = app; this.st = null; this.selId = null; }
  get o() { return this.app.balloonOpts; }
  layer(create) {
    const doc = this.app.doc, a = doc.active;
    if (a && a.kind === 'balloon') return a;
    if (!create) return null;
    const l = new Layer('balloon', 'フキダシ');
    doc.structEdit('フキダシのレイヤー', () => { LayerOps.placeNew(doc, l); doc.activeId = l.id; });
    return l;
  }
  down(p) {
    const sub = this.o.sub, L = this.layer(false);
    if (sub === 'tail' || sub === 'edit') {
      const b = L && hitBalloon(L, p.x, p.y);
      if (!b) { this.selId = null; toast('フキダシの中から始めてください'); this.app.view.request(); return; }
      this.selId = b.id;
      this.st = { b, x0: p.x, y0: p.y, x1: p.x, y1: p.y, before: L.balloons };
      return;
    }
    this.st = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  }
  move(p) {
    const st = this.st;
    if (!st) return;
    st.x1 = p.x; st.y1 = p.y;
    if (this.o.sub === 'edit' && st.b) {
      const L = this.layer(false), dx = p.x - st.x0, dy = p.y - st.y0, b0 = st.b;
      const nb = { ...b0, x: b0.x + dx, y: b0.y + dy, tails: b0.tails.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy })) };
      L.balloons = st.before.map((b) => (b.id === b0.id ? nb : b));
      renderBalloons(this.app.doc, L);
    }
  }
  up() {
    const st = this.st, app = this.app, doc = app.doc, o = this.o;
    this.st = null;
    if (!st) return;
    if (o.sub === 'edit') {
      const L = this.layer(false);
      if (L && L.balloons !== st.before) doc.history.push(new SwapCmd('フキダシの移動', L, 'balloons', st.before, L.balloons, rerenderBalloonsCmd));
      app.view.request();
      return;
    }
    if (o.sub === 'tail') {
      const L = this.layer(false), b0 = st.b;
      if (Math.hypot(st.x1 - st.x0, st.y1 - st.y0) < 8) return;
      const nb = { ...b0, tails: [...b0.tails, { x: st.x1, y: st.y1, w: Math.max(8, Math.min(b0.w, b0.h) * 0.22) }] };
      const before = L.balloons;
      L.balloons = before.map((b) => (b.id === b0.id ? nb : b));
      renderBalloons(doc, L);
      doc.history.push(new SwapCmd('しっぽ', L, 'balloons', before, L.balloons, rerenderBalloonsCmd));
      doc.changed();
      return;
    }
    const w = Math.abs(st.x1 - st.x0), h = Math.abs(st.y1 - st.y0);
    if (w < 8 || h < 8) { app.view.request(); return; }
    doc.history.begin();
    const L = this.layer(true);
    const b = { id: _balloonSeq++, shape: o.sub, x: Math.min(st.x0, st.x1), y: Math.min(st.y0, st.y1), w, h, line: o.line, lineColor: app.color.main, fill: o.fillWhite ? '#ffffff' : null, tails: [] };
    const before = L.balloons;
    L.balloons = [...before, b];
    renderBalloons(doc, L);
    doc.history.push(new SwapCmd('フキダシ', L, 'balloons', before, L.balloons, rerenderBalloonsCmd));
    doc.history.end('フキダシ');
    this.selId = b.id;
    doc.changed();
  }
  removeSelected() {
    const L = this.layer(false), doc = this.app.doc;
    if (!L || this.selId == null) { toast('消すフキダシを「選んで動かす」で選んでください'); return; }
    const before = L.balloons;
    L.balloons = before.filter((b) => b.id !== this.selId);
    if (L.balloons.length === before.length) return;
    renderBalloons(doc, L);
    doc.history.push(new SwapCmd('フキダシを消す', L, 'balloons', before, L.balloons, rerenderBalloonsCmd));
    this.selId = null;
    doc.changed();
  }
  cancel() { this.st = null; }
  drawOverlay(g, view) {
    const st = this.st, o = this.o;
    g.save();
    const L = this.layer(false);
    const sel = L && L.balloons.find((b) => b.id === this.selId);
    if (sel) { const bb = balloonBBox(sel), a = view.toScreen(bb.x, bb.y), c = view.toScreen(bb.x + bb.w, bb.y + bb.h); g.strokeStyle = '#2b8cff'; g.setLineDash([5, 4]); g.lineWidth = 1; g.strokeRect(Math.min(a.x, c.x), Math.min(a.y, c.y), Math.abs(c.x - a.x), Math.abs(c.y - a.y)); g.setLineDash([]); }
    if (st && o.sub !== 'edit') {
      const a = view.toScreen(st.x0, st.y0), b = view.toScreen(st.x1, st.y1);
      g.strokeStyle = '#e4007f'; g.lineWidth = 1.5; g.setLineDash([6, 4]); g.beginPath();
      if (o.sub === 'tail') { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); } else g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }
}

/* ================= 2値 PNG（1ビット・600dpi 入稿用） ================= */
async function encodePNG1bit(doc) {
  const W = doc.width, H = doc.height, rowBytes = Math.ceil(W / 8);
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const outP = new Response(cs.readable).arrayBuffer();
  const t = newCanvas(TILE, TILE), tg = ctx2d(t);
  for (let ty = 0; ty < doc.rows; ty++) {
    const bandH = Math.min(TILE, H - ty * TILE);
    const band = new Uint8Array(bandH * (1 + rowBytes));
    band.fill(0);
    for (let tx = 0; tx < doc.cols; tx++) {
      tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalAlpha = 1; tg.globalCompositeOperation = 'source-over';
      tg.fillStyle = '#fff'; tg.fillRect(0, 0, TILE, TILE);
      composeTile(doc, tg, tx, ty, { exportMode: true, preview: false });
      const px = readTilePixels(t).data, ew = Math.min(TILE, W - tx * TILE);
      for (let j = 0; j < bandH; j++) {
        const ro = j * (1 + rowBytes) + 1;
        for (let i = 0; i < ew; i++) {
          const p = (j * TILE + i) * 4, a = px[p + 3] / 255;
          const v = (px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114) * a + 255 * (1 - a);
          if (v >= 128) { const X = tx * TILE + i; band[ro + (X >> 3)] |= 0x80 >> (X & 7); }    // 1 = 白
        }
      }
    }
    await writer.write(band);
  }
  await writer.close();
  const idat = new Uint8Array(await outP);
  const head = pngHeader(W, H, doc.dpi);
  // IHDR を 1ビット・グレーに書き換え
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer);
  hv.setUint32(0, W); hv.setUint32(4, H); ihdr[8] = 1; ihdr[9] = 0;
  head[1] = pngChunk('IHDR', ihdr);
  return new Blob([...head, pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}
