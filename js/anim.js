'use strict';
/* アニメーション。
   アニメーションフォルダー（folder.anim = true）の中の1枚1枚が「セル」。folder.timing = [{f, cel}]（f フレーム目から cel を出す。
   cel = null は空セル）。差し替えて使う（setProps で取り消せる）。普通のレイヤーはどのフレームでも表示。
   doc.anim = {fps, frames, cur, hold, onion: {on, prev, next, opacity}, outW, outH}、doc.camera = [{f, cx, cy, s, r}]（保存する）。 */

const ONION_PREV = '#2f6bff', ONION_NEXT = '#1fae55';

function animDefaults(doc) {
  return { fps: 12, frames: 24, cur: 0, hold: 2, onion: { on: true, prev: 1, next: 1, opacity: 0.35 }, outW: doc.width, outH: doc.height };
}
function ensureAnim(doc) { if (!doc.anim) doc.anim = animDefaults(doc); if (!doc.camera) doc.camera = []; return doc.anim; }
const animFolders = (doc) => doc.layers().filter((l) => l.anim);

/* f フレーム目のキー（timing の何番目か）。キーより前は -1 */
function keyIndexAt(L, f) {
  const t = L.timing || [];
  let k = -1;
  for (let i = 0; i < t.length; i++) if (t[i].f <= f) k = i; else break;
  return k;
}
function celAt(L, f) { const k = keyIndexAt(L, f); return k >= 0 ? L.timing[k].cel : null; }

/* オニオンスキンで見せるセル: [{id, color, alpha}] */
function onionCels(doc, L, f) {
  const A = doc.anim, on = A.onion, t = L.timing || [], k = keyIndexAt(L, f), out = [];
  if (!on || !on.on) return out;
  const cur = k >= 0 ? t[k].cel : null;
  for (let i = 1, n = 0; n < on.prev && k - i >= 0; i++) { const c = t[k - i].cel; if (c != null && c !== cur) { out.push({ id: c, color: ONION_PREV, alpha: on.opacity / (n + 1) }); n++; } }
  for (let i = 1, n = 0; n < on.next && k + i < t.length; i++) { const c = t[k + i].cel; if (c != null && c !== cur) { out.push({ id: c, color: ONION_NEXT, alpha: on.opacity / (n + 1) }); n++; } }
  return out;
}

/* 合成（compose.js から）: アニメーションフォルダーの中身を target に */
function renderAnimFolder(doc, L, target, tx, ty, d, o) {
  const A = doc.anim || animDefaults(doc);
  const f = o.frame != null ? o.frame : A.cur;
  const curId = celAt(L, f);
  const byId = (id) => L.children.find((c) => c.id === id);
  if (o.preview && !o.noOnion && !doc.playing) {
    const T = tempsAt(d);
    // ライトテーブル（下絵に使うセル）とオニオンスキン
    const extra = [...(L.lightTable || []).filter((id) => id !== curId).map((id) => ({ id, color: null, alpha: 0.3 })), ...onionCels(doc, L, f)];
    for (const e of extra) {
      const cel = byId(e.id);
      if (!cel || !cel.visible) continue;
      const gg = clearTemp(T.G);
      renderList(doc, [cel], gg, tx, ty, d + 1, o);
      if (e.color) { gg.globalCompositeOperation = 'source-in'; gg.fillStyle = e.color; gg.fillRect(0, 0, TILE, TILE); gg.globalCompositeOperation = 'source-over'; }
      target.globalAlpha = e.alpha; target.drawImage(T.G, 0, 0); target.globalAlpha = 1;
    }
  }
  const cel = curId != null ? byId(curId) : null;
  if (cel) renderList(doc, [cel], target, tx, ty, d + 1, o);
}

/* カメラ: f フレーム目の {cx, cy, s, r}（キーの間はなめらかに補間） */
function camAt(doc, f) {
  const A = doc.anim, keys = doc.camera || [];
  const def = { cx: doc.width / 2, cy: doc.height / 2, s: Math.min(A.outW / doc.width, A.outH / doc.height), r: 0 };
  if (!keys.length) return def;
  if (f <= keys[0].f) return { ...keys[0] };
  const last = keys[keys.length - 1];
  if (f >= last.f) return { ...last };
  let i = 0;
  while (keys[i + 1].f <= f) i++;
  const a = keys[i], b = keys[i + 1], t0 = (f - a.f) / (b.f - a.f), t = t0 * t0 * (3 - 2 * t0);   // ゆっくり動き出してゆっくり止まる
  return { cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), s: a.s * Math.pow(b.s / a.s, t), r: lerp(a.r, b.r, t) };
}
function setCamKey(doc, f, c) {
  const keys = (doc.camera || []).filter((k) => k.f !== f);
  keys.push({ f, cx: c.cx, cy: c.cy, s: c.s, r: c.r });
  keys.sort((a, b) => a.f - b.f);
  doc.camera = keys; doc.metaDirty = true;
}

/* 1フレームを出力の大きさで描く（カメラを通す）。k = 出力の倍率（0.5 で半分の大きさ） */
function renderFrame(doc, f, k = 1, { white = true } = {}) {
  const A = doc.anim, W = Math.max(2, Math.round(A.outW * k)), H = Math.max(2, Math.round(A.outH * k));
  const c = newCanvas(W, H), g = c.getContext('2d');
  if (white) { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); }
  const cam = camAt(doc, f), s = cam.s * k;
  // 出力の四隅 → 文書の範囲
  const cs = Math.cos(cam.r), sn = Math.sin(cam.r), hw = W / 2 / s, hh = H / 2 / s;
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: cam.cx + x * cs - y * sn, y: cam.cy + x * sn + y * cs }));
  const x0 = clamp(Math.floor(Math.min(...pts.map((p) => p.x))), 0, doc.width), x1 = clamp(Math.ceil(Math.max(...pts.map((p) => p.x))), 0, doc.width);
  const y0 = clamp(Math.floor(Math.min(...pts.map((p) => p.y))), 0, doc.height), y1 = clamp(Math.ceil(Math.max(...pts.map((p) => p.y))), 0, doc.height);
  if (x1 <= x0 || y1 <= y0) return c;
  const rs = Math.min(1, s * 1.2);        // 縮める時はその大きさで合成（速い）、拡大する時は原寸
  const R = renderRegion(doc, { x: x0, y: y0, w: x1 - x0, h: y1 - y0, scale: rs, opts: { frame: f, exportMode: true, preview: false } });
  g.save();
  g.translate(W / 2, H / 2); g.rotate(-cam.r); g.scale(s, s); g.translate(-cam.cx, -cam.cy);
  g.imageSmoothingQuality = 'high';
  g.drawImage(R, x0, y0, x1 - x0, y1 - y0);
  g.restore();
  return c;
}
/* フレームの見た目が同じかどうかの鍵（同じなら描き直さない） */
function frameKey(doc, f) {
  const cam = camAt(doc, f);
  return animFolders(doc).map((L) => celAt(L, f)).join(',') + '|' + [cam.cx, cam.cy, cam.s, cam.r].map((v) => v.toFixed(3)).join(',');
}

const AnimOps = {
  nextCelName(L) { let n = 1; const names = new Set(L.children.map((c) => c.name)); while (names.has(String(n))) n++; return String(n); },
  /* アニメーションフォルダー（セル「1」入り）を作る */
  newFolder(app) {
    const doc = app.doc, A = ensureAnim(doc);
    const f = new Layer('folder', LayerOps.nextName(doc, 'アニメーション'));
    f.blend = 'normal'; f.anim = true;
    const cel = new Layer('raster', '1');
    f.children.push(cel);
    f.timing = [{ f: A.cur, cel: cel.id }];
    doc.structEdit('アニメーションフォルダー', () => { LayerOps.placeNew(doc, f); doc.activeId = cel.id; });
    doc.metaDirty = true;
    return f;
  },
  /* 作業中のアニメーションフォルダー（作業レイヤーが入っている所、無ければ一番上） */
  activeFolder(doc) {
    for (let l = doc.active; l && l !== doc.root; l = doc.parentOf(l)) if (l.anim) return l;
    const all = animFolders(doc);
    return all.length ? all[all.length - 1] : null;
  },
  setKey(doc, L, f, celId, label = 'セルの指定') {
    const t = (L.timing || []).filter((k) => k.f !== f);
    t.push({ f, cel: celId });
    t.sort((a, b) => a.f - b.f);
    doc.setProps(L, { timing: t }, label);
  },
  removeKey(doc, L, f) { doc.setProps(L, { timing: (L.timing || []).filter((k) => k.f !== f) }, 'キーを消す'); },
  /* 新しいセルを作って f フレーム目に置く */
  newCel(app, L, f) {
    const doc = app.doc;
    const cel = new Layer('raster', this.nextCelName(L));
    doc.history.begin();
    doc.structEdit('新しいセル', () => { L.children.push(cel); doc.activeId = cel.id; });
    this.setKey(doc, L, f, cel.id, '新しいセル');
    doc.history.end('新しいセル');
    return cel;
  },
  /* 次の絵: いまの位置からコマ打ちの数だけ進めて新しいセル */
  nextDrawing(app) {
    const doc = app.doc, A = ensureAnim(doc);
    let L = this.activeFolder(doc);
    if (!L) { L = this.newFolder(app); return; }
    const k = keyIndexAt(L, A.cur);
    const f = k >= 0 && L.timing[k].f === A.cur ? A.cur + A.hold : A.cur;
    if (f >= A.frames) { A.frames = f + 1; doc.metaDirty = true; }
    this.newCel(app, L, f);
    app.setFrame(f);
  },
  /* フレームに合わせて、作業レイヤーをそのフレームのセルにする */
  followFrame(doc) {
    const L = this.activeFolder(doc);
    if (!L) return;
    const id = celAt(L, doc.anim.cur);
    if (id != null && doc.find(id)) doc.activeId = id;
  },
};
