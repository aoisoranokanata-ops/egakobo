'use strict';
/* 本（作品）の設定: 仕上がりサイズ・裁ち落とし・基本枠・綴じ・開始ページ・ノンブル（すべて mm）。
   work.book に持ち、開いたページの doc.book に写す。原稿の大きさ = 仕上がり + 裁ち落とし×2（見開きページは仕上がりの幅×2）。 */

const BOOK_SIZES = {
  b5: { label: 'B5（同人誌・商業誌）', trimW: 182, trimH: 257, frameW: 150, frameH: 220 },
  a4: { label: 'A4（投稿）', trimW: 210, trimH: 297, frameW: 180, frameH: 270 },
  a5: { label: 'A5（同人誌）', trimW: 148, trimH: 210, frameW: 120, frameH: 180 },
  b6: { label: 'B6（コミックス）', trimW: 128, trimH: 182, frameW: 106, frameH: 156 },
  postcard: { label: 'ポストカード', trimW: 100, trimH: 148, frameW: 88, frameH: 136 },
  a3: { label: 'A3 ポスター', trimW: 297, trimH: 420, frameW: 277, frameH: 400 },
  b2: { label: 'B2 ポスター', trimW: 515, trimH: 728, frameW: 495, frameH: 708 },
};
const NOMBRE_POS = [['bottom-outside', '下・外側'], ['bottom-center', '下・中央'], ['top-outside', '上・外側'], ['hidden', '隠しノンブル（のど側）']];
function defaultBook(size = 'b5') {
  const s = BOOK_SIZES[size] || BOOK_SIZES.b5;
  return { size, trimW: s.trimW, trimH: s.trimH, bleed: 3, frameW: s.frameW, frameH: s.frameH, binding: 'right', start: 'left',
    nombre: { on: true, pos: 'bottom-outside', size: 3, start: 1 } };
}
/* 原稿の画素の大きさ */
function bookDocSize(book, dpi, spread = false) {
  const px = (mm) => Math.round((mm / 25.4) * dpi);
  return { w: px((spread ? book.trimW * 2 : book.trimW) + book.bleed * 2), h: px(book.trimH + book.bleed * 2) };
}
/* 文書座標の線（仕上がり・基本枠・のど） */
function bookRects(doc, book = doc.book) {
  const px = (mm) => (mm / 25.4) * doc.dpi;
  const spread = doc.spread;
  const tw = px(spread ? book.trimW * 2 : book.trimW), th = px(book.trimH);
  const trim = { x: (doc.width - tw) / 2, y: (doc.height - th) / 2, w: tw, h: th };
  const fw = px(book.frameW), fh = px(book.frameH);
  const half = spread ? tw / 2 : tw;
  const frames = [];
  for (let i = 0; i < (spread ? 2 : 1); i++) frames.push({ x: trim.x + i * half + (half - fw) / 2, y: trim.y + (th - fh) / 2, w: fw, h: fh });
  return { trim, frames, bleed: px(book.bleed), gutter: spread ? trim.x + half : null };
}

/* ページの並び: 各ページの {side 'left'|'right', number, spreadIndex}。
   右綴じは右のページが先、左綴じは左が先。見開きページは見開きの頭にそろえる（空きができることがある） */
function pageLayout(work) {
  const book = work.book || defaultBook();
  const pages = work.pages || [{ id: work.id }];
  const firstSide = book.start || 'left';
  const readFirst = book.binding === 'left' ? 'left' : 'right';   // 見開きの中で先に読む側
  let g = firstSide === readFirst ? 0 : 1;                        // 見開きの中の位置（偶数 = 先に読む側）
  const out = [];
  let num = (book.nombre && book.nombre.start) || 1;
  for (const p of pages) {
    if (p.spread) {
      if (g % 2) g++;
      out.push({ id: p.id, spread: true, side: 'spread', number: num, number2: num + 1, spreadIndex: g >> 1, slot: g });
      g += 2; num += 2;
    } else {
      const first = g % 2 === 0;
      const side = first ? readFirst : readFirst === 'right' ? 'left' : 'right';
      out.push({ id: p.id, spread: false, side, number: num, spreadIndex: g >> 1, slot: g });
      g++; num++;
    }
  }
  return out;
}

/* 画面のガイド（仕上がり線・基本枠・のど・ノンブルの位置） */
function drawBookGuides(g, view, doc) {
  const b = doc.book;
  if (!b) return;
  const R = bookRects(doc);
  const poly = (r) => { const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, y]) => view.toScreen(x, y)); g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath(); };
  g.save();
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(0,140,255,.85)'; poly(R.trim); g.stroke();                                   // 仕上がり
  g.setLineDash([6, 4]); g.strokeStyle = 'rgba(0,170,200,.8)';
  for (const f of R.frames) { poly(f); g.stroke(); }                                                    // 基本枠
  if (R.gutter != null) { const a = view.toScreen(R.gutter, R.trim.y), c = view.toScreen(R.gutter, R.trim.y + R.trim.h); g.strokeStyle = 'rgba(255,90,95,.8)'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.stroke(); }
  g.setLineDash([]);
  // ノンブル（薄く）
  if (b.nombre && b.nombre.on && doc.pageInfo) {
    for (const n of nombreItems(doc)) {
      const s = view.toScreen(n.x, n.y);
      g.fillStyle = 'rgba(0,140,255,.75)';
      g.font = `${Math.max(9, n.size * view.s)}px sans-serif`;
      g.textAlign = n.align; g.textBaseline = 'middle';
      g.fillText(String(n.text), s.x, s.y);
    }
  }
  g.restore();
}

/* ノンブルの位置（文書座標）: [{text, x, y, size(px), align}] */
function nombreItems(doc) {
  const b = doc.book, info = doc.pageInfo;
  if (!b || !b.nombre || !b.nombre.on || !info) return [];
  const R = bookRects(doc), px = (mm) => (mm / 25.4) * doc.dpi, size = px(b.nombre.size || 3);
  const items = [];
  const sides = info.spread ? [['left', 0], ['right', 1]] : [[info.side, 0]];
  const nums = info.spread ? (b.binding === 'left' ? [info.number, info.number2] : [info.number2, info.number]) : [info.number];
  sides.forEach(([side, i], k) => {
    const f = R.frames[info.spread ? i : 0], t = R.trim;
    const half = info.spread ? t.w / 2 : t.w, tx = t.x + (info.spread ? i * half : 0);
    const outer = side === 'left' ? tx + px(6) : tx + half - px(6);
    const inner = side === 'left' ? tx + half - px(2.5) : tx + px(2.5);
    const below = f.y + f.h + (t.y + t.h - (f.y + f.h)) / 2, above = t.y + (f.y - t.y) / 2;
    const pos = b.nombre.pos;
    let x, y, align;
    if (pos === 'bottom-center') { x = f.x + f.w / 2; y = below; align = 'center'; }
    else if (pos === 'top-outside') { x = outer; y = above; align = side === 'left' ? 'left' : 'right'; }
    else if (pos === 'hidden') { x = inner; y = f.y + f.h; align = side === 'left' ? 'right' : 'left'; }
    else { x = outer; y = below; align = side === 'left' ? 'left' : 'right'; }
    items.push({ text: nums[k], x, y, size: pos === 'hidden' ? size * 0.6 : size, align });
  });
  return items;
}
function drawNombre(g, doc, ox, oy) {
  for (const n of nombreItems(doc)) {
    g.save();
    g.fillStyle = '#000';
    g.font = `${n.size}px "Hiragino Sans", "Yu Gothic", sans-serif`;
    g.textAlign = n.align; g.textBaseline = 'middle';
    g.fillText(String(n.text), n.x + ox, n.y + oy);
    g.restore();
  }
}

/* トンボ（角トンボ・センタートンボ）。ox, oy = 出力の中での原稿の左上 */
function drawCropMarks(g, doc, ox, oy) {
  const R = bookRects(doc), px = (mm) => (mm / 25.4) * doc.dpi;
  const t = { x: R.trim.x + ox, y: R.trim.y + oy, w: R.trim.w, h: R.trim.h }, b = R.bleed, L = px(10);
  g.save();
  g.strokeStyle = '#000'; g.lineWidth = Math.max(1, px(0.1)); g.lineCap = 'butt';
  const line = (x0, y0, x1, y1) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const tx = sx < 0 ? t.x : t.x + t.w, ty = sy < 0 ? t.y : t.y + t.h;
    const bx = tx + sx * b, by = ty + sy * b;
    line(bx, ty, bx + sx * L, ty);            // 内トンボ（仕上がり線の延長）
    line(tx, by, tx, by + sy * L);
    line(tx, by, tx + sx * (b + L), by);      // 外トンボ（裁ち落とし線の延長）
    line(bx, ty, bx, ty + sy * (b + L));
  }
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2, c = px(5);
  line(cx, t.y - b, cx, t.y - b - L); line(cx - c, t.y - b - L / 2, cx + c, t.y - b - L / 2);
  line(cx, t.y + t.h + b, cx, t.y + t.h + b + L); line(cx - c, t.y + t.h + b + L / 2, cx + c, t.y + t.h + b + L / 2);
  line(t.x - b, cy, t.x - b - L, cy); line(t.x - b - L / 2, cy - c, t.x - b - L / 2, cy + c);
  line(t.x + t.w + b, cy, t.x + t.w + b + L, cy); line(t.x + t.w + b + L / 2, cy - c, t.x + t.w + b + L / 2, cy + c);
  g.restore();
}

/* 作品の設定ダイアログ（新規作成と、あとから変える時） */
async function bookDialog(book, { title = '作品の設定', withPages = false, pages = 8 } = {}) {
  const b = JSON.parse(JSON.stringify(book));
  const num = (v, step = 0.5) => el('input', { type: 'number', class: 'inp', value: v, step });
  const sizeSel = el('select', { class: 'sel' }, ...Object.entries(BOOK_SIZES).map(([k, s]) => el('option', { value: k, selected: b.size === k || null }, s.label)), el('option', { value: 'custom', selected: !BOOK_SIZES[b.size] || null }, '自由'));
  const iTW = num(b.trimW), iTH = num(b.trimH), iBl = num(b.bleed), iFW = num(b.frameW), iFH = num(b.frameH);
  sizeSel.addEventListener('change', () => { const s = BOOK_SIZES[sizeSel.value]; if (s) { iTW.value = s.trimW; iTH.value = s.trimH; iFW.value = s.frameW; iFH.value = s.frameH; } });
  const bind = el('select', { class: 'sel' }, el('option', { value: 'right', selected: b.binding === 'right' || null }, '右綴じ（縦書きのマンガ）'), el('option', { value: 'left', selected: b.binding === 'left' || null }, '左綴じ（横書き）'));
  const start = el('select', { class: 'sel' }, el('option', { value: 'left', selected: b.start === 'left' || null }, '左ページから'), el('option', { value: 'right', selected: b.start === 'right' || null }, '右ページから'));
  const nOn = el('input', { type: 'checkbox', checked: b.nombre.on || null });
  const nPos = el('select', { class: 'sel' }, ...NOMBRE_POS.map(([v, t]) => el('option', { value: v, selected: b.nombre.pos === v || null }, t)));
  const nStart = num(b.nombre.start, 1), nSize = num(b.nombre.size, 0.5);
  const iPages = num(pages, 1);
  const cell = (label, input) => el('div', {}, el('label', { class: 'lbl' }, label), input);
  const body = el('div', {},
    el('div', { class: 'row3' }, cell('仕上がりサイズ', sizeSel), cell('幅 mm', iTW), cell('高さ mm', iTH)),
    el('div', { class: 'row3' }, cell('裁ち落とし mm', iBl), cell('基本枠の幅 mm', iFW), cell('基本枠の高さ mm', iFH)),
    el('div', { class: 'row3' }, cell('綴じ', bind), cell('開始ページ', start), withPages ? cell('ページ数', iPages) : el('div')),
    el('div', { class: 'row3' }, cell('ノンブル', el('label', { class: 'chk' }, nOn, ' 入れる')), cell('位置', nPos), cell('最初の番号', nStart)),
    el('div', { class: 'row3' }, cell('ノンブルの大きさ mm', nSize), el('div'), el('div')),
    el('p', { class: 'hint' }, '原稿の大きさ = 仕上がり＋裁ち落とし（上下左右）。右綴じは右のページから読みます。「左ページから」は1ページ目が見開きの左側になります。'));
  const ok = await modal({ title, body, wide: true, buttons: [{ label: 'キャンセル', value: false }, { label: 'OK', value: true, primary: true }] });
  if (!ok) return null;
  Object.assign(b, {
    size: sizeSel.value, trimW: +iTW.value || b.trimW, trimH: +iTH.value || b.trimH, bleed: Math.max(0, +iBl.value || 0),
    frameW: +iFW.value || b.frameW, frameH: +iFH.value || b.frameH, binding: bind.value, start: start.value,
    nombre: { on: nOn.checked, pos: nPos.value, start: Math.round(+nStart.value || 1), size: +nSize.value || 3 },
  });
  if (withPages) b._pages = clamp(Math.round(+iPages.value || 1), 1, 400);
  return b;
}
