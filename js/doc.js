'use strict';
/* 文書・レイヤー・履歴。
   レイヤーは 256px タイルの Map（描いていない所はタイル無し＝透明）。木は root.children（下→上）。
   マスクは「隠す量」のタイル（白・アルファ。タイル無し＝隠さない）。選択範囲は Selection（selection.js）。 */

const BLEND_MODES = [
  { key: 'normal', label: '通常', op: 'source-over' },
  { key: 'passthrough', label: '通過', op: 'source-over', folderOnly: true },
  { key: 'darken', label: '比較（暗）', op: 'darken' },
  { key: 'multiply', label: '乗算', op: 'multiply' },
  { key: 'color-burn', label: '焼き込みカラー', op: 'color-burn' },
  { key: 'lighten', label: '比較（明）', op: 'lighten' },
  { key: 'screen', label: 'スクリーン', op: 'screen' },
  { key: 'color-dodge', label: '覆い焼きカラー', op: 'color-dodge' },
  { key: 'add', label: '加算（発光）', op: 'lighter' },
  { key: 'overlay', label: 'オーバーレイ', op: 'overlay' },
  { key: 'soft-light', label: 'ソフトライト', op: 'soft-light' },
  { key: 'hard-light', label: 'ハードライト', op: 'hard-light' },
  { key: 'difference', label: '差の絶対値', op: 'difference' },
  { key: 'exclusion', label: '除外', op: 'exclusion' },
  { key: 'hue', label: '色相', op: 'hue' },
  { key: 'saturation', label: '彩度', op: 'saturation' },
  { key: 'color', label: 'カラー', op: 'color' },
  { key: 'luminosity', label: '輝度', op: 'luminosity' },
];
const BLEND_OP = Object.fromEntries(BLEND_MODES.map((m) => [m.key, m.op]));

/* 構造の履歴・保存で写す属性（text・adj は差し替えて使う＝中身を書き換えない） */
const LAYER_PROPS = ['name', 'visible', 'opacity', 'blend', 'clip', 'locked', 'alphaLock', 'ref', 'draft', 'open', 'color', 'label', 'maskOn', 'text', 'adj', 'frame', 'tone', 'mono'];
const KIND_NAMES = { raster: 'ラスター', vector: 'ベクター', text: 'テキスト', adjust: '色調補正', balloon: 'フキダシ', folder: 'フォルダー', paper: '用紙' };

let _layerSeq = 1;
function bumpLayerSeq(n) { if (n >= _layerSeq) _layerSeq = n + 1; }

class Layer {
  constructor(kind = 'raster', name = '') {
    this.id = _layerSeq++;
    this.kind = kind;              // 'raster' | 'vector' | 'text' | 'adjust' | 'folder' | 'paper' | 'root'
    this.name = name;
    this.visible = true;
    this.opacity = 1;
    this.blend = kind === 'folder' ? 'passthrough' : 'normal';
    this.clip = false;
    this.locked = false;
    this.alphaLock = false;
    this.ref = false;              // 参照レイヤー（塗りつぶしの参照先）
    this.draft = false;            // 下描き（書き出さない）
    this.open = true;              // フォルダの開閉
    this.color = '#ffffff';        // 用紙の色
    this.label = null;
    this.maskOn = true;
    this.text = null;              // テキストの設定（text.js）
    this.adj = null;               // 色調補正の設定 {type, params}（adjust.js）
    this.frame = null;             // コマ枠（フォルダー）{pts, width, color}（manga.js）
    this.tone = null;              // トーン {lpi, angle, shape, color}
    this.mono = false;             // 表現色モノクロ（2値）
    this.tiles = kind === 'raster' || kind === 'vector' || kind === 'text' || kind === 'balloon' ? new Map() : null;
    this.balloons = kind === 'balloon' ? [] : null;
    this.children = kind === 'folder' || kind === 'root' ? [] : null;
    this.strokes = kind === 'vector' ? [] : null;   // ベクターの線（vector.js）
    this.mask = null;              // Map（隠す量）| null
    this.offset = null;            // 移動中の見た目のずれ {dx, dy}
    this.ver = 0;                  // サムネイル更新用
  }
  get isFolder() { return this.kind === 'folder'; }
  get isRaster() { return this.kind === 'raster'; }
  get hasTiles() { return !!this.tiles; }
  /* 描いてある範囲（タイル単位） */
  tileBounds(map = this.tiles) {
    if (!map) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const k of map.keys()) { const [tx, ty] = parseKey(k); x0 = Math.min(x0, tx); y0 = Math.min(y0, ty); x1 = Math.max(x1, tx); y1 = Math.max(y1, ty); }
    return x0 === Infinity ? null : { x: x0 * TILE, y: y0 * TILE, w: (x1 - x0 + 1) * TILE, h: (y1 - y0 + 1) * TILE };
  }
}

class Doc {
  constructor({ width, height, dpi = 350, name = '名称未設定', paper = '#ffffff', kind = 'illust' } = {}) {
    this.width = width; this.height = height; this.dpi = dpi;
    this.name = name;
    this.kind = kind;
    this.workId = null;
    this.root = new Layer('root', 'root');
    this.root.id = 0;
    const p = new Layer('paper', '用紙');
    if (paper) p.color = paper; else p.visible = false;
    this.root.children.push(p);
    this.activeId = null;
    this.maskEdit = false;         // true = 作業レイヤーのマスクに描く
    this.sel = null;               // Selection | null（全体）
    this.stroke = null;            // 描いている途中のストローク（compose.js が重ねて見せる）
    this.cut = null;               // 変形中: {layer, sel} 元の画素を隠す
    this.preview = null;           // 補正・フィルターの試し表示: {layer, tiles: Map}
    this.ruler = null;             // 定規（ruler.js）
    this.monoView = false;         // 画面をモノクロ2値で見る
    this.unsaved = new Set();      // 'layerId/tx,ty'（マスクは 'layerId/m:tx,ty'）
    this.metaDirty = true;
    this.cols = Math.ceil(width / TILE); this.rows = Math.ceil(height / TILE);
    this.comp = new Comp(this);
    this.history = new History(this);
    this.onChange = null;
  }

  static create(opts) {
    const d = new Doc(opts);
    const l = new Layer('raster', 'レイヤー 1');
    d.root.children.push(l);
    d.activeId = l.id;
    return d;
  }

  get paper() { return this.root.children.find((l) => l.kind === 'paper'); }
  get active() { return this.find(this.activeId); }
  get fullRect() { return { x: 0, y: 0, w: this.width, h: this.height }; }

  *walk(list = this.root.children) {
    for (const l of list) { yield l; if (l.children) yield* this.walk(l.children); }
  }
  layers() { return [...this.walk()]; }
  find(id) { for (const l of this.walk()) if (l.id === id) return l; return null; }
  parentOf(layer, node = this.root) {
    for (const c of node.children) {
      if (c === layer) return node;
      if (c.children) { const p = this.parentOf(layer, c); if (p) return p; }
    }
    return null;
  }
  effectiveVisible(layer) { for (let l = layer; l && l !== this.root; l = this.parentOf(l)) if (!l.visible) return false; return true; }
  effectiveLocked(layer) { for (let l = layer; l && l !== this.root; l = this.parentOf(l)) if (l.locked) return true; return false; }
  /* 文書の中のタイル番号か */
  inGrid(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows; }
  *gridKeys(r = this.fullRect) {
    const { tx0, ty0, tx1, ty1 } = tilesOfRect(r);
    for (let ty = Math.max(0, ty0); ty <= Math.min(this.rows - 1, ty1); ty++)
      for (let tx = Math.max(0, tx0); tx <= Math.min(this.cols - 1, tx1); tx++) yield [tx, ty, tkey(tx, ty)];
  }

  // ---- 合成キャッシュの無効化
  invalidateKey(key) { const [tx, ty] = parseKey(key); this.comp.invalidate(tx, ty); }
  invalidateRect(r) { for (const [tx, ty] of this.gridKeys(r)) this.comp.invalidate(tx, ty); }
  invalidateLayer(layer) {
    if (layer.tiles) { for (const k of layer.tiles.keys()) this.invalidateKey(k); if (layer.mask) for (const k of layer.mask.keys()) this.invalidateKey(k); }
    else this.comp.invalidateAll();
  }
  invalidateAll() { this.comp.invalidateAll(); }
  markTile(layer, key, mask = false) { this.unsaved.add(layer.id + '/' + (mask ? 'm:' : '') + key); }
  changed(kind = 'pixels') { if (kind !== 'pixels') this.metaDirty = true; if (this.onChange) this.onChange(kind); }

  // ---- ストローク（ブラシ・図形・グラデーション・塗りつぶしが共通で使う）
  /* target: 'tiles' = 画素、'mask' = マスク（erase=true で隠す、false で見せる） */
  beginStroke(layer, { erase = false, opacity = 1, alphaLock = false, grain = null, target = 'tiles', useSel = true } = {}) {
    this.stroke = { layer, tiles: new Map(), erase, opacity, alphaLock: target === 'tiles' && (alphaLock || layer.alphaLock), grain, target, sel: useSel ? this.sel : null };
    return this.stroke;
  }
  strokeTile(tx, ty) {
    const s = this.stroke, k = tkey(tx, ty);
    let c = s.tiles.get(k);
    if (!c) { c = TilePool.get(); s.tiles.set(k, c); }
    return c;
  }
  clearStroke() {
    if (!this.stroke) return;
    for (const [k, c] of this.stroke.tiles) { this.invalidateKey(k); TilePool.put(c); }
    this.stroke.tiles.clear();
  }
  cancelStroke() { this.clearStroke(); this.stroke = null; }
  /* ストロークをレイヤー（またはマスク）に焼き込んで履歴に積む */
  commitStroke(label) {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    const layer = s.layer, isMask = s.target === 'mask';
    if (isMask && !layer.mask) layer.mask = new Map();
    const map = isMask ? layer.mask : layer.tiles;
    const before = new Map();
    for (const [k, st] of s.tiles) {
      let cur = map.get(k);
      // 画素: 消す・透明保護で元が無ければ変化なし。マスク: 見せる（隠す量を減らす）で元が無ければ変化なし
      const noop = isMask ? !s.erase && !cur : !cur && (s.erase || s.alphaLock);
      if (noop || (s.sel && !s.sel.tiles.has(k))) { TilePool.put(st); continue; }
      before.set(k, cur ? copyTile(cur) : null);
      if (!cur) { cur = TilePool.get(); map.set(k, cur); }
      applyStrokeTile(ctx2d(cur), st, isMask ? { ...s, erase: !s.erase, alphaLock: false } : s, k);
      TilePool.put(st);
      this.invalidateKey(k);
      this.markTile(layer, k, isMask);
    }
    if (before.size) { layer.ver++; this.history.push(new PixelCmd(label, layer, before, isMask ? 'mask' : 'tiles')); this.changed(); }
  }

  /* 画素を直接いじる操作: fn(touch) の中で touch(key) してから書き換える */
  pixelEdit(label, layer, fn, prop = 'tiles') {
    const map = layer[prop];
    const before = new Map();
    const touch = (k) => { if (!before.has(k)) { const c = map.get(k); before.set(k, c ? copyTile(c) : null); } };
    fn(touch);
    for (const k of before.keys()) { this.invalidateKey(k); this.markTile(layer, k, prop === 'mask'); }
    if (before.size) { layer.ver++; this.history.push(new PixelCmd(label, layer, before, prop)); this.changed(); }
  }
  /* タイルの Map を丸ごと入れ替える（変形・フィルターの確定）。古いタイルは履歴が持つ */
  replaceTiles(label, layer, newTiles, keys, prop = 'tiles') {
    const map = layer[prop];
    const before = new Map();
    for (const k of keys) {
      before.set(k, map.get(k) || null);
      const n = newTiles.get(k);
      if (n) map.set(k, n); else map.delete(k);
      this.invalidateKey(k);
      this.markTile(layer, k, prop === 'mask');
    }
    layer.ver++;
    this.history.push(new PixelCmd(label, layer, before, prop));
    this.changed();
  }

  // ---- 選択範囲
  setSel(sel, label = '選択範囲') {
    if (sel && sel.empty) sel = null;
    if (sel === this.sel) return;
    this.history.push(new SelCmd(label, this.sel, sel));
    this.sel = sel;
    this.changed('sel');
  }

  // ---- 構造
  snapshot() {
    const snap = (node) => ({ layer: node, props: Object.fromEntries([...LAYER_PROPS, 'kind'].map((k) => [k, node[k]])), mask: node.mask, strokes: node.strokes, balloons: node.balloons, children: node.children ? node.children.map(snap) : null });
    return { tree: snap(this.root), activeId: this.activeId };
  }
  restore(s) {
    const apply = (n) => {
      Object.assign(n.layer, n.props);
      n.layer.mask = n.mask;
      n.layer.strokes = n.strokes;
      n.layer.balloons = n.balloons;
      if (n.children) n.layer.children = n.children.map((c) => { apply(c); return c.layer; });
    };
    apply(s.tree);
    this.activeId = s.activeId;
    this.invalidateAll();
    this.metaDirty = true;
  }
  structEdit(label, fn) {
    const before = this.snapshot();
    const r = fn();
    if (r === false) return false;
    const after = this.snapshot();
    this.history.push(new StructCmd(label, before, after));
    this.invalidateAll();
    this.changed('struct');
    return r;
  }
  setProps(layer, props, label = 'レイヤーの設定', mergeKey = null) {
    const before = this.snapshot();
    Object.assign(layer, props);
    const after = this.snapshot();
    this.history.push(new StructCmd(label, before, after), mergeKey ? mergeKey + layer.id : null);
    this.invalidateLayer(layer);
    if ('clip' in props || 'visible' in props || 'blend' in props || 'adj' in props || layer.kind === 'adjust') this.invalidateAll();
    this.changed('struct');
  }
  /* 履歴に残さず属性を変える（開いている設定画面の途中の値。確定時に呼ぶ側が1手にする） */
  setPropsQuiet(layer, props) {
    Object.assign(layer, props);
    if (layer.kind === 'adjust' || 'visible' in props || 'clip' in props) this.invalidateAll(); else this.invalidateLayer(layer);
    if (this.onChange) this.onChange('quiet');
  }
}

/* ストロークのタイルを、レイヤーのタイルに重ねる（合成の見た目と確定で同じ処理）。
   紙の質感・選択範囲で削ってから、不透明度付きで重ねる */
let _grainTmp = null;
function applyStrokeTile(g, st, s, key) {
  let src = st;
  const selTile = s.sel ? s.sel.tiles.get(key) : null;
  if (s.sel && !selTile) return;
  if (s.grain || selTile) {
    if (!_grainTmp) _grainTmp = newCanvas(TILE, TILE);
    const t = _grainTmp.getContext('2d');
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'copy'; t.globalAlpha = 1;
    t.drawImage(st, 0, 0);
    if (s.grain) { t.globalCompositeOperation = 'destination-out'; t.drawImage(s.grain, 0, 0); }   // 質感は 256px 周期＝タイルと同じ
    if (selTile) { t.globalCompositeOperation = 'destination-in'; t.drawImage(selTile, 0, 0); }
    t.globalCompositeOperation = 'source-over';
    src = _grainTmp;
  }
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = s.opacity;
  g.globalCompositeOperation = s.erase ? 'destination-out' : s.alphaLock ? 'source-atop' : 'source-over';
  g.drawImage(src, 0, 0);
  g.restore();
}

/* ---- 履歴 */
class PixelCmd {
  constructor(label, layer, tiles, prop = 'tiles') { this.label = label; this.layer = layer; this.tiles = tiles; this.prop = prop; }
  get bytes() { return this.tiles.size * TILE * TILE * 4; }
  swap(doc) {
    const L = this.layer;
    if (!L[this.prop]) L[this.prop] = new Map();
    const map = L[this.prop];
    for (const [k, stored] of this.tiles) {
      const cur = map.get(k) || null;
      if (stored) map.set(k, stored); else map.delete(k);
      this.tiles.set(k, cur);
      doc.invalidateKey(k);
      doc.markTile(L, k, this.prop === 'mask');
    }
    L.ver++;
  }
  undo(doc) { this.swap(doc); }
  redo(doc) { this.swap(doc); }
  dispose() { for (const c of this.tiles.values()) TilePool.put(c); }
}
class StructCmd {
  constructor(label, before, after) { this.label = label; this.before = before; this.after = after; }
  get bytes() { return 2000; }
  undo(doc) { doc.restore(this.before); }
  redo(doc) { doc.restore(this.after); }
  dispose() {}
}
class SelCmd {
  constructor(label, before, after) { this.label = label; this.before = before; this.after = after; }
  get bytes() { return ((this.before ? this.before.tiles.size : 0) + (this.after ? this.after.tiles.size : 0)) * TILE * TILE * 2; }
  undo(doc) { doc.sel = this.before; }
  redo(doc) { doc.sel = this.after; }
  dispose() {}
}
/* 値を差し替えて、描き直しを呼ぶ汎用の1手（テキスト・ベクター） */
class SwapCmd {
  constructor(label, layer, key, before, after, rerender) { Object.assign(this, { label, layer, key, before, after, rerender }); }
  get bytes() { return 4000; }
  undo(doc) { this.layer[this.key] = this.before; this.rerender(doc, this.layer, this.after, this.before); }
  redo(doc) { this.layer[this.key] = this.after; this.rerender(doc, this.layer, this.before, this.after); }
  dispose() {}
}
class MultiCmd {
  constructor(label, cmds) { this.label = label; this.cmds = cmds; }
  get bytes() { return this.cmds.reduce((s, c) => s + c.bytes, 0); }
  undo(doc) { for (let i = this.cmds.length - 1; i >= 0; i--) this.cmds[i].undo(doc); }
  redo(doc) { for (const c of this.cmds) c.redo(doc); }
  dispose() { for (const c of this.cmds) c.dispose(); }
}

class History {
  constructor(doc) {
    this.doc = doc;
    this.undoStack = []; this.redoStack = [];
    this.maxSteps = 120;
    this.maxBytes = 320 * 1024 * 1024;
    this.group = null;
    this.depth = 0;
    this.lastMerge = null;
  }
  push(cmd, mergeKey = null) {
    if (this.group) { this.group.push(cmd); return; }
    for (const c of this.redoStack) c.dispose();
    this.redoStack = [];
    const top = this.undoStack[this.undoStack.length - 1];
    if (mergeKey && this.lastMerge === mergeKey && top instanceof StructCmd && cmd instanceof StructCmd && performance.now() - this.lastT < 1500) {
      top.after = cmd.after;
      this.lastT = performance.now();
      this.notify();
      return;
    }
    this.lastMerge = mergeKey; this.lastT = performance.now();
    this.undoStack.push(cmd);
    this.trim();
    this.notify();
  }
  /* begin〜end を1手に（入れ子にしてよい） */
  begin() { if (this.depth++ === 0) this.group = []; }
  end(label) {
    if (--this.depth > 0) return;
    const g = this.group;
    this.group = null;
    if (g && g.length) this.push(g.length === 1 ? g[0] : new MultiCmd(label, g));
  }
  trim() {
    let bytes = this.undoStack.reduce((s, c) => s + c.bytes, 0);
    while (this.undoStack.length > 1 && (this.undoStack.length > this.maxSteps || bytes > this.maxBytes)) {
      const c = this.undoStack.shift();
      bytes -= c.bytes;
      c.dispose();
    }
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  undo() {
    const c = this.undoStack.pop();
    if (!c) return null;
    c.undo(this.doc);
    this.redoStack.push(c);
    this.lastMerge = null;
    this.doc.changed('struct');
    this.notify();
    return c.label;
  }
  redo() {
    const c = this.redoStack.pop();
    if (!c) return null;
    c.redo(this.doc);
    this.undoStack.push(c);
    this.lastMerge = null;
    this.doc.changed('struct');
    this.notify();
    return c.label;
  }
  clear() { for (const c of [...this.undoStack, ...this.redoStack]) c.dispose(); this.undoStack = []; this.redoStack = []; this.notify(); }
  notify() { if (this.onChange) this.onChange(); }
}
