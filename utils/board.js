// 画板渲染引擎（小程序版）：豆子绘制、缩放平移手势、拼豆/熨烫交互
// 色板：默认全局 PALETTE；作品可自带 palette（hex 数组，图纸导入的真实颜色），
// drawPatternInto 自动认 p.palette，BoardView 走 opts.palette
const { PALETTE_RGB, hexToRgb } = require('./palette');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// hex 色板 → RGB 三元组数组；没有自定义色板时用全局的
const palRGB = hexes => (hexes && hexes.length ? hexes.map(hexToRgb) : PALETTE_RGB);
const css = (rgb, a) => a == null || a >= 1
  ? 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')'
  : 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
const mix = (c1, c2, t) => [0, 1, 2].map(i => Math.round(c1[i] + (c2[i] - c1[i]) * t));
const BLACK = [35, 33, 58]; // 豆孔/选中框的加深混色基准（豆子本体质感，不随 UI 配色变）
const LOCATE_RED = 'rgb(233,71,55)';       // 定位模式：当前色需拼格高亮红
const LOCATE_EDGE = 'rgba(150,28,20,.9)';  // 高亮红格描边（相邻红格也分得清一颗颗）

/* ---- 豆子形状：'square' 方形像素豆 / 'round' 圆形经典豆（全局设置，持久化） ---- */
let BEAD_SHAPE = 'square';
try { if (wx.getStorageSync('pindou.beadShape') === 'round') BEAD_SHAPE = 'round'; } catch (e) { /* 忽略 */ }
function getBeadShape() { return BEAD_SHAPE; }
function setBeadShape(s) {
  BEAD_SHAPE = s === 'round' ? 'round' : 'square';
  try { wx.setStorageSync('pindou.beadShape', BEAD_SHAPE); } catch (e) { /* 忽略 */ }
}
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

// 单颗豆子：方形 = 无描边方块 + 深色方孔 + 左上硬高光；圆形 = 圆片 + 径向光泽 + 圆孔
// rgb 传三元组（调用方从所用色板取好）
// matte = 纯色豆，不画高光/光泽也不画豆孔（缩略图用：小尺寸下满屏细节显得杂乱）
function drawBead(ctx, cx, cy, r, rgb, alpha, matte) {
  if (alpha == null) alpha = 1;
  if (alpha < 1) ctx.globalAlpha = alpha;
  if (r < 3) {
    // 太小画不出孔和高光，纯色块反而更清晰（缩略图 / 大图纸缩到很小时）
    if (BEAD_SHAPE === 'round') {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
      ctx.fillStyle = css(rgb); ctx.fill();
    } else {
      const side = r * 1.9;
      ctx.fillStyle = css(rgb);
      ctx.fillRect(cx - side / 2, cy - side / 2, side, side);
    }
    if (alpha < 1) ctx.globalAlpha = 1;
    return;
  }
  if (BEAD_SHAPE === 'round') {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
    ctx.fillStyle = css(rgb); ctx.fill();
    if (!matte) {
      const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,.5)');
      g.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(0,0,0,.22)');
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.32, 0, 7);
      ctx.fillStyle = css(mix(rgb, BLACK, 0.45)); ctx.fill();
    }
  } else {
    const side = r * 1.9;
    const x = cx - side / 2, y = cy - side / 2;
    ctx.fillStyle = css(rgb);
    ctx.fillRect(x, y, side, side);
    if (!matte) {
      ctx.fillStyle = css(mix(rgb, BLACK, 0.45));
      ctx.fillRect(cx - side * 0.18, cy - side * 0.18, side * 0.36, side * 0.36);
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.fillRect(x + side * 0.1, y + side * 0.1, side * 0.2, side * 0.2);
    }
  }
  if (alpha < 1) ctx.globalAlpha = 1;
}

// 熨烫后的融合豆：方形 = 方块搭接；圆形 = 圆角方块搭接。
// holeR 为豆孔半径比例（0/undefined = 无孔）：成品中心留一个略深的孔，大小用户熨烫前可选。
function drawFused(ctx, x, y, s, rgb, holeR) {
  const e = s * 0.06; // 外扩使相邻豆融合
  if (BEAD_SHAPE === 'round' && s >= 3.5) {
    roundRect(ctx, x - e, y - e, s + e * 2, s + e * 2, s * 0.3);
    ctx.fillStyle = css(rgb); ctx.fill();
  } else {
    ctx.fillStyle = css(rgb);
    ctx.fillRect(x - e, y - e, s + e * 2, s + e * 2);
  }
  if (holeR > 0 && s >= 4) {
    const cx = x + s / 2, cy = y + s / 2;
    ctx.fillStyle = css(mix(rgb, BLACK, 0.42)); // 比豆面深一档，像凹下去的孔
    if (BEAD_SHAPE === 'round') {
      ctx.beginPath(); ctx.arc(cx, cy, s * holeR, 0, 7); ctx.fill();
    } else {
      const hs = s * holeR * 2;
      ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
    }
  }
}

/* ---------- 熨烫质感 ----------
   照片实测（tests/done.jpg）：底纹是灰度型噪声，强度约亮度 8%、脊线波长约
   1/5 颗豆（屏幕上取实测的 0.2 倍更耐看）。逐像素画代价太高 —— 生成无缝贴片
   用 pattern 铺；贴片只生成一次，缩放靠绘制端 ctx.scale 适配，捏合过程中不重算 */
const GRAIN_AMP = 0.048;  // 底纹峰值 alpha
const GRAIN_MIN_PX = 6;   // 格子小于这个尺寸就不铺（看不见，纯浪费）
const GRAIN_UNIT = 16;    // 贴片里「一颗豆」占多少像素（绘制端据此换算缩放）
const GRAIN_BEADS = 8;    // 贴片边长（豆数）

// 两档质感。存档里可能出现三种历史值，都在 workFinish 里归一：
// 首版是布尔 texture；中途试过 'bling' 闪粉烫（效果不好已撤），按细腻纹理渲染
const SMOOTH = 'smooth', GRAIN = 'grain';
// 全局默认熨烫质感（设置页可改）：只影响没选过的新作品；读不到回退细腻纹理
function defaultFinish() {
  try { const v = wx.getStorageSync('pindou.defaultFinish'); if (v === SMOOTH || v === GRAIN) return v; } catch (e) { /* 忽略 */ }
  return GRAIN;
}
function workFinish(work) {
  if (work) {
    if (work.finish === SMOOTH) return SMOOTH;
    if (work.finish) return GRAIN;               // grain / 已撤的 bling 都按 grain
    if (work.texture === false) return SMOOTH;   // 兼容老布尔字段
    if (work.texture === true) return GRAIN;
  }
  return defaultFinish();                          // 无任何字段（新作品）→ 全局默认
}

/* ---- 豆孔：成品（融合豆）中心残留的孔，熨烫前可选大小 ----
   none 无孔 / small 小孔（默认，贴近真实拼豆熨烫后的样子）/ large 大孔。
   作品级字段 work.hole，渲染链跟 finish 一起走（缩略图/分享/导出/查看都认） */
const HOLE_NONE = 'none', HOLE_SMALL = 'small', HOLE_LARGE = 'large';
// 全局默认豆孔（设置页可改）：没选过的新作品跟它走；读不到回退小孔
function defaultHole() {
  try { const v = wx.getStorageSync('pindou.defaultHole'); if (v === HOLE_NONE || v === HOLE_SMALL || v === HOLE_LARGE) return v; } catch (e) { /* 忽略 */ }
  return HOLE_SMALL;
}
function workHole(work) {
  const h = work && work.hole;
  if (h === HOLE_NONE || h === HOLE_SMALL || h === HOLE_LARGE) return h;
  return defaultHole(); // 无字段（新作品）→ 全局默认
}
function holeRatio(hole) { // 孔半径占格宽的比例（0 = 无孔）
  return hole === HOLE_NONE ? 0 : hole === HOLE_LARGE ? 0.26 : 0.15;
}

function makeOffscreen(w, h) {
  try {
    if (typeof wx !== 'undefined' && wx.createOffscreenCanvas) {
      return wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
    }
  } catch (e) { /* 基础库不支持，下面回退 */ }
  try {
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    }
  } catch (e) { /* 忽略 */ }
  return null;
}

// 周期性格点 + 平滑插值的值噪声（格点环绕 → 贴片四边无缝）。
// nx/ny 可以不等：拉长格点就得到有方向的条纹
function lattice(nx, ny, seed) {
  const a = new Float64Array(nx * ny);
  let s = seed >>> 0;
  for (let i = 0; i < a.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0; // LCG：不依赖 Math.random，贴片可复现
    a[i] = s / 4294967296 * 2 - 1;
  }
  return a;
}
function valueAt(lat, nx, ny, u, v) {
  const fx = u * nx, fy = v * ny;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const ix0 = ((x0 % nx) + nx) % nx, iy0 = ((y0 % ny) + ny) % ny;
  const x1 = (ix0 + 1) % nx, y1 = (iy0 + 1) % ny;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty); // smoothstep
  const a = lat[iy0 * nx + ix0], b = lat[iy0 * nx + x1];
  const c = lat[y1 * nx + ix0], d = lat[y1 * nx + x1];
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}

let grainCv = null, grainTried = false;
const patCache = { ctx: null, pat: null };

// 生成底纹贴片（只生成一次）
function grainTile() {
  if (grainTried) return grainCv;
  grainTried = true;
  const B = GRAIN_BEADS, T = B * GRAIN_UNIT;
  const cv = makeOffscreen(T, T);
  if (!cv) return null;
  try {
    const c2 = cv.getContext('2d');
    const img = c2.createImageData(T, T);
    const d = img.data;
    // 「域扭曲 + 脊线噪声」——对着照片试出来的形态：
    //   脊线 n = 1-2|noise|：噪声过零处连成蜿蜒的亮脊，正是熨烫面那种褶皱，
    //     普通值噪声只会得到一片雪花点；
    //   域扭曲：先用低频噪声偏移采样坐标，脊线才不会沿方格排列（不扭曲时
    //     整片纹理呈方块状，像电路板）。扭曲场本身也是周期的，贴片仍然无缝。
    const N1 = B * 5, N2 = B * 10, NW = Math.round(B * 1.5);
    const WARP = 0.05, DET = 0.15;
    const l1 = lattice(N1, N1, 0x9E3779B9);
    const l2 = lattice(N2, N2, 0x85EBCA6B);
    const w1 = lattice(NW, NW, 0xC2B2AE35);
    const w2 = lattice(NW, NW, 0x27D4EB2F);
    const buf = new Float64Array(T * T);
    let sum = 0;
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const u = x / T, v = y / T;
        const uu = u + valueAt(w1, NW, NW, u, v) * WARP;
        const vv = v + valueAt(w2, NW, NW, u, v) * WARP;
        const r1 = 1 - 2 * Math.abs(valueAt(l1, N1, N1, uu, vv));
        const r2 = 1 - 2 * Math.abs(valueAt(l2, N2, N2, uu, vv));
        const n = r1 * (1 - DET) + r2 * DET;
        buf[y * T + x] = n;
        sum += n;
      }
    }
    const mean = sum / (T * T); // 脊线噪声整体偏亮，去均值才是纯粹的明暗调制
    for (let i = 0; i < T * T; i++) {
      let n = (buf[i] - mean) * 1.35;
      if (n > 1) n = 1; else if (n < -1) n = -1;
      const o = i * 4;
      const light = n > 0;
      d[o] = d[o + 1] = d[o + 2] = light ? 255 : 0;
      d[o + 3] = Math.round((light ? n : -n) * GRAIN_AMP * 255);
    }
    c2.putImageData(img, 0, 0);
    grainCv = cv;
  } catch (e) {
    grainCv = null; // 老基础库不支持离屏画布：退回无纹理
  }
  return grainCv;
}

// 拿到贴片 pattern（按 ctx 记忆，正常一帧只创建一次）
function grainPattern(ctx) {
  const cv = grainTile();
  if (!cv) return null;
  if (patCache.ctx === ctx && patCache.pat) return patCache.pat;
  try {
    patCache.pat = ctx.createPattern(cv, 'repeat');
    patCache.ctx = ctx;
  } catch (e) {
    patCache.pat = null;
  }
  return patCache.pat;
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
  const holeR = holeRatio(opts.hole); // 成品豆孔大小（跟着作品的 hole 字段）
  const placed = opts.placed || null;
  const PAL = palRGB(opts.palette || p.palette);
  const size = patternSize(p, opts);
  const cellPx = size.cellPx, pad = size.pad;
  const w = p.w, h = p.h, cells = p.cells;
  roundRect(ctx, 1, 1, size.width - 2, size.height - 2, Math.min(4, pad * 0.3));
  ctx.fillStyle = '#FFFFFF'; ctx.fill();
  ctx.strokeStyle = 'rgba(95,74,78,.85)'; ctx.lineWidth = 2; ctx.stroke();
  // 底板蒙孔（方豆=方点，圆豆=圆点）
  if (cellPx >= 5) {
    ctx.fillStyle = 'rgba(95,74,78,.09)';
    if (BEAD_SHAPE === 'round') {
      const pr = Math.max(0.8, cellPx * 0.07);
      for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
        ctx.beginPath();
        ctx.arc(pad + cx * cellPx + cellPx / 2, pad + cy * cellPx + cellPx / 2, pr, 0, 7);
        ctx.fill();
      }
    } else {
      const d = Math.max(1, cellPx * 0.12);
      for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
        ctx.fillRect(pad + cx * cellPx + (cellPx - d) / 2, pad + cy * cellPx + (cellPx - d) / 2, d, d);
      }
    }
  }
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const i = cy * w + cx, t = cells[i];
      if (t < 0) continue;
      if (placed && !placed[i]) continue;
      const x = pad + cx * cellPx, y = pad + cy * cellPx;
      if (fused) drawFused(ctx, x, y, cellPx, PAL[t], holeR);
      else drawBead(ctx, x + cellPx / 2, y + cellPx / 2, cellPx * 0.46, PAL[t], 1, !!opts.matte);
    }
  }
  // 熨烫质感：贴片铺一遍（只盖在豆子上，底板保持干净）。
  // opts.finish 是作品的质感档位（熨烫前选的），缩略图/分享/导出都跟着走
  const finish = opts.finish || SMOOTH;
  if (fused && finish !== SMOOTH && cellPx >= GRAIN_MIN_PX) {
    const pat = grainPattern(ctx);
    if (pat) {
      const e = cellPx * 0.06;
      // 贴片按「一颗豆 = 该档位的 unit 像素」缩放，并跟着图纸原点平移：
      // 颗粒/闪点的尺寸永远与豆同比例
      const k = cellPx / GRAIN_UNIT;
      ctx.save();
      ctx.translate(pad, pad);
      ctx.scale(k, k);
      ctx.fillStyle = pat;
      const cs = cellPx / k, es = e / k;
      for (let cy = 0; cy < h; cy++) {
        for (let cx = 0; cx < w; cx++) {
          const i = cy * w + cx;
          if (cells[i] < 0) continue;
          if (placed && !placed[i]) continue;
          ctx.fillRect(cx * cs - es, cy * cs - es, cs + es * 2, cs + es * 2);
        }
      }
      ctx.restore();
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
 *   mode: 'play' | 'view' | 'iron' | 'free',
 *   fused: bool(view 模式), ironed: 数组(iron 模式),
 *   numbers: Map(palIdx -> 序号),
 *   getSelected: () => palIdx,
 *   getTool: () => null | 'row' | 'erase'(free 模式橡皮),
 *   canSwipe: () => bool,  // play 模式：是否允许划动连续上豆；不允许时单指拖动改为平移（不传 = 允许）
 *   onPlace(i), onWrong(i), onToolTap(i), onIron(n), onErase(i)
 *   free 模式：cells 就是用户作品本身（可改写），点/划任意格上当前色，可覆盖换色；橡皮擦除。
 *   onExpand(cx, cy)：free 模式画到数据网格外时回调，页面负责扩容数组并调整 ox/oy，
 *   返回 true 表示已扩容（会重新取格）；无边平移，底板铺满视口。
 * }
 * 页面负责：查询 canvas 节点后 new BoardView(node, opts)，
 * 调 setViewport(w, h, dpr, left, top)，并把 touch 事件转发给 touchStart/Move/End。
 */
class BoardView {
  constructor(canvas, opts) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.o = opts;
    this.pal = palRGB(opts.palette); // 作品自定义色板（hex 数组）或全局色板
    this.fused = !!opts.fused;
    this.finish = opts.finish || SMOOTH; // 熨烫质感：grain 细腻纹理 / smooth 光滑平面
    this.hole = opts.hole; // 成品豆孔档位：none / small / large
    this.holeR = holeRatio(opts.hole);
    this.chart = !!opts.chart; // 图纸显示模式（view）
    this.locate = !!opts.locate; // 定位模式（play）：高亮当前色未拼格、其余变淡
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
  // 熨烫质感切换（熨烫页可在开烫前后随时换，画面即时反映）
  setFinish(v) { this.finish = v || SMOOTH; this.dirty = true; }
  // 成品豆孔大小切换（熨烫页选，已烫的融合豆即时反映）
  setHole(v) { this.hole = v; this.holeR = holeRatio(v); this.dirty = true; }
  // 图纸显示模式（view 模式用）：平色格 + 网格线，与分享/导出图纸同款观感
  setChart(v) { this.chart = !!v; this.dirty = true; }
  // 定位模式（play 模式用）：当前选中色的未拼格高亮红、其余变淡，方便找位置
  setLocate(v) { this.locate = !!v; this.dirty = true; }

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
  _minScale() {
    // 自由画布：视野最多约 200 格，保证 240 格渲染窗口始终盖得住屏幕
    if (this.o.mode === 'free') return Math.max(this.vw, this.vh) / 200;
    return clamp(this._fitScale() * 0.8, 1.5, 12);
  }

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
    if (this.o.mode === 'free') return; // 无边画布：平移不设限
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
      // free 模式按下先不落豆：等移动确认是划豆（双指随后落下则是缩放，抬起时轻点再补画）
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
    if (this.o.mode === 'play' && !tool && (!this.o.canSwipe || this.o.canSwipe())) {
      // 沿轨迹逐格上豆，避免快速滑动漏格
      const steps = Math.ceil(Math.hypot(dx, dy) / (this.scale * 0.4)) || 1;
      for (let i = 1; i <= steps; i++) {
        this._paintAt({ x: prev.x + dx * i / steps, y: prev.y + dy * i / steps }, false);
      }
    } else if (this.o.mode === 'free') {
      if (this.gesture && this.gesture.pinched) {
        // 双指缩放后余下的单指：只平移，不落豆
        this.ox += dx; this.oy += dy;
        this.dirty = true;
      } else if (this.gesture && (this.gesture.painted || this.gesture.moved >= 6)) {
        // 移动超过阈值才开始划豆（阈值内极小抖动不落豆，避免双指落下的瞬间误画）
        const steps = Math.ceil(Math.hypot(dx, dy) / (this.scale * 0.4)) || 1;
        for (let i = 1; i <= steps; i++) {
          this._paintFreeAt({ x: prev.x + dx * i / steps, y: prev.y + dy * i / steps });
        }
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
      // free 模式：确认是单指轻点（没变成缩放、没划动过）才补画按下的那一格
      if (this.o.mode === 'free' && !g.pinched && !g.painted && g.moved < 8) {
        this._paintFreeAt(g.start);
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

  // 自由画布：把当前色画进任意格（可覆盖换色）；橡皮工具则擦除。
  // 画到数据网格外时先让页面扩容再重新取格。
  _paintFreeAt(p) {
    let i = this.cellAt(p);
    if (i < 0 && this.o.onExpand) {
      const cx = Math.floor((p.x - this.ox) / this.scale);
      const cy = Math.floor((p.y - this.oy) / this.scale);
      if (this.o.onExpand(cx, cy)) i = this.cellAt(p);
    }
    if (i < 0) return;
    if (this.gesture) this.gesture.painted = true;
    const erase = this.o.getTool && this.o.getTool() === 'erase';
    if (erase) {
      if (this.o.cells[i] >= 0) {
        this.o.cells[i] = -1;
        this.o.placed[i] = 0;
        this.anims.delete(i);
        this.dirty = true;
        if (this.o.onErase) this.o.onErase(i);
      }
      return;
    }
    const sel = this.o.getSelected();
    if (sel == null || sel < 0) return;
    if (this.o.placed[i] && this.o.cells[i] === sel) return;
    const isNew = !this.o.placed[i];
    this.o.cells[i] = sel;
    this.o.placed[i] = 1;
    if (isNew) this.anims.set(i, now());
    this.dirty = true;
    if (this.o.onPlace) this.o.onPlace(i, isNew);
  }

  // 外部批量上豆（现仅调试一键完成在用），带级联动画；豆子多时压缩总时长
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

    const freeMode = this.o.mode === 'free';
    if (freeMode) {
      // 无边拼豆板：白板铺满视口，5 格虚线 / 10 格实线参考线（与实体板一致），圆钉随后逐格画
      ctx.fillStyle = '#FFFDF9';
      ctx.fillRect(0, 0, this.vw, this.vh);
      const wx0 = Math.floor(-ox / s) - 1, wx1 = Math.ceil((this.vw - ox) / s) + 1;
      const wy0 = Math.floor(-oy / s) - 1, wy1 = Math.ceil((this.vh - oy) / s) + 1;
      for (let gx = wx0; gx <= wx1; gx++) {
        if (gx % 5 !== 0) continue;
        const X = ox + gx * s;
        ctx.beginPath();
        if (gx % 10 !== 0) { ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(95,74,78,.10)'; ctx.lineWidth = 1; }
        else { ctx.setLineDash([]); ctx.strokeStyle = 'rgba(95,74,78,.22)'; ctx.lineWidth = 1.5; }
        ctx.moveTo(X, 0); ctx.lineTo(X, this.vh); ctx.stroke();
      }
      for (let gy = wy0; gy <= wy1; gy++) {
        if (gy % 5 !== 0) continue;
        const Y = oy + gy * s;
        ctx.beginPath();
        if (gy % 10 !== 0) { ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(95,74,78,.10)'; ctx.lineWidth = 1; }
        else { ctx.setLineDash([]); ctx.strokeStyle = 'rgba(95,74,78,.22)'; ctx.lineWidth = 1.5; }
        ctx.moveTo(0, Y); ctx.lineTo(this.vw, Y); ctx.stroke();
      }
      ctx.setLineDash([]);
      // 凸起圆钉铺满视口（数据网格外也画，纯视觉；缩太小时省略）
      if (s >= 9) {
        ctx.strokeStyle = 'rgba(95,74,78,.14)';
        ctx.lineWidth = Math.max(1, s * 0.05);
        const sq = BEAD_SHAPE !== 'round';
        for (let py2 = wy0; py2 <= wy1; py2++) {
          for (let px2 = wx0; px2 <= wx1; px2++) {
            if (px2 >= 0 && py2 >= 0 && px2 < w && py2 < h && placed[py2 * w + px2]) continue;
            const mx2 = ox + px2 * s + s / 2, my2 = oy + py2 * s + s / 2;
            if (sq) { const d = s * 0.32; ctx.strokeRect(mx2 - d / 2, my2 - d / 2, d, d); }
            else { ctx.beginPath(); ctx.arc(mx2, my2, s * 0.17, 0, 7); ctx.stroke(); }
          }
        }
      }
    } else {
      // 底板（像素风：右下掉落式硬投影 + 白底 + 靛墨描边）
      const pad = Math.max(6, s * 0.4);
      const bx = ox - pad, by = oy - pad, bw = w * s + pad * 2, bh = h * s + pad * 2;
      const br = Math.min(4, Math.max(2, s * 0.12));
      roundRect(ctx, bx + 5, by + 5, bw, bh, br);
      ctx.fillStyle = 'rgba(95,74,78,.14)'; ctx.fill();
      roundRect(ctx, bx, by, bw, bh, br);
      ctx.fillStyle = '#FFFFFF'; ctx.fill();
      ctx.strokeStyle = 'rgba(95,74,78,.85)'; ctx.lineWidth = 2; ctx.stroke();
    }

    // 可见范围裁剪
    const x0 = clamp(Math.floor((0 - ox) / s), 0, w - 1);
    const x1 = clamp(Math.ceil(this.vw / s - ox / s), 0, w - 1);
    const y0 = clamp(Math.floor((0 - oy) / s), 0, h - 1);
    const y1 = clamp(Math.ceil(this.vh / s - oy / s), 0, h - 1);

    const isPlay = this.o.mode === 'play';
    const isIron = this.o.mode === 'iron';
    const isFree = this.o.mode === 'free';
    const chartView = this.chart && !isPlay && !isIron && !isFree; // 图纸显示（view 模式）
    const ironed = this.o.ironed;
    const sel = isPlay ? this.o.getSelected() : -2;
    const locate = isPlay && this.locate; // 定位：高亮当前色未拼格、其余变淡
    const showNum = isPlay && !locate && s >= 15 && this.o.numbers;
    const showPeg = s >= 9;
    const tiny = s < 3.5; // 大画布缩到很小时改用方块填充，绕开圆弧/渐变的开销
    const fused = this.fused && !isPlay && !isIron && !chartView;
    const numFont = 'bold ' + Math.round(s * 0.4) + 'px sans-serif';
    // 熨好的格子先记下来，主循环跑完统一铺一遍质感贴片（一帧只设一次 fillStyle）
    const grainOn = this.finish !== SMOOTH && s >= GRAIN_MIN_PX && (fused || isIron);
    const gxs = this._gxs || (this._gxs = []); // 复用数组，避免每帧新建
    let gn = 0;

    if (showNum) {
      ctx.font = numFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }

    // 图纸显示：网格线铺满整板（每 5 格一条浅青参考线），空格露线、色格覆盖
    if (chartView) {
      for (let k = 0; k <= w; k++) {
        ctx.fillStyle = k % 5 === 0 ? '#C9E4DE' : '#E6E9EB';
        ctx.fillRect(ox + k * s - 0.5, oy, 1, h * s);
      }
      for (let k = 0; k <= h; k++) {
        ctx.fillStyle = k % 5 === 0 ? '#C9E4DE' : '#E6E9EB';
        ctx.fillRect(ox, oy + k * s - 0.5, w * s, 1);
      }
    }

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * w + cx;
        const tc = cells[i];
        const px = ox + cx * s, py = oy + cy * s;
        const mx = px + s / 2, my = py + s / 2;
        if (showPeg && !fused && !isFree && !chartView) { // 自由模式的钉在背景块里铺满视口画过了；图纸模式无蒙孔
          ctx.fillStyle = 'rgba(95,74,78,.10)';
          if (BEAD_SHAPE === 'round') {
            ctx.beginPath(); ctx.arc(mx, my, Math.max(1, s * 0.06), 0, 7); ctx.fill();
          } else {
            const d = Math.max(1, s * 0.12);
            ctx.fillRect(mx - d / 2, my - d / 2, d, d);
          }
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
          const rgbT = this.pal[tc];
          if (chartView) {
            // 图纸显示：平色格（无孔无高光），与分享/导出图纸同款
            ctx.fillStyle = css(rgbT);
            ctx.fillRect(px, py, s, s);
          }
          else if (isIron) {
            if (ironed[i]) {
              const m0 = this.ironAnims.get(i);
              if (m0 == null) { drawFused(ctx, px, py, s, rgbT, this.holeR); if (grainOn) { gxs[gn++] = px; gxs[gn++] = py; } }
              else {
                const k = (t - m0) / 260;
                if (k < 0) drawBead(ctx, mx, my, r, rgbT); // 级联还没轮到
                else if (k >= 1) {
                  this.ironAnims.delete(i);
                  drawFused(ctx, px, py, s, rgbT, this.holeR);
                  if (grainOn) { gxs[gn++] = px; gxs[gn++] = py; }
                } else {
                  // 熔化：豆子摊开淡出，熔块淡入（纹理随熔块一起淡入）
                  drawBead(ctx, mx, my, r * (1 + 0.12 * k), rgbT, 1 - k);
                  ctx.globalAlpha = k;
                  drawFused(ctx, px, py, s, rgbT, this.holeR);
                  ctx.globalAlpha = 1;
                }
              }
            } else drawBead(ctx, mx, my, r, rgbT);
          }
          else if (fused) { drawFused(ctx, px, py, s, rgbT, this.holeR); if (grainOn) { gxs[gn++] = px; gxs[gn++] = py; } }
          else if (tiny) { ctx.fillStyle = css(rgbT); ctx.globalAlpha = locate ? 0.4 : 1; ctx.fillRect(px, py, s, s); ctx.globalAlpha = 1; }
          else drawBead(ctx, mx, my, r, rgbT, locate ? 0.4 : 1); // 定位模式：已拼豆淡下去，让红色目标更跳
        } else if (isPlay) {
          const isSel = tc === sel;
          const rgb = this.pal[tc];
          if (locate) {
            // 定位模式：当前色未拼格 = "现在要拼的地方" → 高亮红；其余未拼格淡成影子
            if (isSel) {
              if (tiny) {
                ctx.fillStyle = LOCATE_RED; ctx.fillRect(px, py, s, s);
              } else if (BEAD_SHAPE === 'round') {
                ctx.beginPath(); ctx.arc(mx, my, s * 0.42, 0, 7);
                ctx.fillStyle = LOCATE_RED; ctx.fill();
              } else {
                const gs = s * 0.82;
                ctx.fillStyle = LOCATE_RED;
                ctx.fillRect(mx - gs / 2, my - gs / 2, gs, gs);
              }
              if (s >= 8) {
                ctx.strokeStyle = LOCATE_EDGE;
                ctx.lineWidth = Math.max(1, s * 0.07);
                if (BEAD_SHAPE === 'round') {
                  ctx.beginPath(); ctx.arc(mx, my, s * 0.42, 0, 7); ctx.stroke();
                } else {
                  const ds = s * 0.82;
                  ctx.strokeRect(mx - ds / 2, my - ds / 2, ds, ds);
                }
              }
            } else {
              ctx.globalAlpha = 0.1;
              const gs = s * 0.7;
              ctx.fillStyle = css(rgb);
              ctx.fillRect(mx - gs / 2, my - gs / 2, gs, gs);
              ctx.globalAlpha = 1;
            }
          } else {
            ctx.globalAlpha = isSel ? 0.5 : 0.2;
            if (tiny) {
              ctx.fillStyle = css(rgb); ctx.fillRect(px, py, s, s);
            } else if (BEAD_SHAPE === 'round') {
              ctx.beginPath(); ctx.arc(mx, my, s * 0.38, 0, 7);
              ctx.fillStyle = css(rgb); ctx.fill();
            } else {
              const gs = s * 0.76;
              ctx.fillStyle = css(rgb);
              ctx.fillRect(mx - gs / 2, my - gs / 2, gs, gs);
            }
            ctx.globalAlpha = 1;
            if (isSel && s >= 8) {
              ctx.setLineDash([s * 0.16, s * 0.13]);
              ctx.strokeStyle = css(mix(rgb, BLACK, 0.3), 0.75);
              ctx.lineWidth = Math.max(1, s * 0.06);
              if (BEAD_SHAPE === 'round') {
                ctx.beginPath(); ctx.arc(mx, my, s * 0.42, 0, 7); ctx.stroke();
              } else {
                const ds = s * 0.84;
                ctx.strokeRect(mx - ds / 2, my - ds / 2, ds, ds);
              }
              ctx.setLineDash([]);
            }
            if (showNum) {
              const n = this.o.numbers.get(tc);
              if (n != null) {
                ctx.fillStyle = 'rgba(95,74,78,.8)';
                ctx.fillText(String(n), mx, my + s * 0.02);
                ctx.font = numFont;
              }
            }
          }
        }
      }
    }

    // 熨烫质感：给已熔合的格子统一铺颗粒纹理。
    // 贴片跟着图纸原点平移，平移/缩放时纹理不会在画面上"游"
    if (grainOn && gn) {
      const pat = grainPattern(ctx);
      if (pat) {
        const e = s * 0.06;
        const kk = s / GRAIN_UNIT;
        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(kk, kk);
        ctx.fillStyle = pat;
        const cs = s / kk, es = e / kk;
        for (let k = 0; k < gn; k += 2) {
          ctx.fillRect((gxs[k] - ox) / kk - es, (gxs[k + 1] - oy) / kk - es, cs + es * 2, cs + es * 2);
        }
        ctx.restore();
      }
    }

    // 放错提示红框（像素风：外扩的方框）
    if (this.wrongFx) {
      const k = (t - this.wrongFx.t0) / 320;
      if (k >= 1) this.wrongFx = null;
      else {
        const i = this.wrongFx.i;
        const mx = ox + (i % w) * s + s / 2, my = oy + Math.floor(i / w) * s + s / 2;
        ctx.strokeStyle = 'rgba(217,115,127,' + (1 - k) + ')';
        ctx.lineWidth = Math.max(1.5, s * 0.09);
        if (BEAD_SHAPE === 'round') {
          ctx.beginPath(); ctx.arc(mx, my, s * (0.42 + 0.3 * k), 0, 7); ctx.stroke();
        } else {
          const ws = s * (0.84 + 0.6 * k);
          ctx.strokeRect(mx - ws / 2, my - ws / 2, ws, ws);
        }
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
        const sr = sp.r * (1 + 1.8 * kk);
        ctx.fillStyle = 'rgba(255,255,255,' + (0.38 * (1 - kk)) + ')';
        ctx.fillRect(x - sr, y - sr, sr * 2, sr * 2);
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
  bg.addColorStop(0, '#C9838F');
  bg.addColorStop(0.5, '#E8B4BC');
  bg.addColorStop(1, '#B06B77');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.restore();
  // 手柄
  roundRect(ctx, -w * 0.38, -s * 0.04, w * 0.76, s * 0.2, s * 0.1);
  ctx.fillStyle = '#5F4A4E';
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

module.exports = {
  drawBead, patternSize, drawPatternInto, renderPatternTo, BoardView,
  getBeadShape, setBeadShape, workFinish, workHole,
};
