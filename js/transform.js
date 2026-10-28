'use strict';
/* 変形（拡大・縮小・回転 / 自由変形 / メッシュ変形）。
   対象 = 作業レイヤーの選択範囲の中（なければレイヤー全体）。
   操作中: 元の場所は doc.cut で隠し、縮小した写し（proxy）を画面に重ねて見せる（軽い）。
   確定: 元の画素を三角形の格子に分け、1画素ずつ逆に写して読む（CPU・双線形）。重ねて描かず値を置くので継ぎ目が出ない。
   写し方は map(u, v) = 元の画素座標 → 文書座標 の関数1つで表す（3つの方式とも同じ確定処理）。 */

/* 4隅（左上・右上・右下・左下）への射影変換（単位正方形から） */
function homography(Q) {
  const [p0, p1, p2, p3] = Q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) { g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; }
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x, c = p0.x;
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y, f = p0.y;
  return (u, v) => { const w = g * u + h * v + 1; return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w }; };
}
/* 3点の対応から 2D アフィン（s → d）。[a, b, c, d, e, f] は canvas の setTransform と同じ並び */
function affineFrom3(s0, s1, s2, d0, d1, d2) {
  const sx1 = s1.x - s0.x, sy1 = s1.y - s0.y, sx2 = s2.x - s0.x, sy2 = s2.y - s0.y;
  const det = sx1 * sy2 - sx2 * sy1 || 1e-9;
  const dx1 = d1.x - d0.x, dy1 = d1.y - d0.y, dx2 = d2.x - d0.x, dy2 = d2.y - d0.y;
  const a = (dx1 * sy2 - dx2 * sy1) / det, c = (dx2 * sx1 - dx1 * sx2) / det;
  const b = (dy1 * sy2 - dy2 * sy1) / det, d = (dy2 * sx1 - dy1 * sx2) / det;
  return [a, b, c, d, d0.x - a * s0.x - c * s0.y, d0.y - b * s0.x - d * s0.y];
}

/* 描いてある範囲（画素単位）。rect の中だけ見る */
function contentBounds(map, rect = null) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [k, t] of map) {
    const [tx, ty] = parseKey(k);
    const bx = tx * TILE, by = ty * TILE;
    if (rect && (bx >= rect.x + rect.w || by >= rect.y + rect.h || bx + TILE <= rect.x || by + TILE <= rect.y)) continue;
    const d = readTilePixels(t).data;
    const ix0 = rect ? Math.max(0, rect.x - bx) : 0, iy0 = rect ? Math.max(0, rect.y - by) : 0;
    const ix1 = rect ? Math.min(TILE, rect.x + rect.w - bx) : TILE, iy1 = rect ? Math.min(TILE, rect.y + rect.h - by) : TILE;
    for (let y = iy0; y < iy1; y++) {
      const row = y * TILE * 4;
      for (let x = ix0; x < ix1; x++) {
        if (d[row + x * 4 + 3]) {
          const X = bx + x, Y = by + y;
          if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
        }
      }
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* 元の範囲の画素を1枚の配列に読む（選択範囲のアルファを掛ける） */
function readRegionRGBA(map, r, sel) {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  const { tx0, ty0, tx1, ty1 } = tilesOfRect(r);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const k = tkey(tx, ty), t = map.get(k);
    if (!t) continue;
    const st = sel ? sel.tiles.get(k) : null;
    if (sel && !st) continue;
    const d = readTilePixels(t).data, sd = st ? readTilePixelsB(st).data : null;
    const bx = tx * TILE, by = ty * TILE;
    const x0 = Math.max(r.x, bx), x1 = Math.min(r.x + r.w, bx + TILE), y0 = Math.max(r.y, by), y1 = Math.min(r.y + r.h, by + TILE);
    for (let y = y0; y < y1; y++) {
      let si = ((y - by) * TILE + (x0 - bx)) * 4, di = ((y - r.y) * r.w + (x0 - r.x)) * 4;
      for (let x = x0; x < x1; x++, si += 4, di += 4) {
        out[di] = d[si]; out[di + 1] = d[si + 1]; out[di + 2] = d[si + 2];
        out[di + 3] = sd ? (d[si + 3] * sd[si + 3]) / 255 : d[si + 3];
      }
    }
  }
  return out;
}
/* 半分に縮める（乗算済みで平均） */
function halveRGBA(src, w, h) {
  const W = Math.ceil(w / 2), H = Math.ceil(h / 2), out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const X = Math.min(w - 1, x * 2 + i), Y = Math.min(h - 1, y * 2 + j), p = (Y * w + X) * 4, al = src[p + 3];
      r += src[p] * al; g += src[p + 1] * al; b += src[p + 2] * al; a += al;
    }
    const o = (y * W + x) * 4;
    if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = a / 4; }
  }
  return { data: out, w: W, h: H };
}

/* 写し: map(u,v)（u,v は元の範囲の中の画素座標 0..w）で src を文書へ。結果 = タイルの Map（key → ImageData 用の配列） */
function rasterWarp(doc, src, sw, sh, map, cells, srcScale = 1) {
  // 格子（外側に 1px 透明の余白: 端がなめらかになる）
  const n = cells;
  const U = (i) => -1 + ((sw + 2) * i) / n, V = (j) => -1 + ((sh + 2) * j) / n;
  const P = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const u = U(i), v = V(j); P.push({ u, v, d: map(u * srcScale, v * srcScale) }); }
  const bufs = new Map();
  const W = doc.width, H = doc.height;
  const buf = (k) => { let b = bufs.get(k); if (!b) { b = new Uint8ClampedArray(TILE * TILE * 4); bufs.set(k, b); } return b; };
  const tri = (A, B, C) => {
    // 文書 → 元 のアフィン（三角形の中だけ正しい）
    const m = affineFrom3(A.d, B.d, C.d, { x: A.u, y: A.v }, { x: B.u, y: B.v }, { x: C.u, y: C.v });
    const xs = [A.d.x, B.d.x, C.d.x], ys = [A.d.y, B.d.y, C.d.y];
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
    if (x1 < x0 || y1 < y0) return;
    const e = (p, q, x, y) => (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x);
    const area = e(A.d, B.d, C.d.x, C.d.y);
    if (Math.abs(area) < 1e-9) return;
    const sgn = area > 0 ? 1 : -1, eps = -1e-4 * Math.abs(area);
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      let curKey = null, b = null, rowBase = 0, txb = 0;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        if (sgn * e(A.d, B.d, px, py) < eps || sgn * e(B.d, C.d, px, py) < eps || sgn * e(C.d, A.d, px, py) < eps) continue;
        const su = m[0] * px + m[2] * py + m[4], sv = m[1] * px + m[3] * py + m[5];
        // 双線形（乗算済み・外は透明）
        const fx = su - 0.5, fy = sv - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
        let R = 0, G = 0, Bc = 0, Al = 0;
        for (let j = 0; j < 2; j++) {
          const yy = iy + j;
          if (yy < 0 || yy >= sh) continue;
          const wy = j ? ay : 1 - ay;
          for (let i = 0; i < 2; i++) {
            const xx = ix + i;
            if (xx < 0 || xx >= sw) continue;
            const w = wy * (i ? ax : 1 - ax), p = (yy * sw + xx) * 4, a = src[p + 3] * w;
            R += src[p] * a; G += src[p + 1] * a; Bc += src[p + 2] * a; Al += a;
          }
        }
        if (Al < 0.5) continue;
        const tx = x >> 8;
        if (curKey === null || tx !== txb) { txb = tx; curKey = tkey(tx, y >> 8); b = buf(curKey); rowBase = (y & 255) * TILE; }
        const o = (rowBase + (x & 255)) * 4;
        b[o] = R / Al; b[o + 1] = G / Al; b[o + 2] = Bc / Al; b[o + 3] = Al;
      }
    }
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = P[j * (n + 1) + i], b = P[j * (n + 1) + i + 1], c = P[(j + 1) * (n + 1) + i + 1], d = P[(j + 1) * (n + 1) + i];
    tri(a, b, c); tri(a, c, d);
  }
  return bufs;
}

class TransformTool {
  constructor(app) { this.app = app; this.showsHover = false; this.st = null; }
  get active() { return !!this.st; }

  /* 変形を始める。mode: 'scale' | 'free' | 'mesh' */
  start(mode = 'scale') {
    const app = this.app, doc = app.doc, layer = doc && doc.active;
    if (!layer || !layer.hasTiles) { toast('変形できるのは、ラスター・ベクターレイヤーです'); return false; }
    if (doc.effectiveLocked(layer)) { toast('レイヤーがロックされています'); return false; }
    if (layer.kind === 'text') { toast('テキストレイヤーは移動ツールで動かせます。変形するにはラスタライズしてください'); return false; }
    const vector = layer.kind === 'vector';
    const sel = vector ? null : doc.sel;
    let r = vector ? vectorBounds(layer) : contentBounds(layer.tiles, sel ? sel.bounds : null);
    if (!r) { toast('変形する画素がありません'); return false; }
    // プロキシ（縮小した写し）
    const ps = Math.min(1, 1600 / Math.max(r.w, r.h));
    const pw = Math.max(1, Math.round(r.w * ps)), ph = Math.max(1, Math.round(r.h * ps));
    const proxy = newCanvas(pw, ph), pg = ctx2d(proxy);
    pg.imageSmoothingQuality = 'high';
    const tmp = newCanvas(TILE, TILE), tg = ctx2d(tmp);
    const { tx0, ty0, tx1, ty1 } = tilesOfRect(r);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const k = tkey(tx, ty), t = layer.tiles.get(k);
      if (!t) continue;
      let src = t;
      if (sel) {
        const s = sel.tiles.get(k);
        if (!s) continue;
        tg.globalCompositeOperation = 'copy'; tg.drawImage(t, 0, 0);
        tg.globalCompositeOperation = 'destination-in'; tg.drawImage(s, 0, 0);
        tg.globalCompositeOperation = 'source-over';
        src = tmp;
      }
      const X0 = Math.round((tx * TILE - r.x) * ps), X1 = Math.round(((tx + 1) * TILE - r.x) * ps);
      const Y0 = Math.round((ty * TILE - r.y) * ps), Y1 = Math.round(((ty + 1) * TILE - r.y) * ps);
      pg.drawImage(src, X0, Y0, X1 - X0, Y1 - Y0);
    }
    this.st = {
      layer, sel, r, proxy, ps, vector, mode: 'scale',
      aff: { cx: r.x + r.w / 2, cy: r.y + r.h / 2, sx: 1, sy: 1, rot: 0 },
      quad: null, mesh: null, meshN: 4, drag: null, aspect: true,
    };
    doc.cut = { layer, sel };
    doc.invalidateRect(r);
    if (mode !== 'scale') this.setMode(mode);
    this.prevTool = app.toolName === 'transform' ? this.prevTool : app.toolName;
    app.enterTransform(this);
    this.buildBar();
    app.view.request();
    return true;
  }

  // ---- 写し方
  corners() {
    const s = this.st, r = s.r;
    return [[0, 0], [r.w, 0], [r.w, r.h], [0, r.h]].map(([u, v]) => this.map(u, v));
  }
  map(u, v) {
    const s = this.st, r = s.r;
    if (s.mode === 'scale') {
      const a = s.aff, dx = (u - r.w / 2) * a.sx, dy = (v - r.h / 2) * a.sy, c = Math.cos(a.rot), sn = Math.sin(a.rot);
      return { x: a.cx + dx * c - dy * sn, y: a.cy + dx * sn + dy * c };
    }
    if (s.mode === 'free') return s._H(u / r.w, v / r.h);
    // メッシュ: 格子の升の中で双線形（外側は端の升を延ばす）
    const n = s.meshN, G = s.mesh;
    const fu = (u / r.w) * n, fv = (v / r.h) * n;
    const ci = clamp(Math.floor(fu), 0, n - 1), cj = clamp(Math.floor(fv), 0, n - 1);
    const tu = fu - ci, tv = fv - cj;
    const p00 = G[cj * (n + 1) + ci], p10 = G[cj * (n + 1) + ci + 1], p01 = G[(cj + 1) * (n + 1) + ci], p11 = G[(cj + 1) * (n + 1) + ci + 1];
    return {
      x: (1 - tu) * (1 - tv) * p00.x + tu * (1 - tv) * p10.x + (1 - tu) * tv * p01.x + tu * tv * p11.x,
      y: (1 - tu) * (1 - tv) * p00.y + tu * (1 - tv) * p10.y + (1 - tu) * tv * p01.y + tu * tv * p11.y,
    };
  }
  setMode(mode) {
    const s = this.st;
    if (!s || s.mode === mode) return;
    if (mode === 'free') {
      s.quad = this.corners();
      s.mode = 'free'; s._H = homography(s.quad);
    } else if (mode === 'mesh') {
      const n = s.meshN, r = s.r, G = [];
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) G.push(this.map((r.w * i) / n, (r.h * j) / n));
      s.mesh = G; s.mode = 'mesh';
    } else if (mode === 'scale') {
      if (s.mode !== 'scale') { toast('拡大・縮小・回転に戻すと、自由変形・メッシュの形は元に戻ります'); s.mode = 'scale'; }
    }
    this.buildBar();
    this.app.view.request();
  }
  flip(axis) {
    const s = this.st;
    if (s.mode === 'scale') { if (axis === 'h') s.aff.sx *= -1; else s.aff.sy *= -1; }
    else {
      // 今の形の中心で反転
      const pts = s.mode === 'free' ? s.quad : s.mesh;
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      for (const p of pts) { if (axis === 'h') p.x = 2 * cx - p.x; else p.y = 2 * cy - p.y; }
      if (s.mode === 'free') s._H = homography(s.quad);
    }
    this.app.view.request();
  }

  // ---- 入力（つまみの位置は画面座標で判定）
  handles() {
    const s = this.st, v = this.app.view, r = s.r;
    if (s.mode === 'scale') {
      const pts = [[0, 0], [r.w, 0], [r.w, r.h], [0, r.h], [r.w / 2, 0], [r.w, r.h / 2], [r.w / 2, r.h], [0, r.h / 2]].map(([u, w]) => this.map(u, w));
      return pts.map((p) => v.toScreen(p.x, p.y));
    }
    const pts = s.mode === 'free' ? s.quad : s.mesh;
    return pts.map((p) => v.toScreen(p.x, p.y));
  }
  rotHandle() {
    const v = this.app.view, r = this.st.r;
    const top = this.map(r.w / 2, 0), c = this.map(r.w / 2, r.h / 2);
    const a = v.toScreen(top.x, top.y), b = v.toScreen(c.x, c.y);
    const len = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    return { x: a.x + ((a.x - b.x) / len) * 32, y: a.y + ((a.y - b.y) / len) * 32 };
  }
  inside(sp) {
    const v = this.app.view, cs = this.corners().map((p) => v.toScreen(p.x, p.y));
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const a = cs[i], b = cs[j];
      if ((a.y > sp.y) !== (b.y > sp.y) && sp.x < ((b.x - a.x) * (sp.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  down(p) {
    const s = this.st;
    if (!s) return;
    const v = this.app.view, sp = v.toScreen(p.x, p.y);
    const R = 22;
    const hs = this.handles();
    let hit = -1;
    hs.forEach((h, i) => { if (hit < 0 && Math.hypot(h.x - sp.x, h.y - sp.y) < R) hit = i; });
    const P0 = { x: p.x, y: p.y };
    if (s.mode === 'scale') {
      const rh = this.rotHandle();
      if (hit < 0 && Math.hypot(rh.x - sp.x, rh.y - sp.y) < R) hit = 'rot';
      if (hit === -1) hit = this.inside(sp) ? 'move' : 'rot';
      s.drag = { hit, P0, aff: { ...s.aff } };
    } else {
      if (hit === -1) hit = 'move';
      const pts = s.mode === 'free' ? s.quad : s.mesh;
      s.drag = { hit, P0, pts: pts.map((q) => ({ ...q })) };
    }
  }
  move(p) {
    const s = this.st;
    if (!s || !s.drag) return;
    const D = s.drag, r = s.r;
    if (s.mode === 'scale') {
      const a0 = D.aff, a = s.aff;
      if (D.hit === 'move') { a.cx = a0.cx + p.x - D.P0.x; a.cy = a0.cy + p.y - D.P0.y; }
      else if (D.hit === 'rot') {
        const ang0 = Math.atan2(D.P0.y - a0.cy, D.P0.x - a0.cx), ang = Math.atan2(p.y - a0.cy, p.x - a0.cx);
        let rot = a0.rot + ang - ang0;
        if (p.shift) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
        a.rot = rot;
      } else {
        // 角・辺: 反対側を止めて伸ばす
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]];
        const [hx, hy] = corners[D.hit];
        const c = Math.cos(a0.rot), sn = Math.sin(a0.rot);
        const anchorLocal = { x: (-hx * r.w * a0.sx) / 2, y: (-hy * r.h * a0.sy) / 2 };
        const A = { x: a0.cx + anchorLocal.x * c - anchorLocal.y * sn, y: a0.cy + anchorLocal.x * sn + anchorLocal.y * c };
        const dx = p.x - A.x, dy = p.y - A.y;
        const lx = dx * c + dy * sn, ly = -dx * sn + dy * c;        // 回転を戻した向き
        let sx = hx ? lx / (hx * r.w) : a0.sx, sy = hy ? ly / (hy * r.h) : a0.sy;
        if (hx && hy && (s.aspect !== p.shift)) {
          const k = Math.max(Math.abs(sx / a0.sx), Math.abs(sy / a0.sy));
          sx = a0.sx * k * Math.sign(sx / a0.sx || 1); sy = a0.sy * k * Math.sign(sy / a0.sy || 1);
        }
        if (Math.abs(sx) < 1e-3) sx = 1e-3 * Math.sign(sx || 1);
        if (Math.abs(sy) < 1e-3) sy = 1e-3 * Math.sign(sy || 1);
        a.sx = sx; a.sy = sy;
        // 中心 = 止めた点 ＋ 新しい大きさの半分（辺のつまみは片方の軸だけ）
        const hx2 = (hx * r.w * sx) / 2, hy2 = (hy * r.h * sy) / 2;
        a.cx = A.x + hx2 * c - hy2 * sn; a.cy = A.y + hx2 * sn + hy2 * c;
      }
    } else {
      const pts = s.mode === 'free' ? s.quad : s.mesh;
      const dx = p.x - D.P0.x, dy = p.y - D.P0.y;
      if (D.hit === 'move') pts.forEach((q, i) => { q.x = D.pts[i].x + dx; q.y = D.pts[i].y + dy; });
      else { pts[D.hit].x = D.pts[D.hit].x + dx; pts[D.hit].y = D.pts[D.hit].y + dy; }
      if (s.mode === 'free') s._H = homography(s.quad);
    }
    this.app.view.request();
  }
  up() { if (this.st) this.st.drag = null; }
  cancel() { if (this.st) this.st.drag = null; }

  // ---- 表示
  drawOverlay(g, view) {
    const s = this.st;
    if (!s) return;
    const dpr = view.dpr, m = view.m, r = s.r;
    g.save();
    g.setTransform(m.a * dpr, m.b * dpr, m.c * dpr, m.d * dpr, m.e * dpr, m.f * dpr);
    g.globalAlpha = s.layer.opacity;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
    const k = 1 / s.ps;
    if (s.mode === 'scale') {
      const a = s.aff;
      g.translate(a.cx, a.cy); g.rotate(a.rot); g.scale(a.sx, a.sy); g.translate(-r.w / 2, -r.h / 2);
      g.drawImage(s.proxy, 0, 0, r.w, r.h);
    } else {
      // 三角形ごとに切り抜いて描く（試し表示なので少し重ねる）
      const n = s.mode === 'free' ? 10 : s.meshN * 3;
      const P = [];
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const u = (r.w * i) / n, v = (r.h * j) / n; P.push({ s: { x: u / k, y: v / k }, d: this.map(u, v) }); }
      const base = g.getTransform();
      const tri = (A, B, C) => {
        g.save();
        const cx = (A.d.x + B.d.x + C.d.x) / 3, cy = (A.d.y + B.d.y + C.d.y) / 3, ex = 0.8 / view.s;
        const grow = (q) => { const dx = q.x - cx, dy = q.y - cy, l = Math.hypot(dx, dy) || 1; return { x: q.x + (dx / l) * ex, y: q.y + (dy / l) * ex }; };
        const a = grow(A.d), b = grow(B.d), c = grow(C.d);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.closePath(); g.clip();
        const t = affineFrom3(A.s, B.s, C.s, A.d, B.d, C.d);
        g.setTransform(base.multiply(new DOMMatrix(t)));
        g.drawImage(s.proxy, 0, 0);
        g.restore();
      };
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = P[j * (n + 1) + i], b = P[j * (n + 1) + i + 1], c = P[(j + 1) * (n + 1) + i + 1], d = P[(j + 1) * (n + 1) + i];
        tri(a, b, c); tri(a, c, d);
      }
    }
    g.restore();
    // 枠とつまみ
    g.save();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const line = (pts, close) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); if (close) g.closePath(); };
    const cs = this.corners().map((p) => view.toScreen(p.x, p.y));
    g.lineWidth = 1.5; g.strokeStyle = '#2b8cff';
    if (s.mode === 'mesh') {
      const n = s.meshN, G = s.mesh.map((p) => view.toScreen(p.x, p.y));
      for (let j = 0; j <= n; j++) { line(G.slice(j * (n + 1), (j + 1) * (n + 1))); g.stroke(); }
      for (let i = 0; i <= n; i++) { line(Array.from({ length: n + 1 }, (_, j) => G[j * (n + 1) + i])); g.stroke(); }
    } else { line(cs, true); g.stroke(); }
    const hs = this.handles();
    for (const h of hs) { g.fillStyle = '#fff'; g.strokeStyle = '#2b8cff'; g.beginPath(); g.rect(h.x - 6, h.y - 6, 12, 12); g.fill(); g.stroke(); }
    if (s.mode === 'scale') {
      const rh = this.rotHandle(), top = hs[4];
      g.beginPath(); g.moveTo(top.x, top.y); g.lineTo(rh.x, rh.y); g.stroke();
      g.fillStyle = '#2b8cff'; g.beginPath(); g.arc(rh.x, rh.y, 7, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  // ---- 上のバー
  buildBar() {
    const s = this.st;
    let bar = $('#tbar');
    if (!bar) { bar = el('div', { id: 'tbar', class: 'tbar' }); $('#viewport').append(bar); }
    bar.innerHTML = '';
    const mode = (m, label) => el('button', { class: 'seg-b' + (s.mode === m ? ' on' : ''), onclick: () => this.setMode(m) }, label);
    bar.append(el('div', { class: 'seg' }, mode('scale', '拡大・縮小・回転'), mode('free', '自由変形'), mode('mesh', 'メッシュ')));
    if (s.mode === 'scale') bar.append(el('button', { class: 'seg-b' + (s.aspect ? ' on' : ''), onclick: (e) => { s.aspect = !s.aspect; e.target.classList.toggle('on', s.aspect); } }, '縦横比を固定'));
    if (s.mode !== 'mesh') {
      const sel = el('select', { class: 'sel mini-sel', title: 'メッシュの細かさ' }, ...[2, 3, 4, 6, 8].map((n) => el('option', { value: n, selected: n === s.meshN || null }, `${n}×${n}`)));
      sel.addEventListener('change', () => { s.meshN = +sel.value; });
      bar.append(sel);
    }
    bar.append(el('button', { class: 'seg-b', onclick: () => this.flip('h') }, '左右反転'), el('button', { class: 'seg-b', onclick: () => this.flip('v') }, '上下反転'));
    bar.append(el('span', { class: 'tb-gap' }),
      el('button', { class: 'btn small', onclick: () => this.finish(false) }, 'キャンセル'),
      el('button', { class: 'btn small primary', onclick: () => this.finish(true) }, '確定'));
  }

  // ---- 確定・取り消し
  finish(ok) {
    const s = this.st;
    if (!s) return;
    const app = this.app, doc = app.doc;
    const done = () => {
      doc.cut = null;
      doc.invalidateRect(s.r);
      this.st = null;
      const bar = $('#tbar'); if (bar) bar.remove();
      app.exitTransform(this.prevTool);
      app.view.request();
    };
    if (!ok) { done(); return; }
    app.busy('変形しています…');
    setTimeout(() => {
      try { this.commit(); } catch (e) { console.error(e); toast('変形できませんでした: ' + e.message, { error: true }); }
      finally { app.busy(null); done(); app.afterEdit(); }
    }, 30);
  }
  commit() {
    const s = this.st, doc = this.app.doc, layer = s.layer, r = s.r;
    const mapDoc = (u, v) => this.map(u, v);
    if (s.vector) { transformVectorLayer(doc, layer, (x, y) => mapDoc(x - r.x, y - r.y), this.scaleAt.bind(this)); return; }
    // 縮小が強い時は元を先に縮めておく（ざらつき防止）
    let src = readRegionRGBA(layer.tiles, r, s.sel), sw = r.w, sh = r.h, scale = 1;
    const est = this.scaleEstimate();
    while (est * scale < 0.5 && Math.min(sw, sh) > 8) { const h = halveRGBA(src, sw, sh); src = h.data; sw = h.w; sh = h.h; scale *= 2; }
    const cells = s.mode === 'scale' ? 1 : s.mode === 'free' ? 24 : s.meshN * 6;
    const bufs = rasterWarp(doc, src, sw, sh, (u, v) => mapDoc(u, v), cells, (r.w / sw));
    // 新しいタイル = 元（切り抜いた残り）＋写した画素
    const keys = new Set(bufs.keys());
    const { tx0, ty0, tx1, ty1 } = tilesOfRect(r);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (layer.tiles.has(tkey(tx, ty))) keys.add(tkey(tx, ty));
    const nt = new Map();
    const tmp = newCanvas(TILE, TILE), tg = tmp.getContext('2d');
    for (const k of keys) {
      const [tx, ty] = parseKey(k);
      const inSrc = tx >= tx0 && tx <= tx1 && ty >= ty0 && ty <= ty1;
      const old = layer.tiles.get(k);
      const c = TilePool.get(), g = ctx2d(c);
      if (old) {
        g.drawImage(old, 0, 0);
        if (inSrc) {
          if (!s.sel) {
            // 範囲の中だけ消す（範囲の外にはみ出したタイルの部分は残す）
            g.clearRect(r.x - tx * TILE, r.y - ty * TILE, r.w, r.h);
          } else { const st = s.sel.tiles.get(k); if (st) { g.globalCompositeOperation = 'destination-out'; g.drawImage(st, 0, 0); g.globalCompositeOperation = 'source-over'; } }
        }
      }
      const b = bufs.get(k);
      if (b) { tg.putImageData(new ImageData(b, TILE, TILE), 0, 0); g.drawImage(tmp, 0, 0); }
      nt.set(k, c);
    }
    doc.history.begin();
    doc.replaceTiles('変形', layer, nt, [...keys]);
    // 選択範囲も同じように写す
    if (s.sel) {
      const ss = readRegionRGBA(s.sel.tiles, r, null);
      const sb = rasterWarp(doc, ss, r.w, r.h, (u, v) => mapDoc(u, v), cells, 1);
      const tiles = new Map();
      for (const [k, b] of sb) { tg.putImageData(new ImageData(b, TILE, TILE), 0, 0); const c = TilePool.get(); ctx2d(c).drawImage(tmp, 0, 0); tiles.set(k, c); }
      doc.setSel(new Selection(doc, tiles), '変形');
    }
    doc.history.end('変形');
  }
  scaleEstimate() {
    const s = this.st, r = s.r;
    if (s.mode === 'scale') return Math.sqrt(Math.abs(s.aff.sx * s.aff.sy));
    const cs = this.corners();
    let area = 0;
    for (let i = 0, j = 3; i < 4; j = i++) area += (cs[j].x + cs[i].x) * (cs[j].y - cs[i].y);
    return Math.sqrt(Math.abs(area / 2) / (r.w * r.h));
  }
  /* その場所の拡大率（ベクターの線の太さ用） */
  scaleAt(x, y) {
    const r = this.st.r, u = x - r.x, v = y - r.y, h = 2;
    const p = this.map(u, v), px = this.map(u + h, v), py = this.map(u, v + h);
    return Math.sqrt(Math.abs((px.x - p.x) * (py.y - p.y) - (px.y - p.y) * (py.x - p.x))) / h;
  }
}
