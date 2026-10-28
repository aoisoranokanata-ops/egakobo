'use strict';
/* アニメーションの書き出し: MP4（WebCodecs の H.264 ＋自前の MP4 の箱）・GIF（自前: 減色＋LZW）・連番 PNG */

/* ================= GIF ================= */
/* 減色（メディアンカット・各色 5bit の表で数えてから箱を割る）→ {palette 768, index(r,g,b)} */
function quantize(data, maxColors = 256) {
  const hist = new Uint32Array(32768);
  for (let i = 0; i < data.length; i += 4) hist[((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)]++;
  const cols = [];
  for (let c = 0; c < 32768; c++) if (hist[c]) cols.push(c);
  const comp = (c, ch) => (ch === 0 ? c >> 10 : ch === 1 ? (c >> 5) & 31 : c & 31);
  let boxes = [cols];
  while (boxes.length < maxColors) {
    // 一番広い（数×幅が大きい）箱を割る
    let bi = -1, best = 0, bch = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let mn = 31, mx = 0;
        for (const c of b) { const v = comp(c, ch); if (v < mn) mn = v; if (v > mx) mx = v; }
        const score = (mx - mn) * Math.sqrt(b.reduce((s, c) => s + hist[c], 0));
        if (score > best) { best = score; bi = i; bch = ch; }
      }
    });
    if (bi < 0) break;
    const b = boxes[bi].sort((x, y) => comp(x, bch) - comp(y, bch));
    let total = 0; for (const c of b) total += hist[c];
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += hist[b[i]]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  const palette = new Uint8Array(768), map = new Int16Array(32768).fill(-1);
  const pr = [], pg = [], pb = [];
  boxes.forEach((b, i) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const c of b) { const w = hist[c]; r += (comp(c, 0) * 8 + 4) * w; g += (comp(c, 1) * 8 + 4) * w; bl += (comp(c, 2) * 8 + 4) * w; n += w; map[c] = i; }
    palette[i * 3] = pr[i] = Math.round(r / n); palette[i * 3 + 1] = pg[i] = Math.round(g / n); palette[i * 3 + 2] = pb[i] = Math.round(bl / n);
  });
  return { palette, map, count: boxes.length };
}
function lzwEncode(indices, minCode = 8) {
  const clear = 1 << minCode, eoi = clear + 1;
  const out = [];
  let cur = 0, bits = 0, codeSize = minCode + 1, next = eoi + 1;
  let dict = new Map();
  const emit = (code) => { cur |= code << bits; bits += codeSize; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  emit(clear);
  let w = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (w << 8) | k;
    const v = dict.get(key);
    if (v !== undefined) { w = v; continue; }
    emit(w);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << codeSize) && codeSize < 12) codeSize++; }
    else { emit(clear); dict = new Map(); codeSize = minCode + 1; next = eoi + 1; }
    w = k;
  }
  emit(w); emit(eoi);
  if (bits > 0) out.push(cur & 255);
  // 255 バイトずつの塊に
  const blocks = [];
  for (let i = 0; i < out.length; i += 255) { const n = Math.min(255, out.length - i); blocks.push(n, ...out.slice(i, i + n)); }
  blocks.push(0);
  return new Uint8Array(blocks);
}
function gifFrame(canvas) {
  const W = canvas.width, H = canvas.height, d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const q = quantize(d);
  const idx = new Uint8Array(W * H);
  // 表に無い色（5bit の箱の外）は近い色を探して覚える
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const c = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    let m = q.map[c];
    if (m < 0) {
      let best = 1e9;
      for (let j = 0; j < q.count; j++) { const dr = q.palette[j * 3] - d[i], dg = q.palette[j * 3 + 1] - d[i + 1], db = q.palette[j * 3 + 2] - d[i + 2], e = dr * dr + dg * dg + db * db; if (e < best) { best = e; m = j; } }
      q.map[c] = m;
    }
    idx[p] = m;
  }
  return { W, H, palette: q.palette, data: lzwEncode(idx) };
}
function encodeGIF(frames, delayCs, loop = true) {
  const W = frames[0].W, H = frames[0].H, parts = [];
  const u16 = (v) => [v & 255, (v >> 8) & 255];
  parts.push(new Uint8Array([71, 73, 70, 56, 57, 97, ...u16(W), ...u16(H), 0x70, 0, 0]));       // GIF89a、全体の色表なし
  if (loop) parts.push(new Uint8Array([0x21, 0xff, 11, ...'NETSCAPE2.0'.split('').map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0]));
  for (const f of frames) {
    parts.push(new Uint8Array([0x21, 0xf9, 4, 0x04, ...u16(delayCs), 0, 0]));                    // 表示時間・重ねない
    parts.push(new Uint8Array([0x2c, 0, 0, 0, 0, ...u16(f.W), ...u16(f.H), 0x87]));             // 256 色の色表
    parts.push(f.palette, new Uint8Array([8]), f.data);
  }
  parts.push(new Uint8Array([0x3b]));
  return new Blob(parts, { type: 'image/gif' });
}

/* ================= MP4（H.264） ================= */
function mp4Box(type, ...parts) {
  const len = 8 + parts.reduce((s, p) => s + p.length, 0), b = new Uint8Array(len), dv = new DataView(b.buffer);
  dv.setUint32(0, len);
  for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
  let o = 8;
  for (const p of parts) { b.set(p, o); o += p.length; }
  return b;
}
const u8 = (...a) => new Uint8Array(a);
function be32(...vs) { const b = new Uint8Array(vs.length * 4), dv = new DataView(b.buffer); vs.forEach((v, i) => dv.setUint32(i * 4, v >>> 0)); return b; }
function be16(...vs) { const b = new Uint8Array(vs.length * 2), dv = new DataView(b.buffer); vs.forEach((v, i) => dv.setUint16(i * 2, v & 0xffff)); return b; }
const MATRIX = be32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
function muxMP4(samples, avcC, W, H, fps) {
  const ts = fps * 1000, delta = 1000, n = samples.length, durMedia = n * delta, durMovie = Math.round((n / fps) * 1000);
  const full = (type, ver, flags, ...parts) => mp4Box(type, u8(ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...parts);
  const ftyp = mp4Box('ftyp', new TextEncoder().encode('isom'), be32(512), new TextEncoder().encode('isomiso2avc1mp41'));
  const build = (offset) => {
    const stsd = full('stsd', 0, 0, be32(1), mp4Box('avc1', u8(0, 0, 0, 0, 0, 0), be16(1), new Uint8Array(16), be16(W, H), be32(0x480000, 0x480000, 0), be16(1), new Uint8Array(32), be16(0x18, 0xffff), mp4Box('avcC', avcC)));
    const keys = samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
    const stbl = mp4Box('stbl', stsd,
      full('stts', 0, 0, be32(1, n, delta)),
      full('stss', 0, 0, be32(keys.length, ...keys)),
      full('stsc', 0, 0, be32(1, 1, n, 1)),
      full('stsz', 0, 0, be32(0, n, ...samples.map((s) => s.data.length))),
      full('stco', 0, 0, be32(1, offset)));
    const minf = mp4Box('minf', full('vmhd', 0, 1, be16(0, 0, 0, 0)), mp4Box('dinf', full('dref', 0, 0, be32(1), full('url ', 0, 1))), stbl);
    const mdia = mp4Box('mdia', full('mdhd', 0, 0, be32(0, 0, ts, durMedia), be16(0x55c4, 0)),
      full('hdlr', 0, 0, be32(0), new TextEncoder().encode('vide'), new Uint8Array(12), new TextEncoder().encode('VideoHandler\0')), minf);
    const tkhd = full('tkhd', 0, 3, be32(0, 0, 1, 0, durMovie, 0, 0), be16(0, 0, 0, 0), MATRIX, be32(W << 16, H << 16));
    const mvhd = full('mvhd', 0, 0, be32(0, 0, 1000, durMovie, 0x10000), be16(0x100, 0), new Uint8Array(8), MATRIX, new Uint8Array(24), be32(2));
    return mp4Box('moov', mvhd, mp4Box('trak', tkhd, mdia));
  };
  const moov0 = build(0);
  const moov = build(ftyp.length + moov0.length + 8);
  const mdatLen = 8 + samples.reduce((s, x) => s + x.data.length, 0);
  const head = new Uint8Array(8); new DataView(head.buffer).setUint32(0, mdatLen); head.set([109, 100, 97, 116], 4);
  return new Blob([ftyp, moov, head, ...samples.map((s) => s.data)], { type: 'video/mp4' });
}
async function encodeMP4(renderAt, count, W, H, fps, progress) {
  if (typeof VideoEncoder === 'undefined') throw new Error('この端末のブラウザは動画の書き出し（WebCodecs）に対応していません。GIF か連番 PNG にしてください');
  const bitrate = Math.round(Math.min(20e6, Math.max(2e6, W * H * fps * 0.12)));
  let cfg = null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42e01f']) {
    const c = { codec, width: W, height: H, bitrate, framerate: fps, avc: { format: 'avc' } };
    try { const r = await VideoEncoder.isConfigSupported(c); if (r.supported) { cfg = c; break; } } catch { /* 次へ */ }
  }
  if (!cfg) throw new Error('この大きさの H.264 動画は作れません（大きさを小さくしてください）');
  const samples = [];
  let avcC = null, err = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      const d = meta && meta.decoderConfig && meta.decoderConfig.description;
      if (d && !avcC) avcC = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
      const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b);
      samples.push({ data: b, key: chunk.type === 'key' });
    },
    error: (e) => { err = e; },
  });
  enc.configure(cfg);
  for (let f = 0; f < count; f++) {
    if (err) throw err;
    const c = renderAt(f);
    const vf = new VideoFrame(c, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(vf, { keyFrame: f % (fps * 2) === 0 });
    vf.close();
    while (enc.encodeQueueSize > 3) await new Promise((r) => setTimeout(r, 5));
    if (progress) progress(f + 1, count);
  }
  await enc.flush();
  enc.close();
  if (err) throw err;
  if (!avcC) throw new Error('動画の設定を受け取れませんでした');
  return muxMP4(samples, avcC, W, H, fps);
}

/* ================= 画面 ================= */
const VideoExport = {
  async dialog(app) {
    const doc = app.doc;
    if (!doc) return;
    const A = ensureAnim(doc);
    if (!animFolders(doc).length) { toast('アニメーションフォルダーがありません（タイムラインの「＋アニメフォルダー」から）'); return; }
    const seg = (opts, val) => { const b = el('div', { class: 'seg' }); b.value = val; for (const [v, t] of opts) b.append(el('button', { class: v === val ? 'on' : '', onclick: (e) => { b.value = v; for (const x of b.children) x.classList.remove('on'); e.target.classList.add('on'); } }, t)); return b; };
    const fmt = seg([['mp4', 'MP4（動画）'], ['gif', 'GIF'], ['png', '連番 PNG（zip）']], typeof VideoEncoder !== 'undefined' ? 'mp4' : 'gif');
    const scale = seg([['1', '100%'], ['0.5', '50%'], ['0.25', '25%']], A.outW * A.outH > 2.1e6 ? '0.5' : '1');
    const wIn = el('input', { type: 'number', class: 'inp', value: A.outW }), hIn = el('input', { type: 'number', class: 'inp', value: A.outH });
    const body = el('div', { class: 'settings' },
      el('div', { class: 'set-row col' }, el('span', {}, '形式'), fmt),
      el('div', { class: 'set-row col' }, el('span', {}, '出力の大きさ（カメラの枠・px）'), el('div', { class: 'row3' }, wIn, hIn, el('div'))),
      el('div', { class: 'set-row col' }, el('span', {}, '倍率'), scale),
      el('p', { class: 'hint' }, `${A.frames} フレーム・${A.fps}fps（${(A.frames / A.fps).toFixed(1)} 秒）。GIF は 256 色になります（幅 800px くらいまでがおすすめ）。MP4 は H.264 です。`));
    const ok = await modal({ title: 'アニメーションの書き出し', body, wide: true, buttons: [{ label: 'キャンセル', value: false }, { label: '書き出す', value: true, primary: true }] });
    if (!ok) return;
    const ow = clamp(Math.round(+wIn.value || A.outW), 16, 8192), oh = clamp(Math.round(+hIn.value || A.outH), 16, 8192);
    if (ow !== A.outW || oh !== A.outH) { A.outW = ow; A.outH = oh; doc.metaDirty = true; app.scheduleSave(); }
    let k = +scale.value;
    let W = Math.round(A.outW * k), H = Math.round(A.outH * k);
    if (fmt.value === 'mp4') { W -= W % 2; H -= H % 2; k = W / A.outW; }           // H.264 は偶数の大きさ
    const cache = new Map();
    const at = (f) => { const key = frameKey(doc, f); if (!cache.has(key)) { if (cache.size > 40) cache.clear(); cache.set(key, renderFrame(doc, f, k)); } const c = cache.get(key); if (c.width === W && c.height === H) return c; const d = newCanvas(W, H); d.getContext('2d').drawImage(c, 0, 0, W, H); return d; };
    const name = `${doc.name}_${A.fps}fps`;
    app.busy('書き出しています…');
    try {
      let blob, file;
      if (fmt.value === 'mp4') {
        blob = await encodeMP4(at, A.frames, W, H, A.fps, (i, n) => app.busy(`動画にしています… ${i} / ${n}`));
        file = name + '.mp4';
      } else if (fmt.value === 'gif') {
        const frames = [];
        let prevKey = null, prev = null;
        for (let f = 0; f < A.frames; f++) {
          const key = frameKey(doc, f);
          if (key !== prevKey) { prev = gifFrame(at(f)); prevKey = key; }
          frames.push(prev);
          if (f % 4 === 3) { app.busy(`GIF にしています… ${f + 1} / ${A.frames}`); await new Promise((r) => setTimeout(r, 0)); }
        }
        blob = encodeGIF(frames, Math.max(2, Math.round(100 / A.fps)));
        file = name + '.gif';
      } else {
        const files = [];
        for (let f = 0; f < A.frames; f++) {
          files.push({ name: `${doc.name}_${String(f + 1).padStart(4, '0')}.png`, data: new Uint8Array(await (await canvasToBlob(at(f))).arrayBuffer()) });
          if (f % 4 === 3) app.busy(`連番にしています… ${f + 1} / ${A.frames}`);
        }
        blob = zipStore(files); file = name + '_連番.zip';
      }
      app.busy(null);
      await shareOrDownload(blob, file);
    } catch (e) { app.busy(null); console.error(e); toast('書き出せません: ' + e.message, { error: true }); }
  },
};
