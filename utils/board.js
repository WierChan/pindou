// 画板渲染引擎（小程序版）：豆子绘制、缩放平移手势、拼豆/熨烫交互
const { PALETTE_RGB } = require('./palette');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const css = (rgb, a) => a == null || a >= 1
  ? 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')'
  : 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
const mix = (c1, c2, t) => [0, 1, 2].map(i => Math.round(c1[i] + (c2[i] - c1[i]) * t));
const BLACK = [30, 25, 20];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const now = () => Date.now();

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 单颗豆子（俯视：圆片 + 中孔 + 高光）
function drawBead(ctx, cx, cy, r, palIdx, alpha) {
  if (alpha == null) alpha = 1;
  const rgb = PALETTE_RGB[palIdx];
  if (alpha < 1) ctx.globalAlpha = alpha;
  if (r < 3) {
    // 太小画不出孔和高光，纯色圆反而更清晰（缩略图 / 大图纸缩到很小时）
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
    ctx.fillStyle = css(rgb); ctx.fill();
    if (alpha < 1) ctx.globalAlpha = 1;
    return;
  }
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
  ctx.fillStyle = css(rgb); ctx.fill();
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  g.addColorStop(0, 'rgba(255,255,255,.5)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,.22)');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.32, 0, 7);
  ctx.fillStyle = css(mix(rgb, BLACK, 0.45)); ctx.fill();
  if (alpha < 1) ctx.globalAlpha = 1;
}

// 熨烫后的融合豆（圆角方块互相搭接 + 高光）
function drawFused(ctx, x, y, s, palIdx) {
  const rgb = PALETTE_RGB[palIdx];
  const e = s * 0.06; // 外扩使相邻豆融合
  roundRect(ctx, x - e, y - e, s + e * 2, s + e * 2, s * 0.3);
  ctx.fillStyle = css(rgb); ctx.fill();
}
function drawFusedGloss(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  roundRect(ctx, x + s * 0.14, y + s * 0.1, s * 0.5, s * 0.22, s * 0.11);
  ctx.fill();
}

// 图纸的逻辑尺寸
function patternSize(p, opts) {
  opts = opts || {};
  const cellPx = opts.cellPx == null ? 14 : opts.cellPx;
  const pad = opts.pad == null ? Math.round(cellPx * 0.8) : opts.pad;
  return { width: p.w * cellPx + pad * 2, height: p.h * cellPx + pad * 2, pad, cellPx };
}

// 把图纸画进 ctx（原点为左上角，含底板背景）
function drawPatternInto(ctx, p, opts) {
  opts = opts || {};
  const fused = !!opts.fused;
  const placed = opts.placed || null;
  const size = patternSize(p, opts);
  const cellPx = size.cellPx, pad = size.pad;
  const w = p.w, h = p.h, cells = p.cells;
  roundRect(ctx, 0, 0, size.width, size.height, Math.min(16, pad));
  ctx.fillStyle = '#FFFDF7'; ctx.fill();
  ctx.strokeStyle = 'rgba(120,90,60,.12)'; ctx.lineWidth = 1; ctx.stroke();
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const i = cy * w + cx, t = cells[i];
      if (t < 0) continue;
      if (placed && !placed[i]) continue;
      const x = pad + cx * cellPx, y = pad + cy * cellPx;
      if (fused) drawFused(ctx, x, y, cellPx, t);
      else drawBead(ctx, x + cellPx / 2, y + cellPx / 2, cellPx * 0.46, t);
    }
  }
  if (fused) {
    for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
      const i = cy * w + cx;
      if (cells[i] < 0 || (placed && !placed[i])) continue;
      drawFusedGloss(ctx, pad + cx * cellPx, pad + cy * cellPx, cellPx);
    }
  }
  return size;
}

// 静态渲染图纸到指定 canvas（预览 / 缩略图 / 导出），scale 用于高清输出
function renderPatternTo(canvas, p, opts) {
  opts = opts || {};
  const scale = opts.scale || 1;
  const size = patternSize(p, opts);
  canvas.width = Math.max(1, Math.round(size.width * scale));
  canvas.height = Math.max(1, Math.round(size.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);
  drawPatternInto(ctx, p, opts);
  return size;
}

/**
 * 交互画板。
 * opts: {
 *   w, h, cells, placed,
 *   mode: 'play' | 'view' | 'iron',
 *   fused: bool(view 模式), ironed: 数组(iron 模式),
 *   numbers: Map(palIdx -> 序号),
 *   getSelected: () => palIdx,
 *   getTool: () => null | 'row',
 *   onPlace(i), onWrong(i), onToolTap(i), onIron(n)
 * }
 * 页面负责：查询 canvas 节点后 new BoardView(node, opts)，
 * 调 setViewport(w, h, dpr, left, top)，并把 touch 事件转发给 touchStart/Move/End。
 */
class BoardView {
  constructor(canvas, opts) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.o = opts;
    this.fused = !!opts.fused;
    this.scale = 20; this.ox = 0; this.oy = 0;
    this.vw = 0; this.vh = 0; this.dpr = 1;
    this.rl = 0; this.rt = 0; // canvas 在视口中的位置（把 clientX/Y 换算成画布坐标）
    this._fitted = false;
    this.anims = new Map(); // cellIdx -> 动画开始时间(可为未来,做连排级联)
    this.wrongFx = null;
    this.dirty = true;
    this.alive = true;
    this.pointers = new Map();
    this.pinch = null;
    this.gesture = null;
    this.ironPos = null;          // 熨斗当前位置（画布坐标）
    this.ironAnims = new Map();   // cellIdx -> 熔化动画开始时间
    this.steam = [];              // 蒸汽粒子
    this._lastSteam = 0;
    this._loop = this._loop.bind(this);
    this._raf(this._loop);
  }

  _raf(cb) {
    if (this.cv.requestAnimationFrame) this.cv.requestAnimationFrame(cb);
    else setTimeout(cb, 16);
  }

  destroy() { this.alive = false; }
  requestRender() { this.dirty = true; }
  setFused(v) { this.fused = v; this.dirty = true; }

  // 页面布局完成 / 窗口尺寸变化（iPad 分屏、转屏）时调用
  setViewport(w, h, dpr, left, top) {
    if (w < 10 || h < 10) return;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.vw = w; this.vh = h; this.dpr = dpr;
    this.rl = left || 0; this.rt = top || 0;
    if (!this._fitted) { this.fit(); this._fitted = true; }
    else this._clamp();
    this.dirty = true;
  }

  _fitScale() {
    const m = 26;
    return Math.min((this.vw - m * 2) / this.o.w, (this.vh - m * 2) / this.o.h);
  }
  _minScale() { return clamp(this._fitScale() * 0.8, 1.5, 12); }

  fit() {
    this.scale = clamp(this._fitScale(), 1.5, 46);
    this.ox = (this.vw - this.o.w * this.scale) / 2;
    this.oy = (this.vh - this.o.h * this.scale) / 2;
    this.dirty = true;
  }

  zoomAt(f, px, py) {
    px = px == null ? this.vw / 2 : px;
    py = py == null ? this.vh / 2 : py;
    const ns = clamp(this.scale * f, this._minScale(), 64);
    const k = ns / this.scale;
    this.ox = px - (px - this.ox) * k;
    this.oy = py - (py - this.oy) * k;
    this.scale = ns;
    this._clamp();
    this.dirty = true;
  }

  _clampAxis(o, b, v) {
    const lo = Math.min(0, v - b), hi = Math.max(0, v - b);
    return clamp(o, lo - 28, hi + 28);
  }
  _clamp() {
    this.ox = this._clampAxis(this.ox, this.o.w * this.scale, this.vw);
    this.oy = this._clampAxis(this.oy, this.o.h * this.scale, this.vh);
  }

  // 仅更新画布在视口中的位置（布局稳定后的复测）
  setRect(left, top) {
    this.rl = left || 0;
    this.rt = top || 0;
  }

  // touch 对象 → 画布坐标
  // 优先用 canvas 事件自带的 x/y（相对画布左上角，永远准确）；
  // 部分机型同层渲染回退成原生组件后 clientX/Y 的参照系会变，导致点击整体偏移
  _tp(t) {
    if (t.x != null && t.y != null) return { x: t.x, y: t.y };
    return { x: t.clientX - this.rl, y: t.clientY - this.rt };
  }

  touchStart(e) {
    for (const t of e.touches) {
      if (!this.pointers.has(t.identifier)) this.pointers.set(t.identifier, this._tp(t));
    }
    if (this.pointers.size === 1) {
      const p = [...this.pointers.values()][0];
      this.gesture = { start: p, moved: 0, painted: false, wrongCell: -1, pinched: false };
      if (this.o.mode === 'play') this._paintAt(p, true);
      else if (this.o.mode === 'iron') {
        this.ironPos = this._ironPoint(p);
        this._ironAt(this.ironPos);
        this.dirty = true;
      }
    } else if (this.pointers.size >= 2) {
      if (this.gesture) this.gesture.pinched = true;
      this.ironPos = null;
      const vals = [...this.pointers.values()];
      const a = vals[0], b = vals[1];
      this.pinch = {
        d: dist(a, b), scale: this.scale,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        ox: this.ox, oy: this.oy,
      };
    }
  }

  touchMove(e) {
    if (this.pointers.size >= 2 && this.pinch) {
      for (const t of e.touches) {
        if (this.pointers.has(t.identifier)) this.pointers.set(t.identifier, this._tp(t));
      }
      const vals = [...this.pointers.values()];
      const a = vals[0], b = vals[1];
      const d = dist(a, b);
      if (d < 1) return;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ns = clamp(this.pinch.scale * d / this.pinch.d, this._minScale(), 64);
      const wx0 = (this.pinch.mid.x - this.pinch.ox) / this.pinch.scale;
      const wy0 = (this.pinch.mid.y - this.pinch.oy) / this.pinch.scale;
      this.scale = ns;
      this.ox = mid.x - wx0 * ns;
      this.oy = mid.y - wy0 * ns;
      this._clamp();
      this.dirty = true;
      return;
    }
    const t = e.touches[0];
    if (!t || !this.pointers.has(t.identifier)) return;
    const prev = this.pointers.get(t.identifier);
    const p = this._tp(t);
    this.pointers.set(t.identifier, p);
    if (!this.gesture) return;
    const dx = p.x - prev.x, dy = p.y - prev.y;
    this.gesture.moved += Math.hypot(dx, dy);
    const tool = this.o.getTool ? this.o.getTool() : null;
    if (this.o.mode === 'play' && !tool) {
      // 沿轨迹逐格上豆，避免快速滑动漏格
      const steps = Math.ceil(Math.hypot(dx, dy) / (this.scale * 0.4)) || 1;
      for (let i = 1; i <= steps; i++) {
        this._paintAt({ x: prev.x + dx * i / steps, y: prev.y + dy * i / steps }, false);
      }
    } else if (this.o.mode === 'iron') {
      // 熨斗沿轨迹碾过去
      const np = this._ironPoint(p);
      const from = this.ironPos || np;
      const fd = Math.hypot(np.x - from.x, np.y - from.y);
      const steps = Math.ceil(fd / Math.max(1, this.scale * 0.8)) || 1;
      for (let i = 1; i <= steps; i++) {
        this._ironAt({ x: from.x + (np.x - from.x) * i / steps, y: from.y + (np.y - from.y) * i / steps });
      }
      this.ironPos = np;
      const nowT = now();
      if (nowT - this._lastSteam > 70) { this._lastSteam = nowT; this._spawnSteam(np, 1); }
      this.dirty = true;
    } else {
      // 查看模式 / 工具模式：单指平移
      this.ox += dx; this.oy += dy;
      this._clamp();
      this.dirty = true;
    }
  }

  touchEnd(e) {
    for (const t of e.changedTouches) this.pointers.delete(t.identifier);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0 && this.ironPos) { this.ironPos = null; this.dirty = true; }
    if (this.pointers.size === 0 && this.gesture) {
      const g = this.gesture;
      this.gesture = null;
      if (this.o.mode === 'play' && !g.pinched && !g.painted && g.moved < 8 && g.wrongCell >= 0) {
        this.wrongFx = { i: g.wrongCell, t0: now() };
        this.dirty = true;
        if (this.o.onWrong) this.o.onWrong(g.wrongCell);
      }
    }
  }

  cellAt(p) {
    const cx = Math.floor((p.x - this.ox) / this.scale);
    const cy = Math.floor((p.y - this.oy) / this.scale);
    if (cx < 0 || cy < 0 || cx >= this.o.w || cy >= this.o.h) return -1;
    return cy * this.o.w + cx;
  }

  _paintAt(p, isTap) {
    const i = this.cellAt(p);
    if (i < 0) return;
    const tool = this.o.getTool ? this.o.getTool() : null;
    if (tool) {
      if (isTap) {
        if (this.gesture) this.gesture.painted = true;
        if (this.o.onToolTap) this.o.onToolTap(i);
      }
      return;
    }
    const t = this.o.cells[i];
    if (t < 0 || this.o.placed[i]) return;
    const sel = this.o.getSelected();
    if (t === sel) {
      this.o.placed[i] = 1;
      this.anims.set(i, now());
      if (this.gesture) this.gesture.painted = true;
      this.dirty = true;
      if (this.o.onPlace) this.o.onPlace(i);
    } else if (isTap && this.gesture) {
      this.gesture.wrongCell = i;
    }
  }

  // 外部批量上豆（整排工具），带级联动画；豆子多时压缩总时长
  placeMany(indices) {
    const t0 = now();
    const step = Math.min(26, 900 / indices.length);
    indices.forEach((i, k) => {
      this.o.placed[i] = 1;
      this.anims.set(i, t0 + k * step);
    });
    this.dirty = true;
  }

  /* ---- 熨烫模式 ---- */

  // 熨斗尺寸（屏幕像素），底板作用半径与视觉大小保持一致
  _ironSize() { return clamp(this.scale * 4, 60, 150); }

  // 熨斗贴合点：略高于手指，避免被手挡住
  _ironPoint(p) {
    return { x: p.x, y: p.y - this._ironSize() * 0.18 };
  }

  _ironAt(pt) {
    const R = 2.4; // 熨斗底板作用半径（格），约等于底板半宽
    const o = this.o;
    const w = o.w, h = o.h, cells = o.cells, placed = o.placed, ironed = o.ironed;
    const wx0 = (pt.x - this.ox) / this.scale;
    const wy0 = (pt.y - this.oy) / this.scale;
    const x0 = Math.max(0, Math.floor(wx0 - R - 0.5)), x1 = Math.min(w - 1, Math.ceil(wx0 + R + 0.5));
    const y0 = Math.max(0, Math.floor(wy0 - R - 0.5)), y1 = Math.min(h - 1, Math.ceil(wy0 + R + 0.5));
    let n = 0;
    const t0 = now();
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const dx = cx + 0.5 - wx0, dy = cy + 0.5 - wy0;
        if (dx * dx + dy * dy > R * R) continue;
        const i = cy * w + cx;
        if (cells[i] < 0 || !placed[i] || ironed[i]) continue;
        ironed[i] = 1;
        this.ironAnims.set(i, t0);
        n++;
      }
    }
    if (n) {
      this._spawnSteam(pt, Math.min(3, n));
      this.dirty = true;
      if (this.o.onIron) this.o.onIron(n);
    }
  }

  _spawnSteam(pt, k) {
    const size = this._ironSize();
    for (let j = 0; j < k && this.steam.length < 60; j++) {
      this.steam.push({
        x: pt.x + (Math.random() - 0.5) * 16,
        y: pt.y - size * 0.45,
        r: 3 + Math.random() * 4,
        life: 800 + Math.random() * 500,
        t0: now(),
        seed: Math.random() * 10,
      });
    }
  }

  // 调试用：一键烫平剩余豆子，返回数量
  ironAll() {
    const o = this.o;
    const idx = [];
    for (let i = 0; i < o.cells.length; i++) {
      if (o.cells[i] >= 0 && o.placed[i] && !o.ironed[i]) { o.ironed[i] = 1; idx.push(i); }
    }
    const t0 = now();
    const step = Math.min(8, 900 / (idx.length || 1));
    idx.forEach((i, k) => this.ironAnims.set(i, t0 + k * step));
    this.dirty = true;
    return idx.length;
  }

  _loop() {
    if (!this.alive) return;
    if (this.dirty || this.anims.size || this.wrongFx) this._render(now());
    this._raf(this._loop);
  }

  _render(t) {
    const ctx = this.ctx;
    if (!this.vw || !this.vh) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    const s = this.scale, ox = this.ox, oy = this.oy;
    const w = this.o.w, h = this.o.h, cells = this.o.cells, placed = this.o.placed;

    // 底板
    const pad = Math.max(6, s * 0.4);
    ctx.shadowColor = 'rgba(120,90,60,.16)';
    ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
    roundRect(ctx, ox - pad, oy - pad, w * s + pad * 2, h * s + pad * 2, Math.min(18, Math.max(6, s * 0.6)));
    ctx.fillStyle = '#FFFDF7'; ctx.fill();
    ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(120,90,60,.12)'; ctx.lineWidth = 1; ctx.stroke();

    // 可见范围裁剪
    const x0 = clamp(Math.floor((0 - ox) / s), 0, w - 1);
    const x1 = clamp(Math.ceil(this.vw / s - ox / s), 0, w - 1);
    const y0 = clamp(Math.floor((0 - oy) / s), 0, h - 1);
    const y1 = clamp(Math.ceil(this.vh / s - oy / s), 0, h - 1);

    const isPlay = this.o.mode === 'play';
    const isIron = this.o.mode === 'iron';
    const ironed = this.o.ironed;
    const sel = isPlay ? this.o.getSelected() : -2;
    const showNum = isPlay && s >= 15 && this.o.numbers;
    const showPeg = s >= 9;
    const fused = this.fused && !isPlay && !isIron;
    const numFont = 'bold ' + Math.round(s * 0.4) + 'px sans-serif';

    if (showNum) {
      ctx.font = numFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * w + cx;
        const tc = cells[i];
        const px = ox + cx * s, py = oy + cy * s;
        const mx = px + s / 2, my = py + s / 2;
        if (showPeg && !fused) {
          ctx.beginPath(); ctx.arc(mx, my, Math.max(1, s * 0.06), 0, 7);
          ctx.fillStyle = 'rgba(101,80,60,.10)'; ctx.fill();
        }
        if (tc < 0) continue;
        if (placed[i]) {
          let r = s * 0.46;
          const a0 = this.anims.get(i);
          if (a0 != null) {
            const k = (t - a0) / 160;
            if (k < 0) continue;          // 级联动画：还没轮到
            if (k >= 1) this.anims.delete(i);
            else r *= 1 + 0.4 * (1 - k) * (1 - k);
          }
          if (isIron) {
            if (ironed[i]) {
              const m0 = this.ironAnims.get(i);
              if (m0 == null) drawFused(ctx, px, py, s, tc);
              else {
                const k = (t - m0) / 260;
                if (k < 0) drawBead(ctx, mx, my, r, tc); // 级联还没轮到
                else if (k >= 1) { this.ironAnims.delete(i); drawFused(ctx, px, py, s, tc); }
                else {
                  // 熔化：豆子摊开淡出，熔块淡入
                  drawBead(ctx, mx, my, r * (1 + 0.12 * k), tc, 1 - k);
                  ctx.globalAlpha = k;
                  drawFused(ctx, px, py, s, tc);
                  ctx.globalAlpha = 1;
                }
              }
            } else drawBead(ctx, mx, my, r, tc);
          }
          else if (fused) drawFused(ctx, px, py, s, tc);
          else drawBead(ctx, mx, my, r, tc);
        } else if (isPlay) {
          const isSel = tc === sel;
          const rgb = PALETTE_RGB[tc];
          ctx.globalAlpha = isSel ? 0.5 : 0.2;
          ctx.beginPath(); ctx.arc(mx, my, s * 0.38, 0, 7);
          ctx.fillStyle = css(rgb); ctx.fill();
          ctx.globalAlpha = 1;
          if (isSel && s >= 8) {
            ctx.setLineDash([s * 0.16, s * 0.13]);
            ctx.strokeStyle = css(mix(rgb, BLACK, 0.3), 0.75);
            ctx.lineWidth = Math.max(1, s * 0.06);
            ctx.beginPath(); ctx.arc(mx, my, s * 0.42, 0, 7); ctx.stroke();
            ctx.setLineDash([]);
          }
          if (showNum) {
            const n = this.o.numbers.get(tc);
            if (n != null) {
              ctx.fillStyle = 'rgba(60,45,35,.72)';
              ctx.fillText(String(n), mx, my + s * 0.02);
              ctx.font = numFont;
            }
          }
        }
      }
    }

    if (fused || isIron) {
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const i = cy * w + cx;
        if (cells[i] < 0 || !placed[i]) continue;
        if (isIron && (!ironed[i] || this.ironAnims.has(i))) continue;
        drawFusedGloss(ctx, ox + cx * s, oy + cy * s, s);
      }
    }

    // 放错提示红圈
    if (this.wrongFx) {
      const k = (t - this.wrongFx.t0) / 320;
      if (k >= 1) this.wrongFx = null;
      else {
        const i = this.wrongFx.i;
        const mx = ox + (i % w) * s + s / 2, my = oy + Math.floor(i / w) * s + s / 2;
        ctx.strokeStyle = 'rgba(224,60,50,' + (1 - k) + ')';
        ctx.lineWidth = Math.max(1.5, s * 0.09);
        ctx.beginPath(); ctx.arc(mx, my, s * (0.42 + 0.3 * k), 0, 7); ctx.stroke();
      }
    }

    // 蒸汽 + 熨斗
    if (isIron) {
      for (let k = this.steam.length - 1; k >= 0; k--) {
        const sp = this.steam[k];
        const age = t - sp.t0, kk = age / sp.life;
        if (kk >= 1) { this.steam.splice(k, 1); continue; }
        const x = sp.x + Math.sin(age * 0.008 + sp.seed) * 6;
        const y = sp.y - age * 0.05;
        ctx.beginPath();
        ctx.arc(x, y, sp.r * (1 + 1.8 * kk), 0, 7);
        ctx.fillStyle = 'rgba(255,255,255,' + (0.38 * (1 - kk)) + ')';
        ctx.fill();
      }
      if (this.ironPos && this.pointers.size >= 1) {
        drawIron(ctx, this.ironPos.x, this.ironPos.y, this._ironSize());
      }
    }

    this.dirty = this.anims.size > 0 || !!this.wrongFx ||
      (isIron && (this.steam.length > 0 || this.ironAnims.size > 0));
  }
}

// 画一只可爱的熨斗，尖头朝上，(x,y) 为底板中心
function drawIron(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  const w = s * 0.62;
  const plate = () => {
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.55);
    ctx.quadraticCurveTo(w, -s * 0.3, w * 0.86, s * 0.26);
    ctx.quadraticCurveTo(w * 0.62, s * 0.55, 0, s * 0.55);
    ctx.quadraticCurveTo(-w * 0.62, s * 0.55, -w * 0.86, s * 0.26);
    ctx.quadraticCurveTo(-w, -s * 0.3, 0, -s * 0.55);
    ctx.closePath();
  };
  // 投影
  ctx.save();
  ctx.translate(3, 5);
  plate();
  ctx.fillStyle = 'rgba(60,40,25,.22)';
  ctx.fill();
  ctx.restore();
  // 金属底板
  plate();
  const mg = ctx.createLinearGradient(-w, 0, w, 0);
  mg.addColorStop(0, '#C4CAD1');
  mg.addColorStop(0.5, '#EFF3F6');
  mg.addColorStop(1, '#AEB6BF');
  ctx.fillStyle = mg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,80,90,.5)';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.stroke();
  // 机身
  ctx.save();
  ctx.translate(0, s * 0.1);
  ctx.scale(0.72, 0.64);
  plate();
  const bg = ctx.createLinearGradient(-w, 0, w, 0);
  bg.addColorStop(0, '#E8623A');
  bg.addColorStop(0.5, '#FF8E60');
  bg.addColorStop(1, '#D9552F');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.restore();
  // 手柄
  roundRect(ctx, -w * 0.38, -s * 0.04, w * 0.76, s * 0.2, s * 0.1);
  ctx.fillStyle = '#54382A';
  ctx.fill();
  // 蒸汽孔
  ctx.fillStyle = 'rgba(90,100,110,.65)';
  for (const dx of [-w * 0.3, 0, w * 0.3]) {
    ctx.beginPath();
    ctx.arc(dx, -s * 0.36, Math.max(1.2, s * 0.032), 0, 7);
    ctx.fill();
  }
  ctx.restore();
}

module.exports = { drawBead, patternSize, drawPatternInto, renderPatternTo, BoardView };
