'use strict';
/* テキストレイヤー: 設定（layer.text）から画素を描く。縦書き・ルビ（｜親文字《るび》／漢字《かんじ》）・フチ・アンチック風。
   設定は差し替えて使う（中身を書き換えない）。位置 (x, y) = 横書きは1行目の左上、縦書きは1列目の右上。 */

const FONT_STACKS = {
  gothic: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "YuGothic", "Meiryo", sans-serif',
  mincho: '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", serif',
  maru: '"Hiragino Maru Gothic ProN", "Yu Gothic", "YuGothic", sans-serif',
};
const FONT_LABELS = [['antique', 'アンチック風（漢字ゴシック＋かな明朝）'], ['gothic', 'ゴシック'], ['mincho', '明朝'], ['maru', '丸ゴシック']];
const TEXT_DEFAULTS = { content: '', font: 'antique', size: 48, color: '#000000', vertical: true, lineHeight: 1.45, spacing: 0, bold: false, outline: 0, outlineColor: '#ffffff', x: 0, y: 0 };

const RE_KANJI = /[㐀-䶿一-鿿豈-﫿々〆ヶ]/;
const RE_KANA = /[぀-ヿ]/;
const V_ROTATE = new Set('ー－―‐…‥～〜（）()「」『』【】〔〕［］｛｝〈〉《》＜＞<>=＝-−→←⇒：:;；|｜'.split(''));
const V_SMALL = new Set('ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ'.split(''));
const V_PUNCT = new Set('、。，．'.split(''));

/* ルビを分ける: [{base, ruby}] */
function parseRuby(line) {
  const out = [];
  let buf = '', mark = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '｜' || ch === '|') { if (buf) out.push({ base: buf, ruby: null }); buf = ''; mark = 0; continue; }
    if (ch === '《') {
      const j = line.indexOf('》', i + 1);
      if (j < 0) { buf += ch; continue; }
      const ruby = line.slice(i + 1, j);
      let base;
      if (mark >= 0) { base = buf; buf = ''; }
      else {
        let k = buf.length;
        while (k > 0 && RE_KANJI.test(buf[k - 1])) k--;
        base = buf.slice(k); buf = buf.slice(0, k);
      }
      if (buf) out.push({ base: buf, ruby: null });
      buf = '';
      if (base) out.push({ base, ruby }); else out.push({ base: '《' + ruby + '》', ruby: null });
      mark = -1;
      i = j;
      continue;
    }
    buf += ch;
  }
  if (buf) out.push({ base: buf, ruby: null });
  return out;
}

function fontFor(spec, ch, size) {
  const kind = spec.font === 'antique' ? (RE_KANA.test(ch) ? 'mincho' : 'gothic') : spec.font;
  return `${spec.bold ? '700' : '400'} ${size}px ${FONT_STACKS[kind] || FONT_STACKS.gothic}`;
}
let _measC = null;
function measure(font, ch) { if (!_measC) _measC = newCanvas(4, 4).getContext('2d'); _measC.font = font; return _measC.measureText(ch).width; }

/* 字の並び: [{ch, x, y(中心), size, rot, font}] と範囲 */
function layoutText(spec) {
  const S = spec.size, gap = spec.spacing * S, lh = S * spec.lineHeight, rs = S * 0.5;
  const glyphs = [];
  const lines = spec.content.split('\n');
  lines.forEach((line, li) => {
    const toks = parseRuby(line);
    let pos = 0;           // 行の中での進み
    for (const t of toks) {
      const start = pos;
      const chars = [...t.base];
      for (const ch of chars) {
        const font = fontFor(spec, ch, S);
        if (spec.vertical) {
          const cx = spec.x - S / 2 - li * lh;
          const rot = V_ROTATE.has(ch) || /[A-Za-z0-9]/.test(ch);
          const adv = rot && /[A-Za-z0-9]/.test(ch) ? measure(font, ch) : S;
          let gx = cx, gy = spec.y + pos + adv / 2;
          if (V_SMALL.has(ch)) { gx += S * 0.1; gy -= S * 0.1; }
          if (V_PUNCT.has(ch)) { gx += S * 0.6; gy -= S * 0.6; }
          glyphs.push({ ch, x: gx, y: gy, size: S, rot: rot ? Math.PI / 2 : 0, font });
          pos += adv + gap;
        } else {
          const w = measure(font, ch);
          glyphs.push({ ch, x: spec.x + pos + w / 2, y: spec.y + li * lh + S / 2, size: S, rot: 0, font });
          pos += w + gap;
        }
      }
      if (t.ruby) {
        const len = pos - gap - start, rch = [...t.ruby];
        const rfont = (c) => fontFor({ ...spec, font: spec.font === 'antique' ? 'mincho' : spec.font }, c, rs);
        if (spec.vertical) {
          const cx = spec.x - S / 2 - li * lh + S / 2 + rs * 0.55;
          const step = Math.max(rs, len / rch.length), total = step * rch.length;
          const y0 = spec.y + start + (len - total) / 2;
          rch.forEach((c, i) => glyphs.push({ ch: c, x: cx, y: y0 + step * (i + 0.5), size: rs, rot: V_ROTATE.has(c) ? Math.PI / 2 : 0, font: rfont(c) }));
        } else {
          const cy = spec.y + li * lh - rs * 0.55;
          const ws = rch.map((c) => measure(rfont(c), c)), total = ws.reduce((a, b) => a + b, 0);
          const step = Math.max(0, (len - total) / rch.length);
          let x = spec.x + start + Math.max(0, (len - total - step * (rch.length - 1)) / 2);
          if (total > len) x = spec.x + start + (len - total) / 2;
          rch.forEach((c, i) => { glyphs.push({ ch: c, x: x + ws[i] / 2, y: cy, size: rs, rot: 0, font: rfont(c) }); x += ws[i] + step; });
        }
      }
    }
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const m = spec.outline + 4;
  for (const g of glyphs) { const h = g.size * 0.75 + m; x0 = Math.min(x0, g.x - h); x1 = Math.max(x1, g.x + h); y0 = Math.min(y0, g.y - h); y1 = Math.max(y1, g.y + h); }
  const bbox = glyphs.length ? { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) } : null;
  return { glyphs, bbox };
}

/* 設定から画素を描き直す */
function renderText(doc, layer) {
  for (const [k, t] of layer.tiles) { doc.invalidateKey(k); doc.markTile(layer, k); TilePool.put(t); }
  layer.tiles.clear();
  const spec = layer.text;
  if (!spec || !spec.content) { layer.ver++; return null; }
  const { glyphs, bbox } = layoutText(spec);
  if (!bbox) { layer.ver++; return null; }
  for (const [tx, ty, k] of doc.gridKeys(bbox)) {
    const c = TilePool.get(), g = ctx2d(c);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const pass = (outline) => {
      for (const gl of glyphs) {
        g.setTransform(1, 0, 0, 1, gl.x - tx * TILE, gl.y - ty * TILE);
        if (gl.rot) g.rotate(gl.rot);
        g.font = gl.font;
        if (outline) g.strokeText(gl.ch, 0, 0); else g.fillText(gl.ch, 0, 0);
      }
    };
    if (spec.outline > 0) { g.lineJoin = 'round'; g.lineWidth = spec.outline * 2; g.strokeStyle = spec.outlineColor; pass(true); }
    g.fillStyle = spec.color;
    pass(false);
    if (tileHasAlpha(c)) { layer.tiles.set(k, c); doc.markTile(layer, k); doc.invalidateKey(k); } else TilePool.put(c);
  }
  layer.ver++;
  return bbox;
}
function rerenderTextCmd(doc, layer) { renderText(doc, layer); doc.changed('struct'); }
function textBBox(layer) { return layer.text && layer.text.content ? layoutText(layer.text).bbox : null; }

/* テキストツール: 押した所の文字を直す／何も無ければ新しいテキスト */
class TextTool {
  constructor(app) { this.app = app; }
  down() {}
  move() {}
  up(p) {
    const app = this.app, doc = app.doc;
    const hit = doc.layers().reverse().find((l) => l.kind === 'text' && doc.effectiveVisible(l) && (() => { const b = textBBox(l); return b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; })());
    if (hit) { doc.activeId = hit.id; app.layerPanel.refresh(); app.textPanel.edit(hit, false); return; }
    const d = { ...TEXT_DEFAULTS, ...(app.toolOpts.text || {}) };
    const spec = { ...d, content: '', color: app.color.main, x: Math.round(p.x), y: Math.round(p.y) };
    if (!spec.vertical) spec.y -= spec.size / 2;
    const l = new Layer('text', 'テキスト');
    l.text = spec;
    const before = doc.snapshot();
    LayerOps.placeNew(doc, l);
    doc.activeId = l.id;
    app.layerPanel.refresh();
    app.textPanel.edit(l, true, before);
  }
}

/* 文字を打つパネル（絵の上に浮かぶ） */
class TextPanel {
  constructor(app) { this.app = app; this.open = false; }
  edit(layer, isNew, before = null) {
    const app = this.app, doc = app.doc;
    if (this.open) this.close(true);
    this.open = true; this.layer = layer; this.isNew = isNew; this.before = before; this.spec0 = layer.text;
    const sp = () => layer.text;
    const set = (patch) => { layer.text = { ...layer.text, ...patch }; this.rerender(); };
    const box = el('div', { class: 'float-panel text-panel' });
    const ta = el('textarea', { class: 'inp text-in', rows: 4, placeholder: '文字を入力（ルビ: ｜漢字《かんじ》）' });
    ta.value = sp().content;
    ta.addEventListener('input', () => set({ content: ta.value }));
    const fontSel = el('select', { class: 'sel' }, ...FONT_LABELS.map(([v, t]) => el('option', { value: v, selected: sp().font === v || null }, t)));
    fontSel.addEventListener('change', () => set({ font: fontSel.value }));
    const seg = (opts, cur, on) => { const b = el('div', { class: 'seg' }); for (const [v, t] of opts) b.append(el('button', { class: cur === v ? 'on' : '', onclick: (e) => { for (const x of b.children) x.classList.remove('on'); e.target.classList.add('on'); on(v); } }, t)); return b; };
    const P = app.panels;
    const chip = (key, label) => {
      const sw = el('span', { class: 'chip', style: `background:${sp()[key]}` });
      return el('button', { class: 'btn small gm', title: 'メインカラーにする', onclick: () => { set({ [key]: app.color.main }); sw.style.background = app.color.main; } }, sw, label);
    };
    box.append(el('div', { class: 'fp-title' }, isNew ? '新しいテキスト' : 'テキストを編集'),
      el('div', { class: 'fp-body' }, ta,
        el('div', { class: 'pp col' }, el('span', { class: 'pl' }, '書体'), fontSel),
        el('div', { class: 'pp col' }, el('span', { class: 'pl' }, '向き'), seg([[true, '縦書き'], [false, '横書き']], sp().vertical, (v) => set({ vertical: v }))),
        P.slider('大きさ', sp().size, { min: 6, max: 600, log: true, unit: 'px', fmt: (v) => Math.round(v) }, (v) => set({ size: Math.round(v) })),
        P.slider('行間', sp().lineHeight * 100, { min: 80, max: 300, unit: '%' }, (v) => set({ lineHeight: v / 100 })),
        P.slider('字間', sp().spacing * 100, { min: -30, max: 100, unit: '%' }, (v) => set({ spacing: v / 100 })),
        P.toggle('太字', sp().bold, (v) => set({ bold: v })),
        P.slider('フチ', sp().outline, { min: 0, max: 40, unit: 'px' }, (v) => set({ outline: Math.round(v) })),
        el('div', { class: 'gm-row' }, chip('color', '文字の色'), chip('outlineColor', 'フチの色'))),
      el('div', { class: 'fp-foot' },
        el('button', { class: 'btn', onclick: () => this.close(false) }, 'キャンセル'),
        el('button', { class: 'btn primary', onclick: () => this.close(true) }, 'OK')));
    $('#viewport').append(box);
    this.box = box;
    setTimeout(() => ta.focus(), 50);
    this.rerender();
  }
  rerender() {
    clearTimeout(this._t);
    this._t = setTimeout(() => { renderText(this.app.doc, this.layer); this.app.view.request(); }, 30);
  }
  close(ok) {
    if (!this.open) return;
    clearTimeout(this._t);
    this.open = false;
    this.box.remove();
    const app = this.app, doc = app.doc, L = this.layer;
    // 打った文字を新しいテキストの「既定」として覚える
    if (ok) { const { font, size, vertical, lineHeight, spacing, bold, outline, outlineColor } = L.text; app.toolOpts.text = { font, size, vertical, lineHeight, spacing, bold, outline, outlineColor }; app.saveTools(); }
    if (this.isNew) {
      if (!ok || !L.text.content.trim()) {          // 作らなかったことにする
        const p = doc.parentOf(L); if (p) p.children.splice(p.children.indexOf(L), 1);
        for (const t of L.tiles.values()) TilePool.put(t);
        L.tiles.clear();
        doc.restore(this.before);
      } else {
        renderText(doc, L);
        L.name = L.text.content.replace(/｜|《[^》]*》/g, '').split('\n')[0].slice(0, 16) || 'テキスト';
        doc.history.push(new StructCmd('テキスト', this.before, doc.snapshot()));
      }
    } else if (!ok) { L.text = this.spec0; renderText(doc, L); }
    else if (L.text !== this.spec0) doc.history.push(new SwapCmd('テキストの編集', L, 'text', this.spec0, L.text, rerenderTextCmd));
    doc.invalidateAll();
    doc.changed('struct');
    app.view.request();
  }
}
