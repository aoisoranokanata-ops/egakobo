'use strict';
/* 選択範囲 = タイルの Map（白・アルファ＝選ばれている度合い。タイル無し＝選ばれていない）。
   作ったら中身を変えない（履歴が参照を持つ）。変える操作は新しい Selection を返す。 */

class Selection {
  constructor(doc, tiles) {
    this.doc = doc;
    this.tiles = tiles;
    this._bounds = undefined;
    this._outline = null;
  }
  get empty() { return this.tiles.size === 0; }

  /* 範囲（画素単位）。タイルの中身まで見て詰める */
  get bounds() {
    if (this._bounds !== undefined) return this._bounds;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [k, c] of this.tiles) {
      const [tx, ty] = parseKey(k);
      const d = readTilePixels(c).data;
      for (let y = 0; y < TILE; y++) {
        let rowAny = false;
        for (let x = 0; x < TILE; x++) {
          if (d[(y * TILE + x) * 4 + 3] > 2) {
            rowAny = true;
            const X = tx * TILE + x;
            if (X < x0) x0 = X; if (X > x1) x1 = X;
          }
        }
        if (rowAny) { const Y = ty * TILE + y; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
      }
    }
    this._bounds = x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    return this._bounds;
  }

  /* 形から作る: draw(g) が文書座標で塗る（白） */
  static fromDraw(doc, rect, draw) {
    const tiles = new Map();
    for (const [tx, ty, k] of doc.gridKeys(rect)) {
      const c = TilePool.get(), g = ctx2d(c);
      g.setTransform(1, 0, 0, 1, -tx * TILE, -ty * TILE);
      g.fillStyle = '#fff'; g.strokeStyle = '#fff';
      draw(g);
      if (tileHasAlpha(c)) tiles.set(k, c); else TilePool.put(c);
    }
    return new Selection(doc, tiles);
  }
  static rect(doc, r) { return Selection.fromDraw(doc, r, (g) => g.fillRect(r.x, r.y, r.w, r.h)); }
  static ellipse(doc, r) {
    return Selection.fromDraw(doc, r, (g) => { g.beginPath(); g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); g.fill(); });
  }
  static polygon(doc, pts) {
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const r = { x: Math.min(...xs) - 1, y: Math.min(...ys) - 1, w: Math.max(...xs) - Math.min(...xs) + 2, h: Math.max(...ys) - Math.min(...ys) + 2 };
    return Selection.fromDraw(doc, r, (g) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill(); });
  }
  static all(doc) { return Selection.rect(doc, doc.fullRect); }
  /* 0/1 の配列（文書大）から */
  static fromMask(doc, mask) {
    const W = doc.width, tiles = new Map();
    const tmp = newCanvas(TILE, TILE), tg = tmp.getContext('2d');
    for (const [tx, ty, k] of doc.gridKeys()) {
      const bx = tx * TILE, by = ty * TILE, ew = Math.min(TILE, W - bx), eh = Math.min(TILE, doc.height - by);
      let img = null;
      for (let j = 0; j < eh; j++) {
        let o = (by + j) * W + bx;
        for (let i = 0; i < ew; i++, o++) {
          if (!mask[o]) continue;
          if (!img) img = tg.createImageData(TILE, TILE);
          const p = (j * TILE + i) * 4;
          img.data[p] = img.data[p + 1] = img.data[p + 2] = 255; img.data[p + 3] = mask[o] === 1 ? 255 : mask[o];
        }
      }
      if (img) { tg.putImageData(img, 0, 0); const c = TilePool.get(); ctx2d(c).drawImage(tmp, 0, 0); tiles.set(k, c); }
    }
    return new Selection(doc, tiles);
  }
  /* 他のタイル群（白・アルファ）から（不透明部分を選択 など） */
  static fromTiles(doc, map) {
    const tiles = new Map();
    for (const [k, t] of map) {
      const [tx, ty] = parseKey(k);
      if (!doc.inGrid(tx, ty)) continue;
      const c = TilePool.get(), g = ctx2d(c);
      g.drawImage(t, 0, 0);
      g.globalCompositeOperation = 'source-in'; g.fillStyle = '#fff'; g.fillRect(0, 0, TILE, TILE);
      tiles.set(k, c);
    }
    return new Selection(doc, tiles);
  }

  /* 合成: mode = 'new' | 'add' | 'sub' | 'and' */
  combine(other, mode) {
    if (mode === 'new' || !this.tiles) return other;
    const tiles = new Map();
    const keys = new Set([...this.tiles.keys(), ...other.tiles.keys()]);
    for (const k of keys) {
      const a = this.tiles.get(k), b = other.tiles.get(k);
      if (mode === 'add') { if (!a && !b) continue; const c = copyTile(a); if (b) ctx2d(c).drawImage(b, 0, 0); tiles.set(k, c); }
      else if (mode === 'sub') {
        if (!a) continue;
        const c = copyTile(a);
        if (b) { const g = ctx2d(c); g.globalCompositeOperation = 'destination-out'; g.drawImage(b, 0, 0); g.globalCompositeOperation = 'source-over'; }
        if (tileHasAlpha(c)) tiles.set(k, c); else TilePool.put(c);
      } else if (mode === 'and') {
        if (!a || !b) continue;
        const c = copyTile(a), g = ctx2d(c);
        g.globalCompositeOperation = 'destination-in'; g.drawImage(b, 0, 0); g.globalCompositeOperation = 'source-over';
        if (tileHasAlpha(c)) tiles.set(k, c); else TilePool.put(c);
      }
    }
    return new Selection(this.doc, tiles);
  }
  invert() {
    const doc = this.doc, tiles = new Map();
    for (const [tx, ty, k] of doc.gridKeys()) {
      const a = this.tiles.get(k);
      const c = TilePool.get(), g = ctx2d(c);
      g.fillStyle = '#fff'; g.fillRect(0, 0, Math.min(TILE, doc.width - tx * TILE), Math.min(TILE, doc.height - ty * TILE));
      if (a) { g.globalCompositeOperation = 'destination-out'; g.drawImage(a, 0, 0); g.globalCompositeOperation = 'source-over'; }
      if (!a || tileHasAlpha(c)) tiles.set(k, c); else TilePool.put(c);
    }
    return new Selection(doc, tiles);
  }
  /* 拡張（px>0）・縮小（px<0）・境界をぼかす（feather） */
  grow(px) {
    const doc = this.doc, m = this.toMask(), W = doc.width, H = doc.height;
    if (px > 0) { const d = distanceTo(m, W, H, 1); for (let i = 0; i < m.length; i++) if (!m[i] && d[i] <= px * 3) m[i] = 1; }
    else { const d = distanceTo(m, W, H, 0); for (let i = 0; i < m.length; i++) if (m[i] && d[i] <= -px * 3) m[i] = 0; }
    return Selection.fromMask(doc, m);
  }
  feather(px) {
    const doc = this.doc, tiles = new Map();
    // タイルごとにぼかすと継ぎ目が出るので、帯ごとにまとめてぼかす
    const out = processRegion(doc, this.tiles, doc.fullRect, Math.ceil(px * 3), (img, w, h) => { boxBlurAlpha(img, w, h, px); });
    for (const [k, c] of out) if (c) tiles.set(k, c);
    return new Selection(doc, tiles);
  }
  /* 0/1 の配列（閾値 50%） */
  toMask() {
    const doc = this.doc, W = doc.width, m = new Uint8Array(W * doc.height);
    for (const [k, c] of this.tiles) {
      const [tx, ty] = parseKey(k);
      const d = readTilePixels(c).data, bx = tx * TILE, by = ty * TILE;
      const ew = Math.min(TILE, W - bx), eh = Math.min(TILE, doc.height - by);
      for (let j = 0; j < eh; j++) for (let i = 0; i < ew; i++) if (d[(j * TILE + i) * 4 + 3] >= 128) m[(by + j) * W + bx + i] = 1;
    }
    return m;
  }

  /* 点線用の輪郭（縮小した格子で境目を線分にする）。[x0,y0,x1,y1,...] 文書座標 */
  outline() {
    if (this._outline) return this._outline;
    const doc = this.doc;
    const f = Math.max(1, Math.ceil(Math.max(doc.width, doc.height) / 1400));
    const W = Math.ceil(doc.width / f), H = Math.ceil(doc.height / f);
    const c = newCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    for (const [k, t] of this.tiles) { const [tx, ty] = parseKey(k); g.drawImage(t, (tx * TILE) / f, (ty * TILE) / f, TILE / f, TILE / f); }
    const d = g.getImageData(0, 0, W, H).data;
    const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] >= 128;
    const segs = [];
    // 横の境目（行の間）: 続く所はつなげる
    for (let y = 0; y <= H; y++) {
      let start = -1;
      for (let x = 0; x <= W; x++) {
        const edge = x < W && on(x, y - 1) !== on(x, y);
        if (edge && start < 0) start = x;
        if (!edge && start >= 0) { segs.push(start * f, y * f, x * f, y * f); start = -1; }
      }
    }
    for (let x = 0; x <= W; x++) {
      let start = -1;
      for (let y = 0; y <= H; y++) {
        const edge = y < H && on(x - 1, y) !== on(x, y);
        if (edge && start < 0) start = y;
        if (!edge && start >= 0) { segs.push(x * f, start * f, x * f, y * f); start = -1; }
      }
    }
    this._outline = new Float32Array(segs);
    return this._outline;
  }
  dispose() { for (const c of this.tiles.values()) TilePool.put(c); }
}

function tileHasAlpha(c) {
  const d = readTilePixels(c).data;
  for (let i = 3; i < d.length; i += 16) if (d[i]) return true;
  for (let i = 7; i < d.length; i += 16) if (d[i]) return true;
  for (let i = 11; i < d.length; i += 16) if (d[i]) return true;
  for (let i = 15; i < d.length; i += 16) if (d[i]) return true;
  return false;
}

/* 範囲の画素を帯（タイル1段＋上下左右の余白 pad）ごとに読み、fn(imageData, w, h, 原点) で処理してタイルに戻す。
   map のタイルを読み、新しいタイルの Map を返す（範囲の外は含めない。空になったタイルは null） */
function processRegion(doc, map, rect, pad, fn) {
  const out = new Map();
  const { tx0, ty0, tx1, ty1 } = tilesOfRect(rect);
  const cx0 = Math.max(0, tx0), cx1 = Math.min(doc.cols - 1, tx1);
  const ry0c = Math.max(0, ty0), ry1c = Math.min(doc.rows - 1, ty1);
  const padT = Math.ceil(pad / TILE);
  const cols = cx1 - cx0 + 1 + 2 * padT;
  // 1回に処理するタイルの段数（余白の読み直しを減らす。canvas は 800 万画素まで）
  const per = Math.max(1, Math.min(8, Math.floor(8e6 / (cols * TILE * TILE)) - 2 * padT));
  for (let ty = ry0c; ty <= ry1c; ty += per) {
    const n = Math.min(per, ry1c - ty + 1);
    const ry0 = ty - padT, ry1 = ty + n - 1 + padT;
    const H = (ry1 - ry0 + 1) * TILE;
    const c = newCanvas(cols * TILE, H), g = c.getContext('2d', { willReadFrequently: true });
    let any = false;
    for (let y = ry0; y <= ry1; y++) for (let x = cx0 - padT; x <= cx1 + padT; x++) {
      const t = map.get(tkey(x, y));
      if (t) { g.drawImage(t, (x - cx0 + padT) * TILE, (y - ry0) * TILE); any = true; }
    }
    if (!any) continue;
    const img = g.getImageData(0, 0, c.width, c.height);
    fn(img, c.width, c.height, { x: (cx0 - padT) * TILE, y: ry0 * TILE });
    g.putImageData(img, 0, 0);
    // 中身のあるタイルだけ返す（全部透明なら作らない）
    const cw = c.width, dd = img.data;
    for (let j = 0; j < n; j++) for (let x = cx0; x <= cx1; x++) {
      const ox = (x - cx0 + padT) * TILE, oy = (padT + j) * TILE;
      let any2 = false;
      for (let y = 0; y < TILE && !any2; y++) { const row = ((oy + y) * cw + ox) * 4 + 3; for (let i = 0; i < TILE * 4; i += 4) if (dd[row + i]) { any2 = true; break; } }
      const k = tkey(x, ty + j);
      if (!any2) { if (map.has(k)) out.set(k, null); continue; }
      const t = TilePool.get(), tg = ctx2d(t);
      tg.drawImage(c, ox, oy, TILE, TILE, 0, 0, TILE, TILE);
      out.set(k, t);
    }
  }
  return out;
}

/* アルファだけの箱ぼかし（3回でガウスに近い） */
function boxBlurAlpha(img, w, h, r) {
  const a = new Float32Array(w * h), d = img.data;
  for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3];
  const tmp = new Float32Array(w * h);
  const rr = Math.max(1, Math.round(r / 1.7));
  for (let pass = 0; pass < 3; pass++) { boxH(a, tmp, w, h, rr); boxH2V(tmp, a, w, h, rr); }
  for (let i = 0; i < w * h; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = a[i]; }
}
function boxH(src, dst, w, h, r) {
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[o + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[o + x] = s / n;
      s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
}
function boxH2V(src, dst, w, h, r) {
  const n = 2 * r + 1;
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += src[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = s / n;
      s += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
    }
  }
}
