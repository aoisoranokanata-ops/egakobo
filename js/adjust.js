'use strict';
/* 色調補正とフィルター。
   色調補正 = 1画素ずつの式（fn(data) が RGBA を書き換える）。レイヤーに直接かける・色調補正レイヤーの両方で同じ式。
   フィルター = 周りの画素も見る処理（帯ごとに余白付きで読んで処理: processRegion）。 */

const ADJUSTMENTS = [
  { key: 'bc', label: '明るさ・コントラスト', params: [['brightness', '明るさ', -100, 100, 0], ['contrast', 'コントラスト', -100, 100, 0]],
    lut: (p) => { const c = p.contrast * 2.55, f = (259 * (c + 255)) / (255 * (259 - c)); return (v) => f * (v - 128) + 128 + p.brightness * 1.28; } },
  { key: 'hsv', label: '色相・彩度・明度', params: [['hue', '色相', -180, 180, 0], ['sat', '彩度', -100, 100, 0], ['val', '明度', -100, 100, 0]], make: makeHsv },
  { key: 'levels', label: 'レベル補正', params: [['inLow', '入力 黒', 0, 254, 0], ['gamma', '中間（×100）', 10, 500, 100], ['inHigh', '入力 白', 1, 255, 255], ['outLow', '出力 黒', 0, 255, 0], ['outHigh', '出力 白', 0, 255, 255]],
    lut: (p) => (v) => { const t = clamp((v - p.inLow) / Math.max(1, p.inHigh - p.inLow), 0, 1); return p.outLow + Math.pow(t, 100 / p.gamma) * (p.outHigh - p.outLow); } },
  { key: 'curves', label: 'トーンカーブ', params: [], curve: true, defaults: { points: [[0, 0], [255, 255]] }, lut: (p) => curveFn(p.points) },
  { key: 'balance', label: 'カラーバランス', params: [['r', 'シアン ↔ レッド', -100, 100, 0], ['g', 'マゼンタ ↔ グリーン', -100, 100, 0], ['b', 'イエロー ↔ ブルー', -100, 100, 0]], make: makeBalance },
  { key: 'invert', label: '階調の反転', params: [], lut: () => (v) => 255 - v },
  { key: 'posterize', label: 'ポスタリゼーション', params: [['levels', '階調数', 2, 32, 4]], lut: (p) => { const n = p.levels - 1; return (v) => Math.round((v / 255) * n) * (255 / n); } },
  { key: 'threshold', label: '2階調化', params: [['level', 'しきい値', 1, 255, 128]], make: (p) => (d) => { for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = y >= p.level ? 255 : 0; } } },
  { key: 'gmap', label: 'グラデーションマップ', params: [], colors: true, defaults: { c0: '#1a1a3a', c1: '#ffe9c2' }, make: makeGradMap },
];
const FILTERS = [
  { key: 'blur', label: 'ぼかし（ガウス）', params: [['radius', '半径 px', 0.5, 100, 4, 0.5]], pad: (p) => Math.ceil(p.radius * 3) + 2, run: (img, w, h, o, p) => blurRGBA(img.data, w, h, p.radius) },
  { key: 'sharpen', label: 'シャープ', params: [['amount', '強さ %', 10, 300, 80], ['radius', '半径 px', 0.5, 10, 1.5, 0.5]], pad: (p) => Math.ceil(p.radius * 3) + 2, run: (img, w, h, o, p) => sharpenRGBA(img.data, w, h, p.radius, p.amount / 100) },
  { key: 'mosaic', label: 'モザイク', params: [['size', '大きさ px', 2, 200, 16]], pad: (p) => p.size + 2, run: (img, w, h, o, p) => mosaicRGBA(img.data, w, h, o, Math.round(p.size)) },
  { key: 'noise', label: 'ノイズ', params: [['amount', '量', 1, 100, 20], ['mono', '色（0=モノクロ 1=カラー）', 0, 1, 0]], pad: () => 0, run: (img, w, h, o, p) => noiseRGBA(img.data, w, h, o, p.amount, p.mono >= 0.5) },
  { key: 'lumalpha', label: '輝度を透明度に変換（線画の抽出）', params: [], pad: () => 0, run: (img) => lumaToAlpha(img.data) },
];
const adjustDef = (key) => ADJUSTMENTS.find((a) => a.key === key) || FILTERS.find((a) => a.key === key);
function adjustDefaults(def) {
  const p = { ...(def.defaults || {}) };
  for (const [k, , , , d] of def.params) p[k] = d;
  return p;
}

/* 色調補正の設定 {type, params} → fn(data)。設定オブジェクトごとに覚えておく（差し替えて使うので） */
const _adjCache = new WeakMap();
function adjustFn(adj) {
  if (_adjCache.has(adj)) return _adjCache.get(adj);
  const def = ADJUSTMENTS.find((a) => a.key === adj.type);
  let fn = null;
  if (def) {
    if (def.lut) {
      const f = def.lut(adj.params), lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) lut[v] = Math.round(f(v));
      fn = (d) => { for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; } };
    } else fn = def.make(adj.params);
  }
  _adjCache.set(adj, fn);
  return fn;
}

function makeHsv(p) {
  const dh = p.hue / 60, ds = p.sat / 100, dv = p.val / 100;
  return (d) => {
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = r > g ? (r > b ? r : b) : g > b ? g : b, mn = r < g ? (r < b ? r : b) : g < b ? g : b, c = mx - mn;
      let h = 0;
      if (c) { if (mx === r) h = (g - b) / c; else if (mx === g) h = (b - r) / c + 2; else h = (r - g) / c + 4; }
      h += dh; h %= 6; if (h < 0) h += 6;
      let s = mx ? c / mx : 0, v = mx / 255;
      s = ds >= 0 ? s + (1 - s) * ds * s : s * (1 + ds);
      v = dv >= 0 ? v + (1 - v) * dv : v * (1 + dv);
      if (s < 0) s = 0; else if (s > 1) s = 1;
      if (v < 0) v = 0; else if (v > 1) v = 1;
      const C = v * s * 255, m = v * 255 - C, X = C * (1 - Math.abs((h % 2) - 1)) + m, Cm = C + m;
      switch (h | 0) {
        case 0: d[i] = Cm; d[i + 1] = X; d[i + 2] = m; break;
        case 1: d[i] = X; d[i + 1] = Cm; d[i + 2] = m; break;
        case 2: d[i] = m; d[i + 1] = Cm; d[i + 2] = X; break;
        case 3: d[i] = m; d[i + 1] = X; d[i + 2] = Cm; break;
        case 4: d[i] = X; d[i + 1] = m; d[i + 2] = Cm; break;
        default: d[i] = Cm; d[i + 1] = m; d[i + 2] = X;
      }
    }
  };
}
function makeBalance(p) {
  const mk = (sh) => { const lut = new Uint8ClampedArray(256); for (let v = 0; v < 256; v++) { const t = (v - 128) / 128; lut[v] = v + sh * 0.9 * (1 - t * t); } return lut; };
  const R = mk(p.r), G = mk(p.g), B = mk(p.b);
  return (d) => { for (let i = 0; i < d.length; i += 4) { d[i] = R[d[i]]; d[i + 1] = G[d[i + 1]]; d[i + 2] = B[d[i + 2]]; } };
}
function makeGradMap(p) {
  const a = hexToRgb(p.c0), b = hexToRgb(p.c1);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let v = 0; v < 256; v++) { const t = v / 255; lut[v * 3] = lerp(a.r, b.r, t); lut[v * 3 + 1] = lerp(a.g, b.g, t); lut[v * 3 + 2] = lerp(a.b, b.b, t); }
  return (d) => {
    for (let i = 0; i < d.length; i += 4) {
      const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * 3;
      d[i] = lut[y]; d[i + 1] = lut[y + 1]; d[i + 2] = lut[y + 2];
    }
  };
}
/* トーンカーブ: 点を通る単調な3次曲線（行き過ぎない） */
function curveFn(points) {
  const P = [...points].sort((a, b) => a[0] - b[0]);
  const n = P.length;
  if (n < 2) return (v) => v;
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx.push(xs[i + 1] - xs[i] || 1); m.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1)); }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
  t.push(m[n - 2]);
  return (v) => {
    if (v <= xs[0]) return ys[0];
    if (v >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (v > xs[i + 1]) i++;
    const h = dx[i], s = (v - xs[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * t[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * t[i + 1];
  };
}

/* ---- フィルターの中身 */
function toPremulF(d, n) {
  const f = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i += 4) { const a = d[i + 3] / 255; f[i] = d[i] * a; f[i + 1] = d[i + 1] * a; f[i + 2] = d[i + 2] * a; f[i + 3] = d[i + 3]; }
  return f;
}
function fromPremulF(f, d) {
  for (let i = 0; i < d.length; i += 4) {
    const a = f[i + 3];
    d[i + 3] = a;
    if (a > 0.5) { const k = 255 / a; d[i] = f[i] * k; d[i + 1] = f[i + 1] * k; d[i + 2] = f[i + 2] * k; }
  }
}
function blurF(f, w, h, radius) {
  const r = Math.max(1, Math.round(radius / 1.73));
  const ch = new Float32Array(w * h), tmp = new Float32Array(w * h);
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < w * h; i++) ch[i] = f[i * 4 + c];
    for (let pass = 0; pass < 3; pass++) { boxH(ch, tmp, w, h, r); boxH2V(tmp, ch, w, h, r); }
    for (let i = 0; i < w * h; i++) f[i * 4 + c] = ch[i];
  }
}
function blurRGBA(d, w, h, radius) { const f = toPremulF(d, w * h); blurF(f, w, h, radius); fromPremulF(f, d); }
function sharpenRGBA(d, w, h, radius, amount) {
  const f = toPremulF(d, w * h), b = new Float32Array(f);
  blurF(b, w, h, radius);
  for (let i = 0; i < f.length; i += 4) for (let c = 0; c < 3; c++) f[i + c] = clamp(f[i + c] + (f[i + c] - b[i + c]) * amount, 0, f[i + 3]);
  fromPremulF(f, d);
}
function mosaicRGBA(d, w, h, o, size) {
  // 文書の原点にそろえた格子で平均（帯の境目でずれない）
  const sx = ((o.x % size) + size) % size, sy = ((o.y % size) + size) % size;
  for (let by = -sy; by < h; by += size) for (let bx = -sx; bx < w; bx += size) {
    const x0 = Math.max(0, bx), y0 = Math.max(0, by), x1 = Math.min(w, bx + size), y1 = Math.min(h, by + size);
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4, al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; n++; }
    if (!n) continue;
    const R = a ? r / a : 0, G = a ? g / a : 0, B = a ? b / a : 0, A = a / n;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = A; }
  }
}
function hash2(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function noiseRGBA(d, w, h, o, amount, color) {
  const k = amount * 2.55;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (!d[i + 3]) continue;
    const X = o.x + x, Y = o.y + y;
    if (color) for (let c = 0; c < 3; c++) d[i + c] += (hash2(X, Y, c + 1) - 0.5) * k;
    else { const n = (hash2(X, Y, 7) - 0.5) * k; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  }
}
/* 白を透明に（色は残す）: スキャンした線画を色を塗れる線画にする */
function lumaToAlpha(d) {
  for (let i = 0; i < d.length; i += 4) {
    const a0 = d[i + 3] / 255;
    if (!a0) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const a = 1 - Math.min(r, g, b) / 255;
    if (a <= 0.003) { d[i + 3] = 0; continue; }
    d[i] = (r - 255 * (1 - a)) / a; d[i + 1] = (g - 255 * (1 - a)) / a; d[i + 2] = (b - 255 * (1 - a)) / a;
    d[i + 3] = a * a0 * 255;
  }
}

/* ---- 結果のタイルを作る（レイヤーに直接かける時の試し表示と確定で共通） */
function computeAdjusted(doc, layer, def, params) {
  const sel = doc.sel;
  const out = new Map();
  if (def.run) {
    // フィルター: 選択範囲（なければ描いてある範囲）＋余白
    const pad = def.pad(params);
    let r = sel ? sel.bounds : layer.tileBounds();
    if (!r) return out;
    r = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
    const res = processRegion(doc, layer.tiles, r, pad, (img, w, h, o) => def.run(img, w, h, o, params));
    for (const [k, t] of res) out.set(k, mixBySel(layer.tiles.get(k), t, sel, k));
  } else {
    const fn = adjustFn({ type: def.key, params });
    for (const [k, t] of layer.tiles) {
      if (sel && !sel.tiles.has(k)) continue;
      const img = readTilePixels(t);
      fn(img.data, TILE, TILE);
      _readC.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
      const c = TilePool.get(); ctx2d(c).drawImage(_readC, 0, 0);
      out.set(k, mixBySel(t, c, sel, k));
    }
  }
  return out;
}
/* 選択範囲の分だけ結果を使う: 元×(1−選択) ＋ 結果×選択（乗算済みの足し算なので正確） */
function mixBySel(orig, res, sel, k) {
  if (!sel) return res;
  if (!res) res = TilePool.get();          // フィルターで空になった所
  const st = sel.tiles.get(k);
  if (!st) { TilePool.put(res); return orig ? copyTile(orig) : null; }
  const rg = ctx2d(res);
  rg.globalCompositeOperation = 'destination-in'; rg.drawImage(st, 0, 0); rg.globalCompositeOperation = 'source-over';
  const c = copyTile(orig), g = ctx2d(c);
  g.globalCompositeOperation = 'destination-out'; g.drawImage(st, 0, 0);
  g.globalCompositeOperation = 'lighter'; g.drawImage(res, 0, 0);
  g.globalCompositeOperation = 'source-over';
  TilePool.put(res);
  return c;
}

/* ---- 画面: 絵の上に浮かぶパネル（色調補正・フィルター・色調補正レイヤーの編集） */
class AdjustPanel {
  constructor(app) { this.app = app; this.open = false; }
  /* mode: 'pixels'（レイヤーに直接） | 'layer'（色調補正レイヤー: layer を渡す） */
  show(def, { mode = 'pixels', layer = null } = {}) {
    const app = this.app, doc = app.doc;
    if (this.open) this.close(false);
    const target = layer || doc.active;
    if (mode === 'pixels') {
      if (!target || !target.isRaster) { toast('ラスターレイヤーを選んでください（テキスト・ベクターはラスタライズしてから）'); return; }
      if (doc.effectiveLocked(target)) { toast('レイヤーがロックされています'); return; }
    }
    this.open = true; this.def = def; this.mode = mode; this.layer = target;
    this.params = mode === 'layer' && target.adj ? { ...target.adj.params } : adjustDefaults(def);
    this.before = mode === 'layer' ? doc.snapshot() : null;
    const box = el('div', { class: 'float-panel' });
    box.append(el('div', { class: 'fp-title' }, def.label + (mode === 'layer' ? '（色調補正レイヤー）' : '')));
    const body = el('div', { class: 'fp-body' });
    for (const [k, label, min, max, , step] of def.params) body.append(app.panels.slider(label, this.params[k], { min, max, step: step || 1 }, (v) => { this.params[k] = v; this.update(); }));
    if (def.curve) body.append(this.curveEditor());
    if (def.colors) body.append(this.colorPickers());
    if (!def.params.length && !def.curve && !def.colors) body.append(el('p', { class: 'hint' }, '設定はありません。OK で適用します。'));
    if (mode === 'pixels' && doc.sel) body.append(el('p', { class: 'hint' }, '選択範囲の中だけにかかります。'));
    box.append(body);
    box.append(el('div', { class: 'fp-foot' },
      el('button', { class: 'btn', onclick: () => this.close(false) }, 'キャンセル'),
      el('button', { class: 'btn primary', onclick: () => this.close(true) }, 'OK')));
    $('#viewport').append(box);
    this.box = box;
    this.update(true);
  }
  update(now = false) {
    clearTimeout(this._t);
    const run = () => {
      const app = this.app, doc = app.doc;
      if (!this.open) return;
      if (this.mode === 'layer') {
        doc.setPropsQuiet(this.layer, { adj: { type: this.def.key, params: { ...this.params } } });
      } else {
        const big = this.layer.tiles.size > 120 || this.def.run;
        if (big) app.busy('試し表示を作っています…');
        setTimeout(() => {
          try {
            this.disposePreview();
            doc.preview = { layer: this.layer, tiles: computeAdjusted(doc, this.layer, this.def, this.params) };
            doc.invalidateLayer(this.layer);
            for (const k of doc.preview.tiles.keys()) doc.invalidateKey(k);
          } finally { if (big) app.busy(null); }
          app.view.request();
        }, big ? 20 : 0);
      }
      app.view.request();
    };
    if (now) run(); else this._t = setTimeout(run, this.def.run ? 350 : 90);
  }
  disposePreview() {
    const doc = this.app.doc;
    if (doc.preview) { for (const [k, t] of doc.preview.tiles) { if (t) TilePool.put(t); doc.invalidateKey(k); } doc.preview = null; }
  }
  close(ok) {
    if (!this.open) return;
    clearTimeout(this._t);
    const app = this.app, doc = app.doc;
    this.open = false;
    if (this.box) this.box.remove();
    if (this.mode === 'layer') {
      if (ok) {
        doc.setPropsQuiet(this.layer, { adj: { type: this.def.key, params: { ...this.params } } });
        doc.history.push(new StructCmd('色調補正レイヤー', this.before, doc.snapshot()));
        doc.changed('struct');
      } else if (this.onCancel) this.onCancel();
      else { doc.restore(this.before); doc.changed('struct'); }
      this.onCancel = null;
      return;
    }
    if (ok) {
      // 試し表示が古い（値を変えた直後）なら作り直してから確定
      const res = computeAdjusted(doc, this.layer, this.def, this.params);
      this.disposePreview();
      doc.replaceTiles(this.def.label, this.layer, res, [...res.keys()]);
      app.afterEdit();
    } else this.disposePreview();
    app.view.request();
  }
  curveEditor() {
    const S = 220, c = el('canvas', { class: 'curve', width: S * 2, height: S * 2, style: `width:${S}px;height:${S}px` });
    const pts = () => this.params.points;
    const draw = () => {
      const g = c.getContext('2d');
      g.setTransform(2, 0, 0, 2, 0, 0);
      g.fillStyle = '#17181a'; g.fillRect(0, 0, S, S);
      g.strokeStyle = '#333'; g.lineWidth = 1;
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo((S * i) / 4, 0); g.lineTo((S * i) / 4, S); g.moveTo(0, (S * i) / 4); g.lineTo(S, (S * i) / 4); g.stroke(); }
      const f = curveFn(pts());
      g.strokeStyle = '#e8e8ea'; g.lineWidth = 2; g.beginPath();
      for (let x = 0; x <= 255; x++) { const y = clamp(f(x), 0, 255); const X = (x / 255) * S, Y = S - (y / 255) * S; if (x) g.lineTo(X, Y); else g.moveTo(X, Y); }
      g.stroke();
      g.fillStyle = '#4da3ff';
      for (const [x, y] of pts()) { g.beginPath(); g.arc((x / 255) * S, S - (y / 255) * S, 5, 0, Math.PI * 2); g.fill(); }
    };
    let drag = -1;
    const at = (e) => { const r = c.getBoundingClientRect(); return [clamp(((e.clientX - r.left) / r.width) * 255, 0, 255), clamp((1 - (e.clientY - r.top) / r.height) * 255, 0, 255)]; };
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault(); c.setPointerCapture(e.pointerId);
      const [x, y] = at(e), P = pts();
      drag = P.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 14);
      if (drag < 0) { P.push([x, y]); drag = P.length - 1; }
      this.params = { ...this.params, points: P.map((p) => [...p]) };
      draw(); this.update();
    });
    c.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      const [x, y] = at(e), P = this.params.points.map((p) => [...p]);
      const r = c.getBoundingClientRect();
      // 外へ引き出すと点を消す（両端の点は消さない）
      if (P.length > 2 && drag > 0 && (e.clientY < r.top - 20 || e.clientY > r.bottom + 20 || e.clientX < r.left - 20 || e.clientX > r.right + 20)) { P.splice(drag, 1); drag = -1; }
      else P[drag] = [x, y];
      this.params = { ...this.params, points: P };
      draw(); this.update();
    });
    c.addEventListener('pointerup', () => { drag = -1; });
    draw();
    return el('div', { class: 'curve-wrap' }, c, el('p', { class: 'hint' }, '線を押すと点が増えます。点を外へ引き出すと消えます。'));
  }
  colorPickers() {
    const mk = (k, label) => {
      const sw = el('span', { class: 'chip', style: `background:${this.params[k]}` });
      return el('button', { class: 'btn small gm', onclick: () => { this.params = { ...this.params, [k]: this.app.color.main }; sw.style.background = this.params[k]; this.update(); } }, sw, label);
    };
    return el('div', { class: 'gm-row' }, mk('c0', '暗い所 ← メインカラー'), mk('c1', '明るい所 ← メインカラー'));
  }
}
