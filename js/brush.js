'use strict';
/* ブラシエンジン。
   入力点 → 手ブレ補正（移動平均）→ 2次曲線でなめらかに → 間隔ごとに「点（dab）」を置く → stroke タイルに描く。
   硬い丸は arc（どの太さでもくっきり）、柔らかい先端は円形グラデーションの画像、平筆は楕円。 */

/* サブツールの初期値。tool = どの道具に属するか */
const BRUSH_DEFAULTS = {
  size: 10, opacity: 1, density: 1, hardness: 1, tip: 'round', flatRatio: 0.35, flatAngle: 45, spacing: 0.08,
  pSize: true, pMin: 0.1, pDensity: false, pDensityMin: 0.2, tiltSize: 0, tiltDensity: 0, azimuth: false,
  stab: 6, taperIn: 0, taperOut: 0, grain: null, grainStrength: 0.8, erase: false, vectorMode: 'touch',
};
const SUBTOOLS = [
  { id: 'gpen', tool: 'pen', name: 'Gペン', s: { size: 8, pMin: 0.05, stab: 8 } },
  { id: 'maru', tool: 'pen', name: '丸ペン', s: { size: 3, pMin: 0.2, stab: 6 } },
  { id: 'kabura', tool: 'pen', name: 'カブラペン', s: { size: 6, pMin: 0.45, stab: 10 } },
  { id: 'mili', tool: 'pen', name: 'ミリペン', s: { size: 4, pSize: false, stab: 10 } },
  { id: 'marker', tool: 'pen', name: 'マーカー', s: { size: 24, tip: 'flat', flatRatio: 0.3, opacity: 0.6, pSize: false, azimuth: true, stab: 4, spacing: 0.05 } },
  { id: 'nuri', tool: 'pen', name: '塗りペン', s: { size: 40, pSize: false, stab: 2 } },
  { id: 'pencil', tool: 'pencil', name: '鉛筆', s: { size: 8, hardness: 0.6, density: 0.75, pDensity: true, pDensityMin: 0.15, pMin: 0.5, tiltSize: 1.2, tiltDensity: 0.5, grain: 'paper', grainStrength: 0.85, stab: 3, spacing: 0.1 } },
  { id: 'sharp', tool: 'pencil', name: 'シャープペンシル', s: { size: 3, hardness: 0.8, density: 0.85, pDensity: true, pDensityMin: 0.25, pMin: 0.6, grain: 'paper', grainStrength: 0.6, stab: 4, spacing: 0.1 } },
  { id: 'colorpencil', tool: 'pencil', name: '色鉛筆', s: { size: 14, hardness: 0.5, density: 0.6, pDensity: true, pDensityMin: 0.1, pMin: 0.6, tiltSize: 1.5, tiltDensity: 0.6, grain: 'rough', grainStrength: 0.95, stab: 2, spacing: 0.12 } },
  { id: 'watercolor', tool: 'brush', name: '透明水彩', s: { size: 60, hardness: 0.35, density: 0.12, pDensity: true, pDensityMin: 0.3, pMin: 0.4, grain: 'canvas', grainStrength: 0.35, stab: 2, spacing: 0.06 } },
  { id: 'opaque', tool: 'brush', name: '不透明水彩', s: { size: 40, hardness: 0.75, density: 0.45, pDensity: true, pDensityMin: 0.4, pMin: 0.35, grain: 'canvas', grainStrength: 0.3, stab: 2, spacing: 0.06 } },
  { id: 'gouache', tool: 'brush', name: '平筆', s: { size: 50, tip: 'flat', flatRatio: 0.28, hardness: 0.85, density: 0.7, pMin: 0.3, azimuth: true, stab: 2, spacing: 0.04 } },
  { id: 'airsoft', tool: 'airbrush', name: '柔らか', s: { size: 160, hardness: 0, density: 0.06, pSize: false, pDensity: true, pDensityMin: 0, stab: 0, spacing: 0.1 } },
  { id: 'airhard', tool: 'airbrush', name: '強め', s: { size: 80, hardness: 0.35, density: 0.15, pSize: false, pDensity: true, pDensityMin: 0, stab: 0, spacing: 0.1 } },
  { id: 'erhard', tool: 'eraser', name: '硬め', s: { size: 30, erase: true, pMin: 0.3, stab: 2 } },
  { id: 'ersoft', tool: 'eraser', name: '軟らかめ', s: { size: 80, hardness: 0.2, density: 0.5, erase: true, pSize: false, pDensity: true, pDensityMin: 0.1, stab: 0, spacing: 0.1 } },
  { id: 'erbig', tool: 'eraser', name: 'ざっくり', s: { size: 200, erase: true, pSize: false, stab: 0 } },
  { id: 'ervec', tool: 'eraser', name: 'ベクター用（交点まで）', s: { size: 16, erase: true, pSize: false, stab: 0, vectorMode: 'intersect' } },
];
const subtoolById = (id) => SUBTOOLS.find((s) => s.id === id);
function brushSettings(id, saved = {}) { return { ...BRUSH_DEFAULTS, ...subtoolById(id).s, ...(saved[id] || {}) }; }

/* 柔らかい先端（白で作り、色は描く時に乗せる） */
const TipCache = {
  map: new Map(),
  get(hardness, color) {
    const k = Math.round(hardness * 20) + color;
    let c = this.map.get(k);
    if (c) return c;
    if (this.map.size > 40) this.map.clear();
    const N = 128;
    c = newCanvas(N, N);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    const { r, g: gg, b } = hexToRgb(color);
    const h = clamp(hardness, 0, 0.98);
    const stops = 8;
    for (let i = 0; i <= stops; i++) {
      const t = i / stops;
      // 中心から h までは不透明、外側はなめらかに 0 へ
      const a = t <= h ? 1 : Math.pow(Math.cos(((t - h) / (1 - h)) * Math.PI / 2), 2);
      grad.addColorStop(t, `rgba(${r},${gg},${b},${a})`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, N, N);
    this.map.set(k, c);
    return c;
  },
};

/* ペンの傾き: 0 = 寝ている、1 = 立っている */
function penAltitude(p) {
  if (p.altitude != null) return clamp(p.altitude / (Math.PI / 2), 0, 1);
  if (p.tiltX || p.tiltY) {
    const tx = Math.tan((p.tiltX * Math.PI) / 180), ty = Math.tan((p.tiltY * Math.PI) / 180);
    return clamp(Math.atan(1 / Math.hypot(tx, ty)) / (Math.PI / 2), 0, 1);
  }
  return 1;
}
function penAzimuth(p) {
  if (p.azimuth != null) return p.azimuth;
  if (p.tiltX || p.tiltY) return Math.atan2(p.tiltY, p.tiltX);
  return null;
}

class BrushStroke {
  /* b = ブラシ設定、color = '#rrggbb'、curve = 筆圧の γ */
  /* sink を渡すと描画先をそこにする（ベクターの描き直し: sink.tile(tx, ty) が canvas か null を返す） */
  constructor(doc, layer, b, color, { gamma = 1, transparent = false, sink = null, target = 'tiles' } = {}) {
    this.doc = doc; this.layer = layer; this.b = b; this.color = color;
    this.gamma = gamma;
    this.erase = b.erase || transparent;
    this.raw = [];            // 手ブレ補正用の直近の入力
    this.pts = [];            // 補正後の点
    this.dabs = [];           // 置いた点（抜きの描き直し用）
    this.dist = 0;            // 置いた所までの長さ
    this.nextAt = 0;          // 次の点を置く長さ
    this.last = null;
    const grain = b.grain ? Grain.get(b.grain, b.grainStrength) : null;
    this.sink = sink;
    this.grain = grain;
    if (!sink) doc.beginStroke(layer, { erase: this.erase, opacity: b.opacity, grain, target });
    this.tip = b.hardness < 0.99 ? TipCache.get(b.hardness, this.erase ? '#000000' : color) : null;
    this.bounds = null;
  }

  pressureOf(p) { return Math.pow(clamp(p.pressure, 0, 1), this.gamma); }

  /* 入力1点 */
  add(p) {
    const q = { x: p.x, y: p.y, pr: this.pressureOf(p), alt: penAltitude(p), az: penAzimuth(p), tw: p.twist || 0 };
    this.raw.push(q);
    const n = Math.max(1, Math.round(this.b.stab * 0.6) + 1);
    if (this.raw.length > n) this.raw.shift();
    this.pushPoint(this.average());
  }
  average() {
    const r = this.raw, n = r.length;
    let x = 0, y = 0, w = 0;
    for (let i = 0; i < n; i++) { const k = i + 1; x += r[i].x * k; y += r[i].y * k; w += k; }   // 新しい点ほど重く
    const last = r[n - 1];
    return { x: x / w, y: y / w, pr: last.pr, alt: last.alt, az: last.az, tw: last.tw };
  }
  pushPoint(q) {
    const P = this.pts;
    if (P.length && Math.hypot(q.x - P[P.length - 1].x, q.y - P[P.length - 1].y) < 0.3) { P[P.length - 1].pr = q.pr; return; }
    P.push(q);
    const n = P.length;
    if (n === 1) { this.placeFrom(q, q, q, true); return; }
    if (n === 2) return;
    // 2次ベジエ: 中点(n-3,n-2) → 中点(n-2,n-1)、制御点 n-2
    const a = P[n - 3], b = P[n - 2], c = P[n - 1];
    const m0 = n === 3 ? a : mid(a, b), m1 = mid(b, c);
    this.placeFrom(m0, b, m1);
  }
  /* 曲線に沿って点を置く */
  placeFrom(p0, c, p1, first = false) {
    if (first) { this.dab(p0); this.last = p0; this.nextAt = this.spacingAt(p0); return; }
    const len = Math.hypot(c.x - p0.x, c.y - p0.y) + Math.hypot(p1.x - c.x, p1.y - c.y);
    const steps = Math.max(2, Math.ceil(len / 0.5));
    let prev = p0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      const pt = {
        x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
        y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
        pr: lerp(p0.pr, p1.pr, t), alt: lerp(p0.alt, p1.alt, t), az: p1.az, tw: p1.tw,
      };
      const d = Math.hypot(pt.x - prev.x, pt.y - prev.y);
      this.dist += d;
      while (this.dist >= this.nextAt) {
        // 前の点との間で、ちょうどの位置に置く
        const over = this.dist - this.nextAt, f = d > 0 ? 1 - over / d : 1;
        const at = { x: lerp(prev.x, pt.x, f), y: lerp(prev.y, pt.y, f), pr: lerp(prev.pr, pt.pr, f), alt: pt.alt, az: pt.az, tw: pt.tw };
        this.dab(at, this.nextAt);
        this.nextAt += this.spacingAt(at);
      }
      prev = pt;
    }
    this.last = p1;
  }
  spacingAt(q) { return Math.max(0.35, this.sizeOf(q, this.dist) * this.b.spacing); }
  sizeOf(q, along) {
    const b = this.b;
    let s = b.size;
    if (b.pSize) s *= b.pMin + (1 - b.pMin) * q.pr;
    if (b.tiltSize) s *= 1 + (1 - q.alt) * b.tiltSize;
    if (b.taperIn > 0) s *= taperCurve(along / (b.taperIn * b.size));
    return s;
  }
  alphaOf(q) {
    const b = this.b;
    let a = b.density;
    if (b.pDensity) a *= b.pDensityMin + (1 - b.pDensityMin) * q.pr;
    if (b.tiltDensity) a *= 1 - (1 - q.alt) * b.tiltDensity * 0.8;
    return clamp(a, 0, 1);
  }
  dab(q, along = 0) {
    const b = this.b;
    const d = { x: q.x, y: q.y, s: this.sizeOf(q, along), a: this.alphaOf(q), ang: 0, along };
    if (b.tip === 'flat') {
      let ang = (b.flatAngle * Math.PI) / 180;
      if (b.azimuth && q.az != null) ang = q.az + Math.PI / 2;
      if (q.tw) ang += (q.tw * Math.PI) / 180;      // Apple Pencil Pro のバレルロール（届けば）
      d.ang = ang;
    }
    this.dabs.push(d);
    this.drawDab(d);
  }
  drawDab(d) {
    const doc = this.doc, b = this.b;
    let r = d.s / 2, a = d.a;
    if (r < 0.5) { a *= (r * 2) * (r * 2); r = 0.5; }    // 細すぎる線は薄く（途切れないように）
    if (a <= 0.002) return;
    const R = r + 2;
    const x0 = d.x - R, y0 = d.y - R;
    const tx0 = Math.floor(x0 / TILE), ty0 = Math.floor(y0 / TILE), tx1 = Math.floor((d.x + R) / TILE), ty1 = Math.floor((d.y + R) / TILE);
    const color = this.erase ? '#000000' : this.color;
    for (let ty = Math.max(0, ty0); ty <= Math.min(doc.rows - 1, ty1); ty++) {
      for (let tx = Math.max(0, tx0); tx <= Math.min(doc.cols - 1, tx1); tx++) {
        const tile = this.sink ? this.sink.tile(tx, ty) : doc.strokeTile(tx, ty);
        if (!tile) continue;
        const g = ctx2d(tile);
        g.setTransform(1, 0, 0, 1, -tx * TILE, -ty * TILE);
        g.globalAlpha = a;
        if (this.tip) {
          if (b.tip === 'flat') {
            g.translate(d.x, d.y); g.rotate(d.ang); g.scale(1, b.flatRatio);
            g.drawImage(this.tip, -r, -r, r * 2, r * 2);
          } else g.drawImage(this.tip, d.x - r, d.y - r, r * 2, r * 2);
        } else {
          g.fillStyle = color;
          g.beginPath();
          if (b.tip === 'flat') g.ellipse(d.x, d.y, r, Math.max(0.5, r * b.flatRatio), d.ang, 0, Math.PI * 2);
          else g.arc(d.x, d.y, r, 0, Math.PI * 2);
          g.fill();
        }
        if (!this.sink) doc.comp.invalidate(tx, ty);
      }
    }
  }

  /* 離した: 補正の遅れを取り戻し、抜きがあれば描き直してから確定 */
  end() {
    this.finish();
    if (this.layer.kind === 'vector' && !this.erase && this.doc.stroke && this.doc.stroke.target === 'tiles') { vectorCommit(this); return; }
    this.doc.commitStroke(this.doc.stroke && this.doc.stroke.target === 'mask' ? 'マスク' : this.erase ? '消しゴム' : 'ブラシ');
  }
  finish() {
    if (this.raw.length) {
      const last = this.raw[this.raw.length - 1];
      for (let i = 0; i < this.raw.length; i++) { this.raw.push(last); this.raw.shift(); this.pushPoint(this.average()); }
    }
    const P = this.pts;
    if (P.length >= 2) { const a = P[P.length - 2], c = P[P.length - 1]; this.placeFrom(mid(a, c), c, c); }
    if (this.b.taperOut > 0 && this.dabs.length > 2) {
      const total = this.dist, len = this.b.taperOut * this.b.size;
      if (this.sink) this.sink.clear(); else this.doc.clearStroke();
      for (const d of this.dabs) {
        const f = taperCurve((total - d.along) / len);
        if (f < 1) d.s *= f;
        this.drawDab(d);
      }
    }
  }
  /* 補正済みの点の列から描き直す（ベクター） */
  replay(pts) { for (const q of pts) this.pushPoint(q); this.finish(); }
  cancel() { this.doc.cancelStroke(); }
}
function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, pr: (a.pr + b.pr) / 2, alt: (a.alt + b.alt) / 2, az: b.az, tw: b.tw }; }
function taperCurve(t) { t = clamp(t, 0, 1); return Math.max(0.03, Math.sin((t * Math.PI) / 2)); }
