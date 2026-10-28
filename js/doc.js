'use strict';
/* 文書・レイヤー・履歴。
   レイヤーは 256px タイルの Map（描いていない所はタイル無し＝透明）。木は root.children（下→上）。 */

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

/* 構造の履歴・保存で写す属性 */
const LAYER_PROPS = ['name', 'visible', 'opacity', 'blend', 'clip', 'locked', 'alphaLock', 'ref', 'draft', 'open', 'color', 'label'];

let _layerSeq = 1;
function bumpLayerSeq(n) { if (n >= _layerSeq) _layerSeq = n + 1; }

class Layer {
  constructor(kind = 'raster', name = '') {
    this.id = _layerSeq++;
    this.kind = kind;              // 'raster' | 'folder' | 'paper' | 'root'
    this.name = name;
    this.visible = true;
    this.opacity = 1;
    this.blend = kind === 'folder' ? 'passthrough' : 'normal';
    this.clip = false;
    this.locked = false;
    this.alphaLock = false;
    this.ref = false;              // 参照レイヤー（塗りつぶしの参照先）
    this.draft = false;            // 下書き（書き出さない）
    this.open = true;              // フォルダの開閉
    this.color = '#ffffff';        // 用紙の色
    this.label = null;             // レイヤーカラー（一覧の色札）
    this.tiles = kind === 'raster' ? new Map() : null;
    this.children = kind === 'folder' || kind === 'root' ? [] : null;
    this.offset = null;            // 移動中の見た目のずれ {dx, dy}
    this.ver = 0;                  // サムネイル更新用
  }
  get isFolder() { return this.kind === 'folder'; }
  get isRaster() { return this.kind === 'raster'; }
  /* 描いてある範囲（タイル単位） */
  tileBounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const k of this.tiles.keys()) { const [tx, ty] = parseKey(k); x0 = Math.min(x0, tx); y0 = Math.min(y0, ty); x1 = Math.max(x1, tx); y1 = Math.max(y1, ty); }
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
    this.stroke = null;            // 描いている途中のストローク（compose.js が重ねて見せる）
    this.unsaved = new Set();      // 'layerId/tx,ty'
    this.metaDirty = true;
    this.cols = Math.ceil(width / TILE); this.rows = Math.ceil(height / TILE);
    this.comp = new Comp(this);
    this.history = new History(this);
    this.onChange = null;          // app が設定: 構造・画素が変わった時
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

  *walk(list = this.root.children) {          // 下から上へ、フォルダの中も
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
  /* 祖先のどれかが非表示・ロックか */
  effectiveVisible(layer) { for (let l = layer; l && l !== this.root; l = this.parentOf(l)) if (!l.visible) return false; return true; }
  effectiveLocked(layer) { for (let l = layer; l && l !== this.root; l = this.parentOf(l)) if (l.locked) return true; return false; }

  // ---- 合成キャッシュの無効化
  invalidateKey(key) { const [tx, ty] = parseKey(key); this.comp.invalidate(tx, ty); }
  invalidateRect(r) {
    const { tx0, ty0, tx1, ty1 } = tilesOfRect(r);
    for (let ty = Math.max(0, ty0); ty <= Math.min(this.rows - 1, ty1); ty++)
      for (let tx = Math.max(0, tx0); tx <= Math.min(this.cols - 1, tx1); tx++) this.comp.invalidate(tx, ty);
  }
  invalidateLayer(layer) {
    if (layer.tiles) { for (const k of layer.tiles.keys()) this.invalidateKey(k); }
    else if (layer.children) for (const c of layer.children) this.invalidateLayer(c);
    else this.comp.invalidateAll();
  }
  invalidateAll() { this.comp.invalidateAll(); }
  markTile(layer, key) { this.unsaved.add(layer.id + '/' + key); }
  changed(kind = 'pixels') { if (kind !== 'pixels') this.metaDirty = true; if (this.onChange) this.onChange(kind); }

  // ---- ストローク（ブラシ・投げなわ塗り・塗りつぶしが共通で使う）
  beginStroke(layer, { erase = false, opacity = 1, alphaLock = false, grain = null, color = null } = {}) {
    this.stroke = { layer, tiles: new Map(), erase, opacity, alphaLock: alphaLock || layer.alphaLock, grain };
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
  /* ストロークをレイヤーに焼き込んで履歴に積む */
  commitStroke(label) {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    const layer = s.layer, before = new Map();
    for (const [k, st] of s.tiles) {
      let cur = layer.tiles.get(k);
      if (!cur && (s.erase || s.alphaLock)) { TilePool.put(st); continue; }
      before.set(k, cur ? copyTile(cur) : null);
      if (!cur) { cur = TilePool.get(); layer.tiles.set(k, cur); }
      applyStrokeTile(ctx2d(cur), st, s);
      TilePool.put(st);
      this.invalidateKey(k);
      this.markTile(layer, k);
    }
    if (before.size) { layer.ver++; this.history.push(new PixelCmd(label, layer, before)); this.changed(); }
  }

  /* 画素を直接いじる操作（移動・消去・結合など）: fn がタイルを書き換える前に呼ぶ */
  pixelEdit(label, layer, fn) {
    const before = new Map();
    const touch = (k) => { if (!before.has(k)) { const c = layer.tiles.get(k); before.set(k, c ? copyTile(c) : null); } };
    fn(touch);
    for (const k of before.keys()) { this.invalidateKey(k); this.markTile(layer, k); }
    if (before.size) { layer.ver++; this.history.push(new PixelCmd(label, layer, before)); this.changed(); }
  }

  // ---- 構造
  snapshot() {
    const snap = (node) => ({ layer: node, props: Object.fromEntries(LAYER_PROPS.map((k) => [k, node[k]])), children: node.children ? node.children.map(snap) : null });
    return { tree: snap(this.root), activeId: this.activeId };
  }
  restore(s) {
    const apply = (n) => {
      Object.assign(n.layer, n.props);
      if (n.children) n.layer.children = n.children.map((c) => { apply(c); return c.layer; });
    };
    apply(s.tree);
    this.activeId = s.activeId;
    this.invalidateAll();
    this.metaDirty = true;           // 戻ってきたレイヤーのタイルは Store が「未保存のレイヤー」として書き直す
  }
  /* 構造を変える操作: fn の前後を記録して1手にする */
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
  /* 属性の変更（連続するスライダー操作は1手にまとめる） */
  setProps(layer, props, label = 'レイヤーの設定', mergeKey = null) {
    const before = this.snapshot();
    Object.assign(layer, props);
    const after = this.snapshot();
    this.history.push(new StructCmd(label, before, after), mergeKey ? mergeKey + layer.id : null);
    this.invalidateLayer(layer);
    if ('clip' in props || 'visible' in props || 'blend' in props) this.invalidateAll();
    this.changed('struct');
  }
}

/* ストロークのタイルを、レイヤーのタイルに重ねる（合成の見た目と確定で同じ処理） */
let _grainTmp = null;
function applyStrokeTile(g, st, s) {
  let src = st;
  if (s.grain) {
    if (!_grainTmp) _grainTmp = newCanvas(TILE, TILE);
    const t = _grainTmp.getContext('2d');
    t.globalCompositeOperation = 'copy'; t.globalAlpha = 1;
    t.drawImage(st, 0, 0);
    t.globalCompositeOperation = 'destination-out';
    t.drawImage(s.grain, 0, 0);            // 質感は 256px 周期＝タイルと同じなので位置合わせ不要
    t.globalCompositeOperation = 'source-over';
    src = _grainTmp;
  }
  g.save();
  g.globalAlpha = s.opacity;
  g.globalCompositeOperation = s.erase ? 'destination-out' : s.alphaLock ? 'source-atop' : 'source-over';
  g.drawImage(src, 0, 0);
  g.restore();
}

/* ---- 履歴 */
class PixelCmd {
  constructor(label, layer, tiles) { this.label = label; this.layer = layer; this.tiles = tiles; }
  get bytes() { return this.tiles.size * TILE * TILE * 4; }
  swap(doc) {
    const L = this.layer;
    for (const [k, stored] of this.tiles) {
      const cur = L.tiles.get(k) || null;
      if (stored) L.tiles.set(k, stored); else L.tiles.delete(k);
      this.tiles.set(k, cur);
      doc.invalidateKey(k);
      doc.markTile(L, k);
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
    this.maxBytes = 320 * 1024 * 1024;   // タイルの写しの合計の目安
    this.group = null;                   // まとめ中（begin〜end を1手に）
    this.lastMerge = null;
  }
  push(cmd, mergeKey = null) {
    if (this.group) { this.group.push(cmd); return; }
    for (const c of this.redoStack) c.dispose();
    this.redoStack = [];
    // 同じ属性を続けて変えた時（スライダー）は1手に
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
  begin() { this.group = []; }
  end(label) {
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
