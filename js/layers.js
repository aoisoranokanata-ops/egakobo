'use strict';
/* レイヤーの操作とパネル */

const LayerOps = {
  /* 新しいレイヤーを置く場所: 作業レイヤーの上（開いたフォルダが選ばれていたらその中の一番上） */
  placeNew(doc, layer) {
    const a = doc.active;
    if (a && a.isFolder && a.open) a.children.push(layer);
    else if (a && a.kind !== 'paper') { const p = doc.parentOf(a); p.children.splice(p.children.indexOf(a) + 1, 0, layer); }
    else doc.root.children.push(layer);
  },
  nextName(doc, base) {
    let n = 1;
    const names = new Set(doc.layers().map((l) => l.name));
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  },
  add(doc, kind = 'raster') {
    const l = new Layer(kind, this.nextName(doc, kind === 'folder' ? 'フォルダー' : 'レイヤー'));
    doc.structEdit(kind === 'folder' ? 'フォルダーを作成' : 'レイヤーを作成', () => { this.placeNew(doc, l); doc.activeId = l.id; });
    return l;
  },
  clone(l) {
    const c = new Layer(l.kind, l.name);
    for (const k of LAYER_PROPS) c[k] = l[k];
    if (l.tiles) for (const [k, t] of l.tiles) c.tiles.set(k, copyTile(t));
    if (l.children) c.children = l.children.map((x) => this.clone(x));
    return c;
  },
  duplicate(doc) {
    const a = doc.active;
    if (!a || a.kind === 'paper') return;
    const c = this.clone(a);
    c.name = a.name + ' のコピー';
    doc.structEdit('レイヤーを複製', () => { const p = doc.parentOf(a); p.children.splice(p.children.indexOf(a) + 1, 0, c); doc.activeId = c.id; });
  },
  remove(doc) {
    const a = doc.active;
    if (!a || a.kind === 'paper') return;
    const rasters = doc.layers().filter((l) => l.isRaster);
    const inside = a.isFolder ? [...doc.walk(a.children)].filter((l) => l.isRaster).length : 1;
    if (rasters.length - inside < 1) { toast('最後のレイヤーは削除できません'); return; }
    doc.structEdit('レイヤーを削除', () => {
      const p = doc.parentOf(a), i = p.children.indexOf(a);
      p.children.splice(i, 1);
      const next = p.children[i - 1] && p.children[i - 1].kind !== 'paper' ? p.children[i - 1] : p.children[i] || (p !== doc.root ? p : null);
      doc.activeId = next ? next.id : doc.layers().reverse().find((l) => l.isRaster).id;
    });
  },
  clear(doc) {
    const a = doc.active;
    if (!a || !a.isRaster || !a.tiles.size) return;
    const before = new Map(a.tiles);
    a.tiles.clear();
    for (const k of before.keys()) { doc.invalidateKey(k); doc.markTile(a, k); }
    a.ver++;
    doc.history.push(new PixelCmd('レイヤーを消去', a, before));
    doc.changed();
  },
  below(doc, l) {
    const p = doc.parentOf(l), i = p.children.indexOf(l);
    return i > 0 ? p.children[i - 1] : null;
  },
  mergeDown(doc) {
    const a = doc.active;
    const b = a && this.below(doc, a);
    if (!a || !a.isRaster || !b || !b.isRaster) { toast('下にラスターレイヤーがある時だけ結合できます'); return; }
    if (b.locked) { toast('下のレイヤーがロックされています'); return; }
    doc.history.begin();
    if (a.visible) {
      doc.pixelEdit('下のレイヤーに結合', b, (touch) => {
        for (const [k, t] of a.tiles) {
          let bt = b.tiles.get(k);
          if (!bt && (a.clip || b.alphaLock)) continue;
          touch(k);
          if (!bt) { bt = TilePool.get(); b.tiles.set(k, bt); }
          const g = ctx2d(bt);
          g.save();
          g.globalAlpha = a.opacity;
          g.globalCompositeOperation = a.clip && a.blend === 'normal' ? 'source-atop' : BLEND_OP[a.blend] || 'source-over';
          g.drawImage(t, 0, 0);
          g.restore();
        }
      });
    }
    doc.structEdit('下のレイヤーに結合', () => { const p = doc.parentOf(a); p.children.splice(p.children.indexOf(a), 1); doc.activeId = b.id; });
    doc.history.end('下のレイヤーに結合');
  },
  /* 上へ・下へ（端ではフォルダーの外へ、隣が開いたフォルダーならその中へ） */
  move(doc, dir) {
    const a = doc.active;
    if (!a || a.kind === 'paper') return;
    doc.structEdit('レイヤーの順番', () => {
      const p = doc.parentOf(a), arr = p.children, i = arr.indexOf(a);
      const j = i + dir;
      if (j < 0 || j >= arr.length || arr[j].kind === 'paper') {
        if (p === doc.root) return false;
        const gp = doc.parentOf(p), pi = gp.children.indexOf(p);
        arr.splice(i, 1);
        gp.children.splice(dir > 0 ? pi + 1 : pi, 0, a);
        return true;
      }
      const n = arr[j];
      arr.splice(i, 1);
      if (n.isFolder && n.open) { if (dir > 0) n.children.unshift(a); else n.children.push(a); }
      else arr.splice(j, 0, a);
      return true;
    });
  },
};

class LayerPanel {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.thumbs = new Map();         // layer.id → {c, ver}
    this.build();
  }
  get doc() { return this.app.doc; }
  build() {
    const R = this.root;
    R.innerHTML = '';
    this.blend = el('select', { class: 'sel' });
    this.blend.addEventListener('change', () => { const a = this.doc.active; if (a) this.doc.setProps(a, { blend: this.blend.value }, '描画モード'); });
    this.opa = el('input', { type: 'range', min: 0, max: 100, step: 1, class: 'opa' });
    this.opaNum = el('span', { class: 'opa-num' });
    this.opa.addEventListener('input', () => {
      const a = this.doc.active;
      if (a) { this.doc.setProps(a, { opacity: +this.opa.value / 100 }, '不透明度', 'opa'); this.opaNum.textContent = this.opa.value + '%'; }
    });
    const flag = (key, label, title) => {
      const b = el('button', { class: 'flag', title, onclick: () => {
        const a = this.doc.active;
        if (!a || a.kind === 'paper') return;
        if (key === 'alphaLock' && !a.isRaster) return;
        this.doc.setProps(a, { [key]: !a[key] }, title);
      } }, label);
      b.dataset.key = key;
      return b;
    };
    this.flags = [flag('clip', 'クリップ', '下のレイヤーでクリッピング'), flag('alphaLock', '透明保護', '透明ピクセルをロック'),
      flag('locked', 'ロック', 'レイヤーをロック'), flag('ref', '参照', '参照レイヤーに設定'), flag('draft', '下描き', '下描きレイヤー（書き出さない）')];
    R.append(el('div', { class: 'lp-head' },
      el('div', { class: 'lp-row1' }, this.blend, el('div', { class: 'opa-wrap' }, this.opa, this.opaNum)),
      el('div', { class: 'lp-flags' }, ...this.flags)));
    this.list = el('div', { class: 'lp-list' });
    R.append(this.list);
    const btn = (label, title, fn) => el('button', { class: 'lp-btn', title, onclick: fn }, label);
    R.append(el('div', { class: 'lp-foot' },
      btn('＋', '新規ラスターレイヤー', () => LayerOps.add(this.doc)),
      btn('📁', '新規フォルダー', () => LayerOps.add(this.doc, 'folder')),
      btn('⧉', '複製', () => LayerOps.duplicate(this.doc)),
      btn('⤓', '下のレイヤーに結合', () => LayerOps.mergeDown(this.doc)),
      btn('▲', '上へ', () => LayerOps.move(this.doc, 1)),
      btn('▼', '下へ', () => LayerOps.move(this.doc, -1)),
      btn('⌫', 'レイヤーを消去（中身を消す）', () => LayerOps.clear(this.doc)),
      btn('🗑', '削除', () => LayerOps.remove(this.doc))));
  }
  refresh() {
    const doc = this.doc;
    if (!doc) return;
    const a = doc.active;
    // 頭の部分
    const isFolder = a && a.isFolder;
    const modes = BLEND_MODES.filter((m) => !m.folderOnly || isFolder);
    const sig = modes.map((m) => m.key).join();
    if (this.blend._sig !== sig) { this.blend.innerHTML = ''; for (const m of modes) this.blend.append(el('option', { value: m.key }, m.label)); this.blend._sig = sig; }
    const paper = !a || a.kind === 'paper';
    this.blend.disabled = paper; this.opa.disabled = paper;
    if (a) { this.blend.value = a.blend; this.opa.value = Math.round(a.opacity * 100); this.opaNum.textContent = Math.round(a.opacity * 100) + '%'; }
    for (const f of this.flags) f.classList.toggle('on', !!(a && a[f.dataset.key]));
    // 一覧（上が上）
    this.list.innerHTML = '';
    const rows = [];
    const walk = (list, depth) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const l = list[i];
        rows.push([l, depth]);
        if (l.isFolder && l.open) walk(l.children, depth + 1);
      }
    };
    walk(doc.root.children, 0);
    for (const [l, depth] of rows) this.list.append(this.row(l, depth));
  }
  row(l, depth) {
    const doc = this.doc;
    const r = el('div', { class: 'lrow' + (l.id === doc.activeId ? ' active' : '') + (l.clip ? ' clipped' : ''), style: `--d:${depth}` });
    const eye = el('button', { class: 'eye' + (l.visible ? ' on' : ''), title: '表示／非表示', onclick: (e) => { e.stopPropagation(); doc.setProps(l, { visible: !l.visible }, l.visible ? '非表示' : '表示'); } }, l.visible ? '◉' : '○');
    r.append(eye);
    if (l.clip) r.append(el('span', { class: 'clipmark' }, '┗'));
    if (l.isFolder) {
      r.append(el('button', { class: 'fold', onclick: (e) => { e.stopPropagation(); l.open = !l.open; this.refresh(); doc.metaDirty = true; } }, l.open ? '▾' : '▸'));
      r.append(el('span', { class: 'ficon' }, '📁'));
    } else if (l.kind === 'paper') {
      const sw = el('button', { class: 'paper-sw', style: `background:${l.color}`, title: '用紙の色をメインカラーにする', onclick: (e) => {
        e.stopPropagation();
        if (this.app.color.main !== l.color) doc.setProps(l, { color: this.app.color.main }, '用紙の色');
      } });
      r.append(sw);
    } else r.append(this.thumb(l));
    const badges = [];
    if (l.locked) badges.push('🔒');
    if (l.alphaLock) badges.push('▦');
    if (l.ref) badges.push('参');
    if (l.draft) badges.push('下');
    const info = l.kind === 'paper' ? '' : `${Math.round(l.opacity * 100)}% ${BLEND_MODES.find((m) => m.key === l.blend).label}`;
    r.append(el('div', { class: 'lname' }, el('span', { class: 'nm' }, l.name), el('span', { class: 'sub' }, badges.join(' ') + (badges.length ? '  ' : '') + info)));
    let lastTap = 0;
    r.addEventListener('click', async () => {
      const now = Date.now();
      if (now - lastTap < 350 && l.kind !== 'paper') {
        const name = await promptBox('レイヤー名', l.name);
        if (name) doc.setProps(l, { name }, 'レイヤー名');
        return;
      }
      lastTap = now;
      if (doc.activeId !== l.id) { doc.activeId = l.id; doc.metaDirty = true; this.app.onActiveChanged(); }
    });
    return r;
  }
  thumb(l) {
    let t = this.thumbs.get(l.id);
    if (!t) { t = { c: newCanvas(44, 44), ver: -1 }; t.c.className = 'thumb'; this.thumbs.set(l.id, t); }
    if (t.ver !== l.ver) this.drawThumb(l, t);
    return t.c;
  }
  drawThumb(l, t) {
    const doc = this.doc, g = ctx2d(t.c);
    const s = Math.min(44 / doc.width, 44 / doc.height), ox = (44 - doc.width * s) / 2, oy = (44 - doc.height * s) / 2;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 44, 44);
    g.fillStyle = checkerPattern(g); g.fillRect(ox, oy, doc.width * s, doc.height * s);
    // 一度 4倍の大きさに描いてから縮める（細い線が消えないように）
    if (!this._big) this._big = newCanvas(176, 176);
    const bg = ctx2d(this._big), S = s * 4;
    bg.setTransform(1, 0, 0, 1, 0, 0); bg.clearRect(0, 0, 176, 176);
    bg.imageSmoothingQuality = 'high';
    for (const [k, c] of l.tiles) { const [tx, ty] = parseKey(k); bg.drawImage(c, ox * 4 + tx * TILE * S, oy * 4 + ty * TILE * S, TILE * S + 0.5, TILE * S + 0.5); }
    g.imageSmoothingQuality = 'high';
    g.drawImage(this._big, 0, 0, 44, 44);
    t.ver = l.ver;
  }
  /* 描いた後: サムネイルだけ描き直す（一覧は作り直さない） */
  refreshThumbs() {
    for (const l of this.doc.layers()) {
      const t = this.thumbs.get(l.id);
      if (t && t.ver !== l.ver && l.isRaster) this.drawThumb(l, t);
    }
  }
}
