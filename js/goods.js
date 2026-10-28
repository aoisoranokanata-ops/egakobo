'use strict';
/* グッズ・印刷物: テンプレートのガイド（缶バッジの表示面・巻き込み・安全範囲）、カットラインと白版、CMYK プレビュー。
   doc.goods = { type: 'badge'|'acrylic'|'sticker', face, total（mm） }（保存する） */

const GOODS_COLORS = { cut: '#ff00a0', white: '#000000' };

function drawGoodsGuides(g, view, doc) {
  const G = doc.goods;
  if (!G || G.type !== 'badge') return;
  const px = (mm) => (mm / 25.4) * doc.dpi, cx = doc.width / 2, cy = doc.height / 2;
  const circle = (dmm, color, dash, label) => {
    const r = (px(dmm) / 2) * view.s, c = view.toScreen(cx, cy);
    g.save(); g.strokeStyle = color; g.lineWidth = 1.2; g.setLineDash(dash);
    g.beginPath(); g.arc(c.x, c.y, r, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]); g.fillStyle = color; g.font = '11px sans-serif'; g.textAlign = 'center';
    g.fillText(label, c.x, c.y - r + 14);
    g.restore();
  };
  circle(G.total, 'rgba(255,90,95,.9)', [6, 4], `巻き込み ${G.total}mm（ここまで描く）`);
  circle(G.face, 'rgba(0,140,255,.9)', [], `表示面 ${G.face}mm`);
  circle(G.face - 6, 'rgba(0,170,200,.8)', [3, 4], '文字・顔はこの中');
}

const GoodsOps = {
  /* 描いてある形（用紙・下描きを除く）→ 0/1 の配列 */
  silhouette(doc) {
    const W = doc.width, H = doc.height, m = new Uint8Array(W * H);
    const t = newCanvas(TILE, TILE), tg = ctx2d(t);
    for (const [tx, ty] of doc.gridKeys()) {
      tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalAlpha = 1; tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, TILE, TILE);
      composeTile(doc, tg, tx, ty, { exportMode: true, preview: false, paper: false, filter: (l) => !l.goodsLine });
      const d = readTilePixels(t).data, bx = tx * TILE, by = ty * TILE, ew = Math.min(TILE, W - bx), eh = Math.min(TILE, H - by);
      for (let j = 0; j < eh; j++) for (let i = 0; i < ew; i++) if (d[(j * TILE + i) * 4 + 3] >= 16) m[(by + j) * W + bx + i] = 1;
    }
    return m;
  },
  /* 穴を埋める（外から届かない所は中） */
  fillHoles(m, W, H) {
    const pass = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) pass[i] = m[i] ? 0 : 1;
    const outside = new Uint8Array(W * H);
    const seeds = [];
    for (let x = 0; x < W; x++) { seeds.push([x, 0], [x, H - 1]); }
    for (let y = 0; y < H; y++) { seeds.push([0, y], [W - 1, y]); }
    for (const [x, y] of seeds) {
      if (!pass[y * W + x] || outside[y * W + x]) continue;
      const r = floodFill(pass, W, H, x, y);
      for (let i = 0; i < r.length; i++) if (r[i]) { outside[i] = 1; pass[i] = 0; }
    }
    const inside = new Uint8Array(W * H);
    for (let i = 0; i < inside.length; i++) inside[i] = outside[i] ? 0 : 1;
    return inside;
  },
  /* 0/1 の配列 → 新しいレイヤーのタイル（色 color） */
  maskToLayer(doc, mask, name, color) {
    const l = new Layer('raster', name), W = doc.width;
    const { r, g, b } = hexToRgb(color);
    const tmp = newCanvas(TILE, TILE), tg = tmp.getContext('2d');
    for (const [tx, ty, k] of doc.gridKeys()) {
      const bx = tx * TILE, by = ty * TILE, ew = Math.min(TILE, W - bx), eh = Math.min(TILE, doc.height - by);
      let img = null;
      for (let j = 0; j < eh; j++) for (let i = 0; i < ew; i++) {
        if (!mask[(by + j) * W + bx + i]) continue;
        if (!img) img = tg.createImageData(TILE, TILE);
        const p = (j * TILE + i) * 4; img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
      }
      if (img) { tg.putImageData(img, 0, 0); const c = TilePool.get(); ctx2d(c).drawImage(tmp, 0, 0); l.tiles.set(k, c); doc.markTile(l, k); }
    }
    l.goodsLine = true;
    return l;
  },
  async cutLineDialog(app) {
    const doc = app.doc;
    if (!doc) return;
    const off = el('input', { type: 'number', class: 'inp', value: 2, step: 0.5, min: 0 });
    const lw = el('input', { type: 'number', class: 'inp', value: 0.3, step: 0.1, min: 0.1 });
    const wp = el('input', { type: 'checkbox', checked: true });
    const body = el('div', {},
      el('div', { class: 'row3' }, el('div', {}, el('label', { class: 'lbl' }, '絵からの距離 mm'), off), el('div', {}, el('label', { class: 'lbl' }, '線の太さ mm'), lw), el('div')),
      el('label', { class: 'chk' }, wp, ' 白版（絵の形の黒いレイヤー）も作る'),
      el('p', { class: 'hint' }, '表示中の絵（用紙・下描きを除く）の外側の形から、カットラインを作ります（中の穴は埋めます）。アクリルスタンド・キーホルダー・ステッカー向け。白版は最初は非表示です。入稿の形式は印刷所の指定に合わせてください。'));
    const ok = await modal({ title: 'カットラインを作る', body, buttons: [{ label: 'キャンセル', value: false }, { label: '作る', value: true, primary: true }] });
    if (!ok) return;
    app.busy('カットラインを作っています…');
    setTimeout(() => {
      try { this.makeCutLine(app, +off.value || 0, +lw.value || 0.3, wp.checked); }
      catch (e) { console.error(e); toast('作れませんでした: ' + e.message, { error: true }); }
      finally { app.busy(null); }
    }, 30);
  },
  makeCutLine(app, offMm, lwMm, whitePlate) {
    const doc = app.doc, W = doc.width, H = doc.height, px = (mm) => (mm / 25.4) * doc.dpi;
    const sil = this.silhouette(doc);
    if (!sil.some((v) => v)) { toast('描いてある絵がありません'); return; }
    const inside = this.fillHoles(sil, W, H);
    // 絵から off だけ広げた形
    const d1 = distanceTo(inside, W, H, 1), o3 = px(offMm) * 3;
    const region = new Uint8Array(W * H);
    for (let i = 0; i < region.length; i++) region[i] = d1[i] <= o3 ? 1 : 0;
    // 形の縁（内側に線の太さぶん）
    const d2 = distanceTo(region, W, H, 0), l3 = Math.max(1.5, px(lwMm)) * 3;
    const line = new Uint8Array(W * H);
    for (let i = 0; i < line.length; i++) line[i] = region[i] && d2[i] <= l3 ? 1 : 0;
    const cut = this.maskToLayer(doc, line, 'カットライン', GOODS_COLORS.cut);
    const wl = whitePlate ? this.maskToLayer(doc, sil, '白版', GOODS_COLORS.white) : null;
    if (wl) wl.visible = false;
    doc.structEdit('カットライン', () => {
      if (wl) doc.root.children.push(wl);
      doc.root.children.push(cut);
      doc.activeId = cut.id;
    });
    toast('カットラインを作りました（いちばん上のレイヤー）');
  },
  /* 作業レイヤーだけを PNG で（白版・カットラインを別のファイルで渡す時など） */
  async exportLayerPNG(app) {
    const doc = app.doc, a = doc && doc.active;
    if (!a || !a.hasTiles) { toast('描いてあるレイヤーを選んでください'); return; }
    app.busy('書き出しています…');
    try {
      const blob = await encodeBands(doc.width, doc.height, doc.dpi, 'rgba', (g, y0, h) => {
        for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + h - 1) / TILE); ty++) for (let tx = 0; tx < doc.cols; tx++) {
          const t = a.tiles.get(tkey(tx, ty));
          if (t) g.drawImage(a.tone ? toneTile(t, newCanvas(TILE, TILE), a.tone, tx, ty, doc.dpi) : t, tx * TILE, ty * TILE - y0);
        }
      });
      app.busy(null);
      await shareOrDownload(blob, `${doc.name}_${a.name}.png`);
    } catch (e) { app.busy(null); toast('書き出せません: ' + e.message, { error: true }); }
  },
};

/* ================= CMYK プレビュー（目安） =================
   RGB → CMYK（簡易）→ 印刷したときの色（Japan Color の4色に近いインキを掛け合わせる）を 33³ の表にし、画面に重ねる */
let _cmykLUT = null;
function cmykLUT() {
  if (_cmykLUT) return _cmykLUT;
  const N = 33, lut = new Uint8Array(N * N * N * 3);
  const inks = [[0, 160, 233], [229, 0, 127], [255, 241, 0], [35, 24, 21]].map((c) => c.map((v) => v / 255));
  const paper = [0.97, 0.97, 0.96];
  for (let ri = 0; ri < N; ri++) for (let gi = 0; gi < N; gi++) for (let bi = 0; bi < N; bi++) {
    const r = ri / (N - 1), g = gi / (N - 1), b = bi / (N - 1);
    const k = 1 - Math.max(r, g, b), d = 1 - k || 1;
    let amt = [(1 - r - k) / d, (1 - g - k) / d, (1 - b - k) / d, k];
    // 総インキ量 300% まで
    const tot = amt.reduce((s, v) => s + v, 0);
    if (tot > 3) { const f = (3 - amt[3]) / (tot - amt[3]); amt = [amt[0] * f, amt[1] * f, amt[2] * f, amt[3]]; }
    // 網点の太り（中間調が少し濃くなる）
    amt = amt.map((a) => a + 0.12 * a * (1 - a) * 4 * 0.5);
    const o = ((ri * N + gi) * N + bi) * 3;
    for (let ch = 0; ch < 3; ch++) {
      let v = paper[ch];
      for (let i = 0; i < 4; i++) v *= 1 - Math.min(1, amt[i]) * (1 - inks[i][ch]);
      lut[o + ch] = Math.round(clamp(v, 0, 1) * 255);
    }
  }
  _cmykLUT = lut;
  return lut;
}
function cmykProof(g) {
  const lut = cmykLUT(), N = 33, S = (N - 1) / 255;
  const img = readTilePixels(g.canvas), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const fr = d[i] * S, fg = d[i + 1] * S, fb = d[i + 2] * S;
    const r0 = Math.min(N - 2, fr | 0), g0 = Math.min(N - 2, fg | 0), b0 = Math.min(N - 2, fb | 0);
    const tr = fr - r0, tg = fg - g0, tb = fb - b0;
    for (let ch = 0; ch < 3; ch++) {
      const at = (a, b, c) => lut[(((r0 + a) * N + (g0 + b)) * N + (b0 + c)) * 3 + ch];
      const c00 = at(0, 0, 0) * (1 - tb) + at(0, 0, 1) * tb, c01 = at(0, 1, 0) * (1 - tb) + at(0, 1, 1) * tb;
      const c10 = at(1, 0, 0) * (1 - tb) + at(1, 0, 1) * tb, c11 = at(1, 1, 0) * (1 - tb) + at(1, 1, 1) * tb;
      d[i + ch] = (c00 * (1 - tg) + c01 * tg) * (1 - tr) + (c10 * (1 - tg) + c11 * tg) * tr;
    }
  }
  _readC.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'copy'; g.drawImage(_readC, 0, 0); g.restore();
}
