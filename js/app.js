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
    { name: 'B5 同人誌 モノクロ（600dpi・裁ち落とし込み）', w: mm(188, 600), h: mm(263, 600), dpi: 600, book: 'b5' },
    { name: 'B5 同人誌 カラー（350dpi・裁ち落とし込み）', w: mm(188, 350), h: mm(263, 350), dpi: 350, book: 'b5' },
    { name: 'A4 投稿 モノクロ（600dpi・裁ち落とし込み）', w: mm(216, 600), h: mm(303, 600), dpi: 600, book: 'a4' },
    { name: 'A5 同人誌（600dpi・裁ち落とし込み）', w: mm(154, 600), h: mm(216, 600), dpi: 600, book: 'a5' },
    { name: 'B6 コミックス（600dpi・裁ち落とし込み）', w: mm(134, 600), h: mm(188, 600), dpi: 600, book: 'b6' },
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
    { name: '缶バッジ 32mm（巻き込み込み 44mm）', w: mm(44, 350), h: mm(44, 350), dpi: 350, goods: { type: 'badge', face: 32, total: 44 } },
    { name: '缶バッジ 44mm（巻き込み込み 56mm）', w: mm(56, 350), h: mm(56, 350), dpi: 350, goods: { type: 'badge', face: 44, total: 56 } },
    { name: '缶バッジ 57mm（巻き込み込み 70mm）', w: mm(70, 350), h: mm(70, 350), dpi: 350, goods: { type: 'badge', face: 57, total: 70 } },
    { name: '缶バッジ 76mm（巻き込み込み 90mm）', w: mm(90, 350), h: mm(90, 350), dpi: 350, goods: { type: 'badge', face: 76, total: 90 } },
    { name: 'アクリルスタンド A6（カットライン用）', w: mm(105, 350), h: mm(148, 350), dpi: 350, goods: { type: 'acrylic' } },
    { name: 'アクリルキーホルダー 60mm', w: mm(60, 350), h: mm(60, 350), dpi: 350, goods: { type: 'acrylic' } },
    { name: 'ステッカー 100mm', w: mm(100, 350), h: mm(100, 350), dpi: 350, goods: { type: 'sticker' } },
    { name: 'ポストカード（裁ち落とし込み）', w: mm(106, 350), h: mm(154, 350), dpi: 350, book: 'postcard' },
    { name: 'A3 ポスター（裁ち落とし込み）', w: mm(303, 350), h: mm(426, 350), dpi: 350, book: 'a3' },
    { name: 'B2 ポスター（裁ち落とし込み・200dpi）', w: mm(521, 200), h: mm(734, 200), dpi: 200, book: 'b2' },
  ] },
];
const MAX_PIXELS = 64e6;

const DEFAULT_SETTINGS = { fingerDraws: 'auto', rotateGesture: true, tapUndo: true, pressureHard: 1, quickSliders: true, leftOpen: true, rightOpen: true, guides: true };

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
      sel: { ...SEL_DEFAULTS, ...(ts.sel || {}) },
      shape: { ...SHAPE_DEFAULTS, ...(ts.shape || {}) },
      grad: { ...GRAD_DEFAULTS, ...(ts.grad || {}) },
      vec: { mode: 'widen', size: 30, amount: 20, ...(ts.vec || {}) },
      text: ts.text || null,
      frame: { ...FRAME_DEFAULTS, ...(ts.frame || {}) },
      fx: { ...FX_DEFAULTS, ...(ts.fx || {}) },
      balloon: { ...BALLOON_DEFAULTS, ...(ts.balloon || {}) },
      ruler: { sub: 'line', count: 1, mirror: true, ...(ts.ruler || {}) },
      tone: ts.tone || null,
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
    this.tools.select = new SelectTool(this);
    this.tools.shape = new ShapeTool(this);
    this.tools.gradient = new GradientTool(this);
    this.tools.text = new TextTool(this);
    this.tools.vecedit = new VectorWidthTool(this);
    this.tools.frame = new FrameTool(this);
    this.tools.fx = new EffectLineTool(this);
    this.tools.balloon = new BalloonTool(this);
    this.tools.ruler = new RulerTool(this);
    this.vecErase = new VectorEraseTool(this);
    this.transformTool = new TransformTool(this);
    this.adjustPanel = new AdjustPanel(this);
    this.textPanel = new TextPanel(this);
    this.selLauncher = new SelLauncher(this);
    this.pageMgr = new PageManager(this);
    this.timeline = new Timeline(this);
    this.player = new Player(this);
    this.camTool = new CameraTool(this);
    this.cameraEdit = false;
    this.work = null;                   // 開いているページの作品（複数ページの時）
    this.color.on(() => this.view.request());
    // 選択範囲の点線を動かす
    setInterval(() => { if (this.doc && this.doc.sel && !document.hidden && this.screen === 'editor') { this.view.ants = (this.view.ants + 1) % 16; this.view.request(); } }, 180);
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
  saveTools() { const t = this.toolOpts; saveLS('tools', { current: t.current, sub: t.sub, brushSaved: t.brushSaved, fillSub: t.fillSub, fillSaved: t.fillSaved, eyedropper: t.eyedropper, sel: t.sel, shape: t.shape, grad: t.grad, vec: t.vec, text: t.text, frame: t.frame, fx: t.fx, balloon: t.balloon, ruler: t.ruler, tone: t.tone }); }
  get frameOpts() { return this.toolOpts.frame; }
  get fxOpts() { return this.toolOpts.fx; }
  get balloonOpts() { return this.toolOpts.balloon; }
  get rulerOpts() { return this.toolOpts.ruler; }
  get selOpts() { return this.toolOpts.sel; }
  get shapeOpts() { return this.toolOpts.shape; }
  get gradOpts() { return this.toolOpts.grad; }
  get vecOpts() { return this.toolOpts.vec; }
  updateOpts(kind, patch) { Object.assign(this.toolOpts[kind], patch); this.saveTools(); this.view.request(); }
  pressureGamma() { return Math.pow(2, (this.settings.pressureHard - 1) * 1.2); }

  // ---- 道具
  get toolName() { return this.toolOpts.current; }
  get tool() {
    if (this.transforming) return this.transformTool;
    if (this.cameraEdit) return this.camTool;
    const a = this.doc && this.doc.active;
    if (this.toolName === 'eraser' && a && a.kind === 'vector' && !this.doc.maskEdit) return this.vecErase;
    return this.tools[this.toolName];
  }
  get transforming() { return this.transformTool && this.transformTool.active; }
  setTool(id, quiet = false) {
    if (this.view.mode === 'tool') return;
    if (this.transforming) this.transformTool.finish(true);
    if (this.tools.select && this.tools.select.poly && id !== 'select') this.tools.select.poly = null;
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
    if (this.adjustPanel.open) return '色調補正のパネルを閉じてから描いてください（OK かキャンセル）';
    if (this.textPanel.open && !(tool instanceof TextTool)) return 'テキストの編集を終えてください（OK）';
    if (tool instanceof NullTool || tool instanceof EyedropperTool || tool instanceof TransformTool || tool instanceof TextTool) return null;
    if (tool instanceof FrameTool || tool instanceof RulerTool || tool instanceof EffectLineTool || tool instanceof BalloonTool || tool instanceof CameraTool) return null;
    // アニメーション: このフレームに出ていないセルには描かない（描いても見えないので）
    if (this.doc.anim && this.doc.active) {
      for (let l = this.doc.active, p = this.doc.parentOf(l); p && p !== this.doc.root; l = p, p = this.doc.parentOf(p)) {
        if (p.anim) { if (celAt(p, this.doc.anim.cur) !== l.id) return 'このフレームに出ていないセルです（タイムラインでセルを指定するか、レイヤーを選び直してください）'; break; }
      }
    }
    const doc = this.doc, a = doc.active;
    if (tool instanceof SelectTool) return tool.o.sub === 'wand' && tool.o.ref === 'layer' && (!a || !a.hasTiles) ? '自動選択（編集レイヤー）は描いてあるレイヤーで使います' : null;
    if (!a || a.kind === 'paper') return '描くレイヤーを選んでください';
    if (tool instanceof MoveTool) return doc.effectiveLocked(a) ? 'レイヤーがロックされています' : null;
    if (a.isFolder && !doc.maskEdit) return 'フォルダーには描けません。中のレイヤーを選んでください';
    if (doc.effectiveLocked(a)) return 'レイヤーがロックされています';
    if (!doc.effectiveVisible(a)) return '非表示のレイヤーには描けません';
    if (doc.maskEdit) return a.mask ? null : 'マスクがありません';
    if (tool instanceof VectorWidthTool) return a.kind === 'vector' ? null : '線修正はベクターレイヤーで使います';
    if (a.kind === 'adjust') return '色調補正レイヤーには描けません（マスクを作ると、マスクに描けます）';
    if (a.kind === 'text') return 'テキストレイヤーには描けません（テキストツールで直すか、ラスタライズしてください）';
    if (a.kind === 'vector') {
      if (tool instanceof BrushTool && this.color.transparent) return 'ベクターレイヤーでは透明色は使えません（消しゴムを使ってください）';
      if (!(tool instanceof BrushTool || tool instanceof VectorEraseTool)) return 'ベクターレイヤーで使えるのはペン・鉛筆・筆・エアブラシ・消しゴムです';
    }
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
    if (src === 'layer') { const a = d.active; tile = a && a.hasTiles ? a.tiles.get(tkey(tx, ty)) : null; if (!tile) return; }
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
    $('#editor').hidden = true; $('#pages').hidden = true; $('#gallery').hidden = false;
    this.work = null;
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
        el('div', { class: 'card-info' }, el('div', { class: 'card-name' }, w.name), el('div', { class: 'card-meta' }, (w.pages ? `${w.pages.length}ページ・` : `${w.width}×${w.height}・`) + fmtDate(w.updated))), more));
    }
    const est = await Store.estimate();
    $('#galStorage').textContent = est ? `保存領域 ${fmtBytes(est.usage || 0)} 使用` : '';
  }
  workMenu(w, anchor) {
    this.popup(anchor, [
      ['名前を変更', async () => { const n = await promptBox('作品名', w.name); if (n) { await Store.rename(w.id, n); this.renderGallery(); } }],
      ['複製', async () => { this.busy('複製中…'); try { await Store.duplicate(w.id); } catch (e) { toast('複製できません: ' + e.message, { error: true }); } this.busy(null); this.renderGallery(); }],
      ['作品ファイル（.egk）で書き出す', async () => {
        this.busy('書き出し中…');
        try { let b; if (w.pages) b = await exportWorkEgk(w.id); else { const d = await Store.loadDoc(w.id); b = await exportEgk(d); d.comp.dispose(); } this.busy(null); await shareOrDownload(b, `${w.name}.egk`); }
        catch (e) { this.busy(null); toast('書き出せません: ' + e.message, { error: true }); }
      }],
      ...(w.pages ? [] : [['PNG で書き出す', async () => { this.busy('書き出し中…'); try { const d = await Store.loadDoc(w.id); const b = await encodePNG(d); d.comp.dispose(); this.busy(null); await shareOrDownload(b, `${w.name}.png`); } catch (e) { this.busy(null); toast('書き出せません: ' + e.message, { error: true }); } }]]),
      ['削除', async () => { if (await confirmBox('作品を削除', `「${w.name}」を削除します。元に戻せません。`, '削除', true)) { await Store.remove(w.id); this.renderGallery(); } }, 'danger'],
    ]);
  }
  async openWork(id) {
    const work = await Store.getWork(id);
    if (work && work.pages) { this.pageMgr.show(id); return; }
    await this.openPage(id, id);
  }
  /* ページを開く（複数ページの作品なら、ページの並び・見開きの情報も付ける） */
  async openPage(wid, pid) {
    if (this.doc) { await this.saveNow(); }
    this.busy('開いています…');
    try {
      const work = await Store.getWork(wid);
      const d = await Store.loadDoc(wid, pid);
      if (work.pages) {
        const i = work.pages.findIndex((p) => p.id === d.pageId);
        d.pageInfo = pageLayout(work)[i];
        d.spread = !!work.pages[i].spread;
        this.work = work;
      } else this.work = null;
      this.openDoc(d);
    } catch (e) { toast('開けません: ' + e.message, { error: true }); }
    this.busy(null);
  }
  async goPage(dir) {
    const w = this.work, d = this.doc;
    if (!w || !d) return;
    const ids = Store.pageIds(w), i = ids.indexOf(d.pageId) + dir;
    if (i < 0 || i >= ids.length) { toast(dir > 0 ? '最後のページです' : '最初のページです', { ms: 900 }); return; }
    await this.openPage(w.id, ids[i]);
  }
  refreshPageNav() {
    const w = this.work, d = this.doc, nav = $('#pageNav');
    nav.hidden = !(w && w.pages && d);
    if (nav.hidden) return;
    const ids = Store.pageIds(w), i = ids.indexOf(d.pageId);
    $('#pageNum').textContent = d.pageInfo ? `${d.pageInfo.spread ? d.pageInfo.number + '–' + d.pageInfo.number2 : d.pageInfo.number}（${i + 1}/${ids.length}）` : `${i + 1}/${ids.length}`;
  }
  async bookSettings() {
    const d = this.doc;
    if (!d) return;
    const b = await bookDialog(d.book || defaultBook());
    if (!b) return;
    d.book = b; d.metaDirty = true;
    if (d.workId) { const w = await Store.getWork(d.workId); if (w) { w.book = b; await Store.putWork(w); if (this.work) { this.work = w; d.pageInfo = pageLayout(w)[Store.pageIds(w).indexOf(d.pageId)]; } } }
    this.scheduleSave(); this.view.request(); this.refreshPageNav();
  }
  openDoc(doc) {
    if (this.doc && this.doc !== doc) this.doc.comp.dispose();
    this.doc = doc;
    if (!doc.pageInfo && doc.book) doc.pageInfo = pageLayout({ id: doc.workId || 'x', book: doc.book })[0];
    doc.onChange = (kind) => this.onDocChange(kind);
    doc.history.onChange = () => this.refreshUndo();
    this.screen = 'editor';
    $('#gallery').hidden = true; $('#pages').hidden = true; $('#editor').hidden = false;
    $('#docTitle').textContent = doc.name;
    this.refreshPageNav();
    this.cameraEdit = false;
    if (animFolders(doc).length || doc.kind === 'anime') ensureAnim(doc);
    this.timeline.toggle(!!(doc.anim && (doc.kind === 'anime' || animFolders(doc).length)));
    this.view.rot = 0; this.view.flip = false;
    this.view.fitted = true;
    requestAnimationFrame(() => { this.view.resize(); this.view.fit(); });
    this.layerPanel.thumbs.clear();
    this.layerPanel.refresh();
    this.selLauncher.refresh();
    this.panels.refreshProps();
    this.refreshUndo();
    this.onViewFlags();
    this.setSaveState('saved');
  }
  async closeDoc() {
    if (!this.doc) { this.showGallery(); return; }
    if (this.transforming) this.transformTool.finish(true);
    this.closePanels();
    await this.saveNow();
    if (this.saveState === 'error' && !(await confirmBox('保存できていません', '保存に失敗しています。このまま作品一覧に戻りますか？（最後に保存した所までになります）', '戻る', true))) return;
    const wid = this.doc.workId, pid = this.doc.pageId, multi = this.work && this.work.pages;
    this.doc.comp.dispose();
    this.doc = null;
    this.view.request();
    if (multi) this.pageMgr.show(wid, pid); else this.showGallery();
  }
  onDocChange(kind) {
    this.view.request();
    if (kind === 'quiet') return;
    if (kind !== 'pixels' && this.timeline.open) this.timeline.render();
    if (kind !== 'pixels') this.layerPanel.refresh();
    this.selLauncher.refresh();
    this.scheduleSave();
  }
  onActiveChanged() { this.layerPanel.refresh(); this.panels.refreshProps(); this.view.request(); if (this.timeline.open) this.timeline.render(); }

  // ---- アニメーション
  setFrame(f) {
    const d = this.doc;
    if (!d) return;
    const A = ensureAnim(d);
    f = clamp(Math.round(f), 0, A.frames - 1);
    if (f !== A.cur) { A.cur = f; d.metaDirty = true; d.invalidateAll(); }
    AnimOps.followFrame(d);
    this.layerPanel.refresh();
    this.timeline.render(); this.timeline.scrollToCur();
    this.view.request();
  }
  toggleCamera(on = !this.cameraEdit) {
    if (on && !this.doc) return;
    if (on) ensureAnim(this.doc);
    this.cameraEdit = on;
    if (on && !this.timeline.open) this.timeline.toggle(true);
    this.timeline.render();
    this.panels.refreshQuick();
    this.view.request();
    if (on) toast('カメラの枠を動かすと、いまのフレームにキーを打ちます（中=移動・角=拡大縮小・丸=回転）', { ms: 3000 });
  }

  // ---- 変形
  startTransform(mode = 'scale') {
    if (!this.doc || this.view.mode === 'tool') return;
    if (this.transforming) { this.transformTool.setMode(mode); return; }
    this.closePanels();
    this.transformTool.start(mode);
  }
  enterTransform() { this.panels.refreshQuick(); this.selLauncher.refresh(); this.view.request(); }
  exitTransform() { this.panels.refreshQuick(); this.selLauncher.refresh(); this.view.request(); }
  closePanels() {
    if (this.adjustPanel.open) this.adjustPanel.close(false);
    if (this.textPanel.open) this.textPanel.close(true);
  }

  // ---- 色調補正・フィルター
  runAdjust(key, asLayer = false) {
    const doc = this.doc;
    if (!doc) return;
    if (this.transforming) this.transformTool.finish(true);
    const def = adjustDef(key);
    if (!asLayer) { this.adjustPanel.show(def); return; }
    const before = doc.snapshot();
    const l = new Layer('adjust', def.label);
    l.adj = { type: key, params: adjustDefaults(def) };
    LayerOps.placeNew(doc, l);
    doc.activeId = l.id;
    doc.invalidateAll();
    this.layerPanel.refresh();
    this.adjustPanel.show(def, { mode: 'layer', layer: l });
    this.adjustPanel.before = before;
    this.adjustPanel.onCancel = () => { doc.restore(before); doc.changed('struct'); };
  }
  editAdjustLayer(l) {
    if (!l.adj) return;
    this.layerPanel.refresh();
    this.adjustPanel.show(adjustDef(l.adj.type), { mode: 'layer', layer: l });
  }
  layerMoreMenu() {
    const d = this.doc, a = d && d.active;
    return [
      ['新規ベクターレイヤー', () => LayerOps.add(d, 'vector')],
      ['新規色調補正レイヤー（トーンカーブ）', () => this.runAdjust('curves', true)],
      ['新規色調補正レイヤー（色相・彩度・明度）', () => this.runAdjust('hsv', true)],
      '-',
      ['レイヤーマスクを作成', () => LayerOps.addMask(d)],
      ['選択範囲外をマスク', () => LayerOps.addMask(d, true)],
      [a && a.mask && a.maskOn ? 'マスクを無効にする' : 'マスクを有効にする', () => { if (a && a.mask) d.setProps(a, { maskOn: !a.maskOn }, 'マスクの有効/無効'); }],
      ['マスクを適用', () => LayerOps.applyMask(d)],
      ['マスクを削除', () => LayerOps.deleteMask(d)],
      '-',
      ['ラスタライズ', () => LayerOps.rasterize(d)],
      ['レイヤーを消去（中身を消す）', () => LayerOps.clear(d)],
      ['描いてある所を選択範囲に', () => SelOps.fromLayer(d)],
    ];
  }
  refreshUndo() {
    const h = this.doc && this.doc.history;
    $('#btnUndo').disabled = !(h && h.canUndo);
    $('#btnRedo').disabled = !(h && h.canRedo);
  }
  onViewFlags() {
    $('#btnFlip').classList.toggle('on', this.view.flip);
    const r = this.doc && this.doc.ruler;
    $('#btnSnap').hidden = !r;
    $('#btnSnap').classList.toggle('on', !!(r && this.settings.snap));
  }
  toggleSnap() { this.settings.snap = !this.settings.snap; this.saveSettings(); this.onViewFlags(); this.view.request(); toast(this.settings.snap ? '定規に吸い付きます' : '定規に吸い付きません', { ms: 900 }); }
  toggleCmykView() { const d = this.doc; if (!d) return; d.cmykView = !d.cmykView; d.invalidateAll(); this.view.request(); toast(d.cmykView ? 'CMYK プレビュー: 印刷したときの色の目安です（鮮やかな青・緑・蛍光色がくすみます）' : 'CMYK プレビューを終えました', { ms: 2600 }); }
  toggleMonoView() { const d = this.doc; if (!d) return; d.monoView = !d.monoView; d.invalidateAll(); this.view.request(); toast(d.monoView ? 'モノクロ2値で表示しています（印刷の見え方）' : 'カラーで表示しています', { ms: 1400 }); }
  async exportMono() {
    const d = this.doc;
    if (!d) return;
    this.busy('2値 PNG を作っています…');
    try { const b = await encodePNG1bit(d); this.busy(null); await shareOrDownload(b, `${d.name}_2値.png`); } catch (e) { this.busy(null); toast('書き出せません: ' + e.message, { error: true }); }
  }

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
    const pagesIn = el('input', { type: 'number', class: 'inp', min: 1, max: 400, value: 1 });
    const bindSel = el('select', { class: 'sel' }, el('option', { value: 'right' }, '右綴じ'), el('option', { value: 'left' }, '左綴じ'));
    const bookRow = el('div', { class: 'row3' }, el('div', {}, el('label', { class: 'lbl' }, 'ページ数'), pagesIn), el('div', {}, el('label', { class: 'lbl' }, '綴じ'), bindSel), el('div'));
    const upd = () => {
      wIn.value = sel.w; hIn.value = sel.h; dpiIn.value = sel.dpi;
      bindSel.disabled = !sel.book;
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
      el('label', { class: 'lbl' }, '用紙'), paperSel, bookRow, note,
      el('p', { class: 'hint' }, 'ページ数を 2 以上にすると、ページ管理のある作品になります（あとから足すこともできます）。マンガ原稿は仕上がり線・基本枠のガイドが出ます。')));
    upd();
    const ok = await modal({ title: '新規作成', body, wide: true, buttons: [{ label: 'キャンセル', value: false }, { label: '作成', value: true, primary: true }] });
    if (!ok) return;
    const w = Math.round(+wIn.value), h = Math.round(+hIn.value);
    if (!(w >= 16 && h >= 16) || w * h > MAX_PIXELS) { toast(`大きさは 16px 以上・${MAX_PIXELS / 1e6}M 画素までです`, { error: true }); return; }
    const name = nameIn.value.trim() || sel.name.replace(/（.*$/, ''), dpi = +dpiIn.value || 350, pages = clamp(Math.round(+pagesIn.value || 1), 1, 400);
    const book = sel.book && w === sel.w && h === sel.h ? { ...defaultBook(sel.book), binding: bindSel.value } : null;
    if (pages > 1) {
      this.busy(`${pages} ページを作っています…`);
      try {
        const work = await PageOps.create({ name, dpi, kind: sel.kind, book, pages, paper: paperSel.value || null, w, h });
        this.busy(null);
        await this.openPage(work.id, work.pages[0].id);
      } catch (e) { this.busy(null); toast('作れませんでした: ' + e.message, { error: true }); }
      return;
    }
    const doc = Doc.create({ width: w, height: h, dpi, name, paper: paperSel.value || null, kind: sel.kind });
    doc.book = book;
    doc.goods = sel.goods ? { ...sel.goods } : null;
    if (sel.kind === 'anime') {
      // アニメ: 背景レイヤー＋アニメーションフォルダー（セル 1）から
      ensureAnim(doc);
      doc.active.name = '背景';
      const f = new Layer('folder', 'アニメーション 1'); f.blend = 'normal'; f.anim = true;
      const cel = new Layer('raster', '1'); f.children.push(cel); f.timing = [{ f: 0, cel: cel.id }];
      doc.root.children.push(f); doc.activeId = cel.id;
    }
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
    try {
      const z = unzipStore(await f.arrayBuffer());
      if (z.get('work.json')) { const wid = await importWorkEgk(z, (f.name || '作品').replace(/\.egk$/i, '')); this.busy(null); this.pageMgr.show(wid); return; }
      const d = await importEgk(f); d.workId = null; d.pageId = null; this.openDoc(d); await this.saveNow();
    }
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
      this.startTransform();             // 読み込んだらすぐ大きさ・位置を合わせられるように
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
        ['2値 PNG（モノクロ原稿・1ビット）で書き出す', () => this.exportMono()],
        ['作業レイヤーだけを PNG で書き出す（白版・カットラインなど）', () => GoodsOps.exportLayerPNG(this)],
        ['作品ファイル（.egk）で書き出す', () => this.exportEgkCurrent()],
        ['書き出し（トンボ・ノンブル・全ページ・見開き）…', () => Exporter.dialog(this)],
        ['Webtoon 用に分割して書き出す…', () => Exporter.webtoon(this)],
        '-',
        ['作品の設定（仕上がり・基本枠・綴じ・ノンブル）…', () => this.bookSettings()],
        ['アニメーションを書き出す（MP4・GIF・連番）…', () => VideoExport.dialog(this)],
        ['ページ管理', async () => { if (!this.doc) return; const wid = this.doc.workId; const w = await Store.getWork(wid); if (w && !w.pages) { PageOps.ensureMulti(w); await Store.putWork(w); } await this.closeDoc(); if (!this.work) this.pageMgr.show(wid); }],
        '-',
        ['今すぐ保存', async () => { await this.saveNow(); if (this.saveState === 'saved') toast('保存しました'); }],
        ['作品の情報', () => this.docInfo()],
      ],
      edit: [
        ['取り消し', () => this.undo(), '⌘Z'],
        ['やり直し', () => this.redo(), '⇧⌘Z'],
        '-',
        ['切り取り', () => Clip.copy(d(), true), '⌘X'],
        ['コピー', () => Clip.copy(d()), '⌘C'],
        ['貼り付け', () => Clip.paste(this), '⌘V'],
        '-',
        ['拡大・縮小・回転', () => this.startTransform('scale'), '⌘T'],
        ['自由変形', () => this.startTransform('free')],
        ['メッシュ変形', () => this.startTransform('mesh')],
        '-',
        ['メインカラーでレイヤーを塗りつぶす', () => fillLayerSolid(d(), this.color.main)],
        ['選択範囲の中を消去', () => SelOps.clear(d()), 'Del'],
      ],
      select: [
        ['すべてを選択', () => SelOps.all(d()), '⌘A'],
        ['選択を解除', () => SelOps.none(d()), '⌘D'],
        ['選択範囲を反転', () => SelOps.invert(d()), '⇧⌘I'],
        '-',
        ['選択範囲を広げる', () => SelOps.grow(this, 1)],
        ['選択範囲を縮める', () => SelOps.grow(this, -1)],
        ['境界をぼかす', () => SelOps.feather(this)],
        '-',
        ['描いてある所を選択', () => SelOps.fromLayer(d())],
        ['選択範囲の外を消去', () => SelOps.clearOutside(d())],
        ['選択範囲をメインカラーで塗る', () => SelOps.fill(d(), this.color.main)],
        ['選択範囲を新しいレイヤーに', () => Clip.toNewLayer(this)],
      ],
      adjust: [
        ...ADJUSTMENTS.map((a) => [a.label, () => this.runAdjust(a.key)]),
        '-',
        ...ADJUSTMENTS.filter((a) => a.key !== 'invert').map((a) => [a.label + '（補正レイヤー）', () => this.runAdjust(a.key, true)]),
      ],
      filter: FILTERS.map((f) => [f.label, () => this.runAdjust(f.key)]),
      manga: [
        ['コマ枠を作成（基本枠）', () => FrameOps.createDialog(this)],
        ['コマ枠ツール（枠線分割）', () => { this.setTool('frame'); }],
        '-',
        ['トーンを貼る（選択範囲）', () => ToneOps.dialog(this)],
        ['作業レイヤーをトーンにする／やめる', () => ToneOps.toggle(this)],
        ['トーンの設定', () => { const a = d().active; if (a && a.tone) ToneOps.dialog(this, { layer: a }); else toast('トーンのレイヤーを選んでください'); }],
        ['作業レイヤーをモノクロ（2値）にする／戻す', () => { const a = d().active; if (a && a.hasTiles) d().setProps(a, { mono: !a.mono }, '表現色'); }],
        '-',
        ['効果線（集中線・流線・ウニフラ）', () => this.setTool('fx')],
        ['フキダシ', () => this.setTool('balloon')],
        ['定規', () => this.setTool('ruler')],
        [this.settings.snap ? '定規に吸い付かない' : '定規に吸い付く', () => this.toggleSnap()],
        '-',
        ['モノクロ2値で表示する／戻す', () => this.toggleMonoView()],
        ['CMYK プレビュー（印刷の色の目安）', () => this.toggleCmykView()],
        ['カットライン・白版を作る（グッズ）…', () => GoodsOps.cutLineDialog(this)],
        ['2値 PNG（1ビット）で書き出す', () => this.exportMono()],
      ],
      layer: [
        ['新規ラスターレイヤー', () => LayerOps.add(d()), '⇧⌘N'],
        ['新規フォルダー', () => LayerOps.add(d(), 'folder')],
        ['新規ベクターレイヤー', () => LayerOps.add(d(), 'vector')],
        ['新規アニメーションフォルダー', () => { AnimOps.newFolder(this); this.timeline.toggle(true); }],
        ['レイヤーを複製', () => LayerOps.duplicate(d())],
        ['レイヤーを削除', () => LayerOps.remove(d())],
        '-',
        ['下のレイヤーに結合', () => LayerOps.mergeDown(d()), '⌘E'],
        ['下のレイヤーでクリッピング', () => { const a = d().active; if (a && a.kind !== 'paper') d().setProps(a, { clip: !a.clip }, 'クリッピング'); }],
        ['下描きレイヤーにする／戻す', () => { const a = d().active; if (a && a.kind !== 'paper') d().setProps(a, { draft: !a.draft }, '下描きレイヤー'); }],
        ['参照レイヤーにする／戻す', () => { const a = d().active; if (a && a.kind !== 'paper') d().setProps(a, { ref: !a.ref }, '参照レイヤー'); }],
        '-',
        ['レイヤーマスクを作成', () => LayerOps.addMask(d())],
        ['選択範囲外をマスク', () => LayerOps.addMask(d(), true)],
        ['マスクを適用', () => LayerOps.applyMask(d())],
        ['マスクを削除', () => LayerOps.deleteMask(d())],
        ['ラスタライズ', () => LayerOps.rasterize(d())],
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
        ['タイムライン（アニメーション）', () => this.timeline.toggle()],
        ['再生（プレーヤー）', () => this.player.show()],
        ['CMYK プレビュー（印刷の色の目安）', () => this.toggleCmykView()],
        ['仕上がり線・基本枠のガイド', () => { this.settings.guides = !this.settings.guides; this.saveSettings(); this.view.request(); }],
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
    $('#btnSnap').onclick = () => this.toggleSnap();
    $('#pgPrev').onclick = () => this.goPage(-1);
    $('#pgNext').onclick = () => this.goPage(1);
    $('#pageNum').onclick = () => { if (this.work) this.closeDoc(); };
    $('#pgBack').onclick = () => this.showGallery();
    $('#pgAdd').onclick = () => this.pageMgr.addPage(false);
    $('#pgAddSpread').onclick = () => this.pageMgr.addPage(true);
    $('#pgSettings').onclick = () => this.pageMgr.settings();
    $('#pgExport').onclick = async () => {
      const w = this.pageMgr.work;
      // 書き出しは1ページ目を開いてから（ページの絵を読むため）
      await this.openPage(w.id, Store.pageIds(w)[0]);
      Exporter.dialog(this);
    };
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
      if (mod && k === 'a') { e.preventDefault(); SelOps.all(this.doc); return; }
      if (mod && k === 'd') { e.preventDefault(); SelOps.none(this.doc); return; }
      if (mod && e.shiftKey && k === 'i') { e.preventDefault(); SelOps.invert(this.doc); return; }
      if (mod && k === 't') { e.preventDefault(); this.startTransform(); return; }
      if (mod && k === 'c') { e.preventDefault(); Clip.copy(this.doc); return; }
      if (mod && k === 'x') { e.preventDefault(); Clip.copy(this.doc, true); return; }
      if (mod && k === 'v') { e.preventDefault(); Clip.paste(this); return; }
      if (mod && e.shiftKey && k === 'n') { e.preventDefault(); LayerOps.add(this.doc); return; }
      if (mod) return;
      if (this.doc.anim && (e.key === ',' || e.key === '.')) { e.preventDefault(); this.setFrame(this.doc.anim.cur + (e.key === '.' ? 1 : -1)); return; }
      if (this.doc.anim && e.key === '>') { e.preventDefault(); AnimOps.nextDrawing(this); return; }
      if (k === 'pageup' || k === 'pagedown') { e.preventDefault(); this.goPage(k === 'pagedown' ? 1 : -1); return; }
      if (k === ' ') { this.view.spaceDown = true; e.preventDefault(); return; }
      if (k === 'tab') { e.preventDefault(); this.togglePanels(); return; }
      if (k === 'x') { this.color.swap(); return; }
      if (k === 'c') { this.color.setTransparent(!this.color.transparent); return; }
      if (k === 'delete' || k === 'backspace') { if (this.toolName === 'balloon' && this.tools.balloon.selId != null) this.tools.balloon.removeSelected(); else SelOps.clear(this.doc); return; }
      if (k === 'enter') {
        if (this.transforming) this.transformTool.finish(true);
        else if (this.tools.select.poly) this.tools.select.closePoly();
        return;
      }
      if (k === 'escape') {
        if (this.transforming) this.transformTool.finish(false);
        else if (this.tools.select.poly) { this.tools.select.poly = null; this.view.request(); }
        return;
      }
      if (e.key === '[' || e.key === ']') {
        const b = this.brush;
        if (b) { this.updateBrush({ size: clamp(Math.round(b.size * (e.key === ']' ? 1.15 : 1 / 1.15) * 10) / 10, 0.5, 1000) }); this.panels.refreshProps(); }
        return;
      }
      if (k === 'h' && e.shiftKey) { this.view.toggleFlip(); return; }
      if (k === 'r' && e.shiftKey) { this.view.rotateBy(Math.PI / 12); return; }
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
