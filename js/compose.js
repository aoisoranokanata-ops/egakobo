'use strict';
/* 合成。タイル1枚ずつ、レイヤーの木を下から重ねる。
   Comp = 合成結果のキャッシュ（レベル0＝原寸、レベルL＝1/2^L のミップ）。表示は拡大率に合うレベルを使う。 */

const COMP_L0_CAP = 520;           // レベル0 を持っておく上限（約 130MB）。超えたら最近使っていないものを捨てる

class Comp {
  constructor(doc) {
    this.doc = doc;
    this.maxLevel = Math.max(0, Math.ceil(Math.log2(Math.max(doc.width, doc.height) / TILE)));
    this.levels = Array.from({ length: this.maxLevel + 1 }, () => new Map());
    this.seq = 0;
    this.frame = 0;
  }
  cols(L) { return Math.ceil(this.doc.width / (TILE << L)); }
  rows(L) { return Math.ceil(this.doc.height / (TILE << L)); }
  invalidate(tx, ty) {
    for (let L = 0; L <= this.maxLevel; L++) {
      const e = this.levels[L].get(tkey(tx >> L, ty >> L));
      if (e) e.valid = false;
    }
  }
  invalidateAll() { for (const m of this.levels) for (const e of m.values()) e.valid = false; }
  get(L, tx, ty) {
    const m = this.levels[L], k = tkey(tx, ty);
    let e = m.get(k);
    if (!e) { e = { c: TilePool.get(), valid: false, ver: 0, used: 0 }; m.set(k, e); }
    e.used = this.frame;
    if (!e.valid) {
      const g = ctx2d(e.c);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, TILE, TILE);
      if (L === 0) composeTile(this.doc, g, tx, ty);
      else {
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
        const cc = this.cols(L - 1), cr = this.rows(L - 1), H = TILE / 2;
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
          const cx = tx * 2 + i, cy = ty * 2 + j;
          if (cx >= cc || cy >= cr) continue;
          g.drawImage(this.get(L - 1, cx, cy).c, i * H, j * H, H, H);
        }
      }
      e.valid = true;
      e.ver = ++this.seq;
    }
    return e;
  }
  /* 表示の1コマが終わったら呼ぶ: 古いレベル0 を捨てる */
  endFrame() {
    this.frame++;
    const m = this.levels[0];
    if (m.size <= COMP_L0_CAP) return;
    const arr = [...m.entries()].sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < arr.length - COMP_L0_CAP * 0.8; i++) {
      if (arr[i][1].used >= this.frame - 1) break;
      TilePool.put(arr[i][1].c);
      m.delete(arr[i][0]);
    }
  }
  dispose() { for (const m of this.levels) { for (const e of m.values()) TilePool.put(e.c); m.clear(); } }
}

/* ---- タイル1枚の合成 */
const _temps = [];          // 深さごとの作業タイル
function tempsAt(d) {
  if (!_temps[d]) _temps[d] = { F: newCanvas(TILE, TILE), A: newCanvas(TILE, TILE), B: newCanvas(TILE, TILE), C: newCanvas(TILE, TILE), G: newCanvas(TILE, TILE) };
  return _temps[d];
}
function clearTemp(c) {
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, TILE, TILE);
  return g;
}

/* opts: { exportMode: 下書きを除く, filter: (layer) => 含めるか, paper: 用紙を含めるか(既定 true), preview: 作業中の表示を含めるか } */
function composeTile(doc, g, tx, ty, opts = {}) {
  const o = { exportMode: false, filter: null, paper: true, preview: true, ...opts };
  renderList(doc, doc.root.children, g, tx, ty, 0, o);
  if (o.preview && doc.monoView && !o.exportMode) monoView(g);         // 画面のモノクロ2値表示
  // 文書の外にはみ出した画素は見せない
  const x0 = tx * TILE, y0 = ty * TILE;
  if (x0 + TILE > doc.width) g.clearRect(doc.width - x0, 0, TILE, TILE);
  if (y0 + TILE > doc.height) g.clearRect(0, doc.height - y0, TILE, TILE);
}

function included(l, o) {
  if (!l.visible) return false;
  if (o.exportMode && l.draft) return false;
  if (l.kind === 'paper') return o.paper;
  if (o.filter && l.kind !== 'folder' && !o.filter(l)) return false;
  return true;
}

function renderList(doc, list, target, tx, ty, d, o) {
  const T = tempsAt(d);
  const key = tkey(tx, ty);
  for (let i = 0; i < list.length;) {
    const L = list[i];
    let j = i + 1;
    while (j < list.length && list[j].clip && list[j].kind !== 'paper') j++;
    const clips = list.slice(i + 1, j);
    i = j;
    if (!included(L, o)) continue;
    if (L.kind === 'paper') {
      target.globalAlpha = 1; target.globalCompositeOperation = 'source-over';
      target.fillStyle = L.color;
      target.fillRect(0, 0, Math.min(TILE, doc.width - tx * TILE), Math.min(TILE, doc.height - ty * TILE));
      continue;
    }
    if (L.kind === 'adjust') {                 // 色調補正レイヤー: ここまでの結果を補正する
      applyAdjustLayer(target.canvas, L, key, o);
      continue;
    }
    let src = null;
    if (L.kind === 'folder') {
      const anyClip = clips.some((c) => included(c, o));
      const hasMask = L.mask && L.maskOn && (L.mask.size || (o.preview && doc.stroke && doc.stroke.layer === L));
      if (L.blend === 'passthrough' && L.opacity === 1 && !anyClip && !hasMask && !L.frame) { renderList(doc, L.children, target, tx, ty, d + 1, o); continue; }
      const fg = clearTemp(T.F);
      renderList(doc, L.children, fg, tx, ty, d + 1, o);
      if (L.frame) applyFrame(T.F, L.frame, tx, ty);          // コマ枠: 枠の外を隠して枠線を描く
      src = applyMask(doc, L, T.F, key, T.A, o);
    } else {
      src = layerSource(doc, L, tx, ty, T.A, o);
      if (!src) continue;
    }
    const vis = clips.filter((c) => included(c, o));
    if (vis.length) {
      const bg = clearTemp(T.B);
      bg.drawImage(src, 0, 0);
      for (const c of vis) {
        if (c.kind === 'adjust') { applyAdjustLayer(T.B, c, key, o); continue; }
        let cs;
        if (c.kind === 'folder') { const gg = clearTemp(T.G); renderList(doc, c.children, gg, tx, ty, d + 1, o); cs = applyMask(doc, c, T.G, key, T.A, o); }
        else cs = layerSource(doc, c, tx, ty, T.A, o);
        if (!cs) continue;
        if (c.blend === 'normal' || c.blend === 'passthrough') {
          bg.globalCompositeOperation = 'source-atop'; bg.globalAlpha = c.opacity;
          bg.drawImage(cs, 0, 0);
        } else {
          const cg = clearTemp(T.C);
          cg.drawImage(cs, 0, 0);
          cg.globalCompositeOperation = 'destination-in';
          cg.drawImage(T.B, 0, 0);
          bg.globalCompositeOperation = BLEND_OP[c.blend] || 'source-over'; bg.globalAlpha = c.opacity;
          bg.drawImage(T.C, 0, 0);
        }
        bg.globalCompositeOperation = 'source-over'; bg.globalAlpha = 1;
      }
      src = T.B;
    }
    target.globalCompositeOperation = BLEND_OP[L.blend] || 'source-over';
    target.globalAlpha = L.opacity;
    target.drawImage(src, 0, 0);
    target.globalCompositeOperation = 'source-over';
    target.globalAlpha = 1;
  }
}

/* レイヤーの画素（作業中のストローク・移動のずれ・変形中の切り抜き・試し表示・マスクを含めた見た目）。無ければ null */
function layerSource(doc, L, tx, ty, tmp, o) {
  const k = tkey(tx, ty);
  const s = o.preview ? doc.stroke : null;
  const off = o.preview ? L.offset : null;
  let base = null;
  if (off && (off.dx || off.dy)) {
    const g = clearTemp(tmp);
    const x0 = tx * TILE - off.dx, y0 = ty * TILE - off.dy;
    const sx0 = Math.floor(x0 / TILE), sy0 = Math.floor(y0 / TILE);
    let any = false;
    for (let sy = sy0; sy <= sy0 + 1; sy++) for (let sx = sx0; sx <= sx0 + 1; sx++) {
      const t = L.tiles.get(tkey(sx, sy));
      if (t) { g.drawImage(t, sx * TILE - x0, sy * TILE - y0); any = true; }
    }
    if (!any) return null;
    base = tmp;
  } else if (o.preview && doc.preview && doc.preview.layer === L && doc.preview.tiles.has(k)) base = doc.preview.tiles.get(k);
  else base = L.tiles.get(k) || null;
  // 変形中: 元の場所の画素を隠す
  if (o.preview && doc.cut && doc.cut.layer === L && base) {
    if (!doc.cut.sel) return null;
    const st = doc.cut.sel.tiles.get(k);
    if (st) {
      if (base !== tmp) { const g = clearTemp(tmp); g.drawImage(base, 0, 0); }
      const g = tmp.getContext('2d');
      g.globalCompositeOperation = 'destination-out'; g.drawImage(st, 0, 0); g.globalCompositeOperation = 'source-over';
      base = tmp;
    }
  }
  if (s && s.layer === L && s.target === 'tiles') {
    const st = s.tiles.get(k);
    if (st) {
      if (!base && (s.erase || s.alphaLock)) return null;
      if (base !== tmp) { const g = clearTemp(tmp); if (base) g.drawImage(base, 0, 0); }
      applyStrokeTile(tmp.getContext('2d'), st, s, k);
      base = tmp;
    }
  }
  if (!base) return null;
  if (L.tone) base = toneTile(base, tmp, L.tone, tx, ty, doc.dpi);        // トーン: 濃さを網点に
  else if (L.mono) base = monoTile(base, tmp);                            // 表現色モノクロ: 2値に
  return applyMask(doc, L, base, k, tmp, o);
}

/* マスク（隠す量）で削る。描いている途中のマスクのストロークも重ねて見せる */
let _maskTmp = null;
function applyMask(doc, L, src, k, tmp, o) {
  if (!L.mask || !L.maskOn) return src;
  let hide = L.mask.get(k) || null;
  const s = o.preview ? doc.stroke : null;
  if (s && s.layer === L && s.target === 'mask' && s.tiles.has(k)) {
    if (!_maskTmp) _maskTmp = newCanvas(TILE, TILE);
    const mg = clearTemp(_maskTmp);
    if (hide) mg.drawImage(hide, 0, 0);
    if (hide || s.erase) { applyStrokeTile(mg, s.tiles.get(k), { ...s, erase: !s.erase, alphaLock: false }, k); hide = _maskTmp; }
  }
  if (!hide) return src;
  if (src !== tmp) { const g = clearTemp(tmp); g.drawImage(src, 0, 0); }
  const g = tmp.getContext('2d');
  g.globalCompositeOperation = 'destination-out'; g.drawImage(hide, 0, 0); g.globalCompositeOperation = 'source-over';
  return tmp;
}

/* 色調補正レイヤー: target の画素を補正し、不透明度とマスクの分だけ元と混ぜる（CPU） */
function applyAdjustLayer(target, L, k, o) {
  if (!L.adj) return;
  const fn = adjustFn(L.adj);
  if (!fn) return;
  const img = readTilePixels(target), d = img.data;
  const orig = new Uint8ClampedArray(d);
  fn(d, TILE, TILE);
  let hide = L.mask && L.maskOn ? L.mask.get(k) : null;
  const hd = hide ? readTilePixelsB(hide).data : null;
  const op = L.opacity;
  for (let i = 0; i < d.length; i += 4) {
    const w = op * (hd ? 1 - hd[i + 3] / 255 : 1);
    if (w >= 0.999) continue;
    d[i] = orig[i] + (d[i] - orig[i]) * w;
    d[i + 1] = orig[i + 1] + (d[i + 1] - orig[i + 1]) * w;
    d[i + 2] = orig[i + 2] + (d[i + 2] - orig[i + 2]) * w;
    d[i + 3] = orig[i + 3];
  }
  _readC.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
  const g = target.getContext('2d');
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'copy';
  g.drawImage(_readC, 0, 0);
  g.restore();
}

/* 文書の一部を1枚の canvas に（書き出し・サムネイル用）。大きい文書は scale で縮める */
function renderRegion(doc, { x = 0, y = 0, w = doc.width, h = doc.height, scale = 1, opts = {} } = {}) {
  const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));
  if (scale < 0.25) {
    // 小さく縮める時は 4倍で描いてから縮める（細い線が消えない・継ぎ目が出ない）
    const big = renderRegion(doc, { x, y, w, h, scale: scale * 4, opts });
    const c = newCanvas(W, H), g = ctx2d(c);
    g.imageSmoothingQuality = 'high';
    g.drawImage(big, 0, 0, W, H);
    return c;
  }
  const c = newCanvas(W, H), g = ctx2d(c);
  const t = newCanvas(TILE, TILE), tg = ctx2d(t);
  g.imageSmoothingQuality = 'high';
  const { tx0, ty0, tx1, ty1 } = tilesOfRect({ x, y, w, h });
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalAlpha = 1; tg.globalCompositeOperation = 'source-over';
    tg.clearRect(0, 0, TILE, TILE);
    composeTile(doc, tg, tx, ty, opts);
    // 角を整数に揃える（隣のタイルと重ならず隙間もできない）
    const X0 = Math.round((tx * TILE - x) * scale), X1 = Math.round(((tx + 1) * TILE - x) * scale);
    const Y0 = Math.round((ty * TILE - y) * scale), Y1 = Math.round(((ty + 1) * TILE - y) * scale);
    g.drawImage(t, X0, Y0, X1 - X0, Y1 - Y0);
  }
  return c;
}
