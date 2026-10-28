'use strict';
/* 効率化: コマンドの登録・クイックアクセス・オートアクション・ショートカット設定・素材・タイムラプス・作業時間 */

/* ================= コマンド =================
   メニューの項目 = コマンド。id = 'メニュー名:項目名'（項目名は表示の文字。後ろのチェック印などは除く）。道具は 'tool:pen'、サブツールは 'sub:gpen' */
const MENU_TITLES = { file: 'ファイル', edit: '編集', layer: 'レイヤー', select: '選択範囲', adjust: '色調補正', filter: 'フィルター', manga: 'マンガ', view: '表示' };
const Commands = {
  list(app) {
    const out = [], menus = app.menus();
    for (const [g, items] of Object.entries(menus)) for (const it of items) {
      if (it === '-') continue;
      out.push({ id: `${g}:${it[0]}`, label: it[0], group: MENU_TITLES[g] || g, run: it[1] });
    }
    for (const t of TOOL_DEFS) out.push({ id: 'tool:' + t.id, label: t.name, group: '道具', run: () => app.setTool(t.id) });
    return out;
  },
  find(app, id) {
    if (id.startsWith('sub:')) {
      const sid = id.slice(4), s = subtoolById(sid);
      return s ? { id, label: s.name, run: () => { app.setTool(s.tool); app.setSubtool(sid); } } : null;
    }
    return this.list(app).find((c) => c.id === id) || null;
  },
  async run(app, id) {
    const c = this.find(app, id);
    if (!c) { toast('見つからないコマンドです: ' + id, { error: true }); return false; }
    if (AutoActions.recording && !id.startsWith('action:')) AutoActions.recording.steps.push(id);
    await c.run();
    return true;
  },
};

/* ================= クイックアクセス =================
   画面の端に出す自分用のボタン。項目 = {type: 'sub'|'color'|'cmd'|'action', v} */
class QuickAccess {
  constructor(app) {
    this.app = app;
    this.items = loadLS('quick', [{ type: 'sub', v: 'gpen' }, { type: 'sub', v: 'erhard' }, { type: 'color', v: '#000000' }, { type: 'color', v: '#ffffff' }, { type: 'cmd', v: 'edit:拡大・縮小・回転' }, { type: 'cmd', v: 'select:選択を解除' }]);
    this.root = el('div', { id: 'quickaccess', class: 'qa', hidden: true });
    $('#viewport').append(this.root);
    this.render();
  }
  save() { saveLS('quick', this.items); }
  toggle(on = this.root.hidden) { this.root.hidden = !on; this.app.settings.quickAccess = on; this.app.saveSettings(); }
  label(it) {
    if (it.type === 'sub') { const s = subtoolById(it.v); return s ? s.name : '?'; }
    if (it.type === 'cmd') return it.v.split(':').slice(1).join(':').replace(/（.*$/, '').slice(0, 8);
    if (it.type === 'action') { const a = AutoActions.list.find((x) => x.id === it.v); return '▶' + (a ? a.name : '?').slice(0, 6); }
    return '';
  }
  render() {
    const R = this.root;
    R.innerHTML = '';
    this.items.forEach((it, i) => {
      const b = el('button', { class: 'qa-b' + (it.type === 'color' ? ' color' : ''), title: it.type === 'cmd' ? it.v.replace(':', ' → ') : this.label(it) });
      if (it.type === 'color') b.style.background = it.v; else b.textContent = this.label(it);
      let hold = 0;
      b.addEventListener('pointerdown', () => { hold = setTimeout(() => { hold = -1; this.itemMenu(i, b); }, 600); });
      b.addEventListener('pointerup', () => { if (hold !== -1) { clearTimeout(hold); this.use(it); } hold = 0; });
      b.addEventListener('pointerleave', () => { if (hold > 0) clearTimeout(hold); });
      R.append(b);
    });
    R.append(el('button', { class: 'qa-b add', title: '追加', onclick: () => this.addDialog() }, '＋'));
  }
  async use(it) {
    const app = this.app;
    if (it.type === 'color') { app.color.setMain(it.v); app.color.commitHistory(); return; }
    if (it.type === 'sub') { await Commands.run(app, 'sub:' + it.v); return; }
    if (it.type === 'cmd') { await Commands.run(app, it.v); return; }
    if (it.type === 'action') AutoActions.play(app, it.v);
  }
  itemMenu(i, anchor) {
    this.app.popup(anchor, [
      ['前へ', () => { if (i > 0) { [this.items[i - 1], this.items[i]] = [this.items[i], this.items[i - 1]]; this.save(); this.render(); } }],
      ['後ろへ', () => { if (i < this.items.length - 1) { [this.items[i + 1], this.items[i]] = [this.items[i], this.items[i + 1]]; this.save(); this.render(); } }],
      ['外す', () => { this.items.splice(i, 1); this.save(); this.render(); }, 'danger'],
    ]);
  }
  async addDialog() {
    const app = this.app;
    const tabs = [['sub', 'サブツール'], ['color', 'いまの色'], ['cmd', 'コマンド'], ['action', 'オートアクション']];
    const list = el('div', { class: 'pick-list' });
    let tab = 'sub';
    const fill = () => {
      list.innerHTML = '';
      const add = (it, label) => list.append(el('button', { class: 'preset', onclick: () => { this.items.push(it); this.save(); this.render(); toast('追加しました', { ms: 800 }); } }, label));
      if (tab === 'sub') for (const s of SUBTOOLS) add({ type: 'sub', v: s.id }, `${TOOL_DEFS.find((t) => t.id === s.tool).name} › ${s.name}`);
      else if (tab === 'color') add({ type: 'color', v: app.color.main }, `メインカラー ${app.color.main}`);
      else if (tab === 'cmd') { let g = ''; for (const c of Commands.list(app)) { if (c.group !== g) { g = c.group; list.append(el('div', { class: 'preset-g' }, g)); } add({ type: 'cmd', v: c.id }, c.label); } }
      else { if (!AutoActions.list.length) list.append(el('p', { class: 'hint' }, 'オートアクションがまだありません（表示 → オートアクション で記録）')); for (const a of AutoActions.list) add({ type: 'action', v: a.id }, '▶ ' + a.name); }
    };
    const seg = el('div', { class: 'seg' }, ...tabs.map(([v, t]) => el('button', { class: v === tab ? 'on' : '', onclick: (e) => { tab = v; for (const x of seg.children) x.classList.remove('on'); e.target.classList.add('on'); fill(); } }, t)));
    fill();
    await modal({ title: 'クイックアクセスに追加', body: el('div', {}, seg, list), wide: true, buttons: [{ label: '閉じる', value: true, primary: true }] });
  }
}

/* ================= オートアクション =================
   記録中に実行したコマンド（メニュー・道具・クイックアクセス）を順に覚え、まとめて実行する */
const AutoActions = {
  list: loadLS('actions', []),
  recording: null,
  save() { saveLS('actions', this.list); },
  start(app) {
    this.recording = { steps: [] };
    $('#recBadge').hidden = false;
    toast('記録しています。メニューの操作を順に行い、上の「● 記録中」を押すと終わります', { ms: 3500 });
  },
  async stop(app) {
    const rec = this.recording;
    this.recording = null;
    $('#recBadge').hidden = true;
    if (!rec || !rec.steps.length) { toast('何も記録されませんでした'); return; }
    const name = await promptBox('オートアクションの名前', `アクション ${this.list.length + 1}`, rec.steps.map((s) => s.replace(':', ' › ')).join(' → '));
    if (!name) return;
    this.list.push({ id: 'a' + Date.now().toString(36), name, steps: rec.steps });
    this.save();
    toast('保存しました（クイックアクセスにも置けます）');
  },
  async play(app, id) {
    const a = this.list.find((x) => x.id === id);
    if (!a) return;
    for (const s of a.steps) {
      const ok = await Commands.run(app, s);
      if (!ok) return;
      await new Promise((r) => setTimeout(r, 30));
      // ダイアログが開いたら閉じるまで待つ（設定を選ぶ操作など）
      while (document.querySelector('.modal-back') || app.adjustPanel.open || app.transforming) await new Promise((r) => setTimeout(r, 200));
    }
    toast(`「${a.name}」を実行しました`, { ms: 1200 });
  },
  async dialog(app) {
    const body = el('div', {});
    const render = () => {
      body.innerHTML = '';
      if (!this.list.length) body.append(el('p', { class: 'hint' }, 'まだありません。「記録を始める」を押して、メニューの操作（例: 新規ラスターレイヤー → 描画モード… → トーンを貼る）を順に行います。'));
      for (const a of this.list) {
        body.append(el('div', { class: 'act-row' },
          el('div', { class: 'act-name' }, el('b', {}, a.name), el('div', { class: 'hint' }, a.steps.map((s) => s.split(':').slice(1).join(':')).join(' → '))),
          el('button', { class: 'btn small', onclick: () => { document.querySelector('.modal-back').remove(); this.play(app, a.id); } }, '▶ 実行'),
          el('button', { class: 'btn small danger', onclick: () => { this.list = this.list.filter((x) => x !== a); this.save(); render(); } }, '削除')));
      }
    };
    render();
    const r = await modal({ title: 'オートアクション', body, wide: true, buttons: [{ label: '閉じる', value: false }, { label: '● 記録を始める', value: 'rec', primary: true }] });
    if (r === 'rec') this.start(app);
  },
};

/* ================= ショートカット設定 =================
   settings.keymap = {'mod+shift+k': 'コマンドの id'}。初めからのキーより先に見る */
function keyCombo(e) {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (['control', 'meta', 'shift', 'alt'].includes(k)) return null;
  return [(e.ctrlKey || e.metaKey) && 'mod', e.altKey && 'alt', e.shiftKey && 'shift', k].filter(Boolean).join('+');
}
const comboLabel = (c) => c.replace('mod', '⌘').replace('shift', '⇧').replace('alt', '⌥').replace(/\+/g, '').toUpperCase();
async function keymapDialog(app) {
  const km = app.settings.keymap || (app.settings.keymap = {});
  const body = el('div', { class: 'pick-list tall' });
  let waiting = null;
  const render = () => {
    body.innerHTML = '';
    body.append(el('p', { class: 'hint' }, '項目を押してから、割り当てるキーを押します（Esc で取り消し、Delete で外す）。初めからのショートカットより優先されます。'));
    let g = '';
    for (const c of Commands.list(app)) {
      if (c.group !== g) { g = c.group; body.append(el('div', { class: 'preset-g' }, g)); }
      const keys = Object.entries(km).filter(([, v]) => v === c.id).map(([k]) => comboLabel(k));
      body.append(el('button', { class: 'preset km' + (waiting === c.id ? ' on' : ''), onclick: () => { waiting = c.id; render(); } }, el('span', {}, c.label), el('span', { class: 'kbd' }, waiting === c.id ? 'キーを押してください…' : keys.join(' '))));
    }
  };
  const onKey = (e) => {
    if (!waiting) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { waiting = null; render(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { for (const [k, v] of Object.entries(km)) if (v === waiting) delete km[k]; }
    else { const c = keyCombo(e); if (!c) return; km[c] = waiting; }
    waiting = null; app.saveSettings(); render();
  };
  document.addEventListener('keydown', onKey, true);
  render();
  await modal({ title: 'ショートカット設定', body, wide: true, buttons: [{ label: 'すべて初めに戻す', value: 'reset' }, { label: '閉じる', value: true, primary: true }] }).then((r) => { if (r === 'reset') { app.settings.keymap = {}; app.saveSettings(); toast('初めのショートカットに戻しました'); } });
  document.removeEventListener('keydown', onKey, true);
}

/* ================= 素材 =================
   自分の素材（作業レイヤー・選択範囲の絵）は IndexedDB の materials に。入っている素材: トーン・パターン */
const PATTERNS = [
  ['ichimatsu', '市松', (g, S) => { g.fillRect(0, 0, S / 2, S / 2); g.fillRect(S / 2, S / 2, S / 2, S / 2); }],
  ['stripe', 'ストライプ', (g, S) => { for (let i = -2; i < 4; i++) { g.beginPath(); g.moveTo(i * S / 2, 0); g.lineTo(i * S / 2 + S / 4, 0); g.lineTo(i * S / 2 + S / 4 + S, S); g.lineTo(i * S / 2 + S, S); g.closePath(); g.fill(); } }],
  ['dot', '水玉', (g, S) => { const r = S * 0.16; for (const [x, y] of [[S / 4, S / 4], [S * 3 / 4, S * 3 / 4]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); } }],
  ['seigaiha', '青海波', (g, S) => {
    const R = S / 2; g.lineWidth = S / 40;
    for (const [cx, cy] of [[0, S / 2], [S, S / 2], [S / 2, S], [0, S * 1.5], [S, S * 1.5], [S / 2, 0], [-S / 2, S], [S * 1.5, S]]) for (let k = 4; k >= 1; k--) {
      g.beginPath(); g.arc(cx, cy, (R * k) / 4, Math.PI, 0); g.strokeStyle = g.fillStyle; g.stroke();
    }
  }],
  ['grid', '格子', (g, S) => { g.fillRect(0, 0, S, S / 16); g.fillRect(0, 0, S / 16, S); }],
  ['asanoha', '麻の葉', (g, S) => {
    g.lineWidth = S / 64; g.strokeStyle = g.fillStyle;
    const h = S / 2, pts = [[0, 0], [S, 0], [0, S], [S, S], [h, h]];
    for (const [x, y] of pts) for (let a = 0; a < 6; a++) { const t = (a * Math.PI) / 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(t) * h * 0.58, y + Math.sin(t) * h * 0.58); g.stroke(); }
    for (let y = 0; y <= S; y += h) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  }],
];
const TONE_MATERIALS = [10, 20, 30, 50, 70].map((d) => ({ name: `トーン ${d}%（60線）`, d }));

const Materials = {
  async listUser() { return Store.tx(['materials'], 'readonly', (m) => Store.req(m.getAll())).then((p) => p); },
  async addFromLayer(app) {
    const doc = app.doc, a = doc && doc.active;
    if (!a || !a.hasTiles) { toast('描いてあるレイヤーを選んでください'); return; }
    const r = contentBounds(a.tiles, doc.sel ? doc.sel.bounds : null);
    if (!r) { toast('描いてある所がありません'); return; }
    const k = Math.min(1, 4096 / Math.max(r.w, r.h));
    const c = newCanvas(Math.round(r.w * k), Math.round(r.h * k)), g = ctx2d(c);
    const t = newCanvas(TILE, TILE), tg = ctx2d(t);
    for (const [tx, ty, key] of doc.gridKeys(r)) {
      const tile = a.tiles.get(key);
      if (!tile) continue;
      tg.globalCompositeOperation = 'copy'; tg.drawImage(tile, 0, 0);
      if (doc.sel) { const s = doc.sel.tiles.get(key); tg.globalCompositeOperation = 'destination-in'; if (s) tg.drawImage(s, 0, 0); else tg.clearRect(0, 0, TILE, TILE); }
      tg.globalCompositeOperation = 'source-over';
      g.drawImage(t, (tx * TILE - r.x) * k, (ty * TILE - r.y) * k, TILE * k, TILE * k);
    }
    const name = await promptBox('素材の名前', a.name);
    if (!name) return;
    const png = await (await canvasToBlob(c)).arrayBuffer();
    const s = Math.min(1, 160 / Math.max(c.width, c.height)), th = newCanvas(Math.max(1, Math.round(c.width * s)), Math.max(1, Math.round(c.height * s)));
    ctx2d(th).drawImage(c, 0, 0, th.width, th.height);
    const thumb = await (await canvasToBlob(th)).arrayBuffer();
    await Store.tx(['materials'], 'readwrite', (m) => m.put({ id: 'm' + Date.now().toString(36), name, w: r.w, h: r.h, dpi: doc.dpi, png, thumb, created: Date.now() }));
    toast('素材に保存しました（右パネルの「素材」）');
    app.matPanel.render();
  },
  async place(app, m) {
    const doc = app.doc;
    if (!doc) return;
    const bmp = await blobToBitmap(new Blob([m.png], { type: 'image/png' }));
    // 解像度が違えば大きさを合わせる
    let k = m.dpi && doc.dpi ? doc.dpi / m.dpi : 1;
    k = Math.min(k, doc.width / bmp.width, doc.height / bmp.height);
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const c = app.view.toDocLocal(app.view.cssW / 2, app.view.cssH / 2);
    const x = Math.round(clamp(c.x - w / 2, 0, doc.width - w)), y = Math.round(clamp(c.y - h / 2, 0, doc.height - h));
    const l = new Layer('raster', m.name);
    drawImageToLayer(doc, l, bmp, x, y, w, h);
    doc.structEdit('素材を貼る', () => { LayerOps.placeNew(doc, l); doc.activeId = l.id; });
    app.startTransform();
  },
  /* パターンを新しいレイヤーに（選択範囲があればその中） */
  pattern(app, id, scaleMm = 6) {
    const doc = app.doc, P = PATTERNS.find((p) => p[0] === id);
    const S = Math.max(8, Math.round((scaleMm / 25.4) * doc.dpi));
    const c = newCanvas(S, S), g = ctx2d(c);
    g.fillStyle = app.color.main; g.strokeStyle = app.color.main;
    P[2](g, S);
    const l = new Layer('raster', P[1]);
    doc.history.begin();
    doc.structEdit('パターン', () => { LayerOps.placeNew(doc, l); doc.activeId = l.id; });
    doc.beginStroke(l, {});
    for (const [tx, ty] of doc.gridKeys(doc.sel ? doc.sel.bounds : doc.fullRect)) {
      const tg = ctx2d(doc.strokeTile(tx, ty));
      const pat = tg.createPattern(c, 'repeat');
      pat.setTransform(new DOMMatrix().translate(-((tx * TILE) % S), -((ty * TILE) % S)));
      tg.fillStyle = pat; tg.fillRect(0, 0, TILE, TILE);
    }
    doc.commitStroke('パターン');
    doc.history.end('パターン');
  },
  /* トーン（選択範囲に、なければ全体に） */
  tone(app, d) {
    const doc = app.doc;
    const l = new Layer('raster', `トーン ${d}%`);
    l.tone = { ...TONE_DEFAULTS, ...(app.toolOpts.tone || {}) };
    doc.history.begin();
    doc.structEdit('トーン', () => { LayerOps.placeNew(doc, l); doc.activeId = l.id; });
    doc.beginStroke(l, { opacity: d / 100 });
    for (const [tx, ty] of doc.gridKeys(doc.sel ? doc.sel.bounds : doc.fullRect)) { const g = ctx2d(doc.strokeTile(tx, ty)); g.fillStyle = '#000'; g.fillRect(0, 0, TILE, TILE); }
    doc.commitStroke('トーン');
    doc.history.end('トーン');
  },
};

class MaterialPanel {
  constructor(app) {
    this.app = app;
    this.root = $('#matpanel');
  }
  async render() {
    const app = this.app, R = this.root;
    if (!R || $('#rightpanel').dataset.focus !== 'materials') return;
    R.innerHTML = '';
    R.append(el('div', { class: 'mat-head' },
      el('button', { class: 'btn small', onclick: () => Materials.addFromLayer(app) }, '＋ 作業レイヤーを素材に'),
      el('p', { class: 'hint' }, '選択範囲があれば、その中だけを素材にします。素材を押すと新しいレイヤーに貼って、すぐ変形できます。')));
    const grid = (title) => { R.append(el('div', { class: 'sub-h' }, title)); const g = el('div', { class: 'mat-grid' }); R.append(g); return g; };
    const user = await Materials.listUser().catch(() => []);
    const gu = grid(`自分の素材（${user.length}）`);
    for (const m of user.sort((a, b) => b.created - a.created)) {
      const img = el('img', { alt: '' }); const u = URL.createObjectURL(new Blob([m.thumb], { type: 'image/png' })); img.src = u; img.onload = () => URL.revokeObjectURL(u);
      const card = el('button', { class: 'mat', title: m.name, onclick: () => app.doc && Materials.place(app, m) }, img, el('span', {}, m.name));
      let hold = 0;
      card.addEventListener('pointerdown', () => { hold = setTimeout(async () => { hold = -1; if (await confirmBox('素材', `「${m.name}」を削除しますか？`, '削除', true)) { await Store.tx(['materials'], 'readwrite', (s) => s.delete(m.id)); this.render(); } }, 650); });
      card.addEventListener('pointerup', () => { if (hold > 0) clearTimeout(hold); });
      card.addEventListener('click', (e) => { if (hold === -1) { e.stopImmediatePropagation(); hold = 0; } }, true);
      gu.append(card);
    }
    if (!user.length) gu.append(el('p', { class: 'hint' }, 'まだありません（長押しで削除）'));
    const gt = grid('トーン（選択範囲に貼る）');
    for (const t of TONE_MATERIALS) {
      const c = newCanvas(64, 64), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#000';
      const step = 6, r = Math.sqrt((t.d / 100) * step * step / Math.PI);
      for (let y = 0; y < 64; y += step) for (let x = (y / step) % 2 ? step / 2 : 0; x < 64; x += step) { g.beginPath(); g.arc(x, y, Math.min(r, step * 0.75), 0, Math.PI * 2); g.fill(); }
      gt.append(el('button', { class: 'mat', onclick: () => app.doc && Materials.tone(app, t.d) }, c, el('span', {}, t.name)));
    }
    const gp = grid('パターン（メインカラーで・選択範囲に）');
    for (const [id, name, draw] of PATTERNS) {
      const c = newCanvas(64, 64), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
      const t = newCanvas(32, 32), tg = t.getContext('2d'); tg.fillStyle = '#333'; tg.strokeStyle = '#333'; draw(tg, 32);
      g.fillStyle = g.createPattern(t, 'repeat'); g.fillRect(0, 0, 64, 64);
      gp.append(el('button', { class: 'mat', onclick: () => app.doc && Materials.pattern(app, id) }, c, el('span', {}, name)));
    }
  }
}

/* ================= タイムラプス・作業時間 ================= */
const Timelapse = {
  last: 0,
  /* 描いた後に呼ぶ（4秒に1回まで） */
  capture(app) {
    const doc = app.doc;
    if (!doc || !app.timelapseOn || !doc.pageId) return;
    const now = Date.now();
    if (now - this.last < 4000) { clearTimeout(this._t); this._t = setTimeout(() => this.capture(app), 4000 - (now - this.last)); return; }
    this.last = now;
    const s = Math.min(1, 720 / Math.max(doc.width, doc.height));
    const c = renderRegion(doc, { scale: s, opts: { exportMode: true, preview: false } });
    canvasToBlob(c, 'image/jpeg', 0.8).then((b) => b.arrayBuffer()).then((buf) =>
      Store.tx(['timelapse'], 'readwrite', (t) => t.put({ type: 'image/jpeg', buf }, `${doc.pageId}|${String(now).padStart(15, '0')}`))).catch(() => {});
  },
  async count(pid) { return Store.tx(['timelapse'], 'readonly', (t) => Store.req(t.count(IDBKeyRange.bound(`${pid}|`, `${pid}|￿`)))).then((p) => p); },
  async export(app) {
    const doc = app.doc;
    if (!doc || !doc.pageId) return;
    await app.saveNow();
    const pid = doc.pageId;
    const vals = await Store.tx(['timelapse'], 'readonly', (t) => Store.req(t.getAll(IDBKeyRange.bound(`${pid}|`, `${pid}|￿`)))).then((p) => p);
    if (!vals.length) { toast('記録がありません（ファイル → タイムラプスを記録する を入れてから描いてください）'); return; }
    app.busy('タイムラプスを作っています…');
    try {
      const first = await blobToBitmap(new Blob([vals[0].buf]));
      let W = first.width, H = first.height; W -= W % 2; H -= H % 2;
      const frames = [];
      for (const v of vals) frames.push(await blobToBitmap(new Blob([v.buf])));
      // 最後の絵を 2 秒見せる
      const last = renderRegion(doc, { scale: W / doc.width, opts: { exportMode: true, preview: false } });
      const fps = 15, n = frames.length + fps * 2;
      const at = (i) => { const c = newCanvas(W, H), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(i < frames.length ? frames[i] : last, 0, 0, W, H); return c; };
      let blob, name;
      if (typeof VideoEncoder !== 'undefined') { blob = await encodeMP4(at, n, W, H, fps, (i, m) => app.busy(`タイムラプス… ${i} / ${m}`)); name = `${doc.name}_タイムラプス.mp4`; }
      else {
        const g = []; for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 300))) g.push(gifFrame(at(i)));
        blob = encodeGIF(g, 7); name = `${doc.name}_タイムラプス.gif`;
      }
      app.busy(null);
      await shareOrDownload(blob, name);
    } catch (e) { app.busy(null); toast('作れませんでした: ' + e.message, { error: true }); }
  },
  async clear(pid) { await Store.tx(['timelapse'], 'readwrite', (t) => t.delete(IDBKeyRange.bound(`${pid}|`, `${pid}|￿`))); },
};
/* 作業時間: 操作と操作の間が 60 秒より短ければ、その間を作業していた時間に足す */
const WorkTime = {
  last: 0,
  touch(doc) {
    const now = Date.now();
    if (this.last && now - this.last < 60000) doc._timeAdd = (doc._timeAdd || 0) + (now - this.last);
    this.last = now;
  },
  fmt(ms) { const m = Math.round((ms || 0) / 60000); return m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60}分`; },
};
