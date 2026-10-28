'use strict';
/* 保存（IndexedDB "egakobo"）。
   works: {id, name, width, height, dpi, kind, created, updated, thumb, bytes}
   docs : {id, meta}  meta = 文書の構造（レイヤーの木と属性）
   tiles: key = 'workId|layerId|tx,ty' → {type, buf: ArrayBuffer}（PNG）
   画像は ArrayBuffer で入れる（Blob のままだと iPad の Safari で保存に失敗することがある）。
   変わったタイルだけ書く（doc.unsaved）。どのレイヤーが保存済みかは doc._storedIds で持つ。 */

const FORMAT = 'egakobo';
const FORMAT_VERSION = 1;

const Store = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open('egakobo', 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        for (const n of ['works', 'docs']) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('tiles')) db.createObjectStore('tiles');
      };
      rq.onsuccess = () => {
        const db = rq.result;
        db.onclose = () => { if (this.db === db) this.db = null; };
        db.onversionchange = () => { db.close(); if (this.db === db) this.db = null; };
        this.db = db;
        res(db);
      };
      rq.onerror = () => rej(rq.error || new Error('保存領域を開けません'));
    });
  },
  async tx(stores, mode, fn) {
    try { return await this._tx(stores, mode, fn); } catch (e) {
      if (e && (e.name === 'InvalidStateError' || e.name === 'UnknownError' || /connection|closing|lost/i.test(e.message || ''))) {
        try { this.db && this.db.close(); } catch { /* */ }
        this.db = null;
        return this._tx(stores, mode, fn);
      }
      throw e;
    }
  },
  _tx(stores, mode, fn) {
    return this.open().then((db) => new Promise((res, rej) => {
      let t;
      try { t = db.transaction(stores, mode); } catch (e) { rej(e); return; }
      let out, reqErr = null;
      t.oncomplete = () => res(out);
      t.onerror = (ev) => { reqErr = (ev && ev.target && ev.target.error) || reqErr; };
      t.onabort = () => rej(t.error || reqErr || new Error('保存が中断されました（容量不足の可能性）'));
      try { out = fn(...stores.map((s) => t.objectStore(s))); } catch (e) { try { t.abort(); } catch { /* */ } rej(e); }
    }));
  },
  req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  newId() { return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },

  async list() {
    const all = await this.tx(['works'], 'readonly', (w) => this.req(w.getAll()));
    return (await all).sort((a, b) => b.updated - a.updated);
  },
  async getWork(id) { return this.tx(['works'], 'readonly', (w) => this.req(w.get(id))).then((p) => p); },

  /* 保存。unsaved のタイル・未保存のレイヤー・消えたレイヤーを反映 */
  async saveDoc(doc, extra = {}) {
    if (!doc.workId) doc.workId = this.newId();
    const id = doc.workId;
    if (!doc._storedIds) doc._storedIds = new Set();
    const live = doc.layers().filter((l) => l.isRaster);
    const liveIds = new Set(live.map((l) => l.id));
    // 書くタイル
    const want = new Set(doc.unsaved);
    doc.unsaved.clear();
    for (const l of live) if (!doc._storedIds.has(l.id)) for (const k of l.tiles.keys()) want.add(l.id + '/' + k);
    const puts = [], dels = [];
    try {
      for (const w of want) {
        const i = w.indexOf('/'), lid = +w.slice(0, i), k = w.slice(i + 1);
        if (!liveIds.has(lid)) continue;
        const l = live.find((x) => x.id === lid);
        const c = l.tiles.get(k);
        const key = `${id}|${lid}|${k}`;
        const png = c ? await tileToPNG(c) : null;
        if (png) puts.push([key, { type: 'image/png', buf: png.buffer }]);
        else {
          dels.push(key);
          if (c && l.tiles.get(k) === c) { l.tiles.delete(k); TilePool.put(c); }    // 消しゴムで空になったタイルは捨てる
        }
      }
    } catch (e) { for (const w of want) doc.unsaved.add(w); throw e; }
    const gone = [...doc._storedIds].filter((lid) => !liveIds.has(lid));
    const meta = docMeta(doc);
    const thumb = await this.makeThumb(doc);
    const now = Date.now();
    const prev = await this.getWork(id);
    const work = {
      id, name: doc.name, width: doc.width, height: doc.height, dpi: doc.dpi, kind: doc.kind,
      created: prev ? prev.created : now, updated: now, thumb, layers: live.length,
      ...extra,
    };
    try {
      await this.tx(['works', 'docs', 'tiles'], 'readwrite', (w, d, t) => {
        w.put(work);
        d.put({ id, meta });
        for (const [k, v] of puts) t.put(v, k);
        for (const k of dels) t.delete(k);
        for (const lid of gone) t.delete(IDBKeyRange.bound(`${id}|${lid}|`, `${id}|${lid}|￿`));
      });
    } catch (e) { for (const w of want) doc.unsaved.add(w); throw e; }
    for (const l of live) doc._storedIds.add(l.id);
    for (const lid of gone) doc._storedIds.delete(lid);
    doc.metaDirty = false;
    return work;
  },
  async makeThumb(doc) {
    const s = Math.min(1, 400 / Math.max(doc.width, doc.height));
    const c = renderRegion(doc, { scale: s, opts: { exportMode: true, preview: false } });
    return { type: 'image/jpeg', buf: await (await canvasToBlob(c, 'image/jpeg', 0.85)).arrayBuffer() };
  },

  async loadDoc(id) {
    const [work, data] = await this.tx(['works', 'docs'], 'readonly', (w, d) => Promise.all([this.req(w.get(id)), this.req(d.get(id))]));
    if (!work || !data) throw new Error('作品が見つかりません');
    const tiles = await this.tx(['tiles'], 'readonly', (t) => {
      const range = IDBKeyRange.bound(`${id}|`, `${id}|￿`);
      return Promise.all([this.req(t.getAllKeys(range)), this.req(t.getAll(range))]);
    });
    const [keys, vals] = await tiles;
    const files = new Map();
    keys.forEach((k, i) => { const p = k.split('|'); files.set(p[1] + '/' + p[2], vals[i]); });
    const doc = await docFromMeta(data.meta, async (lid, k) => { const v = files.get(lid + '/' + k); return v ? new Blob([v.buf], { type: v.type }) : null; }, work.name);
    doc.workId = id;
    doc._storedIds = new Set(doc.layers().filter((l) => l.isRaster).map((l) => l.id));
    doc.metaDirty = false;
    return doc;
  },
  async remove(id) {
    await this.tx(['works', 'docs', 'tiles'], 'readwrite', (w, d, t) => { w.delete(id); d.delete(id); t.delete(IDBKeyRange.bound(`${id}|`, `${id}|￿`)); });
  },
  async rename(id, name) {
    const work = await this.getWork(id);
    if (!work) return;
    work.name = name;
    await this.tx(['works'], 'readwrite', (w) => w.put(work));
  },
  async estimate() {
    try { return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch { return null; }
  },
};

/* 文書の構造 → JSON（レイヤーの id もそのまま。読み込んでも同じ id を使う） */
function docMeta(doc) {
  const ser = (l) => {
    const o = { id: l.id, kind: l.kind };
    for (const k of LAYER_PROPS) o[k] = l[k];
    if (l.tiles) o.tiles = [...l.tiles.keys()];
    if (l.children) o.children = l.children.map(ser);
    return o;
  };
  return {
    format: FORMAT, version: FORMAT_VERSION, width: doc.width, height: doc.height, dpi: doc.dpi, kind: doc.kind,
    name: doc.name, active: doc.activeId, layers: doc.root.children.map(ser), app: APP_VERSION,
  };
}
/* JSON ＋ タイル画像の取り出し方 → 文書 */
async function docFromMeta(meta, getTile, name) {
  if (meta.format !== FORMAT) throw new Error('描工房の作品ではありません');
  if ((meta.version || 0) > FORMAT_VERSION) throw new Error('新しい版の描工房で保存された作品です');
  const doc = new Doc({ width: meta.width, height: meta.height, dpi: meta.dpi, name: name || meta.name, kind: meta.kind });
  doc.root.children = [];
  const idMap = new Map();
  const jobs = [];
  // レイヤーの id は保存時のまま（保存領域のタイルの名前に id が入っているため）
  const build = (o) => {
    const l = new Layer(o.kind, o.name);
    l.id = o.id;
    bumpLayerSeq(o.id);
    for (const k of LAYER_PROPS) if (k in o) l[k] = o[k];
    idMap.set(o.id, l.id);
    if (o.kind === 'raster') for (const k of o.tiles || []) jobs.push([l, o.id, k]);
    if (o.children) l.children = o.children.map(build);
    return l;
  };
  doc.root.children = meta.layers.map(build);
  if (!doc.paper) { const p = new Layer('paper', '用紙'); doc.root.children.unshift(p); }
  // タイルを並行して読む（多すぎると iPad で詰まるので 16 本ずつ）
  for (let i = 0; i < jobs.length; i += 16) {
    await Promise.all(jobs.slice(i, i + 16).map(async ([l, oid, k]) => {
      const blob = await getTile(oid, k);
      if (!blob) return;
      const bmp = await blobToBitmap(blob);
      const c = TilePool.get();
      ctx2d(c).drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      l.tiles.set(k, c);
    }));
  }
  doc.activeId = idMap.get(meta.active) ?? null;
  if (!doc.active || doc.active.kind === 'paper') {
    const r = doc.layers().reverse().find((l) => l.isRaster);
    if (r) doc.activeId = r.id;
    else { const l = new Layer('raster', 'レイヤー 1'); doc.root.children.push(l); doc.activeId = l.id; }
  }
  doc.history.clear();
  return doc;
}

/* ---- 作品ファイル（.egk = 無圧縮 zip: document.json ＋ tiles/<layerId>/<tx>_<ty>.png） */
async function exportEgk(doc) {
  const files = [];
  const meta = docMeta(doc);
  files.push({ name: 'document.json', data: new TextEncoder().encode(JSON.stringify(meta)) });
  for (const l of doc.layers()) {
    if (!l.isRaster) continue;
    for (const [k, c] of l.tiles) {
      const png = await tileToPNG(c);
      if (png) files.push({ name: `tiles/${l.id}/${k.replace(',', '_')}.png`, data: png });
    }
  }
  const thumb = renderRegion(doc, { scale: Math.min(1, 512 / Math.max(doc.width, doc.height)), opts: { exportMode: true, preview: false } });
  files.push({ name: 'thumbnail.png', data: new Uint8Array(await (await canvasToBlob(thumb)).arrayBuffer()) });
  return zipStore(files);
}
async function importEgk(file) {
  const z = unzipStore(await file.arrayBuffer());
  const j = z.get('document.json');
  if (!j) throw new Error('描工房の作品ファイルではありません');
  const meta = JSON.parse(new TextDecoder().decode(j));
  return docFromMeta(meta, async (lid, k) => {
    const d = z.get(`tiles/${lid}/${k.replace(',', '_')}.png`);
    return d ? new Blob([d], { type: 'image/png' }) : null;
  }, meta.name || (file.name || '').replace(/\.egk$/i, ''));
}

/* ---- PNG 書き出し（大きい文書でも1枚の canvas を作らない: タイルの帯ごとに圧縮して流す） */
async function encodePNG(doc, opts = {}) {
  const W = doc.width, H = doc.height;
  if (typeof CompressionStream === 'undefined') {
    const c = renderRegion(doc, { opts: { exportMode: true, preview: false, ...opts } });
    return canvasToBlob(c);
  }
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const outP = new Response(cs.readable).arrayBuffer();
  const t = newCanvas(TILE, TILE), tg = ctx2d(t);
  for (let ty = 0; ty < doc.rows; ty++) {
    const bandH = Math.min(TILE, H - ty * TILE);
    const band = new Uint8Array(bandH * (1 + W * 4));
    for (let tx = 0; tx < doc.cols; tx++) {
      tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalAlpha = 1; tg.globalCompositeOperation = 'source-over';
      tg.clearRect(0, 0, TILE, TILE);
      composeTile(doc, tg, tx, ty, { exportMode: true, preview: false, ...opts });
      const px = readTilePixels(t).data;
      const ew = Math.min(TILE, W - tx * TILE);
      for (let j = 0; j < bandH; j++) band.set(px.subarray(j * TILE * 4, j * TILE * 4 + ew * 4), j * (1 + W * 4) + 1 + tx * TILE * 4);
    }
    // フィルタ 1（左との差）で少し小さく
    const row = new Uint8Array(W * 4);
    for (let j = 0; j < bandH; j++) {
      const o = j * (1 + W * 4);
      row.set(band.subarray(o + 1, o + 1 + W * 4));
      pngFilterRow(row, 0, W, band, o);
    }
    await writer.write(band);
  }
  await writer.close();
  const idat = new Uint8Array(await outP);
  return new Blob([...pngHeader(W, H, doc.dpi || 72), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}
