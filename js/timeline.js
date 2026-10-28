'use strict';
/* タイムライン（画面下のパネル）・再生（プレーヤー）・カメラの操作 */

const TL_CW = 26, TL_HEAD = 22, TL_ROW = 30, TL_CAM = 24;

class Timeline {
  constructor(app) {
    this.app = app;
    this.open = false;
    this.root = el('div', { id: 'timeline', class: 'timeline', hidden: true });
    const b = (label, title, fn, cls = '') => el('button', { class: 'tl-b ' + cls, title, onclick: fn }, label);
    this.playBtn = b('▶', '再生（プレーヤーで見る）', () => this.app.player.show());
    this.frameLbl = el('span', { class: 'tl-frame' });
    this.fpsSel = el('select', { class: 'sel mini-sel', title: '1秒のフレーム数' }, ...[6, 8, 12, 15, 24, 30].map((v) => el('option', { value: v }, v + 'fps')));
    this.fpsSel.addEventListener('change', () => { this.anim.fps = +this.fpsSel.value; this.dirty(); });
    this.lenIn = el('input', { type: 'number', class: 'inp mini-num', min: 1, max: 3000, title: '長さ（フレーム）' });
    this.lenIn.addEventListener('change', () => { this.anim.frames = clamp(Math.round(+this.lenIn.value || 1), 1, 3000); if (this.anim.cur >= this.anim.frames) this.app.setFrame(this.anim.frames - 1); this.dirty(); });
    this.holdSel = el('select', { class: 'sel mini-sel', title: 'コマ打ち（次の絵を何フレーム後に置くか）' }, ...[1, 2, 3, 4].map((v) => el('option', { value: v }, `${v}コマ`)));
    this.holdSel.addEventListener('change', () => { this.anim.hold = +this.holdSel.value; this.dirty(); });
    this.onionBtn = b('オニオン', 'オニオンスキン（前後のセルを薄く表示）', () => { const o = this.anim.onion; o.on = !o.on; this.app.doc.invalidateAll(); this.dirty(); }, 'tog2');
    this.camBtn = b('カメラ', 'カメラワークを編集（枠を動かすと、このフレームにキーを打ちます）', () => this.app.toggleCamera(), 'tog2');
    const bar = el('div', { class: 'tl-bar' },
      this.playBtn,
      b('|◀', '最初のフレーム', () => this.app.setFrame(0)),
      b('◀', '前のフレーム（,）', () => this.app.setFrame(this.anim.cur - 1)),
      this.frameLbl,
      b('▶', '次のフレーム（.）', () => this.app.setFrame(this.anim.cur + 1)),
      b('▶|', '最後のフレーム', () => this.app.setFrame(this.anim.frames - 1)),
      this.fpsSel, el('span', { class: 'tl-lbl' }, '長さ'), this.lenIn, this.holdSel, this.onionBtn, this.camBtn,
      b('＋次の絵', '次の絵（コマ打ちの数だけ進めて新しいセル）⇧.', () => AnimOps.nextDrawing(this.app), 'acc'),
      b('＋アニメフォルダー', '新しいアニメーションフォルダー', () => { AnimOps.newFolder(this.app); this.render(); }),
      b('書き出し', '動画（MP4）・GIF・連番 PNG', () => VideoExport.dialog(this.app)),
      el('span', { class: 'tb-gap' }),
      b('✕', 'タイムラインを閉じる', () => this.toggle(false)));
    this.names = el('div', { class: 'tl-names' });
    this.canvas = el('canvas', { class: 'tl-grid' });
    this.scroll = el('div', { class: 'tl-scroll' }, this.canvas);
    this.root.append(bar, el('div', { class: 'tl-body' }, this.names, this.scroll));
    $('#viewport').append(this.root);
    this.bindGrid();
  }
  get anim() { return ensureAnim(this.app.doc); }
  dirty() { this.app.doc.metaDirty = true; this.app.scheduleSave(); this.render(); }
  toggle(on = !this.open) {
    this.open = on && !!this.app.doc;
    this.root.hidden = !this.open;
    $('#viewport').classList.toggle('with-tl', this.open);
    if (this.open) { ensureAnim(this.app.doc); this.render(); this.scrollToCur(); }
    else if (this.app.cameraEdit) this.app.toggleCamera(false);
  }
  tracks() { return animFolders(this.app.doc).reverse(); }      // 上のフォルダーを上に
  render() {
    if (!this.open || !this.app.doc) return;
    const A = this.anim, doc = this.app.doc, tracks = this.tracks();
    this.frameLbl.textContent = `${A.cur + 1} / ${A.frames}`;
    this.fpsSel.value = A.fps; this.lenIn.value = A.frames; this.holdSel.value = A.hold;
    this.onionBtn.classList.toggle('on', A.onion.on);
    this.camBtn.classList.toggle('on', !!this.app.cameraEdit);
    // 名前の列
    this.names.innerHTML = '';
    this.names.append(el('div', { class: 'tl-name head' }, `${(A.cur / A.fps).toFixed(2)} 秒`));
    const act = AnimOps.activeFolder(doc);
    for (const L of tracks) this.names.append(el('div', { class: 'tl-name' + (L === act ? ' on' : ''), onclick: () => { const id = celAt(L, A.cur) ?? (L.children[0] && L.children[0].id); if (id != null) { doc.activeId = id; this.app.onActiveChanged(); } this.render(); } }, L.name));
    this.names.append(el('div', { class: 'tl-name cam' }, 'カメラ'));
    if (!tracks.length) this.names.append(el('div', { class: 'tl-name hint2' }, '「＋アニメフォルダー」から'));
    // 格子
    const W = A.frames * TL_CW, H = TL_HEAD + tracks.length * TL_ROW + TL_CAM, dpr = window.devicePixelRatio || 1;
    const c = this.canvas;
    c.style.width = W + 'px'; c.style.height = H + 'px';
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#1d1e21'; g.fillRect(0, 0, W, H);
    g.font = '10px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let f = 0; f < A.frames; f++) {
      const x = f * TL_CW;
      if (f === A.cur) { g.fillStyle = 'rgba(77,163,255,.22)'; g.fillRect(x, 0, TL_CW, H); }
      g.fillStyle = f % A.fps === 0 ? '#5a5b62' : '#2c2d32';
      g.fillRect(x, 0, 1, H);
      g.fillStyle = f === A.cur ? '#fff' : f % A.fps === 0 ? '#ccc' : '#777';
      if (f % (A.fps >= 24 ? 2 : 1) === 0 || f === A.cur) g.fillText(String(f + 1), x + TL_CW / 2, TL_HEAD / 2);
    }
    tracks.forEach((L, r) => {
      const y = TL_HEAD + r * TL_ROW, t = L.timing || [];
      g.fillStyle = '#26272b'; g.fillRect(0, y + TL_ROW - 1, W, 1);
      t.forEach((k, i) => {
        const end = i + 1 < t.length ? t[i + 1].f : A.frames;
        const x0 = k.f * TL_CW, x1 = Math.min(end, A.frames) * TL_CW;
        if (k.cel == null) { g.fillStyle = '#888'; g.fillText('×', x0 + TL_CW / 2, y + TL_ROW / 2); return; }
        const cel = L.children.find((c2) => c2.id === k.cel);
        g.fillStyle = cel && cel.id === doc.activeId ? '#3c79c9' : '#3a4f6e';
        g.fillRect(x0 + 1, y + 4, x1 - x0 - 2, TL_ROW - 8);
        g.fillStyle = '#9ec5ff'; g.fillRect(x0 + 1, y + 4, 3, TL_ROW - 8);
        g.fillStyle = '#fff'; g.textAlign = 'left';
        g.fillText(cel ? cel.name : '?', x0 + 7, y + TL_ROW / 2);
        g.textAlign = 'center';
        if (L.lightTable && L.lightTable.includes(k.cel)) { g.fillStyle = '#f0c36b'; g.fillRect(x0 + 1, y + TL_ROW - 7, x1 - x0 - 2, 2); }
      });
    });
    // カメラのキー
    const cy = TL_HEAD + tracks.length * TL_ROW + TL_CAM / 2;
    g.fillStyle = '#f39ac8';
    for (const k of doc.camera || []) { const x = k.f * TL_CW + TL_CW / 2; g.beginPath(); g.moveTo(x, cy - 6); g.lineTo(x + 6, cy); g.lineTo(x, cy + 6); g.lineTo(x - 6, cy); g.closePath(); g.fill(); }
  }
  scrollToCur() { const x = this.anim.cur * TL_CW; const s = this.scroll; if (x < s.scrollLeft || x > s.scrollLeft + s.clientWidth - TL_CW) s.scrollLeft = Math.max(0, x - s.clientWidth / 2); }
  bindGrid() {
    let drag = null;
    const at = (e) => { const r = this.canvas.getBoundingClientRect(); return { f: Math.floor((e.clientX - r.left) / TL_CW), y: e.clientY - r.top, cx: e.clientX, cy: e.clientY }; };
    this.canvas.addEventListener('pointerdown', (e) => {
      const p = at(e);
      drag = { ...p, moved: false };
      if (p.y < TL_HEAD) { this.canvas.setPointerCapture(e.pointerId); this.app.setFrame(p.f); }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = at(e);
      if (drag.y < TL_HEAD && p.f !== this.anim.cur) { drag.moved = true; this.app.setFrame(p.f); }
    });
    this.canvas.addEventListener('pointerup', (e) => {
      const d0 = drag; drag = null;
      if (!d0 || d0.y < TL_HEAD) return;
      const p = at(e);
      if (Math.abs(p.cx - d0.cx) > 8) return;      // 横に送っただけ
      this.app.setFrame(p.f);
      const tracks = this.tracks(), r = Math.floor((p.y - TL_HEAD) / TL_ROW);
      if (r >= 0 && r < tracks.length) this.cellMenu(tracks[r], p.f, e);
      else if (p.y >= TL_HEAD + tracks.length * TL_ROW) this.camMenu(p.f, e);
    });
  }
  cellMenu(L, f, e) {
    const app = this.app, doc = app.doc;
    const anchor = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY - 4, bottom: e.clientY - 4 }) };
    const k = (L.timing || []).find((x) => x.f === f), cur = celAt(L, f);
    const items = L.children.map((c) => [`セル「${c.name}」${c.id === cur ? ' ✓' : ''}`, () => { AnimOps.setKey(doc, L, f, c.id); doc.activeId = c.id; app.onActiveChanged(); app.setFrame(f); }]);
    items.push('-', ['空セル（何も出さない）', () => { AnimOps.setKey(doc, L, f, null); app.setFrame(f); }],
      ['新しいセルをここに', () => { AnimOps.newCel(app, L, f); app.setFrame(f); }]);
    if (k) items.push(['このキーを消す', () => { AnimOps.removeKey(doc, L, f); app.setFrame(f); }, 'danger']);
    if (cur != null) {
      const on = L.lightTable && L.lightTable.includes(cur);
      items.push('-', [on ? 'ライトテーブルから外す' : 'ライトテーブルに入れる（いつも薄く表示）', () => {
        const lt = (L.lightTable || []).filter((x) => x !== cur); if (!on) lt.push(cur);
        doc.setProps(L, { lightTable: lt }, 'ライトテーブル');
      }]);
    }
    app.popup(anchor, items);
  }
  camMenu(f, e) {
    const app = this.app, doc = app.doc;
    const anchor = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY - 4, bottom: e.clientY - 4 }) };
    const has = (doc.camera || []).some((k) => k.f === f);
    app.popup(anchor, [
      ['このフレームにカメラのキーを打つ', () => { setCamKey(doc, f, camAt(doc, f)); this.dirty(); app.view.request(); }],
      ...(has ? [['このキーを消す', () => { doc.camera = doc.camera.filter((k) => k.f !== f); this.dirty(); app.view.request(); }, 'danger']] : []),
      ['カメラのキーを全部消す', () => { doc.camera = []; this.dirty(); app.view.request(); }],
      ['カメラを編集する', () => app.toggleCamera(true)],
    ]);
  }
}

/* カメラの枠: 中をドラッグで移動、角で拡大縮小、上の丸で回転。離すと今のフレームにキー */
class CameraTool {
  constructor(app) { this.app = app; this.st = null; }
  frame() {
    const doc = this.app.doc, A = doc.anim, c = camAt(doc, A.cur);
    const hw = A.outW / 2 / c.s, hh = A.outH / 2 / c.s, cs = Math.cos(c.r), sn = Math.sin(c.r);
    const P = (x, y) => ({ x: c.cx + x * cs - y * sn, y: c.cy + x * sn + y * cs });
    return { c, pts: [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)], top: P(0, -hh - 40 / this.app.view.s) };
  }
  down(p) {
    const v = this.app.view, F = this.frame(), sp = v.toScreen(p.x, p.y);
    const near = (q) => { const s = v.toScreen(q.x, q.y); return Math.hypot(s.x - sp.x, s.y - sp.y) < 24; };
    let mode = 'move';
    if (near(F.top)) mode = 'rot';
    else if (F.pts.some(near)) mode = 'scale';
    this.st = { mode, p0: p, c0: { ...F.c } };
  }
  move(p) {
    const st = this.st;
    if (!st) return;
    const c0 = st.c0, c = { ...c0 };
    if (st.mode === 'move') { c.cx = c0.cx + (p.x - st.p0.x); c.cy = c0.cy + (p.y - st.p0.y); }
    else if (st.mode === 'scale') {
      const d0 = Math.hypot(st.p0.x - c0.cx, st.p0.y - c0.cy), d1 = Math.hypot(p.x - c0.cx, p.y - c0.cy);
      c.s = clamp(c0.s * (d0 / Math.max(1, d1)), 0.02, 50);
    } else {
      c.r = c0.r + Math.atan2(p.y - c0.cy, p.x - c0.cx) - Math.atan2(st.p0.y - c0.cy, st.p0.x - c0.cx);
      if (p.shift) c.r = Math.round(c.r / (Math.PI / 12)) * (Math.PI / 12);
    }
    this.live = c;
    setCamKey(this.app.doc, this.app.doc.anim.cur, c);
    this.app.view.request();
  }
  up() {
    this.st = null;
    this.app.timeline.dirty();
  }
  cancel() { this.st = null; }
  drawOverlay(g, view) {
    const doc = this.app.doc;
    if (!doc || !doc.anim) return;
    const F = this.frame(), pts = F.pts.map((q) => view.toScreen(q.x, q.y)), top = view.toScreen(F.top.x, F.top.y);
    g.save();
    // 枠の外を暗く
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.rect(0, 0, view.cssW, view.cssH);
    pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath();
    g.fill('evenodd');
    g.strokeStyle = '#f39ac8'; g.lineWidth = 2;
    g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath(); g.stroke();
    const mt = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    g.beginPath(); g.moveTo(mt.x, mt.y); g.lineTo(top.x, top.y); g.stroke();
    g.fillStyle = '#f39ac8';
    for (const q of pts) { g.fillRect(q.x - 6, q.y - 6, 12, 12); }
    g.beginPath(); g.arc(top.x, top.y, 7, 0, Math.PI * 2); g.fill();
    g.font = '12px sans-serif'; g.fillText(`カメラ ${doc.anim.cur + 1}F`, pts[0].x + 6, pts[0].y + 16);
    g.restore();
  }
}

/* 再生: 先にフレームを作っておいてから流す（同じ見た目のフレームは1回だけ作る） */
class Player {
  constructor(app) {
    this.app = app;
    this.root = el('div', { class: 'player', hidden: true });
    this.cv = el('canvas', { class: 'player-cv' });
    this.info = el('span', { class: 'player-info' });
    this.loop = true;
    const loopBtn = el('button', { class: 'tl-b tog2 on', onclick: () => { this.loop = !this.loop; loopBtn.classList.toggle('on', this.loop); } }, 'くり返し');
    this.root.append(this.cv, el('div', { class: 'player-bar' }, el('button', { class: 'tl-b', onclick: () => this.restart() }, '最初から'), loopBtn, this.info, el('button', { class: 'btn small', onclick: () => this.hide() }, '閉じる')));
    this.root.addEventListener('pointerdown', (e) => { if (e.target === this.root) this.hide(); });
    document.body.append(this.root);
  }
  async show() {
    const app = this.app, doc = app.doc;
    if (!doc) return;
    const A = ensureAnim(doc);
    const k = Math.min(1, 960 / Math.max(A.outW, A.outH));
    app.busy('フレームを準備しています…');
    const cache = new Map();
    this.frames = [];
    try {
      for (let f = 0; f < A.frames; f++) {
        const key = frameKey(doc, f);
        if (!cache.has(key)) cache.set(key, renderFrame(doc, f, k));
        this.frames.push(cache.get(key));
        if (f % 8 === 7) { app.busy(`フレームを準備しています… ${f + 1} / ${A.frames}`); await new Promise((r) => setTimeout(r, 0)); }
      }
    } finally { app.busy(null); }
    this.cv.width = this.frames[0].width; this.cv.height = this.frames[0].height;
    this.root.hidden = false;
    this.fps = A.fps;
    this.distinct = cache.size;
    this.restart();
  }
  restart() {
    cancelAnimationFrame(this._raf);
    const t0 = performance.now(), n = this.frames.length;
    let last = -1;
    const tick = () => {
      let f = Math.floor(((performance.now() - t0) / 1000) * this.fps);
      if (f >= n) { if (this.loop) { this.restart(); return; } f = n - 1; }
      if (f !== last) {
        last = f;
        this.cv.getContext('2d').drawImage(this.frames[f], 0, 0);
        this.info.textContent = `${f + 1} / ${n}（${this.fps}fps・絵 ${this.distinct} 枚）`;
      }
      if (f < n - 1 || this.loop) this._raf = requestAnimationFrame(tick);
    };
    tick();
  }
  hide() { cancelAnimationFrame(this._raf); this.root.hidden = true; this.frames = null; }
}
