'use strict';
/* 塗りつぶし（閉じた領域）。
   1) 参照先（作業レイヤー / 表示中の全レイヤー / 参照レイヤー）を合成して、押した所の色と近い画素を「塗れる」にする
   2) 隙間閉じ: 線から r 以内を一旦ふさいで塗り、塗れた所を r だけ広げ直す（元の線の上には広げない）
   3) 領域拡縮: 塗った所を広げる（線の下に潜らせる）／縮める
   結果は stroke タイルに書いて commitStroke（ブラシと同じ確定処理・取り消し） */

const Fill = {
  /* opts: { ref: 'layer'|'all'|'ref', tolerance 0..255, gap px, expand px, color, opacity, alphaLock } */
  run(doc, layer, x, y, opts) {
    const t0 = performance.now();
    const region = this.region(doc, layer, x, y, opts);
    if (!region) return false;
    const W = doc.width, H = doc.height;
    const N = W * H;
    // 書き込み
    const { r, g, b } = hexToRgb(opts.color || '#000000');
    doc.beginStroke(layer, { erase: !!opts.erase, opacity: opts.opacity ?? 1, alphaLock: opts.alphaLock, target: opts.target || 'tiles' });
    let count = 0;
    const tmp = newCanvas(TILE, TILE), tg = tmp.getContext('2d');
    for (let ty = 0; ty < doc.rows; ty++) for (let tx = 0; tx < doc.cols; tx++) {
      const bx = tx * TILE, by = ty * TILE, ew = Math.min(TILE, W - bx), eh = Math.min(TILE, H - by);
      let img = null;
      for (let j = 0; j < eh; j++) {
        let o = (by + j) * W + bx;
        for (let k = 0; k < ew; k++, o++) {
          if (!region[o]) continue;
          if (!img) img = tg.createImageData(TILE, TILE);
          const i = (j * TILE + k) * 4;
          img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
          count++;
        }
      }
      if (img) {
        tg.putImageData(img, 0, 0);
        const sg2 = ctx2d(doc.strokeTile(tx, ty));
        sg2.drawImage(tmp, 0, 0);
      }
    }
    if (!count) { doc.cancelStroke(); return false; }
    doc.commitStroke(opts.erase ? '塗りつぶし（消去）' : '塗りつぶし');
    this.lastMs = performance.now() - t0;
    return true;
  },


  /* 押した所からつながる領域（0/1 の文書大の配列）。自動選択も使う */
  region(doc, layer, x, y, opts) {
    x = Math.floor(x); y = Math.floor(y);
    const W = doc.width, H = doc.height;
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    const refLayers = this.refFilter(doc, layer, opts.ref);
    // 押した所の色
    const seed = this.readRef(doc, Math.floor(x / TILE), Math.floor(y / TILE), refLayers);
    const si = ((y % TILE) * TILE + (x % TILE)) * 4;
    const sr = seed[si], sg = seed[si + 1], sb = seed[si + 2], sa = seed[si + 3];
    const tol = opts.tolerance;
    // 1) 塗れる画素
    const N = W * H;
    const free = new Uint8Array(N);
    const srcLayers = doc.layers().filter((l) => l.hasTiles && l.visible && refLayers(l));
    const emptyFree = sa < 8 || sa <= tol ? 1 : 0;        // 何も描いていないタイル（透明）が塗れるか
    for (let ty = 0; ty < doc.rows; ty++) for (let tx = 0; tx < doc.cols; tx++) {
      const bx = tx * TILE, by = ty * TILE, ew = Math.min(TILE, W - bx), eh = Math.min(TILE, H - by);
      const k = tkey(tx, ty);
      if (!srcLayers.some((l) => l.tiles.has(k))) {
        if (emptyFree) for (let j = 0; j < eh; j++) free.fill(1, (by + j) * W + bx, (by + j) * W + bx + ew);
        continue;
      }
      const d = this.readRef(doc, tx, ty, refLayers);
      for (let j = 0; j < eh; j++) {
        let o = (by + j) * W + bx, i = j * TILE * 4;
        for (let k = 0; k < ew; k++, o++, i += 4) {
          const a = d[i + 3];
          // 透明同士は色を見ない（色の値が不定なので）
          let diff;
          if (a < 8 && sa < 8) diff = 0;
          else diff = Math.max(Math.abs(d[i] * a - sr * sa) / 255, Math.abs(d[i + 1] * a - sg * sa) / 255, Math.abs(d[i + 2] * a - sb * sa) / 255, Math.abs(a - sa));
          free[o] = diff <= tol ? 1 : 0;
        }
      }
    }
    // 2) 隙間閉じ
    const gap = Math.max(0, opts.gap | 0);
    let pass = free;
    if (gap > 0) {
      const dist = distanceTo(free, W, H, 0);          // 線（塗れない所）からの距離
      pass = new Uint8Array(N);
      for (let i = 0; i < N; i++) pass[i] = free[i] && dist[i] > gap * 3 ? 1 : 0;
      if (!pass[y * W + x]) pass = free;                // 押した所が細い隙間の中 → 隙間閉じなしで
    }
    let region = floodFill(pass, W, H, x, y);
    if (gap > 0 && pass !== free) {
      const dist = distanceTo(region, W, H, 1);         // 塗れた所からの距離
      for (let i = 0; i < N; i++) if (!region[i] && free[i] && dist[i] <= (gap + 1) * 3) region[i] = 1;
    }
    // 3) 領域拡縮
    const ex = Math.round(opts.expand || 0);
    if (ex > 0) { const dist = distanceTo(region, W, H, 1); for (let i = 0; i < N; i++) if (!region[i] && dist[i] <= ex * 3) region[i] = 1; }
    else if (ex < 0) { const dist = distanceTo(region, W, H, 0); for (let i = 0; i < N; i++) if (region[i] && dist[i] <= -ex * 3) region[i] = 0; }
    return region;
  },

  refFilter(doc, layer, mode) {
    if (mode === 'layer') return (l) => l === layer;
    if (mode === 'ref') {
      const refs = doc.layers().filter((l) => l.ref && l.hasTiles);
      if (refs.length) { const set = new Set(refs); return (l) => set.has(l); }
    }
    return (l) => !l.draft || l === layer;
  },
  /* 参照先を合成したタイルの画素（用紙は含めない） */
  _c: null,
  readRef(doc, tx, ty, filter) {
    if (!this._c) this._c = newCanvas(TILE, TILE);
    const g = this._c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, TILE, TILE);
    composeTile(doc, g, tx, ty, { filter, paper: false, preview: false });
    return readTilePixels(this._c).data;
  },
};

/* 走査線の塗りつぶし: pass=1 の画素を (x,y) からつながる所だけ 1 にした配列を返す */
function floodFill(pass, W, H, x, y) {
  const out = new Uint8Array(W * H);
  if (!pass[y * W + x]) return out;
  const stack = [x, y];
  while (stack.length) {
    const sy = stack.pop(), sx = stack.pop();
    let lx = sx;
    const row = sy * W;
    if (out[row + lx] || !pass[row + lx]) continue;
    while (lx > 0 && pass[row + lx - 1] && !out[row + lx - 1]) lx--;
    let rx = sx;
    while (rx < W - 1 && pass[row + rx + 1] && !out[row + rx + 1]) rx++;
    for (let i = lx; i <= rx; i++) out[row + i] = 1;
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= H) continue;
      const nr = ny * W;
      let inRun = false;
      for (let i = lx; i <= rx; i++) {
        const ok = pass[nr + i] && !out[nr + i];
        if (ok && !inRun) { stack.push(i, ny); inRun = true; } else if (!ok) inRun = false;
      }
    }
  }
  return out;
}

/* 面取り距離（3-4 の2回走査）: mask[i] === target の画素までのおおよその距離（1/3 px 単位の Uint16） */
function distanceTo(mask, W, H, target) {
  const INF = 65000;
  const d = new Uint16Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] === target ? 0 : INF;
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < W; x++) {
      const i = r + x;
      let v = d[i];
      if (!v) continue;
      if (x > 0 && d[i - 1] + 3 < v) v = d[i - 1] + 3;
      if (y > 0) {
        const u = i - W;
        if (d[u] + 3 < v) v = d[u] + 3;
        if (x > 0 && d[u - 1] + 4 < v) v = d[u - 1] + 4;
        if (x < W - 1 && d[u + 1] + 4 < v) v = d[u + 1] + 4;
      }
      d[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    const r = y * W;
    for (let x = W - 1; x >= 0; x--) {
      const i = r + x;
      let v = d[i];
      if (!v) continue;
      if (x < W - 1 && d[i + 1] + 3 < v) v = d[i + 1] + 3;
      if (y < H - 1) {
        const u = i + W;
        if (d[u] + 3 < v) v = d[u] + 3;
        if (x < W - 1 && d[u + 1] + 4 < v) v = d[u + 1] + 4;
        if (x > 0 && d[u - 1] + 4 < v) v = d[u - 1] + 4;
      }
      d[i] = v;
    }
  }
  return d;          // 単位は 1/3 px（呼ぶ側は px×3 と比べる）
}
