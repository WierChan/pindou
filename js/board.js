// 画板渲染引擎：豆子绘制、缩放平移手势、拼豆交互
import { PALETTE_RGB } from './palette.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const css = ([r, g, b], a = 1) => `rgba(${r},${g},${b},${a})`;
const mix = (c1, c2, t) => [0, 1, 2].map(i => Math.round(c1[i] + (c2[i] - c1[i]) * t));
const BLACK = [30, 25, 20];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

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
export function drawBead(ctx, cx, cy, r, palIdx, alpha = 1) {
  const rgb = PALETTE_RGB[palIdx];
  if (alpha < 1) ctx.globalAlpha = alpha;
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

// 静态渲染图纸到新 canvas（预览 / 缩略图 / 导出）
export function renderPattern({ w, h, cells }, { cellPx = 14, fused = false, placed = null, pad = null } = {}) {
  pad = pad == null ? Math.round(cellPx * 0.8) : pad;
  const cv = document.createElement('canvas');
  cv.width = w * cellPx + pad * 2;
  cv.height = h * cellPx + pad * 2;
  const ctx = cv.getContext('2d');
  roundRect(ctx, 0, 0, cv.width, cv.height, Math.min(16, pad));
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
  return cv;
}

/**
 * 交互画板。
 * opts: {
 *   w, h, cells, placed,
 *   mode: 'play' | 'view',
 *   fused: bool(view 模式),
 *   numbers: Map(palIdx -> 序号),
 *   getSelected: () => palIdx,
 *   getTool: () => null | 'row',
 *   onPlace(i), onWrong(i), onToolTap(i)
 * }
 */
export class BoardView {
  constructor(canvas, opts) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.o = opts;
    this.fused = !!opts.fused;
    this.scale = 20; this.ox = 0; this.oy = 0;
    this.vw = 0; this.vh = 0; this.dpr = 1;
    this._fitted = false;
    this.anims = new Map(); // cellIdx -> 动画开始时间(可为未来,做连排级联)
    this.wrongFx = null;
    this.dirty = true;
    this.alive = true;
    this.pointers = new Map();
    this.pinch = null;
    this.gesture = null;
    this.ironPos = null;          // 熨斗当前位置（屏幕坐标）
    this.ironAnims = new Map();   // cellIdx -> 熔化动画开始时间
    this.steam = [];              // 蒸汽粒子
    this._lastSteam = 0;
    this._bind();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    this.ro = new ResizeObserver(() => this._resize());
    this.ro.observe(canvas.parentElement);
    this._resize();
  }

  destroy() { this.alive = false; this.ro.disconnect(); }
  requestRender() { this.dirty = true; }
  setFused(v) { this.fused = v; this.dirty = true; }

  _resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const dpr = window.devicePixelRatio || 1;
    this.cv.style.width = r.width + 'px';
    this.cv.style.height = r.height + 'px';
    this.cv.width = Math.round(r.width * dpr);
    this.cv.height = Math.round(r.height * dpr);
    this.vw = r.width; this.vh = r.height; this.dpr = dpr;
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

  _bind() {
    const cv = this.cv;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', e => this._down(e));
    cv.addEventListener('pointermove', e => this._move(e));
    const up = e => this._up(e);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => this._wheel(e), { passive: false });
    cv.addEventListener('contextmenu', e => e.preventDefault());
  }

  _pos(e) {
    const r = this.cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _down(e) {
    try { this.cv.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件无真实指针 */ }
    const p = this._pos(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      this.gesture = { start: p, moved: 0, painted: false, wrongCell: -1, pinched: false };
      if (this.o.mode === 'play') this._paintAt(p, true);
      else if (this.o.mode === 'iron') {
        this.ironPos = this._ironPoint(p);
        this._ironAt(this.ironPos);
        this.dirty = true;
      }
    } else if (this.pointers.size === 2) {
      if (this.gesture) this.gesture.pinched = true;
      this.ironPos = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        d: dist(a, b), scale: this.scale,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        ox: this.ox, oy: this.oy,
      };
    }
  }

  _move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const prev = this.pointers.get(e.pointerId);
    const p = this._pos(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = dist(a, b);
      if (d < 1) return;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ns = clamp(this.pinch.scale * d / this.pinch.d, this._minScale(), 64);
      const wx = (this.pinch.mid.x - this.pinch.ox) / this.pinch.scale;
      const wy = (this.pinch.mid.y - this.pinch.oy) / this.pinch.scale;
      this.scale = ns;
      this.ox = mid.x - wx * ns;
      this.oy = mid.y - wy * ns;
      this._clamp();
      this.dirty = true;
      return;
    }
    if (this.pointers.size === 1 && this.gesture) {
      const dx = p.x - prev.x, dy = p.y - prev.y;
      this.gesture.moved += Math.hypot(dx, dy);
      if (this.o.mode === 'play' && !this.o.getTool?.()) {
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
        const nowT = performance.now();
        if (nowT - this._lastSteam > 70) { this._lastSteam = nowT; this._spawnSteam(np, 1); }
        this.dirty = true;
      } else {
        // 查看模式 / 工具模式：单指平移
        this.ox += dx; this.oy += dy;
        this._clamp();
        this.dirty = true;
      }
    }
  }

  _up(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0 && this.ironPos) { this.ironPos = null; this.dirty = true; }
    if (this.pointers.size === 0 && this.gesture) {
      const g = this.gesture;
      this.gesture = null;
      if (this.o.mode === 'play' && !g.pinched && !g.painted && g.moved < 8 && g.wrongCell >= 0) {
        this.wrongFx = { i: g.wrongCell, t0: performance.now() };
        this.dirty = true;
        this.o.onWrong?.(g.wrongCell);
      }
    }
  }

  _wheel(e) {
    e.preventDefault();
    const p = this._pos(e);
    if (e.ctrlKey || e.metaKey) this.zoomAt(Math.exp(-e.deltaY * 0.01), p.x, p.y);
    else {
      this.ox -= e.deltaX; this.oy -= e.deltaY;
      this._clamp();
      this.dirty = true;
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
    const tool = this.o.getTool?.();
    if (tool) {
      if (isTap) {
        this.gesture && (this.gesture.painted = true);
        this.o.onToolTap?.(i);
      }
      return;
    }
    const t = this.o.cells[i];
    if (t < 0 || this.o.placed[i]) return;
    const sel = this.o.getSelected();
    if (t === sel) {
      this.o.placed[i] = 1;
      this.anims.set(i, performance.now());
      if (this.gesture) this.gesture.painted = true;
      this.dirty = true;
      this.o.onPlace?.(i);
    } else if (isTap && this.gesture) {
      this.gesture.wrongCell = i;
    }
  }

  // 外部批量上豆（整排工具），带级联动画；豆子多时压缩总时长
  placeMany(indices) {
    const now = performance.now();
    const step = Math.min(26, 900 / indices.length);
    indices.forEach((i, k) => {
      this.o.placed[i] = 1;
      this.anims.set(i, now + k * step);
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
    const { w, h, cells, placed, ironed } = this.o;
    const wx = (pt.x - this.ox) / this.scale;
    const wy = (pt.y - this.oy) / this.scale;
    const x0 = Math.max(0, Math.floor(wx - R - 0.5)), x1 = Math.min(w - 1, Math.ceil(wx + R + 0.5));
    const y0 = Math.max(0, Math.floor(wy - R - 0.5)), y1 = Math.min(h - 1, Math.ceil(wy + R + 0.5));
    let n = 0;
    const now = performance.now();
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const dx = cx + 0.5 - wx, dy = cy + 0.5 - wy;
        if (dx * dx + dy * dy > R * R) continue;
        const i = cy * w + cx;
        if (cells[i] < 0 || !placed[i] || ironed[i]) continue;
        ironed[i] = 1;
        this.ironAnims.set(i, now);
        n++;
      }
    }
    if (n) {
      this._spawnSteam(pt, Math.min(3, n));
      this.dirty = true;
      this.o.onIron?.(n);
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
        t0: performance.now(),
        seed: Math.random() * 10,
      });
    }
  }

  // 调试用：一键烫平剩余豆子，返回数量
  ironAll() {
    const { cells, placed, ironed } = this.o;
    const idx = [];
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] >= 0 && placed[i] && !ironed[i]) { ironed[i] = 1; idx.push(i); }
    }
    const now = performance.now();
    const step = Math.min(8, 900 / (idx.length || 1));
    idx.forEach((i, k) => this.ironAnims.set(i, now + k * step));
    this.dirty = true;
    return idx.length;
  }

  _loop() {
    if (!this.alive) return;
    if (this.dirty || this.anims.size || this.wrongFx) this._render(performance.now());
    requestAnimationFrame(this._loop);
  }

  _render(now) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    const s = this.scale, ox = this.ox, oy = this.oy;
    const { w, h, cells, placed } = this.o;

    // 底板
    const pad = Math.max(6, s * 0.4);
    ctx.shadowColor = 'rgba(120,90,60,.16)';
    ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
    roundRect(ctx, ox - pad, oy - pad, w * s + pad * 2, h * s + pad * 2, Math.min(18, Math.max(6, s * 0.6)));
    ctx.fillStyle = '#FFFDF7'; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
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

    if (showNum) {
      ctx.font = `600 ${Math.round(s * 0.4)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * w + cx;
        const t = cells[i];
        const px = ox + cx * s, py = oy + cy * s;
        const mx = px + s / 2, my = py + s / 2;
        if (showPeg && !fused) {
          ctx.beginPath(); ctx.arc(mx, my, Math.max(1, s * 0.06), 0, 7);
          ctx.fillStyle = 'rgba(101,80,60,.10)'; ctx.fill();
        }
        if (t < 0) continue;
        if (placed[i]) {
          let r = s * 0.46;
          const a0 = this.anims.get(i);
          if (a0 != null) {
            const k = (now - a0) / 160;
            if (k < 0) continue;          // 级联动画：还没轮到
            if (k >= 1) this.anims.delete(i);
            else r *= 1 + 0.4 * (1 - k) * (1 - k);
          }
          if (isIron) {
            if (ironed[i]) {
              const m0 = this.ironAnims.get(i);
              if (m0 == null) drawFused(ctx, px, py, s, t);
              else {
                const k = (now - m0) / 260;
                if (k < 0) drawBead(ctx, mx, my, r, t); // 级联还没轮到
                else if (k >= 1) { this.ironAnims.delete(i); drawFused(ctx, px, py, s, t); }
                else {
                  // 熔化：豆子摊开淡出，熔块淡入
                  drawBead(ctx, mx, my, r * (1 + 0.12 * k), t, 1 - k);
                  ctx.globalAlpha = k;
                  drawFused(ctx, px, py, s, t);
                  ctx.globalAlpha = 1;
                }
              }
            } else drawBead(ctx, mx, my, r, t);
          }
          else if (fused) drawFused(ctx, px, py, s, t);
          else drawBead(ctx, mx, my, r, t);
        } else if (isPlay) {
          const isSel = t === sel;
          const rgb = PALETTE_RGB[t];
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
            const n = this.o.numbers.get(t);
            if (n != null) {
              ctx.fillStyle = 'rgba(60,45,35,.72)';
              ctx.fillText(n, mx, my + s * 0.02);
              if (showNum) { ctx.font = `600 ${Math.round(s * 0.4)}px system-ui, sans-serif`; }
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
      const k = (now - this.wrongFx.t0) / 320;
      if (k >= 1) this.wrongFx = null;
      else {
        const i = this.wrongFx.i;
        const mx = ox + (i % w) * s + s / 2, my = oy + Math.floor(i / w) * s + s / 2;
        ctx.strokeStyle = `rgba(224,60,50,${1 - k})`;
        ctx.lineWidth = Math.max(1.5, s * 0.09);
        ctx.beginPath(); ctx.arc(mx, my, s * (0.42 + 0.3 * k), 0, 7); ctx.stroke();
      }
    }

    // 蒸汽 + 熨斗
    if (isIron) {
      for (let k = this.steam.length - 1; k >= 0; k--) {
        const sp = this.steam[k];
        const age = now - sp.t0, kk = age / sp.life;
        if (kk >= 1) { this.steam.splice(k, 1); continue; }
        const x = sp.x + Math.sin(age * 0.008 + sp.seed) * 6;
        const y = sp.y - age * 0.05;
        ctx.beginPath();
        ctx.arc(x, y, sp.r * (1 + 1.8 * kk), 0, 7);
        ctx.fillStyle = `rgba(255,255,255,${0.38 * (1 - kk)})`;
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
