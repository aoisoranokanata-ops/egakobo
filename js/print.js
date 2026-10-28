'use strict';
/* 印刷・受け渡し用の書き出し: PDF（ページごとに画像1枚、TrimBox/BleedBox 付き）と PSD（レイヤー付き） */

/* ================= PDF =================
   pages: [{img: {idat, W, H, colors, bpc, mode}, dpi, trim, bleed}]。画像は PNG と同じ行ごとのフィルタ付き Flate なので
   /DecodeParms /Predictor 15 でそのまま入る（作り直さない） */
function buildPDF(pages, title = '') {
  const enc = new TextEncoder();
  const parts = [];
  let size = 0;
  const offsets = [];
  const add = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); size += b.length; };
  const obj = (n, body, stream = null) => {
    offsets[n] = size;
    if (stream) { add(`${n} 0 obj\n<< ${body} /Length ${stream.length} >>\nstream\n`); add(stream); add('\nendstream\nendobj\n'); }
    else add(`${n} 0 obj\n${body}\nendobj\n`);
  };
  add('%PDF-1.6\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length, kids = [];
  for (let i = 0; i < n; i++) kids.push(`${3 + i * 3} 0 R`);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`);
  const f = (v) => (Math.round(v * 1000) / 1000).toString();
  pages.forEach((p, i) => {
    const base = 3 + i * 3, im = p.img, k = 72 / p.dpi;
    const w = im.W * k, h = im.H * k;
    // PDF は左下が原点（y を上下ひっくり返す）
    const box = (r) => (r ? `[${f(r.x * k)} ${f(h - (r.y + r.h) * k)} ${f((r.x + r.w) * k)} ${f(h - r.y * k)}]` : null);
    const trim = box(p.trim), bleed = box(p.bleed);
    obj(base, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(w)} ${f(h)}]${trim ? ' /TrimBox ' + trim : ''}${bleed ? ' /BleedBox ' + bleed : ''} /Resources << /XObject << /Im0 ${base + 2} 0 R >> >> /Contents ${base + 1} 0 R >>`);
    const content = enc.encode(`q ${f(w)} 0 0 ${f(h)} 0 0 cm /Im0 Do Q`);
    obj(base + 1, '', content);
    const cs = { rgb: '/DeviceRGB', gray: '/DeviceGray', mono: '/DeviceGray', cmyk: '/DeviceCMYK' }[im.mode];
    obj(base + 2, `/Type /XObject /Subtype /Image /Width ${im.W} /Height ${im.H} /ColorSpace ${cs} /BitsPerComponent ${im.bpc} /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${im.colors} /BitsPerComponent ${im.bpc} /Columns ${im.W} >>`, im.idat);
  });
  const infoN = 3 + n * 3;
  const hex = (str) => '<FEFF' + [...str].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '>';
  obj(infoN, `<< /Title ${hex(title)} /Producer ${hex('描工房 ' + APP_VERSION)} >>`);
  const xref = size;
  let x = `xref\n0 ${infoN + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= infoN; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  add(x);
  add(`trailer\n<< /Size ${infoN + 1} /Root 1 0 R /Info ${infoN} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

/* ================= PSD =================
   レイヤー: 画素（トーン・モノクロは見た目どおり）、フォルダー、クリッピング、描画モード、不透明度、表示、マスク、日本語の名前。
   コマ枠フォルダーは「枠の形のマスク付きグループ＋枠線のレイヤー」。色調補正レイヤーは入れない。
   データは行ごとの PackBits（RLE）。並びは下から上。 */
const PSD_BLEND = { normal: 'norm', passthrough: 'pass', darken: 'dark', multiply: 'mul ', 'color-burn': 'idiv', lighten: 'lite', screen: 'scrn', 'color-dodge': 'div ', add: 'lddg', overlay: 'over', 'soft-light': 'sLit', 'hard-light': 'hLit', difference: 'diff', exclusion: 'smud', hue: 'hue ', saturation: 'sat ', color: 'colr', luminosity: 'lum ' };

class Bytes {
  constructor() { this.parts = []; this.len = 0; }
  push(u8) { this.parts.push(u8); this.len += u8.length; return this; }
  u8(...v) { return this.push(new Uint8Array(v)); }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v & 0xffff); return this.push(b); }
  i16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v); return this.push(b); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); return this.push(b); }
  i32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v); return this.push(b); }
  str(s) { return this.push(new TextEncoder().encode(s)); }
  bytes() { const out = new Uint8Array(this.len); let o = 0; for (const p of this.parts) { out.set(p, o); o += p.length; } return out; }
}
/* PackBits（1行） */
function packBits(src, out) {
  let i = 0;
  const n = src.length, start = out.length;
  while (i < n) {
    let j = i;
    while (j + 1 < n && src[j + 1] === src[i] && j - i < 127) j++;
    if (j > i) { out.push(257 - (j - i + 1), src[i]); i = j + 1; continue; }        // 同じ値の続き
    let k = i;
    while (k + 1 < n && src[k + 1] !== src[k] && k - i < 127) k++;
    if (k + 1 < n && k > i) k--;                                                     // 次の続きの頭は残す
    out.push(k - i);
    for (let m = i; m <= k; m++) out.push(src[m]);
    i = k + 1;
  }
  return out.length - start;
}
/* getTile(tx, ty) を1段ぶんずつ先に読んでおく（同じタイルを行ごとに読み直さない） */
function rowFetcher(getTile, r) {
  let curTy = null, row = null;
  return (ty) => {
    if (ty !== curTy) {
      curTy = ty; row = [];
      for (let tx = Math.floor(r.x / TILE); tx <= Math.floor((r.x + r.w - 1) / TILE); tx++) row.push([tx, getTile(tx, ty)]);
    }
    return row;
  };
}
/* タイル（と範囲）→ チャンネルの RLE データ [{id, data: Uint8Array}] */
function psdChannels(getTile, r, withAlpha = true) {
  const chans = withAlpha ? [-1, 0, 1, 2] : [0, 1, 2];
  const offs = chans.map((c) => (c === -1 ? 3 : c));
  const rows = chans.map(() => ({ counts: [], data: [] }));
  const W = r.w, line = chans.map(() => new Uint8Array(W));
  const fetch = rowFetcher(getTile, r);
  for (let y = r.y; y < r.y + r.h; y++) {
    const ty = Math.floor(y / TILE), ly = y - ty * TILE;
    for (const l of line) l.fill(withAlpha ? 0 : 255);
    for (const [tx, px] of fetch(ty)) {
      if (!px) continue;
      const x0 = Math.max(r.x, tx * TILE), x1 = Math.min(r.x + r.w, tx * TILE + TILE);
      const base = (ly * TILE + (x0 - tx * TILE)) * 4, o0 = x0 - r.x, n = x1 - x0;
      for (let ci = 0; ci < chans.length; ci++) {
        const L = line[ci], off = offs[ci];
        for (let i = 0, p = base + off; i < n; i++, p += 4) L[o0 + i] = px[p];
      }
    }
    for (let ci = 0; ci < chans.length; ci++) rows[ci].counts.push(packBits(line[ci], rows[ci].data));
  }
  return chans.map((id, ci) => {
    const b = new Bytes().u16(1);
    for (const c of rows[ci].counts) b.u16(c);
    b.push(new Uint8Array(rows[ci].data));
    return { id, data: b.bytes() };
  });
}
/* マスク（-2）: 値 = 255 − 隠す量 */
function psdMaskChannel(getTile, r) {
  const counts = [], data = [], line = new Uint8Array(r.w);
  const fetch = rowFetcher(getTile, r);
  for (let y = r.y; y < r.y + r.h; y++) {
    const ty = Math.floor(y / TILE), ly = y - ty * TILE;
    line.fill(255);
    for (const [tx, px] of fetch(ty)) {
      if (!px) continue;
      const x0 = Math.max(r.x, tx * TILE), x1 = Math.min(r.x + r.w, tx * TILE + TILE);
      for (let x = x0, p = (ly * TILE + (x0 - tx * TILE)) * 4 + 3; x < x1; x++, p += 4) line[x - r.x] = 255 - px[p];
    }
    counts.push(packBits(line, data));
  }
  const b = new Bytes().u16(1);
  for (const c of counts) b.u16(c);
  b.push(new Uint8Array(data));
  return { id: -2, data: b.bytes() };
}
function pascal4(name) {
  // 名前（ASCII 以外は ? にして）を 4 の倍数に
  const s = [...name].map((c) => (c.charCodeAt(0) < 128 ? c : '?')).join('').slice(0, 255);
  const b = new Bytes().u8(s.length).str(s);
  while (b.len % 4) b.u8(0);
  return b.bytes();
}
function psdExtra(key, body) { const pad = body.length % 2; const b = new Bytes().str('8BIM').str(key).u32(body.length + pad).push(body); if (pad) b.u8(0); return b.bytes(); }
function luni(name) { const b = new Bytes().u32(name.length); for (const c of name) b.u16(c.charCodeAt(0)); return psdExtra('luni', b.bytes()); }

async function encodePSD(doc, progress = null) {
  const W = doc.width, H = doc.height, recs = [];
  const tilePixels = (map, prep) => (tx, ty) => { const t = map.get(tkey(tx, ty)); if (!t) return null; return prep ? prep(t, tx, ty) : readTilePixels(t).data; };
  const tmp = newCanvas(TILE, TILE);
  const clipDoc = (r) => { if (!r) return null; const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(W, r.x + r.w), y1 = Math.min(H, r.y + r.h); return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null; };
  const pixelRec = (L, name, getTile, r, extraProps = {}) => {
    const chans = r ? psdChannels(getTile, r) : [-1, 0, 1, 2].map((id) => ({ id, data: new Uint8Array([0, 0]) }));
    recs.push({ name, r: r || { x: 0, y: 0, w: 0, h: 0 }, chans, blend: PSD_BLEND[L.blend] || 'norm', opacity: Math.round(L.opacity * 255), clip: L.clip ? 1 : 0, hidden: !L.visible || !!L.draft, alphaLock: L.alphaLock, mask: maskOf(L), ...extraProps });
  };
  const maskOf = (L) => {
    if (!L.mask || !L.mask.size) return null;
    const r = clipDoc(L.tileBounds(L.mask));
    if (!r) return null;
    return { r, chan: psdMaskChannel(tilePixels(L.mask), r), off: !L.maskOn };
  };
  const walk = async (list) => {
    for (const L of list) {
      if (L.kind === 'paper') {
        if (!L.visible) continue;
        const c = TilePool.get(); const g = ctx2d(c); g.fillStyle = L.color; g.fillRect(0, 0, TILE, TILE);
        const px = readTilePixels(c).data.slice(); TilePool.put(c);
        pixelRec(L, '用紙', () => px, { x: 0, y: 0, w: W, h: H });
        continue;
      }
      if (L.kind === 'adjust') continue;
      if (L.isFolder) {
        recs.push({ name: '</Layer group>', divider: 3, r: { x: 0, y: 0, w: 0, h: 0 }, chans: [-1, 0, 1, 2].map((id) => ({ id, data: new Uint8Array([0, 0]) })), blend: 'norm', opacity: 255, hidden: false });
        await walk(L.children);
        if (L.frame) {
          // コマ枠: 枠線を一番上のレイヤーに
          const fb = clipDoc(frameBBox(L.frame));
          if (fb) {
            const tiles = new Map();
            for (const [tx, ty, k] of doc.gridKeys(fb)) { const c = TilePool.get(), g = ctx2d(c); g.setTransform(1, 0, 0, 1, -tx * TILE, -ty * TILE); g.lineWidth = L.frame.width; g.lineJoin = 'miter'; g.strokeStyle = L.frame.color || '#000'; g.stroke(framePath(L.frame.pts)); tiles.set(k, c); }
            pixelRec({ blend: 'normal', opacity: 1, visible: true }, '枠線', tilePixels(tiles), fb);
            for (const c of tiles.values()) TilePool.put(c);
          }
        }
        let mask = maskOf(L);
        if (L.frame) {
          // 枠の形をマスクに（外 = 隠す）
          const fb = clipDoc(frameBBox(L.frame));
          const hide = new Map();
          for (const [tx, ty, k] of doc.gridKeys(fb)) { const c = TilePool.get(), g = ctx2d(c); g.fillStyle = '#fff'; g.fillRect(0, 0, TILE, TILE); g.setTransform(1, 0, 0, 1, -tx * TILE, -ty * TILE); g.globalCompositeOperation = 'destination-out'; g.fill(framePath(L.frame.pts)); hide.set(k, c); }
          mask = { r: fb, chan: psdMaskChannel(tilePixels(hide), fb), off: false };
          for (const c of hide.values()) TilePool.put(c);
        }
        recs.push({ name: L.name, divider: L.open ? 1 : 2, r: { x: 0, y: 0, w: 0, h: 0 }, chans: [-1, 0, 1, 2].map((id) => ({ id, data: new Uint8Array([0, 0]) })), blend: L.anim || L.frame ? 'norm' : PSD_BLEND[L.blend] || 'pass', opacity: Math.round(L.opacity * 255), clip: L.clip ? 1 : 0, hidden: !L.visible, mask });
        continue;
      }
      if (!L.hasTiles) continue;
      // アニメのセルは今のフレームのものだけ表示
      const pa = doc.parentOf(L);
      const hiddenCel = pa && pa.anim && doc.anim && celAt(pa, doc.anim.cur) !== L.id;
      const prep = L.tone || L.mono ? (t, tx, ty) => readTilePixels(L.tone ? toneTile(t, tmp, L.tone, tx, ty, doc.dpi) : monoTile(t, tmp)).data : null;
      pixelRec(L, L.name, tilePixels(L.tiles, prep), clipDoc(L.tileBounds()), hiddenCel ? { hidden: true } : {});
      if (progress) progress(`PSD にしています…（${L.name}）`);
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  await walk(doc.root.children);

  // ---- 書く
  const out = new Bytes();
  out.str('8BPS').u16(1).u32(0).u16(0).u16(3).u32(H).u32(W).u16(8).u16(3);
  out.u32(0);                                                    // カラーモードのデータなし
  const res = new Bytes().str('8BIM').u16(0x03ed).u16(0).u32(16).u32(doc.dpi << 16).u16(1).u16(1).u32(doc.dpi << 16).u16(1).u16(1);
  out.u32(res.len).push(res.bytes());
  // レイヤー情報
  const info = new Bytes().i16(recs.length);
  for (const r of recs) {
    info.i32(r.r.y).i32(r.r.x).i32(r.r.y + r.r.h).i32(r.r.x + r.r.w);
    const chans = r.mask ? [...r.chans, r.mask.chan] : r.chans;
    info.u16(chans.length);
    for (const c of chans) info.i16(c.id).u32(c.data.length);
    info.str('8BIM').str(r.blend).u8(r.opacity, r.clip || 0, (r.alphaLock ? 1 : 0) | (r.hidden ? 2 : 0) | 8 | (r.divider ? 16 : 0), 0);
    const ex = new Bytes();
    if (r.mask) { const m = r.mask.r; ex.u32(20).i32(m.y).i32(m.x).i32(m.y + m.h).i32(m.x + m.w).u8(255, r.mask.off ? 2 : 0, 0, 0); } else ex.u32(0);
    ex.u32(0);                                                   // 合成範囲なし
    ex.push(pascal4(r.name));
    ex.push(luni(r.name));
    if (r.divider) { const d = new Bytes().u32(r.divider); if (r.divider !== 3) d.str('8BIM').str(r.blend); ex.push(psdExtra('lsct', d.bytes())); }
    info.u32(ex.len).push(ex.bytes());
  }
  for (const r of recs) { for (const c of r.chans) info.push(c.data); if (r.mask) info.push(r.mask.chan.data); }
  if (info.len % 2) info.u8(0);
  const lmi = new Bytes().u32(info.len).push(info.bytes()).u32(0);
  out.u32(lmi.len).push(lmi.bytes());
  // 合成した画像（RLE・RGB）
  if (progress) progress('PSD にしています…（合成画像）');
  const t = newCanvas(TILE, TILE), tg = ctx2d(t);
  const rowsCache = new Map();
  const compTile = (tx, ty) => {
    const k = tkey(tx, ty);
    if (!rowsCache.has(k)) {
      if (rowsCache.size > doc.cols * 2) rowsCache.clear();
      tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalAlpha = 1; tg.globalCompositeOperation = 'source-over'; tg.fillStyle = '#fff'; tg.fillRect(0, 0, TILE, TILE);
      composeTile(doc, tg, tx, ty, { exportMode: true, preview: false });
      rowsCache.set(k, readTilePixels(t).data.slice());
    }
    return rowsCache.get(k);
  };
  const merged = psdChannels(compTile, { x: 0, y: 0, w: W, h: H }, false);
  // 合成画像は「全チャンネルの行の長さ → 全チャンネルのデータ」の順
  const img = new Bytes().u16(1);
  const counts = merged.map((c) => c.data.subarray(2, 2 + H * 2));
  const datas = merged.map((c) => c.data.subarray(2 + H * 2));
  for (const c of counts) img.push(c);
  for (const d of datas) img.push(d);
  out.push(img.bytes());
  return new Blob(out.parts, { type: 'image/vnd.adobe.photoshop' });
}
