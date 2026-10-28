'use strict';
/* アプリ本体: 画面の切り替え・作品一覧・新規作成・メニュー・道具の状態・自動保存・書き出し */

const mm = (v, dpi) => Math.round((v / 25.4) * dpi);
const PRESETS = [
  { group: 'イラスト', items: [
    { name: 'A4（350dpi）', w: mm(210, 350), h: mm(297, 350), dpi: 350 },
    { name: 'B5（350dpi）', w: mm(182, 350), h: mm(257, 350), dpi: 350 },
    { name: '正方形 3000px', w: 3000, h: 3000, dpi: 350 },
    { name: '4K 横長', w: 3840, h: 2160, dpi: 144 },
    { name: 'スマホ壁紙', w: 1290, h: 2796, dpi: 144 },
  ] },
  { group: 'マンガ', kind: 'manga', items: [
    { name: 'B5 同人誌 モノクロ（600dpi・裁ち落とし込み）', w: mm(188, 600), h: mm(263, 600), dpi: 600 },
    { name: 'B5 同人誌 カラー（350dpi・裁ち落とし込み）', w: mm(188, 350), h: mm(263, 350), dpi: 350 },
    { name: 'A4 投稿 モノクロ（600dpi・裁ち落とし込み）', w: mm(216, 600), h: mm(303, 600), dpi: 600 },
    { name: 'A5 同人誌（600dpi・裁ち落とし込み）', w: mm(154, 600), h: mm(216, 600), dpi: 600 },
  ] },
  { group: 'Webtoon', kind: 'webtoon', items: [
    { name: '縦スクロール 800×12800', w: 800, h: 12800, dpi: 144 },
    { name: '縦スクロール 1080×19200', w: 1080, h: 19200, dpi: 144 },
  ] },
  { group: 'アニメーション', kind: 'anime', items: [
    { name: 'フルHD 1920×1080', w: 1920, h: 1080, dpi: 144 },
    { name: 'HD 1280×720', w: 1280, h: 720, dpi: 144 },
  ] },
  { group: 'SNS・配信', items: [
    { name: 'X 横長 1600×900', w: 1600, h: 900, dpi: 144 },
    { name: 'Instagram 縦 1080×1350', w: 1080, h: 1350, dpi: 144 },
    { name: 'YouTube サムネイル 1280×720', w: 1280, h: 720, dpi: 144 },
    { name: 'アイコン 1000×1000', w: 1000, h: 1000, dpi: 144 },
  ] },
  { group: 'グッズ・印刷物', items: [
    { name: '缶バッジ 57mm（巻き込み込み 70mm）', w: mm(70, 350), h: mm(70, 350), dpi: 350 },
    { name: 'ポストカード（裁ち落とし込み）', w: mm(106, 350), h: mm(154, 350), dpi: 350 },
    { name: 'アクリルスタンド A6', w: mm(105, 350), h: mm(148, 350), dpi: 350 },
    { name: 'A3 ポスター（350dpi）', w: mm(303, 350), h: mm(426, 350), dpi: 350 },
  ] },
];
const MAX_PIXELS = 64e6;

const DEFAULT_SETTINGS = { fingerDraws: 'auto', rotateGesture: true, tapUndo: true, pressureHard: 1, quickSliders: true, leftOpen: true, rightOpen: true };

class App {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS, ...loadLS('settings', {}) };
    this.color = new ColorState();
    const ts = loadLS('tools', {});
    this.toolOpts = {
      current: ts.current || 'pen',
      sub: { pen: 'gpen', pencil: 'pencil', brush: 'watercolor', airbrush: 'airsoft', eraser: 'erhard', ...(ts.sub || {}) },
      brushSaved: ts.brushSaved || {},
      fillSub: ts.fillSub || 'fill-ref',
      fillSaved: ts.fillSaved || {},
      eyedropper: ts.eyedropper || 'all',
    };
    this.doc = null;
    this.screen = 'gallery';
    this.tools = {};
    this.saveState = 'saved';
  }

  init() {
    this.view = new View(this, $('#view'));
    this.panels = new ToolPanels(this);
    this.colorPanel = new ColorPanel(this, $('#colorpanel'));
    this.layerPanel = new LayerPanel(this, $('#layerpanel'));
    const brush = new BrushTool(this);
    for (const t of BRUSH_TOOLS) this.tools[t] = brush;
    this.tools.fill = new FillTool(this);
    this.tools.eyedropper = new EyedropperTool(this);
    this.tools.move = new MoveTool(this);
    this.tools.hand = new NullTool(); this.tools.zoom = new NullTool();
    this.color.on(() => this.view.request());
    this.bindUI();
    this.bindKeys();
    this.setTool(this.toolOpts.current, true);
    this.applyPanels();
    $('#appVersion').textContent = 'v' + APP_VERSION;
    this.showGallery();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      const had = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) $('#updateBar').hidden = false; });
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.saveNow(); });
    window.addEventListener('pagehide', () => this.saveNow());
  }
  saveSettings() { saveLS('settings', this.settings); }
  saveTools() { saveLS('tools', { current: this.toolOpts.current, sub: this.toolOpts.sub, brushSaved: this.toolOpts.brushSaved, fillSub: this.toolOpts.fillSub, fillSaved: this.toolOpts.fillSaved, eyedropper: this.toolOpts.eyedropper }); }
  pressureGamma() { return Math.pow(2, (this.settings.pressureHard - 1) * 1.2); }

  // ---- 道具
  get toolName() { return this.toolOpts.current; }
  get tool() { return this.tools[this.toolName]; }
  setTool(id, quiet = false) {
    if (this.view.mode === 'tool') return;
    if (this.tool && this.tool.cancel) this.tool.cancel();
    this.toolOpts.current = id;
    this._brush = null;
    this.panels.refreshBar();
    this.panels.refreshProps();
    this.panels.refreshQuick();
    this.view.request();
    if (!quiet) this.saveTools();
  }
  subFor(tool) { return this.toolOpts.sub[tool]; }
  setSubtool(id) {
    const s = subtoolById(id);
    this.toolOpts.sub[s.tool] = id;
    this._brush = null;
    this.saveTools();
    this.panels.refreshProps(); this.panels.refreshQuick();
  }
  get brush() {
    if (!BRUSH_TOOLS.includes(this.toolName)) return null;
    const id = this.subFor(this.toolName);
    if (!this._brush || this._brush.id !== id) this._brush = { id, ...brushSettings(id, this.toolOpts.brushSaved) };
    return this._brush;
  }
  updateBrush(patch, fromQuick = false) {
    const b = this.brush;
    if (!b) return;
    Object.assign(b, patch);
    const saved = (this.toolOpts.brushSaved[b.id] = this.toolOpts.brushSaved[b.id] || {});
    Object.assign(saved, patch);
    if (!fromQuick) { this.saveTools(); this.panels.refreshQuick(); }
    this.view.request();
  }
  resetBrush() { const b = this.brush; if (!b) return; delete this.toolOpts.brushSaved[b.id]; this._brush = null; this.saveTools(); this.panels.refreshProps(); this.panels.refreshQuick(); }
  get fillOpts() { const id = this.toolOpts.fillSub; return { ...FILL_DEFAULTS, ...FILL_SUBTOOLS.find((s) => s.id === id).s, ...(this.toolOpts.fillSaved[id] || {}) }; }
  setFillSub(id) { this.toolOpts.fillSub = id; this.saveTools(); this.panels.refreshProps(); }
  updateFill(patch) { const id = this.toolOpts.fillSub; this.toolOpts.fillSaved[id] = { ...(this.toolOpts.fillSaved[id] || {}), ...patch }; this.saveTools(); }

  /* 描けない理由（無ければ null） */
  cannotEdit(tool) {
    if (!this.doc) return '作品が開かれていません';
    if (tool instanceof NullTool || tool instanceof EyedropperTool) return null;
    const a = this.doc.active;
    if (!a || a.kind === 'paper') return '描くレイヤーを選んでください';
    if (tool instanceof MoveTool) return this.doc.effectiveLocked(a) ? 'レイヤーがロックされています' : null;
    if (a.isFolder) return 'フォルダーには描けません。中のレイヤーを選んでください';
    if (this.doc.effectiveLocked(a)) return 'レイヤーがロックされています';
    if (!this.doc.effectiveVisible(a)) return '非表示のレイヤーには描けません';
    return null;
  }
  afterEdit() { this.layerPanel.refreshThumbs(); }

  pickColorAt(p, src = 'all') {
    const d = this.doc;
    if (!d) return;
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    let tile;
    if (src === 'layer') { const a = d.active; tile = a && a.isRaster ? a.tiles.get(tkey(tx, ty)) : null; if (!tile) return; }
    else tile = d.comp.get(0, tx, ty).c;
    if (!this._pickC) this._pickC = newCanvas(1, 1);
    const g = this._pickC.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, 1, 1);
    g.drawImage(tile, x - tx * TILE, y - ty * TILE, 1, 1, 0, 0, 1, 1);
    const px = g.getImageData(0, 0, 1, 1).data;
    if (px[3] < 8) return;
    this.color.setMain(rgbToHex({ r: px[0], g: px[1], b: px[2] }));
  }

  undo() {
    if (!this.doc || this.view.mode === 'tool') return;
    const l = this.doc.history.undo();
    if (l) toast('取り消し: ' + l, { ms: 900 });
  }
  redo() {
    if (!this.doc || this.view.mode === 'tool') return;
    const l = this.doc.history.redo();
    if (l) toast('やり直し: ' + l, { ms: 900 });
  }

  // ---- 画面
  showGallery() {
    this.screen = 'gallery';
    $('#editor').hidden = true; $('#gallery').hidden = false;
    this.renderGallery();
  }
  async renderGallery() {
    const grid = $('#galGrid');
    let works = [];
    try { works = await Store.list(); } catch (e) { toast('作品一覧を読めません: ' + e.message, { error: true }); }
    grid.innerHTML = '';
    $('#galEmpty').hidden = works.length > 0;
    for (const w of works) {
      const img = el('img', { alt: '' });
      if (w.thumb) { const u = URL.createObjectURL(new Blob([w.thumb.buf], { type: w.thumb.type })); img.src = u; img.onload = () => URL.revokeObjectURL(u); }
      const more = el('button', { class: 'card-more', title: 'その他', onclick: (e) => { e.stopPropagation(); this.workMenu(w, more); } }, '⋯');
      grid.append(el('div', { class: 'card', onclick: () => this.openWork(w.id) },
        el('div', { class: 'card-img' }, img),
        el('div', { class: 'card-info' }, el('div', { class: 'card-name' }, w.name), el('div', { class: 'card-meta' }, `${w.width}×${w.height}・${fmtDate(w.updated)}`)), more));
    }
    const est = await Store.estimate();
    $('#galStorage').textContent = est ? `保存領域 ${fmtBytes(est.usage || 0)} 使用` : '';
  }
  workMenu(w, anchor) {
    this.popup(anchor, [
      ['名前を変更', async () => { const n = await promptBox('作品名', w.name); if (n) { await Store.rename(w.id, n); this.renderGallery(); } }],
      ['複製', async () => { this.busy('複製中…'); try { const d = await Store.loadDoc(w.id); d.workId = null; d._storedIds = null; d.name = w.name + ' のコピー'; await Store.saveDoc(d); d.comp.dispose(); } catch (e) { toast('複製できません: ' + e.message, { error: true }); } this.busy(null); this.renderGallery(); }],
      ['作品ファイル（.egk）で書き出す', async () => { this.busy('書き出し中…'); try { const d = await Store.loadDoc(w.id); const b = await exportEgk(d); d.comp.dispose(); this.busy(null); await shareOrDownload(b, `${w.name}.egk`); } catch (e) { this.busy(null); toast('書き出せません: ' + e.message, { error: true }); } }],
      ['PNG で書き出す', async () => { this.busy('書き出し中…'); try { const d = await Store.loadDoc(w.id); const b = await encodePNG(d); d.comp.dispose(); this.busy(null); await shareOrDownload(b, `${w.name}.png`); } catch (e) { this.busy(null); toast('書き出せません: ' + e.message, { error: true }); } }],
      ['削除', async () => { if (await confirmBox('作品を削除', `「${w.name}」を削除します。元に戻せません。`, '削除', true)) { await Store.remove(w.id); this.renderGallery(); } }, 'danger'],
    ]);
  }
  async openWork(id) {
    this.busy('開いています…');
    try { const d = await Store.loadDoc(id); this.openDoc(d); } catch (e) { toast('開けません: ' + e.message, { error: true }); }
    this.busy(null);
  }
  openDoc(doc) {
    if (this.doc && this.doc !== doc) this.doc.comp.dispose();
    this.doc = doc;
    doc.onChange = (kind) => this.onDocChange(kind);
    doc.history.onChange = () => this.refreshUndo();
    this.screen = 'editor';
    $('#gallery').hidden = true; $('#editor').hidden = false;
    $('#docTitle').textContent = doc.name;
    this.view.rot = 0; this.view.flip = false;
    this.view.fitted = true;
    requestAnimationFrame(() => { this.view.resize(); this.view.fit(); });
    this.layerPanel.thumbs.clear();
    this.layerPanel.refresh();
    this.refreshUndo();
    this.onViewFlags();
    this.setSaveState('saved');
  }
  async closeDoc() {
    if (!this.doc) { this.showGallery(); return; }
    await this.saveNow();
    if (this.saveState === 'error' && !(await confirmBox('保存できていません', '保存に失敗しています。このまま作品一覧に戻りますか？（最後に保存した所までになります）', '戻る', true))) return;
    this.doc.comp.dispose();
    this.doc = null;
    this.view.request();
    this.showGallery();
  }
  onDocChange(kind) {
    if (kind !== 'pixels') this.layerPanel.refresh();
    this.view.request();
    this.scheduleSave();
  }
  onActiveChanged() { this.layerPanel.refresh(); }
  refreshUndo() {
    const h = this.doc && this.doc.history;
    $('#btnUndo').disabled = !(h && h.canUndo);
    $('#btnRedo').disabled = !(h && h.canRedo);
  }
  onViewFlags() { $('#btnFlip').classList.toggle('on', this.view.flip); }

  // ---- 保存
  scheduleSave() {
    this.setSaveState('dirty');
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.saveNow(), 2500);
  }
  async saveNow() {
    clearTimeout(this._saveT);
    const doc = this.doc;
    if (!doc || (!doc.unsaved.size && !doc.metaDirty && doc.workId)) return;
    if (this.view.mode === 'tool') { this._saveT = setTimeout(() => this.saveNow(), 800); return; }
    if (this._saving) { this._saveAgain = true; return this._saving; }
    this.setSaveState('saving');
    this._saving = (async () => {
      try { await Store.saveDoc(doc); this.setSaveState(doc.unsaved.size ? 'dirty' : 'saved'); }
      catch (e) {
        console.error(e);
        this.setSaveState('error');
        clearTimeout(this._saveT);
        this._saveT = setTimeout(() => this.saveNow(), 8000);      // 自動でやり直す（ポップアップは出さない）
      }
    })();
    await this._saving;
    this._saving = null;
    if (this._saveAgain) { this._saveAgain = false; if (doc.unsaved.size || doc.metaDirty) await this.saveNow(); }
  }
  setSaveState(s) {
    this.saveState = s;
    const b = $('#saveState');
    b.className = 'save-state ' + s;
    b.textContent = { saved: '保存済み', dirty: '未保存', saving: '保存中…', error: '● 保存できません（再試行中）' }[s];
  }

  // ---- 新規作成
  async newDocDialog() {
    let sel = { ...PRESETS[0].items[0], kind: 'illust' };
    const body = el('div', { class: 'newdoc' });
    const list = el('div', { class: 'preset-list' });
    const wIn = el('input', { type: 'number', class: 'inp', min: 16, max: 20000 }), hIn = el('input', { type: 'number', class: 'inp', min: 16, max: 40000 });
    const dpiIn = el('input', { type: 'number', class: 'inp', min: 72, max: 1200 });
    const nameIn = el('input', { type: 'text', class: 'inp', value: '' });
    const paperSel = el('select', { class: 'sel' }, el('option', { value: '#ffffff' }, '白'), el('option', { value: '#f6f1e6' }, 'クリーム'), el('option', { value: '' }, '透明（用紙なし）'));
    const note = el('p', { class: 'hint' });
    const upd = () => {
      wIn.value = sel.w; hIn.value = sel.h; dpiIn.value = sel.dpi;
      for (const b of $$('.preset', list)) b.classList.toggle('on', b._p === sel._p);
      check();
    };
    const check = () => {
      const w = +wIn.value, h = +hIn.value, px = w * h, dpi = +dpiIn.value || 350;
      const mmw = ((w / dpi) * 25.4).toFixed(0), mmh = ((h / dpi) * 25.4).toFixed(0);
      note.textContent = `${w}×${h}px（${mmw}×${mmh}mm・${(px / 1e6).toFixed(1)}M 画素）` + (px > 24e6 ? '　大きめの原稿です。レイヤーを増やすと iPad のメモリを多く使います。' : '');
    };
    for (const g of PRESETS) {
      list.append(el('div', { class: 'preset-g' }, g.group));
      for (const p of g.items) {
        const b = el('button', { class: 'preset', onclick: () => { sel = { ...p, kind: g.kind || 'illust', _p: p }; upd(); } }, p.name);
        b._p = p;
        list.append(b);
      }
    }
    sel._p = PRESETS[0].items[0];
    for (const inp of [wIn, hIn, dpiIn]) inp.addEventListener('input', check);
    body.append(list, el('div', { class: 'newdoc-form' },
      el('label', { class: 'lbl' }, '作品名'), nameIn,
      el('div', { class: 'row3' }, el('div', {}, el('label', { class: 'lbl' }, '幅 px'), wIn), el('div', {}, el('label', { class: 'lbl' }, '高さ px'), hIn), el('div', {}, el('label', { class: 'lbl' }, '解像度 dpi'), dpiIn)),
      el('label', { class: 'lbl' }, '用紙'), paperSel, note));
    upd();
    const ok = await modal({ title: '新規作成', body, wide: true, buttons: [{ label: 'キャンセル', value: false }, { label: '作成', value: true, primary: true }] });
    if (!ok) return;
    const w = Math.round(+wIn.value), h = Math.round(+hIn.value);
    if (!(w >= 16 && h >= 16) || w * h > MAX_PIXELS) { toast(`大きさは 16px 以上・${MAX_PIXELS / 1e6}M 画素までです`, { error: true }); return; }
    const doc = Doc.create({ width: w, height: h, dpi: +dpiIn.value || 350, name: nameIn.value.trim() || sel.name.replace(/（.*$/, ''), paper: paperSel.value || null, kind: sel.kind });
    if (sel.kind === 'manga') {
      // マンガ: 下描き・線画・ベタ の3枚から始める（CSP の新規原稿と同じ考え方）
      const draft = doc.active; draft.name = '下描き'; draft.draft = true; draft.opacity = 0.5;
      const ink = new Layer('raster', '線画'); doc.root.children.push(ink);
      const color = new Layer('raster', '塗り'); doc.root.children.splice(1, 0, color);
      doc.activeId = draft.id;
    }
    doc.history.clear();
    this.openDoc(doc);
    this.saveNow();
  }

  async newFromImage() {
    const f = await pickFile('image/*');
    if (!f) return;
    try {
      const bmp = await blobToBitmap(f);
      let w = bmp.width, h = bmp.height;
      const s = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
      w = Math.round(w * s); h = Math.round(h * s);
      const doc = Doc.create({ width: w, height: h, dpi: 144, name: (f.name || '画像').replace(/\.[^.]+$/, '') });
      doc.active.name = '画像';
      drawImageToLayer(doc, doc.active, bmp, 0, 0, w, h);
      doc.history.clear();
      this.openDoc(doc);
      this.saveNow();
    } catch (e) { toast('画像を読めません: ' + e.message, { error: true }); }
  }
  async importEgkFile() {
    const f = await pickFile('.egk,application/zip,application/octet-stream');
    if (!f) return;
    this.busy('読み込み中…');
    try { const d = await importEgk(f); d.workId = null; this.openDoc(d); await this.saveNow(); }
    catch (e) { toast('読み込めません: ' + e.message, { error: true }); }
    this.busy(null);
  }
  async importImageLayer() {
    const f = await pickFile('image/*');
    if (!f || !this.doc) return;
    try {
      const bmp = await blobToBitmap(f), d = this.doc;
      const s = Math.min(1, d.width / bmp.width, d.height / bmp.height);
      const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
      const l = new Layer('raster', (f.name || '画像').replace(/\.[^.]+$/, ''));
      drawImageToLayer(d, l, bmp, Math.round((d.width - w) / 2), Math.round((d.height - h) / 2), w, h);
      d.structEdit('画像を読み込む', () => { LayerOps.placeNew(d, l); d.activeId = l.id; });
    } catch (e) { toast('画像を読めません: ' + e.message, { error: true }); }
  }
  async exportImage(type) {
    const d = this.doc;
    if (!d) return;
    this.busy('書き出し中…');
    try {
      let blob;
      if (type === 'png') blob = await encodePNG(d);
      else {
        if (d.width * d.height > 16.7e6) { this.busy(null); toast('大きすぎて JPEG にできません（PNG で書き出してください）', { error: true }); return; }
        const c = renderRegion(d, { opts: { exportMode: true, preview: false } });
        const g = ctx2d(c);
        g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        blob = await canvasToBlob(c, 'image/jpeg', 0.92);
      }
      this.busy(null);
      await shareOrDownload(blob, `${d.name}.${type === 'png' ? 'png' : 'jpg'}`);
    } catch (e) { this.busy(null); toast('書き出せません: ' + e.message, { error: true }); }
  }
  async exportEgkCurrent() {
    if (!this.doc) return;
    this.busy('書き出し中…');
    try { const b = await exportEgk(this.doc); this.busy(null); await shareOrDownload(b, `${this.doc.name}.egk`); } catch (e) { this.busy(null); toast('書き出せません: ' + e.message, { error: true }); }
  }

  // ---- 設定・情報
  async settingsDialog() {
    const st = this.settings;
    const body = el('div', { class: 'settings' });
    const seg = (label, key, opts) => {
      const box = el('div', { class: 'seg' });
      for (const [v, t] of opts) box.append(el('button', { class: st[key] === v ? 'on' : '', onclick: (e) => { st[key] = v; for (const x of box.children) x.classList.remove('on'); e.target.classList.add('on'); this.saveSettings(); this.applyPanels(); } }, t));
      body.append(el('div', { class: 'set-row' }, el('span', {}, label), box));
    };
    seg('指で描く', 'fingerDraws', [['auto', '自動（ペンを使ったら描かない）'], [true, '描く'], [false, '描かない']]);
    seg('2本指で回転', 'rotateGesture', [[true, 'する'], [false, 'しない']]);
    seg('2本指タップで取り消し', 'tapUndo', [[true, 'する'], [false, 'しない']]);
    seg('画面左端のスライダー', 'quickSliders', [[true, '出す'], [false, '出さない']]);
    // 筆圧
    const curve = el('canvas', { class: 'pcurve', width: 120, height: 120 });
    const drawCurve = () => {
      const g = curve.getContext('2d'), gm = this.pressureGamma();
      g.clearRect(0, 0, 120, 120); g.strokeStyle = '#555'; g.strokeRect(0.5, 0.5, 119, 119);
      g.strokeStyle = '#4da3ff'; g.lineWidth = 2; g.beginPath();
      for (let i = 0; i <= 40; i++) { const x = i / 40, y = Math.pow(x, gm); if (i) g.lineTo(x * 120, 120 - y * 120); else g.moveTo(0, 120); }
      g.stroke();
    };
    const pr = el('input', { type: 'range', min: 0, max: 2, step: 0.05, value: st.pressureHard });
    pr.addEventListener('input', () => { st.pressureHard = +pr.value; this.saveSettings(); drawCurve(); });
    body.append(el('div', { class: 'set-row col' }, el('span', {}, '筆圧の硬さ（左: 軽い力で太く／右: 強く押して太く）'), el('div', { class: 'prow' }, pr, curve)));
    drawCurve();
    body.append(el('p', { class: 'hint' }, 'Apple Pencil Pro のスクイーズとダブルタップは、Web アプリには届かない仕組みのため使えません。代わりに 2本指タップ（取り消し）・3本指タップ（やり直し）・指の長押し（スポイト）が使えます。'));
    await modal({ title: '設定', body, buttons: [{ label: '閉じる', value: true, primary: true }] });
    this.panels.refreshQuick();
  }
  docInfo() {
    const d = this.doc;
    if (!d) return;
    const rasters = d.layers().filter((l) => l.isRaster);
    const tiles = rasters.reduce((s, l) => s + l.tiles.size, 0);
    const mem = (tiles + d.comp.levels.reduce((s, m) => s + m.size, 0)) * TILE * TILE * 4;
    modal({ title: '作品の情報', body: el('div', {},
      el('p', {}, `大きさ: ${d.width} × ${d.height} px（${((d.width / d.dpi) * 25.4).toFixed(1)} × ${((d.height / d.dpi) * 25.4).toFixed(1)} mm・${d.dpi} dpi）`),
      el('p', {}, `レイヤー: ${rasters.length} 枚（描いてあるタイル ${tiles} 枚）`),
      el('p', {}, `使っているメモリの目安: ${fmtBytes(mem)}（取り消し用 ${fmtBytes(d.history.undoStack.reduce((s, c) => s + c.bytes, 0))} は別）`),
      el('p', { class: 'hint' }, `描工房 v${APP_VERSION}`)) });
  }
  async renameDoc() {
    const n = await promptBox('作品名', this.doc.name);
    if (!n) return;
    this.doc.name = n; this.doc.metaDirty = true;
    $('#docTitle').textContent = n;
    this.scheduleSave();
  }

  // ---- メニュー
  menus() {
    const d = () => this.doc;
    return {
      file: [
        ['作品一覧に戻る', () => this.closeDoc()],
        ['作品名を変更', () => this.renameDoc()],
        '-',
        ['画像を読み込む（新しいレイヤー）', () => this.importImageLayer()],
        '-',
        ['PNG で書き出す', () => this.exportImage('png')],
        ['JPEG で書き出す', () => this.exportImage('jpeg')],
        ['作品ファイル（.egk）で書き出す', () => this.exportEgkCurrent()],
        '-',
        ['今すぐ保存', async () => { await this.saveNow(); if (this.saveState === 'saved') toast('保存しました'); }],
        ['作品の情報', () => this.docInfo()],
      ],
      edit: [
        ['取り消し', () => this.undo(), '⌘Z'],
        ['やり直し', () => this.redo(), '⇧⌘Z'],
        '-',
        ['メインカラーでレイヤーを塗りつぶす', () => fillLayerSolid(d(), this.color.main)],
        ['レイヤーを消去', () => LayerOps.clear(d()), 'Del'],
      ],
      layer: [
        ['新規ラスターレイヤー', () => LayerOps.add(d()), '⇧⌘N'],
        ['新規フォルダー', () => LayerOps.add(d(), 'folder')],
        ['レイヤーを複製', () => LayerOps.duplicate(d())],
        ['レイヤーを削除', () => LayerOps.remove(d())],
        '-',
        ['下のレイヤーに結合', () => LayerOps.mergeDown(d()), '⌘E'],
        ['下のレイヤーでクリッピング', () => { const a = d().active; if (a && a.kind !== 'paper') d().setProps(a, { clip: !a.clip }, 'クリッピング'); }],
        ['下描きレイヤーにする／戻す', () => { const a = d().active; if (a && a.kind !== 'paper') d().setProps(a, { draft: !a.draft }, '下描きレイヤー'); }],
        ['参照レイヤーにする／戻す', () => { const a = d().active; if (a && a.kind !== 'paper') d().setProps(a, { ref: !a.ref }, '参照レイヤー'); }],
      ],
      view: [
        ['全体を表示', () => this.view.fit(), '⌘0'],
        ['100%', () => this.view.setZoom(1), '⌘1'],
        ['拡大', () => this.view.zoomStep(1), '⌘+'],
        ['縮小', () => this.view.zoomStep(-1), '⌘−'],
        '-',
        ['左に 15° 回転', () => this.view.rotateBy(-Math.PI / 12)],
        ['右に 15° 回転', () => this.view.rotateBy(Math.PI / 12)],
        ['回転を戻す', () => this.view.setRotation(0)],
        ['左右反転', () => this.view.toggleFlip(), 'H'],
        '-',
        ['パネルを隠す／出す', () => this.togglePanels(), 'Tab'],
        ['設定', () => this.settingsDialog()],
      ],
    };
  }
  popup(anchor, items) {
    this.closePopups();
    const m = el('div', { class: 'menu' });
    for (const it of items) {
      if (it === '-') { m.append(el('div', { class: 'menu-sep' })); continue; }
      const [label, fn, extra] = it;
      m.append(el('button', { class: 'menu-item' + (extra === 'danger' ? ' danger' : ''), onclick: () => { this.closePopups(); fn(); } },
        el('span', {}, label), extra && extra !== 'danger' ? el('span', { class: 'kbd' }, extra) : null));
    }
    document.body.append(m);
    const r = anchor.getBoundingClientRect();
    const mw = m.offsetWidth, mh = m.offsetHeight;
    m.style.left = Math.max(6, Math.min(window.innerWidth - mw - 6, r.left)) + 'px';
    m.style.top = (r.bottom + mh + 6 > window.innerHeight ? Math.max(6, r.top - mh - 4) : r.bottom + 4) + 'px';
    this._popup = m;
    setTimeout(() => {
      this._popupClose = (e) => { if (!m.contains(e.target)) this.closePopups(); };
      document.addEventListener('pointerdown', this._popupClose, true);
    }, 0);
  }
  closePopups() {
    $('#editor').classList.remove('left-pop');
    if (this._popup) { this._popup.remove(); this._popup = null; }
    if (this._popupClose) { document.removeEventListener('pointerdown', this._popupClose, true); this._popupClose = null; }
  }
  busy(text) {
    const b = $('#busy');
    if (!text) { b.hidden = true; return; }
    $('#busyText').textContent = text; b.hidden = false;
  }

  // ---- パネルの出し入れ
  applyPanels() {
    $('#editor').classList.toggle('no-left', !this.settings.leftOpen);
    $('#editor').classList.toggle('no-right', !this.settings.rightOpen);
    $('#btnSide').classList.toggle('on', this.settings.rightOpen);
  }
  get portrait() { return window.matchMedia('(max-width: 1100px)').matches; }
  /* 縦向きでは左パネルは絵の上に重なるポップオーバー（ツールをもう一度押すと開き、絵に触ると閉じる） */
  toggleLeftPanel() {
    if (this.portrait) { $('#editor').classList.toggle('left-pop'); return; }
    this.settings.leftOpen = !this.settings.leftOpen; this.saveSettings(); this.applyPanels();
  }
  togglePanels() {
    const on = !(this.settings.leftOpen || this.settings.rightOpen);
    this.settings.leftOpen = on; this.settings.rightOpen = on;
    this.saveSettings(); this.applyPanels();
  }

  // ---- 画面の部品をつなぐ
  bindUI() {
    $('#galNew').onclick = () => this.newDocDialog();
    $('#galImage').onclick = () => this.newFromImage();
    $('#galOpen').onclick = () => this.importEgkFile();
    $('#btnBack').onclick = () => this.closeDoc();
    $('#btnUndo').onclick = () => this.undo();
    $('#btnRedo').onclick = () => this.redo();
    $('#btnFit').onclick = () => { this.view.setRotation(0); this.view.fit(); };
    $('#btnFlip').onclick = () => this.view.toggleFlip();
    $('#btnSide').onclick = () => { this.settings.rightOpen = !this.settings.rightOpen; this.saveSettings(); this.applyPanels(); };
    $('#saveState').onclick = () => this.saveNow();
    $('#docTitle').onclick = () => this.renameDoc();
    $('#updateBar button').onclick = () => location.reload();
    $('#updateBar .x').onclick = () => { $('#updateBar').hidden = true; };
    for (const b of $$('[data-menu]')) b.onclick = () => this.popup(b, this.menus()[b.dataset.menu]);
    // 右パネルのタブ（色・レイヤーの高さを入れ替え）
    for (const b of $$('.rp-tab')) b.onclick = () => { $('#rightpanel').dataset.focus = b.dataset.focus; };
    window.addEventListener('resize', () => this.closePopups());
  }
  bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (this.screen !== 'editor' || !this.doc) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); this.redo(); return; }
      if (mod && k === '0') { e.preventDefault(); this.view.fit(); return; }
      if (mod && k === '1') { e.preventDefault(); this.view.setZoom(1); return; }
      if (mod && (k === '=' || k === '+' || k === ';')) { e.preventDefault(); this.view.zoomStep(1); return; }
      if (mod && k === '-') { e.preventDefault(); this.view.zoomStep(-1); return; }
      if (mod && k === 's') { e.preventDefault(); this.saveNow(); return; }
      if (mod && k === 'e') { e.preventDefault(); LayerOps.mergeDown(this.doc); return; }
      if (mod && e.shiftKey && k === 'n') { e.preventDefault(); LayerOps.add(this.doc); return; }
      if (mod) return;
      if (k === ' ') { this.view.spaceDown = true; e.preventDefault(); return; }
      if (k === 'tab') { e.preventDefault(); this.togglePanels(); return; }
      if (k === 'x') { this.color.swap(); return; }
      if (k === 'c') { this.color.setTransparent(!this.color.transparent); return; }
      if (k === 'delete' || k === 'backspace') { LayerOps.clear(this.doc); return; }
      if (e.key === '[' || e.key === ']') {
        const b = this.brush;
        if (b) { this.updateBrush({ size: clamp(Math.round(b.size * (e.key === ']' ? 1.15 : 1 / 1.15) * 10) / 10, 0.5, 1000) }); this.panels.refreshProps(); }
        return;
      }
      if (k === 'h' && e.shiftKey) { this.view.toggleFlip(); return; }
      if (k === 'r') { this.view.rotateBy((e.shiftKey ? -1 : 1) * Math.PI / 12); return; }
      const t = TOOL_DEFS.find((d) => d.key === k);
      if (t) this.setTool(t.id);
    });
    document.addEventListener('keyup', (e) => { if (e.key === ' ') this.view.spaceDown = false; });
  }
}

/* 画像をレイヤーのタイルに描く（履歴なし: 呼ぶ側が structEdit で包む） */
function drawImageToLayer(doc, layer, img, x, y, w, h) {
  const { tx0, ty0, tx1, ty1 } = tilesOfRect({ x, y, w, h });
  for (let ty = Math.max(0, ty0); ty <= Math.min(doc.rows - 1, ty1); ty++) for (let tx = Math.max(0, tx0); tx <= Math.min(doc.cols - 1, tx1); tx++) {
    const c = TilePool.get(), g = ctx2d(c);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, x - tx * TILE, y - ty * TILE, w, h);
    layer.tiles.set(tkey(tx, ty), c);
    doc.markTile(layer, tkey(tx, ty));
  }
  layer.ver++;
}
function fillLayerSolid(doc, color) {
  const a = doc.active;
  if (!a || !a.isRaster || doc.effectiveLocked(a)) { toast('ラスターレイヤーを選んでください'); return; }
  doc.pixelEdit('塗りつぶし（全体）', a, (touch) => {
    for (let ty = 0; ty < doc.rows; ty++) for (let tx = 0; tx < doc.cols; tx++) {
      const k = tkey(tx, ty);
      let t = a.tiles.get(k);
      if (!t && a.alphaLock) continue;
      touch(k);
      if (!t) { t = TilePool.get(); a.tiles.set(k, t); }
      const g = ctx2d(t);
      g.save(); g.globalCompositeOperation = a.alphaLock ? 'source-atop' : 'source-over'; g.fillStyle = color; g.fillRect(0, 0, TILE, TILE); g.restore();
    }
  });
}

const app = new App();
window.addEventListener('DOMContentLoaded', () => app.init());
