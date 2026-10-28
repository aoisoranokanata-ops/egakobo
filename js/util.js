'use strict';
/* 共通の小道具。トップレベルの宣言は全 js で共有される。 */

const APP_VERSION = '0.6.0';
const TILE = 256;
const LS = 'egakobo.';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  return c;
}
function ctx2d(c, opts) { return c.getContext('2d', opts); }

/* 256px タイル用の canvas を使い回す（作っては捨てると iPad で GC が重い） */
const TilePool = {
  free: [],
  get() {
    const c = this.free.pop();
    if (c) { const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, TILE, TILE); return c; }
    return newCanvas(TILE, TILE);
  },
  put(c) { if (c && this.free.length < 256) this.free.push(c); },
};
function copyTile(src) {
  const c = TilePool.get();
  if (src) c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

/* 読み出し専用の小さな canvas（getImageData を描画用 canvas でやると CPU 描画に落ちることがある） */
let _readC = null;
function readTilePixels(tile) {
  if (!_readC) _readC = newCanvas(TILE, TILE);
  const g = _readC.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, TILE, TILE);
  if (tile) g.drawImage(tile, 0, 0);
  return g.getImageData(0, 0, TILE, TILE);
}

let _readC2 = null;
function readTilePixelsB(tile) {           // 2枚目の読み出し用（1枚目と同時に使う時）
  if (!_readC2) _readC2 = newCanvas(TILE, TILE);
  const g = _readC2.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, TILE, TILE);
  if (tile) g.drawImage(tile, 0, 0);
  return g.getImageData(0, 0, TILE, TILE);
}

const tkey = (tx, ty) => tx + ',' + ty;
const parseKey = (k) => { const i = k.indexOf(','); return [+k.slice(0, i), +k.slice(i + 1)]; };

/* 矩形 {x, y, w, h} が掛かるタイルの範囲 */
function tilesOfRect(r) {
  const tx0 = Math.floor(r.x / TILE), ty0 = Math.floor(r.y / TILE);
  const tx1 = Math.floor((r.x + r.w - 1e-6) / TILE), ty1 = Math.floor((r.y + r.h - 1e-6) / TILE);
  return { tx0, ty0, tx1, ty1 };
}

/* ---- 色 */
function hexToRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
}
function hsvToRgb({ h, s, v }) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/* ---- 小さな通知 */
function toast(msg, { ms = 2200, error = false } = {}) {
  const box = $('#toasts');
  if (!box) return;
  const t = el('div', { class: 'toast' + (error ? ' err' : '') }, msg);
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

/* ---- ダイアログ（Promise で値を返す） */
function modal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], onOpen, wide }) {
  return new Promise((resolve) => {
    const back = el('div', { class: 'modal-back' });
    const box = el('div', { class: 'modal' + (wide ? ' wide' : '') });
    if (title) box.append(el('h2', {}, title));
    const bodyEl = el('div', { class: 'modal-body' });
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
    box.append(bodyEl);
    const foot = el('div', { class: 'modal-foot' });
    const close = (v) => { back.remove(); resolve(v); };
    for (const b of buttons) {
      foot.append(el('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), onclick: () => close(typeof b.value === 'function' ? b.value(bodyEl) : b.value) }, b.label));
    }
    box.append(foot);
    back.append(box);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(undefined); });
    document.body.append(back);
    if (onOpen) onOpen(bodyEl, close);
  });
}
const confirmBox = (title, text, okLabel = 'OK', danger = false) =>
  modal({ title, body: el('p', {}, text), buttons: [{ label: 'キャンセル', value: false }, { label: okLabel, value: true, primary: !danger, danger }] });
async function promptBox(title, value = '', label = '') {
  const inp = el('input', { type: 'text', value, class: 'inp' });
  const body = el('div', {}, label ? el('label', { class: 'lbl' }, label) : null, inp);
  const r = await modal({
    title, body, buttons: [{ label: 'キャンセル', value: null }, { label: 'OK', value: () => inp.value, primary: true }],
    onOpen: () => setTimeout(() => { inp.focus(); inp.select(); }, 50),
  });
  return r == null ? null : r;
}

/* ---- ファイル */
function canvasToBlob(c, type = 'image/png', q) {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('画像にできませんでした'))), type, q));
}
async function blobToBitmap(blob) {
  if (window.createImageBitmap) { try { return await createImageBitmap(blob); } catch { /* 下へ */ } }
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('画像を読めません')); };
    img.src = url;
  });
}
/* 共有シート（iPad: 写真に保存・ファイルに保存）→ 無ければダウンロード */
async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
  }
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}
function pickFile(accept, multiple = false) {
  return new Promise((res) => {
    const inp = el('input', { type: 'file', accept, style: 'display:none' });
    if (multiple) inp.multiple = true;
    inp.addEventListener('change', () => { res(multiple ? [...inp.files] : inp.files[0] || null); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}

/* ---- 透明部分の市松模様 */
let _checker = null;
function checkerPattern(g) {
  if (!_checker) {
    const c = newCanvas(16, 16), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 16, 16);
    x.fillStyle = '#d6d6d6'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
    _checker = c;
  }
  return g.createPattern(_checker, 'repeat');
}

/* ---- 紙の質感（つなぎ目無しのノイズ 256px、値が大きいほど紙の凹み＝色が乗らない） */
const Grain = {
  cache: new Map(),
  /* kind: 'paper' | 'canvas' | 'rough'  strength 0..1 → 白・アルファの canvas */
  get(kind, strength) {
    const key = kind + ':' + Math.round(strength * 20);
    if (this.cache.has(key)) return this.cache.get(key);
    const N = 256, c = newCanvas(N, N), g = c.getContext('2d');
    const img = g.createImageData(N, N), d = img.data;
    const base = this.field(kind);
    for (let i = 0; i < N * N; i++) {
      const v = clamp((base[i] - 0.35) * 1.6, 0, 1) * strength;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = Math.round(v * 255);
    }
    g.putImageData(img, 0, 0);
    this.cache.set(key, c);
    return c;
  },
  _fields: {},
  field(kind) {
    if (this._fields[kind]) return this._fields[kind];
    const N = 256, out = new Float32Array(N * N);
    let seed = kind === 'canvas' ? 7 : kind === 'rough' ? 13 : 3;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // 周期的な値ノイズを何段か重ねる（つなぎ目が出ない）
    const octaves = kind === 'rough' ? [[16, 0.25], [64, 0.35], [128, 0.4]] : kind === 'canvas' ? [[32, 0.4], [64, 0.4], [128, 0.2]] : [[16, 0.15], [64, 0.35], [128, 0.5]];
    for (const [cells, amp] of octaves) {
      const grid = new Float32Array(cells * cells);
      for (let i = 0; i < grid.length; i++) grid[i] = rnd();
      const s = cells / N;
      for (let y = 0; y < N; y++) {
        const fy = y * s, y0 = Math.floor(fy), ty = fy - y0, ty2 = ty * ty * (3 - 2 * ty);
        const r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells;
        for (let x = 0; x < N; x++) {
          const fx = x * s, x0 = Math.floor(fx), tx = fx - x0, tx2 = tx * tx * (3 - 2 * tx);
          const c0 = x0 % cells, c1 = (x0 + 1) % cells;
          const a = lerp(grid[r0 + c0], grid[r0 + c1], tx2), b = lerp(grid[r1 + c0], grid[r1 + c1], tx2);
          out[y * N + x] += lerp(a, b, ty2) * amp;
        }
      }
    }
    if (kind === 'canvas') {                // 布目: 縦横の織り目を少し足す
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[y * N + x] = out[y * N + x] * 0.7 + 0.3 * (0.5 + 0.25 * Math.sin(x * Math.PI / 4) + 0.25 * Math.sin(y * Math.PI / 4));
    }
    this._fields[kind] = out;
    return out;
  },
};

/* ---- 無圧縮 zip（.egk 用。中身の PNG は圧縮済みなので store で十分） */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipStore(files) {          // files: [{name, data: Uint8Array}]
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + n;
  }
  const csize = central.reduce((s, a) => s + a.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
function unzipStore(buf) {          // → Map(name → Uint8Array)。store（無圧縮）だけ読める
  const u8 = new Uint8Array(buf), dv = new DataView(buf), dec = new TextDecoder();
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('作品ファイルが壊れています');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('作品ファイルが壊れています');
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    if (method !== 0) throw new Error('圧縮された zip は読めません');
    const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true);
    out.set(name, u8.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + size));
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/* ---- PNG を自前で作る（toBlob は裏に回った時などに 1枚1秒まで遅くなることがあるため、タイルの保存はこちら）
   rows: 各行の RGBA を順に返すジェネレータ、または RGBA 全体の Uint8Array */
function pngChunk(type, data) {
  const b = new Uint8Array(12 + data.length), dv = new DataView(b.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
  b.set(data, 8);
  dv.setUint32(8 + data.length, crc32(b.subarray(4, 8 + data.length)));
  return b;
}
function pngHeader(W, H, dpi) {
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer);
  hv.setUint32(0, W); hv.setUint32(4, H); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr)];
  if (dpi) {
    const phys = new Uint8Array(9), pv = new DataView(phys.buffer), ppm = Math.round(dpi / 0.0254);
    pv.setUint32(0, ppm); pv.setUint32(4, ppm); phys[8] = 1;
    parts.push(pngChunk('pHYs', phys));
  }
  return parts;
}
/* 1行分にフィルタ 1（左との差）を掛けて out に書く */
function pngFilterRow(src, so, W, out, oo) {
  out[oo] = 1;
  const n = W * 4;
  for (let i = 0; i < 4; i++) out[oo + 1 + i] = src[so + i];
  for (let i = 4; i < n; i++) out[oo + 1 + i] = (src[so + i] - src[so + i - 4]) & 255;
}
async function deflate(u8) {
  const cs = new CompressionStream('deflate');
  const w = cs.writable.getWriter();
  w.write(u8); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
/* タイル（256px canvas）→ PNG の Uint8Array。全部透明なら null */
async function tileToPNG(tile) {
  const px = readTilePixels(tile).data;
  let any = false;
  for (let i = 3; i < px.length; i += 4) if (px[i]) { any = true; break; }
  if (!any) return null;
  if (typeof CompressionStream === 'undefined') return new Uint8Array(await (await canvasToBlob(tile)).arrayBuffer());
  const raw = new Uint8Array(TILE * (1 + TILE * 4));
  for (let y = 0; y < TILE; y++) pngFilterRow(px, y * TILE * 4, TILE, raw, y * (1 + TILE * 4));
  const idat = await deflate(raw);
  const parts = [...pngHeader(TILE, TILE), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1024 ** 3) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 ** 3).toFixed(2) + ' GB';
}
function fmtDate(t) {
  const d = new Date(t);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function loadLS(key, def) { try { const v = localStorage.getItem(LS + key); return v == null ? def : JSON.parse(v); } catch { return def; } }
function saveLS(key, v) { try { localStorage.setItem(LS + key, JSON.stringify(v)); } catch { /* 容量・プライベート */ } }
