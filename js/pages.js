'use strict';
/* 複数ページの作品: ページ管理の画面・ページの追加/複製/削除/並べ替え・書き出し（トンボ・ノンブル・全ページ・見開き・Webtoon 分割） */

/* 新しいページの文書（マンガは 下描き・線画・塗り の3枚から） */
function newPageDoc(work, { spread = false } = {}) {
  const dpi = work.dpi || 350;
  const size = work.book ? bookDocSize(work.book, dpi, spread) : { w: work.width, h: work.height };
  const doc = Doc.create({ width: size.w, height: size.h, dpi, name: work.name, kind: work.kind || 'manga', paper: work.paper === undefined ? '#ffffff' : work.paper });
  if ((work.kind || 'manga') === 'manga') {
    const draft = doc.active; draft.name = '下描き'; draft.draft = true; draft.opacity = 0.5;
    doc.root.children.push(new Layer('raster', '線画'));
    doc.root.children.splice(1, 0, new Layer('raster', '塗り'));
  }
  doc.history.clear();
  return doc;
}

const PageOps = {
  /* 1ページの作品を、ページを足せる形にする */
  ensureMulti(work) {
    if (work.pages) return;
    work.pages = [{ id: work.id }];
    work.pageThumbs = { [work.id]: work.thumb };
  },
  async add(work, at, spread = false) {
    this.ensureMulti(work);
    const id = Store.newId();
    work.pages.splice(at, 0, { id, spread });
    await Store.putWork(work);
    const doc = newPageDoc(work, { spread });
    doc.workId = work.id; doc.pageId = id; doc.spread = spread;
    await Store.saveDoc(doc);
    doc.comp.dispose();
    return id;
  },
  async duplicate(work, i) {
    this.ensureMulti(work);
    const src = work.pages[i], id = Store.newId();
    const d = await Store.loadDoc(work.id, src.id);
    work.pages.splice(i + 1, 0, { ...src, id });
    await Store.putWork(work);
    d.pageId = id; d._storedIds = null;
    await Store.saveDoc(d);
    d.comp.dispose();
  },
  async remove(work, i) {
    if (!work.pages || work.pages.length <= 1) { toast('最後のページは削除できません'); return false; }
    const [p] = work.pages.splice(i, 1);
    if (work.pageThumbs) delete work.pageThumbs[p.id];
    if (i === 0 && work.pageThumbs) work.thumb = work.pageThumbs[work.pages[0].id] || work.thumb;
    await Store.putWork(work);
    await Store.removePageData(p.id);
    return true;
  },
  async move(work, i, dir) {
    const j = i + dir;
    if (!work.pages || j < 0 || j >= work.pages.length) return false;
    [work.pages[i], work.pages[j]] = [work.pages[j], work.pages[i]];
    if (work.pageThumbs) work.thumb = work.pageThumbs[work.pages[0].id] || work.thumb;
    await Store.putWork(work);
    return true;
  },
  /* 新しい複数ページの作品 */
  async create({ name, dpi, kind, book, pages, paper, w = 0, h = 0 }) {
    const wid = Store.newId();
    const work = { id: wid, name, dpi, kind, book, paper, pages: Array.from({ length: pages }, () => ({ id: Store.newId() })), pageThumbs: {}, created: Date.now(), updated: Date.now() };
    const s = book ? bookDocSize(book, dpi) : null;
    work.width = s ? s.w : w; work.height = s ? s.h : h;
    await Store.putWork(work);
    for (const p of work.pages) {
      const d = newPageDoc(work);
      d.workId = wid; d.pageId = p.id; d.book = book;
      await Store.saveDoc(d);
      d.comp.dispose();
    }
    return work;
  },
};

/* ---- ページ管理の画面 */
class PageManager {
  constructor(app) { this.app = app; this.work = null; this.sel = 0; }
  async show(wid, selId = null) {
    const app = this.app;
    this.work = await Store.getWork(wid);
    if (!this.work) { app.showGallery(); return; }
    if (selId) this.sel = Math.max(0, Store.pageIds(this.work).indexOf(selId));
    app.screen = 'pages';
    $('#gallery').hidden = true; $('#editor').hidden = true; $('#pages').hidden = false;
    $('#pgTitle').textContent = this.work.name;
    this.render();
  }
  render() {
    const w = this.work, grid = $('#pgGrid');
    grid.innerHTML = '';
    const lay = pageLayout(w), book = w.book;
    const readFirstRight = !book || book.binding !== 'left';
    const n = Store.pageIds(w).length;
    $('#pgInfo').textContent = `${n} ページ` + (book ? `・${book.trimW}×${book.trimH}mm・${book.binding === 'left' ? '左綴じ' : '右綴じ'}` : '');
    // 見開きごとに並べる
    const spreads = new Map();
    lay.forEach((p, i) => { const s = spreads.get(p.spreadIndex) || []; s.push({ ...p, i }); spreads.set(p.spreadIndex, s); });
    const maxS = Math.max(...lay.map((p) => p.spreadIndex));
    for (let si = 0; si <= maxS; si++) {
      const items = spreads.get(si) || [];
      const row = el('div', { class: 'spread' });
      if (items.length === 1 && items[0].spread) row.append(this.card(items[0], true));
      else {
        const bySlot = (k) => items.find((p) => p.slot % 2 === k);
        const first = bySlot(0), second = bySlot(1);
        const left = readFirstRight ? second : first, right = readFirstRight ? first : second;
        row.append(left ? this.card(left) : el('div', { class: 'pcard empty' }), right ? this.card(right) : el('div', { class: 'pcard empty' }));
      }
      grid.append(row);
    }
  }
  card(p, wide = false) {
    const w = this.work, img = el('img', { alt: '' });
    const th = w.pageThumbs ? w.pageThumbs[p.id] : p.i === 0 ? w.thumb : null;
    if (th) { const u = URL.createObjectURL(new Blob([th.buf], { type: th.type })); img.src = u; img.onload = () => URL.revokeObjectURL(u); }
    const label = p.spread ? `${p.number}–${p.number2}（見開き）` : `${p.number}`;
    const more = el('button', { class: 'card-more', onclick: (e) => { e.stopPropagation(); this.menu(p.i, more); } }, '⋯');
    const c = el('div', { class: 'pcard' + (wide ? ' wide' : '') + (p.i === this.sel ? ' on' : ''), onclick: () => this.open(p.i) },
      el('div', { class: 'pimg' }, img), el('div', { class: 'pnum' }, label), more);
    return c;
  }
  open(i) { const ids = Store.pageIds(this.work); this.sel = i; this.app.openPage(this.work.id, ids[i]); }
  menu(i, anchor) {
    const app = this.app, w = this.work;
    const run = async (fn) => { app.busy('処理中…'); try { await fn(); } catch (e) { toast(e.message, { error: true }); } app.busy(null); this.work = await Store.getWork(w.id); this.render(); };
    app.popup(anchor, [
      ['開く', () => this.open(i)],
      ['後ろにページを追加', () => run(() => PageOps.add(w, i + 1))],
      ['複製', () => run(() => PageOps.duplicate(w, i))],
      ['前へ移動', () => run(async () => { if (await PageOps.move(w, i, -1)) this.sel = i - 1; })],
      ['後ろへ移動', () => run(async () => { if (await PageOps.move(w, i, 1)) this.sel = i + 1; })],
      ['削除', async () => { if (await confirmBox('ページを削除', `${pageLayout(w)[i].number} ページを削除します。元に戻せません。`, '削除', true)) run(async () => { await PageOps.remove(w, i); this.sel = Math.max(0, i - 1); }); }, 'danger'],
    ]);
  }
  async addPage(spread = false) {
    const app = this.app, w = this.work;
    if (spread && !w.book) { toast('見開きページは、作品の設定（仕上がりサイズ）がある作品で使えます'); return; }
    app.busy('ページを追加しています…');
    try { await PageOps.add(w, Store.pageIds(w).length, spread); } catch (e) { toast(e.message, { error: true }); }
    app.busy(null);
    this.work = await Store.getWork(w.id);
    this.render();
  }
  async settings() {
    const w = this.work;
    const b = await bookDialog(w.book || defaultBook());
    if (!b) return;
    const sizeChanged = !w.book || b.trimW !== w.book.trimW || b.trimH !== w.book.trimH || b.bleed !== w.book.bleed;
    w.book = b;
    await Store.putWork(w);
    if (sizeChanged) toast('仕上がりサイズを変えても、描いてあるページの大きさは変わりません（新しいページから反映されます）', { ms: 4500 });
    this.render();
  }
}

/* ================= 書き出し ================= */
/* 帯ごとに画素を作って PNG に流す（大きな原稿でも1枚の canvas を作らない）。fill(g, y0, h) が帯に描く */
async function encodeBands(W, H, dpi, mode, fill) {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const outP = new Response(cs.readable).arrayBuffer();
  const BH = 256, band = newCanvas(W, BH), bg = band.getContext('2d', { willReadFrequently: true });
  const rowBytes = mode === 'mono' ? Math.ceil(W / 8) : W * 4;
  const row = new Uint8Array(W * 4);
  for (let y0 = 0; y0 < H; y0 += BH) {
    const h = Math.min(BH, H - y0);
    bg.setTransform(1, 0, 0, 1, 0, 0); bg.globalAlpha = 1; bg.globalCompositeOperation = 'source-over';
    bg.clearRect(0, 0, W, BH);
    fill(bg, y0, h);
    const px = bg.getImageData(0, 0, W, h).data;
    const out = new Uint8Array(h * (1 + rowBytes));
    for (let j = 0; j < h; j++) {
      const o = j * (1 + rowBytes);
      if (mode === 'mono') {
        for (let i = 0; i < W; i++) {
          const p = (j * W + i) * 4, a = px[p + 3] / 255;
          const v = (px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114) * a + 255 * (1 - a);
          if (v >= 128) out[o + 1 + (i >> 3)] |= 0x80 >> (i & 7);
        }
      } else {
        row.set(px.subarray(j * W * 4, (j + 1) * W * 4));
        pngFilterRow(row, 0, W, out, o);
      }
    }
    await writer.write(out);
  }
  await writer.close();
  const idat = new Uint8Array(await outP);
  const head = pngHeader(W, H, dpi);
  if (mode === 'mono') { const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer); hv.setUint32(0, W); hv.setUint32(4, H); ihdr[8] = 1; ihdr[9] = 0; head[1] = pngChunk('IHDR', ihdr); }
  return new Blob([...head, pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}
/* ページを書き出す。opts: { crop: 'full'|'trim'|'marks', nombre, format: 'png'|'mono'|'jpeg' } */
async function exportPage(doc, opts) {
  const book = doc.book;
  let W = doc.width, H = doc.height, ox = 0, oy = 0;
  const px = (mm) => (mm / 25.4) * doc.dpi;
  if (book && opts.crop === 'trim') { const R = bookRects(doc); W = Math.round(R.trim.w); H = Math.round(R.trim.h); ox = -Math.round(R.trim.x); oy = -Math.round(R.trim.y); }
  if (book && opts.crop === 'marks') { const m = Math.round(px(15)); W = doc.width + m * 2; H = doc.height + m * 2; ox = oy = m; }
  const white = opts.format !== 'png' || opts.crop === 'marks';
  // 原稿のタイルを1段ずつ合成して使い回す
  const cache = new Map(), tmp = newCanvas(TILE, TILE), tg = ctx2d(tmp);
  const tileAt = (tx, ty) => {
    const k = tkey(tx, ty);
    if (cache.has(k)) return cache.get(k);
    tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalAlpha = 1; tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, TILE, TILE);
    composeTile(doc, tg, tx, ty, { exportMode: true, preview: false });
    const c = TilePool.get(); ctx2d(c).drawImage(tmp, 0, 0); cache.set(k, c);
    return c;
  };
  const fill = (g, y0, h) => {
    if (white) { g.fillStyle = '#fff'; g.fillRect(0, 0, W, h); }
    const ty0 = Math.max(0, Math.floor((y0 - oy) / TILE)), ty1 = Math.min(doc.rows - 1, Math.floor((y0 + h - 1 - oy) / TILE));
    for (const [k, c] of cache) { if (parseKey(k)[1] < ty0) { TilePool.put(c); cache.delete(k); } }
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = 0; tx < doc.cols; tx++) {
      const x = tx * TILE + ox;
      if (x >= W || x + TILE <= 0) continue;
      g.drawImage(tileAt(tx, ty), x, ty * TILE + oy - y0);
    }
    g.save(); g.translate(0, -y0);
    if (book && opts.nombre) drawNombre(g, doc, ox, oy);
    if (book && opts.crop === 'marks') drawCropMarks(g, doc, ox, oy);
    g.restore();
  };
  try {
    if (opts.format === 'jpeg') {
      if (W * H > 16.7e6) throw new Error('大きすぎて JPEG にできません（PNG にしてください）');
      const c = newCanvas(W, H), g = c.getContext('2d');
      for (let y0 = 0; y0 < H; y0 += 256) { g.save(); g.beginPath(); g.rect(0, y0, W, 256); g.clip(); g.translate(0, y0); fill(g, y0, Math.min(256, H - y0)); g.restore(); }
      return await canvasToBlob(c, 'image/jpeg', 0.92);
    }
    return await encodeBands(W, H, doc.dpi, opts.format === 'mono' ? 'mono' : 'rgba', fill);
  } finally { for (const c of cache.values()) TilePool.put(c); }
}

const Exporter = {
  async dialog(app) {
    const doc = app.doc, wid = doc.workId;
    const work = wid ? await Store.getWork(wid) : null;
    const multi = !!(work && work.pages && work.pages.length > 1);
    const book = doc.book;
    const seg = (opts, val) => { const b = el('div', { class: 'seg' }); b.value = val; for (const [v, t] of opts) b.append(el('button', { class: v === val ? 'on' : '', onclick: (e) => { b.value = v; for (const x of b.children) x.classList.remove('on'); e.target.classList.add('on'); } }, t)); return b; };
    const range = seg([['page', 'このページ'], ...(multi ? [['all', `全ページ（${work.pages.length}）`], ['spreads', '見開きの確認用 JPEG']] : [])], 'page');
    const format = seg([['png', 'PNG（カラー）'], ['mono', '2値 PNG（モノクロ原稿）'], ['jpeg', 'JPEG']], doc.kind === 'manga' ? 'mono' : 'png');
    const crop = seg(book ? [['full', '裁ち落とし込み（原稿のまま）'], ['trim', '仕上がりで切る'], ['marks', 'トンボを付ける']] : [['full', '原稿のまま']], 'full');
    const nom = el('input', { type: 'checkbox', checked: book && book.nombre && book.nombre.on ? true : null, disabled: !book || null });
    const body = el('div', { class: 'settings' },
      el('div', { class: 'set-row col' }, el('span', {}, '範囲'), range),
      el('div', { class: 'set-row col' }, el('span', {}, '形式'), format),
      el('div', { class: 'set-row col' }, el('span', {}, '大きさ'), crop),
      el('div', { class: 'set-row' }, el('span', {}, 'ノンブルを入れる'), nom),
      el('p', { class: 'hint' }, '入稿は印刷所の指定に合わせてください（よくある指定: モノクロ 600dpi 2値・裁ち落とし込み、カラー 350dpi）。全ページはまとめて zip にします。'));
    const ok = await modal({ title: '書き出し', body, wide: true, buttons: [{ label: 'キャンセル', value: false }, { label: '書き出す', value: true, primary: true }] });
    if (!ok) return;
    const opts = { crop: crop.value, format: format.value, nombre: nom.checked };
    await app.saveNow();
    app.busy('書き出しています…');
    try {
      if (range.value === 'page') {
        if (work) doc.pageInfo = pageLayout({ ...work, book: work.book || doc.book })[Math.max(0, Store.pageIds(work).indexOf(doc.pageId))];
        const blob = await exportPage(doc, opts);
        app.busy(null);
        await shareOrDownload(blob, `${doc.name}${multi ? '_' + String(doc.pageInfo.number).padStart(3, '0') : ''}.${opts.format === 'jpeg' ? 'jpg' : 'png'}`);
      } else if (range.value === 'all') {
        const zip = await this.allPages(app, work, opts);
        app.busy(null);
        await shareOrDownload(zip, `${work.name}_全ページ.zip`);
      } else {
        const zip = await this.spreads(app, work);
        app.busy(null);
        await shareOrDownload(zip, `${work.name}_見開き.zip`);
      }
    } catch (e) { app.busy(null); console.error(e); toast('書き出せません: ' + e.message, { error: true }); }
  },
  async allPages(app, work, opts) {
    const lay = pageLayout(work), files = [];
    for (let i = 0; i < lay.length; i++) {
      app.busy(`書き出しています… ${i + 1} / ${lay.length}`);
      const d = await Store.loadDoc(work.id, lay[i].id);
      d.pageInfo = lay[i]; d.spread = lay[i].spread;
      const blob = await exportPage(d, opts);
      d.comp.dispose();
      const n = lay[i].spread ? `${String(lay[i].number).padStart(3, '0')}-${String(lay[i].number2).padStart(3, '0')}` : String(lay[i].number).padStart(3, '0');
      files.push({ name: `${work.name}_${n}.${opts.format === 'jpeg' ? 'jpg' : 'png'}`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    return zipStore(files);
  },
  /* 見開きで並べた確認用の画像（高さ 1600px の JPEG） */
  async spreads(app, work) {
    const lay = pageLayout(work), H = 1600, files = [];
    const readFirstRight = !work.book || work.book.binding !== 'left';
    const bySpread = new Map();
    lay.forEach((p) => { const s = bySpread.get(p.spreadIndex) || []; s.push(p); bySpread.set(p.spreadIndex, s); });
    const imgs = new Map();
    for (let i = 0; i < lay.length; i++) {
      app.busy(`見開きを作っています… ${i + 1} / ${lay.length}`);
      const d = await Store.loadDoc(work.id, lay[i].id);
      d.spread = lay[i].spread; d.pageInfo = lay[i];
      const r = d.book ? bookRects(d).trim : { x: 0, y: 0, w: d.width, h: d.height };
      const c = renderRegion(d, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), scale: H / r.h, opts: { exportMode: true, preview: false } });
      imgs.set(lay[i].id, c);
      d.comp.dispose();
    }
    for (const [si, items] of [...bySpread.entries()].sort((a, b) => a[0] - b[0])) {
      let parts;
      if (items.length === 1 && items[0].spread) parts = [imgs.get(items[0].id)];
      else {
        const first = items.find((p) => p.slot % 2 === 0), second = items.find((p) => p.slot % 2 === 1);
        const a = first ? imgs.get(first.id) : null, b = second ? imgs.get(second.id) : null;
        parts = readFirstRight ? [b, a] : [a, b];
      }
      const pw = (parts.find(Boolean) || { width: Math.round(H * 0.7) }).width;
      const c = newCanvas(parts.reduce((s, p) => s + (p ? p.width : pw), 0), H), g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, H);
      let x = 0;
      for (const p of parts) { if (p) g.drawImage(p, x, 0); x += p ? p.width : pw; }
      if (parts.length === 2) { g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(x / 2 - 1, 0, 2, H); }
      files.push({ name: `${work.name}_見開き${String(si + 1).padStart(2, '0')}.jpg`, data: new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.88)).arrayBuffer()) });
    }
    return zipStore(files);
  },
  /* Webtoon: 縦に一定の高さで切って連番の画像に */
  async webtoon(app) {
    const doc = app.doc;
    const hIn = el('input', { type: 'number', class: 'inp', value: Math.min(doc.height, 1280), min: 100, step: 10 });
    const fmt = el('select', { class: 'sel' }, el('option', { value: 'jpeg' }, 'JPEG（軽い）'), el('option', { value: 'png' }, 'PNG'));
    const body = el('div', {}, el('label', { class: 'lbl' }, '1枚の高さ px'), hIn, el('label', { class: 'lbl' }, '形式'), fmt,
      el('p', { class: 'hint' }, `幅 ${doc.width}px のまま、上から順に切ります（全体の高さ ${doc.height}px）。連番の画像を zip にまとめます。`));
    const ok = await modal({ title: 'Webtoon 用に分割して書き出す', body, buttons: [{ label: 'キャンセル', value: false }, { label: '書き出す', value: true, primary: true }] });
    if (!ok) return;
    const h = clamp(Math.round(+hIn.value || 1280), 50, doc.height), files = [];
    app.busy('分割しています…');
    try {
      const n = Math.ceil(doc.height / h);
      for (let i = 0; i < n; i++) {
        const y = i * h, hh = Math.min(h, doc.height - y);
        const c = renderRegion(doc, { x: 0, y, w: doc.width, h: hh, opts: { exportMode: true, preview: false } });
        if (fmt.value === 'jpeg') { const g = c.getContext('2d'); g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
        const blob = await canvasToBlob(c, fmt.value === 'jpeg' ? 'image/jpeg' : 'image/png', 0.9);
        files.push({ name: `${doc.name}_${String(i + 1).padStart(3, '0')}.${fmt.value === 'jpeg' ? 'jpg' : 'png'}`, data: new Uint8Array(await blob.arrayBuffer()) });
      }
      app.busy(null);
      await shareOrDownload(zipStore(files), `${doc.name}_分割.zip`);
    } catch (e) { app.busy(null); toast('書き出せません: ' + e.message, { error: true }); }
  },
};

/* ---- 作品ファイル（複数ページ）: work.json ＋ pages/<番号>/document.json ＋ pages/<番号>/tiles/... */
async function exportWorkEgk(wid) {
  const work = await Store.getWork(wid);
  const ids = Store.pageIds(work);
  const files = [{ name: 'work.json', data: new TextEncoder().encode(JSON.stringify({ format: 'egakobo-work', version: 1, name: work.name, dpi: work.dpi, kind: work.kind, book: work.book || null, pages: (work.pages || [{}]).map((p) => ({ spread: !!p.spread })) })) }];
  for (let i = 0; i < ids.length; i++) {
    const d = await Store.loadDoc(wid, ids[i]);
    files.push({ name: `pages/${i}/document.json`, data: new TextEncoder().encode(JSON.stringify(docMeta(d))) });
    for (const l of d.layers()) for (const [prefix, map] of [['', l.tiles], ['m:', l.mask]]) {
      if (!map) continue;
      for (const [k, c] of map) { const png = await tileToPNG(c); if (png) files.push({ name: `pages/${i}/` + egkTileName(l.id, prefix + k), data: png }); }
    }
    d.comp.dispose();
  }
  return zipStore(files);
}
async function importWorkEgk(z, fallbackName) {
  const wj = JSON.parse(new TextDecoder().decode(z.get('work.json')));
  const wid = Store.newId();
  const work = { id: wid, name: wj.name || fallbackName, dpi: wj.dpi, kind: wj.kind, book: wj.book, pages: wj.pages.map((p) => ({ id: Store.newId(), spread: p.spread })), pageThumbs: {}, created: Date.now(), updated: Date.now() };
  await Store.putWork(work);
  for (let i = 0; i < work.pages.length; i++) {
    const mj = z.get(`pages/${i}/document.json`);
    if (!mj) continue;
    const meta = JSON.parse(new TextDecoder().decode(mj));
    const d = await docFromMeta(meta, async (lid, k) => { const b = z.get(`pages/${i}/` + egkTileName(lid, k)); return b ? new Blob([b], { type: 'image/png' }) : null; }, work.name);
    d.workId = wid; d.pageId = work.pages[i].id; d._storedIds = null;
    await Store.saveDoc(d);
    d.comp.dispose();
  }
  return wid;
}
