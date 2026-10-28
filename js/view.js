'use strict';
/* 画面の表示とジェスチャー。
   表示: 文書 → 画面 = 移動(ox,oy)・回転(rot)・拡大(s)・左右反転(flip)。合成キャッシュの拡大率に合うレベルのタイルを並べる。
   2本指: つまんで拡大縮小・回転・移動、素早いタップで取り消し。3本指タップでやり直し。指の長押しでスポイト。
   ペンを一度使うと「指では描かない」（1本指 = 移動）に切り替わる（app.settings.fingerDraws = 'auto' のとき）。 */

class View {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.s = 1; this.rot = 0; this.flip = false; this.ox = 0; this.oy = 0;
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = 1; this.cssH = 1;
    this.pointers = new Map();
    this.mode = null;                  // 'tool' | 'pan' | 'pinch' | 'pick'
    this.toolPointer = null;
    this.hover = null;
    this._raf = 0;
    this.spaceDown = false;
    this.gesture = null;
    this.fitted = true;
    this.ants = 0;

    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && !this.pointers.size) { this.hover = null; this.request(); } });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || e.target === canvas) e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });   // iPad の拡大鏡・選択を出さない
  }
  get doc() { return this.app.doc; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const pw = this.cssW, ph = this.cssH;
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = Math.max(1, r.width); this.cssH = Math.max(1, r.height);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    if (this.doc) {
      if (this.fitted || pw < 10) this.fit();
      else { this.ox += (this.cssW - pw) / 2; this.oy += (this.cssH - ph) / 2; }
    }
    this.request();
  }

  // ---- 変換
  get m() {
    const c = Math.cos(this.rot), s = Math.sin(this.rot), f = this.flip ? -1 : 1, k = this.s;
    return { a: k * f * c, b: k * f * s, c: -k * s, d: k * c, e: this.ox, f: this.oy };
  }
  toScreen(x, y) { const m = this.m; return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }; }
  toDocLocal(sx, sy) {
    const m = this.m, det = m.a * m.d - m.b * m.c, X = sx - m.e, Y = sy - m.f;
    return { x: (m.d * X - m.c * Y) / det, y: (-m.b * X + m.a * Y) / det };
  }
  toDoc(clientX, clientY) { const r = this.canvas.getBoundingClientRect(); return this.toDocLocal(clientX - r.left, clientY - r.top); }
  local(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  /* 文書の点 P が画面の点 S に来るように位置を合わせる */
  pin(P, S) { const m = this.m; this.ox = S.x - (m.a * P.x + m.c * P.y); this.oy = S.y - (m.b * P.x + m.d * P.y); }

  fit() {
    const d = this.doc;
    if (!d) return;
    const pad = 28, c = Math.abs(Math.cos(this.rot)), s = Math.abs(Math.sin(this.rot));
    const bw = d.width * c + d.height * s, bh = d.width * s + d.height * c;
    this.s = clamp(Math.min((this.cssW - pad * 2) / bw, (this.cssH - pad * 2) / bh), 0.01, 8);
    this.pin({ x: d.width / 2, y: d.height / 2 }, { x: this.cssW / 2, y: this.cssH / 2 });
    this.fitted = true;
    this.request();
  }
  zoomAt(factor, cx, cy) {
    const P = this.toDocLocal(cx, cy);
    this.s = clamp(this.s * factor, 0.01, 64);
    this.pin(P, { x: cx, y: cy });
    this.fitted = false;
    this.showBadge(Math.round(this.s * 100) + '%');
    this.request();
  }
  setZoom(s) { this.zoomAt(s / this.s, this.cssW / 2, this.cssH / 2); }
  zoomStep(dir) {
    const steps = [0.05, 0.1, 0.167, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
    const s = this.s;
    const next = dir > 0 ? steps.find((v) => v > s * 1.01) || s * 1.5 : [...steps].reverse().find((v) => v < s * 0.99) || s / 1.5;
    this.setZoom(next);
  }
  rotateBy(rad) { this.setRotation(this.rot + rad); }
  setRotation(rad) {
    const C = { x: this.cssW / 2, y: this.cssH / 2 }, P = this.toDocLocal(C.x, C.y);
    this.rot = Math.atan2(Math.sin(rad), Math.cos(rad));
    this.pin(P, C);
    this.fitted = false;
    this.showBadge(Math.round((this.rot * 180) / Math.PI) + '°');
    this.request();
  }
  toggleFlip() {
    const C = { x: this.cssW / 2, y: this.cssH / 2 }, P = this.toDocLocal(C.x, C.y);
    this.flip = !this.flip;
    this.pin(P, C);
    this.showBadge(this.flip ? '左右反転' : '反転なし');
    this.request();
    this.app.onViewFlags();
  }
  showBadge(text) {
    const b = $('#zoomBadge');
    if (!b) return;
    b.textContent = text; b.hidden = false;
    clearTimeout(this._zt);
    this._zt = setTimeout(() => { b.hidden = true; }, 900);
  }

  // ---- 描画
  request() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
  }
  render() {
    const g = this.g, d = this.doc, dpr = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#2b2c30';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!d) return;
    const t0 = performance.now();
    const m = this.m;
    const devScale = this.s * dpr;
    const L = devScale >= 1 ? 0 : clamp(Math.floor(Math.log2(1 / devScale)), 0, d.comp.maxLevel);
    const S = TILE << L;
    // 画面に見えている文書の範囲
    const cs = [this.toDocLocal(0, 0), this.toDocLocal(this.cssW, 0), this.toDocLocal(0, this.cssH), this.toDocLocal(this.cssW, this.cssH)];
    const minX = Math.max(0, Math.min(...cs.map((p) => p.x))), maxX = Math.min(d.width, Math.max(...cs.map((p) => p.x)));
    const minY = Math.max(0, Math.min(...cs.map((p) => p.y))), maxY = Math.min(d.height, Math.max(...cs.map((p) => p.y)));
    const corners = [this.toScreen(0, 0), this.toScreen(d.width, 0), this.toScreen(d.width, d.height), this.toScreen(0, d.height)];
    // 文書の影・透明部分の市松
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.beginPath(); corners.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
    g.fillStyle = '#fff'; g.fill();
    const paper = d.paper;
    if (!paper || !paper.visible) { g.fillStyle = checkerPattern(g); g.fill(); }
    if (maxX > minX && maxY > minY) {
      const tx0 = Math.floor(minX / S), ty0 = Math.floor(minY / S), tx1 = Math.floor((maxX - 1e-6) / S), ty1 = Math.floor((maxY - 1e-6) / S);
      const axis = Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9;
      g.imageSmoothingEnabled = devScale * (1 << L) < 2.5;
      g.imageSmoothingQuality = 'medium';
      if (axis) {
        // 回転なし: 角を画面の画素に合わせて並べる（継ぎ目が出ない）
        const fx = m.a < 0;
        for (let ty = ty0; ty <= ty1; ty++) {
          const y0 = Math.round((m.d * ty * S + m.f) * dpr), y1 = Math.round((m.d * (ty + 1) * S + m.f) * dpr);
          for (let tx = tx0; tx <= tx1; tx++) {
            let x0 = Math.round((m.a * tx * S + m.e) * dpr), x1 = Math.round((m.a * (tx + 1) * S + m.e) * dpr);
            const e = d.comp.get(L, tx, ty);
            if (fx) { g.setTransform(-1, 0, 0, 1, x0 + x1, 0); [x0, x1] = [x1, x0]; } else g.setTransform(1, 0, 0, 1, 0, 0);
            g.drawImage(e.c, x0, y0, x1 - x0, y1 - y0);
          }
        }
      } else {
        g.setTransform(m.a * dpr, m.b * dpr, m.c * dpr, m.d * dpr, m.e * dpr, m.f * dpr);
        const ov = 0.6 / devScale;           // 回転中は少し重ねて継ぎ目を隠す
        for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
          const e = d.comp.get(L, tx, ty);
          g.drawImage(e.c, tx * S - ov, ty * S - ov, S + ov * 2, S + ov * 2);
        }
      }
    }
    d.comp.endFrame();
    // 枠
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.beginPath(); corners.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
    g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
    // 選択範囲の点線（文書座標の線分を画面へ）
    if (d.sel && !this.app.transforming) {
      const segs = d.sel.outline();
      g.beginPath();
      for (let i = 0; i < segs.length; i += 4) {
        const a = this.toScreen(segs[i], segs[i + 1]), b = this.toScreen(segs[i + 2], segs[i + 3]);
        g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
      }
      g.lineWidth = 1; g.setLineDash([4, 4]);
      g.strokeStyle = '#000'; g.lineDashOffset = -this.ants; g.stroke();
      g.strokeStyle = '#fff'; g.lineDashOffset = -this.ants + 4; g.stroke();
      g.setLineDash([]); g.lineDashOffset = 0;
    }
    // 仕上がり線・基本枠・ノンブル
    if (d.book && this.app.settings.guides) drawBookGuides(g, this, d);
    if (d.goods && this.app.settings.guides) drawGoodsGuides(g, this, d);
    // 定規
    if (d.ruler) drawRuler(g, this, d.ruler, this.app.settings.snap);
    // ツールの補助表示（画面座標）
    const tool = this.app.tool;
    if (tool && tool.drawOverlay) tool.drawOverlay(g, this);
    if (this.hover && tool && tool.showsHover && this.mode !== 'tool') this.drawBrushCursor(g, this.hover);
    if (this.pickAt) {
      const s = this.toScreen(this.pickAt.x, this.pickAt.y);
      g.lineWidth = 12; g.strokeStyle = this.app.color.main;
      g.beginPath(); g.arc(s.x, s.y - 70, 34, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = '#fff';
      g.beginPath(); g.arc(s.x, s.y - 70, 40.5, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(s.x, s.y - 70, 27.5, 0, Math.PI * 2); g.stroke();
    }
    this.lastRenderMs = performance.now() - t0;
  }
  drawBrushCursor(g, p) {
    const b = this.app.brush;
    if (!b) return;
    const r = Math.max(1.5, (b.size / 2) * this.s);
    const s = this.toScreen(p.x, p.y);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,0,0,.7)';
    g.beginPath();
    if (b.tip === 'flat') g.ellipse(s.x, s.y, r, Math.max(1, r * b.flatRatio), (b.flatAngle * Math.PI) / 180 + this.rot, 0, Math.PI * 2);
    else g.arc(s.x, s.y, r, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.8)';
    g.beginPath(); g.arc(s.x, s.y, r + 1, 0, Math.PI * 2); g.stroke();
  }

  // ---- 入力
  pointInfo(e) {
    const p = this.toDoc(e.clientX, e.clientY);
    p.type = e.pointerType;
    p.pressure = e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 1;
    p.tiltX = e.tiltX || 0; p.tiltY = e.tiltY || 0;
    p.altitude = e.altitudeAngle != null && e.pointerType === 'pen' ? e.altitudeAngle : null;
    let az = e.azimuthAngle != null && e.pointerType === 'pen' ? e.azimuthAngle : null;
    if (az != null) az = this.flip ? Math.PI - (az - this.rot) : az - this.rot;     // 画面の向き → 文書の向き
    p.azimuth = az;
    p.twist = e.twist || 0;
    p.shift = e.shiftKey; p.alt = e.altKey; p.ctrl = e.ctrlKey || e.metaKey;
    p.t = e.timeStamp;
    return p;
  }
  touchCount() { let n = 0; for (const p of this.pointers.values()) if (p.type === 'touch') n++; return n; }

  onDown(e) {
    if (!this.doc) return;
    this.app.closePopups();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* */ }
    const lp = this.local(e);
    this.pointers.set(e.pointerId, { x: lp.x, y: lp.y, type: e.pointerType });
    const st = this.app.settings;
    if (e.pointerType === 'pen' && st.fingerDraws === 'auto') {
      st.fingerDraws = false;
      this.app.saveSettings();
      toast('Apple Pencil を検出しました。指では描かない設定にしました（1本指＝画面の移動）', { ms: 4200 });
    }
    if (e.pointerType === 'touch') {
      if (this.mode === 'tool' && this.toolPointer && this.toolPointer.type === 'pen') return;   // ペンで描いている最中の手のひら
      const n = this.touchCount();
      if (n >= 2) {
        if (this.mode === 'tool' && this.toolPointer && this.toolPointer.type === 'touch') this.cancelTool();
        this.startPinch();
        return;
      }
      const fingerDraws = st.fingerDraws === true || st.fingerDraws === 'auto';
      if (!fingerDraws || this.app.toolName === 'hand') { this.startPan(e); return; }
      this.startTool(e);
      return;
    }
    if (this.mode === 'pinch' || this.mode === 'pan') { if (e.pointerType === 'pen') this.endGesture(true); else return; }
    if (e.button === 1 || e.button === 2 || this.spaceDown || this.app.toolName === 'hand') { this.startPan(e); return; }
    if (this.app.toolName === 'zoom') { this.zoomAt(e.altKey ? 0.5 : 2, lp.x, lp.y); return; }
    this.startTool(e);
  }
  startTool(e) {
    const tool = this.app.tool;
    if (!tool) return;
    const why = this.app.cannotEdit(tool);
    if (why) { toast(why, { error: true }); return; }
    this.mode = 'tool';
    this.toolPointer = { id: e.pointerId, type: e.pointerType };
    this.hover = null;
    tool.down(this.pointInfo(e), e);
    this.request();
  }
  cancelTool() {
    if (this.app.tool && this.app.tool.cancel) this.app.tool.cancel();
    this.mode = null; this.toolPointer = null;
    this.request();
  }
  startPan(e) {
    const lp = this.local(e);
    this.mode = 'pan';
    this.gesture = { sx: lp.x, sy: lp.y, ox: this.ox, oy: this.oy, id: e.pointerId, moved: false };
    clearTimeout(this._holdT);
    if (e.pointerType === 'touch' && this.app.toolName !== 'hand') {
      const cx = e.clientX, cy = e.clientY;
      this._holdT = setTimeout(() => {
        if (this.mode !== 'pan' || !this.gesture || this.gesture.moved) return;
        this.mode = 'pick';
        this.pickAt = this.toDoc(cx, cy);
        this.app.pickColorAt(this.pickAt);
        this.request();
      }, 450);
    }
  }
  startPinch() {
    clearTimeout(this._holdT);
    if (this.mode === 'pick') this.pickAt = null;
    const pts = [...this.pointers.values()].filter((p) => p.type === 'touch');
    const [a, b] = pts;
    const prev = this.mode === 'pinch' && this.gesture ? this.gesture : null;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.mode = 'pinch';
    this.gesture = {
      mid, P: this.toDocLocal(mid.x, mid.y), dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, ang: Math.atan2(b.y - a.y, b.x - a.x),
      s: this.s, rot: this.rot, ids: [...this.pointers.entries()].filter(([, p]) => p.type === 'touch').slice(0, 2).map(([id]) => id),
      t0: prev ? prev.t0 : performance.now(), maxTouches: Math.max(pts.length, prev ? prev.maxTouches : 0), moved: prev ? prev.moved : 0,
    };
  }
  onMove(e) {
    const lp = this.local(e);
    const ptr = this.pointers.get(e.pointerId);
    if (ptr) { ptr.x = lp.x; ptr.y = lp.y; }
    if (this.mode === 'pinch') {
      if (e.pointerType !== 'touch') return;
      const G = this.gesture;
      const a = this.pointers.get(G.ids[0]), b = this.pointers.get(G.ids[1]);
      if (!a || !b) return;
      G.maxTouches = Math.max(G.maxTouches, this.touchCount());
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1, ang = Math.atan2(b.y - a.y, b.x - a.x);
      G.moved = Math.max(G.moved, Math.hypot(mid.x - G.mid.x, mid.y - G.mid.y), Math.abs(dist - G.dist));
      if (G.moved < 8) return;                  // タップかもしれない間は動かさない
      this.fitted = false;
      this.s = clamp(G.s * (dist / G.dist), 0.01, 64);
      if (this.app.settings.rotateGesture) {
        let r = G.rot + (ang - G.ang);
        const snap = Math.round(r / (Math.PI / 2)) * (Math.PI / 2);
        if (Math.abs(r - snap) < (4 * Math.PI) / 180) r = snap;   // 0°・90° 付近で吸い付く
        this.rot = Math.atan2(Math.sin(r), Math.cos(r));
      }
      this.pin(G.P, mid);
      this.showBadge(Math.round(this.s * 100) + '%' + (this.rot ? '  ' + Math.round((this.rot * 180) / Math.PI) + '°' : ''));
      this.request();
      return;
    }
    if (this.mode === 'pick') {
      this.pickAt = this.toDoc(e.clientX, e.clientY);
      this.app.pickColorAt(this.pickAt);
      this.request();
      return;
    }
    if (this.mode === 'pan') {
      const G = this.gesture;
      if (G && e.pointerId === G.id) {
        if (Math.hypot(lp.x - G.sx, lp.y - G.sy) > 8) { G.moved = true; clearTimeout(this._holdT); }
        if (!G.moved) return;
        this.fitted = false;
        this.ox = G.ox + lp.x - G.sx; this.oy = G.oy + lp.y - G.sy;
        this.request();
      }
      return;
    }
    if (this.mode === 'tool') {
      if (!this.toolPointer || e.pointerId !== this.toolPointer.id) return;
      const tool = this.app.tool;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (evs.length > 1) for (const ce of evs) tool.move(this.pointInfo(ce), ce);
      else tool.move(this.pointInfo(e), e);
      this.request();
      return;
    }
    if (e.pointerType !== 'touch') {               // 押していない時（Apple Pencil のホバー・マウス）
      this.hover = this.toDoc(e.clientX, e.clientY);
      if (this.app.tool && this.app.tool.showsHover) this.request();
    }
  }
  onUp(e, cancelled = false) {
    const had = this.pointers.has(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!had) return;
    if (this.mode === 'pinch') { if (this.touchCount() === 0) this.endGesture(); return; }
    if (this.mode === 'pick') {
      this.mode = null; this.gesture = null; this.pickAt = null;
      this.app.color.commitHistory();
      this.request();
      return;
    }
    if (this.mode === 'pan') {
      clearTimeout(this._holdT);
      if (this.gesture && e.pointerId === this.gesture.id) { this.mode = null; this.gesture = null; }
      return;
    }
    if (this.mode === 'tool' && this.toolPointer && e.pointerId === this.toolPointer.id) {
      const tool = this.app.tool;
      if (cancelled && tool.cancel) tool.cancel();
      else tool.up(this.pointInfo(e), e);
      this.mode = null; this.toolPointer = null;
      this.request();
    }
  }
  endGesture(silent = false) {
    const G = this.gesture;
    this.mode = null; this.gesture = null;
    if (silent || !G || G.moved >= 12 || !this.app.settings.tapUndo) return;
    if (performance.now() - G.t0 > 350) return;
    if (G.maxTouches === 2) this.app.undo();
    else if (G.maxTouches >= 3) this.app.redo();
  }
  onWheel(e) {
    if (!this.doc) return;
    e.preventDefault();
    const lp = this.local(e);
    if (e.ctrlKey || e.metaKey || e.altKey) this.zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), lp.x, lp.y);
    else if (e.shiftKey && !e.deltaX) { this.ox -= e.deltaY; this.fitted = false; this.request(); }
    else { this.ox -= e.deltaX; this.oy -= e.deltaY; this.fitted = false; this.request(); }
  }
}
