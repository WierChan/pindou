// 图片 → 拼豆图纸：线性光空间降采样（降低像素）+ 增强 + OKLab 感知空间最近色匹配
const { PALETTE_RGB } = require('./palette');

/* ---------- sRGB <-> 线性光 ---------- */
// 查表加速：sRGB 0-255 → 线性 0-1
const S2L = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  S2L[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
const s2l = v => S2L[v < 0 ? 0 : v > 255 ? 255 : Math.round(v)];
// 线性 0-1 → sRGB 0-255
function l2s(v) {
  v = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(v * 255)));
}

function rgb2oklab(r, g, b) {
  const lr = s2l(r), lg = s2l(g), lb = s2l(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

const PAL_LAB = PALETTE_RGB.map(rgb => rgb2oklab(rgb[0], rgb[1], rgb[2]));

// L 升序索引：最近色搜索从 L 最接近处向两侧展开，某侧 |ΔL|² 已 ≥ 当前最优就整侧剪掉
// （L 差只增不减，剪枝精确无损）。色板扩到 221 色后 256 大板逐格全扫在真机（无 JIT）
// 要多花约 1s，剪枝后平均只访问 ~20 个候选
const PAL_ORDER = PAL_LAB.map((p, i) => i).sort((a, b) => PAL_LAB[a][0] - PAL_LAB[b][0]);
const PAL_L = PAL_ORDER.map(i => PAL_LAB[i][0]);

// OKLab 三元组 → 最近的色板下标（L 排序 + 亚像素剪枝）
function nearestLab(L, A, B) {
  let lo = 0, hi = PAL_L.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (PAL_L[mid] < L) lo = mid + 1; else hi = mid; }
  let bi = 0, bd = Infinity;
  let up = lo, down = lo - 1;
  while (up < PAL_L.length || down >= 0) {
    const du = up < PAL_L.length ? PAL_L[up] - L : Infinity;
    const dd = down >= 0 ? L - PAL_L[down] : Infinity;
    const useUp = du <= dd;
    const dl = useUp ? du : dd;
    if (dl * dl >= bd) break; // 两侧 L 差都不会再变小，剩余候选必然更远
    const idx = PAL_ORDER[useUp ? up++ : down--];
    const p = PAL_LAB[idx];
    const dL = L - p[0], da = A - p[1], db = B - p[2];
    const d = dL * dL + da * da + db * db; // OKLab 本身已是感知均匀，直接欧氏距离
    if (d < bd) { bd = d; bi = idx; }
  }
  return bi;
}
function nearestPalette(r, g, b) {
  const lab = rgb2oklab(r, g, b);
  return nearestLab(lab[0], lab[1], lab[2]);
}

/* ---------- 一键换色：整套「不一样但近似」的配色变体 ----------
   在 OKLab 上对每个色做同一种变换（移相 / 增艳 / 变柔…），再各自映射回最近的实体豆色。
   整体一致地平移，成品仍认得出原图，只是换了一套色。vi=0 原样，1..N 各套变体，循环。*/
function _rotHue(lab, deg) {
  const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  return [lab[0], lab[1] * c - lab[2] * s, lab[1] * s + lab[2] * c];
}
// 只保留一套「不一样但近似」的配色：整体略偏暖移相 + 微增艳，成品明显换色又不违和
const COLOR_VARIANTS = [
  lab => _rotHue([lab[0], lab[1] * 1.12, lab[2] * 1.12], -24),
];
function variantCount() { return COLOR_VARIANTS.length; }
function variantPal(pal, vi) {
  const n = COLOR_VARIANTS.length;
  const k = ((vi % (n + 1)) + (n + 1)) % (n + 1); // 0..n
  if (k === 0) return pal;
  const nl = COLOR_VARIANTS[k - 1](PAL_LAB[pal]);
  return nearestLab(nl[0], nl[1], nl[2]);
}

// 轻微对比 + 饱和度提升：弥补降采样平均造成的发灰，让拼豆成品更接近原图观感
function boost(r, g, b) {
  const ct = v => 128 + (v - 128) * 1.1;
  r = ct(r); g = ct(g); b = ct(b);
  const m = 0.299 * r + 0.587 * g + 0.114 * b; // 围绕亮度拉饱和，保住色相
  const k = 1.3;
  const f = v => Math.min(255, Math.max(0, Math.round(m + (v - m) * k)));
  return [f(r), f(g), f(b)];
}

// 把图片文件解码后读出像素（借用一块 2d canvas）
// maxSide 由调用方决定：图片转图纸用 512 —— 真机上解码/读回/重采样都快一个量级，
// 且对 ≤256 豆的画布每格仍有 ≥2×2 采样；不大于 maxSide 的小图不缩放（像素画 1:1 还原）
// rect：可选的归一化源区裁剪 {x, y, w, h}（0~1，裁剪弹窗的输出），只解码框内部分
function loadImageToData(canvas, src, maxSide, rect) {
  maxSide = maxSide || 2048;
  return new Promise((resolve, reject) => {
    const img = canvas.createImage();
    img.onload = () => {
      try {
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (rect) {
          sx = Math.max(0, Math.round(img.width * rect.x));
          sy = Math.max(0, Math.round(img.height * rect.y));
          sw = Math.max(1, Math.min(img.width - sx, Math.round(img.width * rect.w)));
          sh = Math.max(1, Math.min(img.height - sy, Math.round(img.height * rect.h)));
        }
        const k = Math.min(1, maxSide / Math.max(sw, sh));
        const w = Math.max(1, Math.round(sw * k));
        const h = Math.max(1, Math.round(sh * k));
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = true;
        try { ctx.imageSmoothingQuality = 'high'; } catch (e) { /* 部分内核不支持 */ }
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h);
        resolve({ data: d.data, w, h });
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

// 把 emoji 画到 canvas 上并读出像素（走图片转图纸同一条管线）
function emojiToData(canvas, ch) {
  const S = 256;
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, S, S);
  ctx.font = '208px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, S / 2, S / 2 + 12);
  const d = ctx.getImageData(0, 0, S, S);
  return { data: d.data, w: S, h: S };
}

// 降低像素：每个拼豆格 = 源图对应区域在线性光空间的加权平均（预乘 alpha）
// longSide = 长边豆子数；透明像素留空；whiteEmpty 时近白色也留空（适合白底图）
function imageToPattern(data, iw, ih, longSide, opts) {
  const whiteEmpty = !!(opts && opts.whiteEmpty);
  const enhance = !opts || opts.enhance !== false;
  let w, h;
  if (iw >= ih) { w = longSide; h = Math.max(1, Math.round(longSide * ih / iw)); }
  else { h = longSide; w = Math.max(1, Math.round(longSide * iw / ih)); }
  const cells = new Array(w * h).fill(-1);
  for (let cy = 0; cy < h; cy++) {
    const y0 = Math.floor(cy * ih / h), y1 = Math.max(y0 + 1, Math.floor((cy + 1) * ih / h));
    for (let cx = 0; cx < w; cx++) {
      const x0 = Math.floor(cx * iw / w), x1 = Math.max(x0 + 1, Math.floor((cx + 1) * iw / w));
      let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        let o = (y * iw + x0) * 4;
        for (let x = x0; x < x1; x++, o += 4) {
          const a = data[o + 3];
          if (a) {
            sr += S2L[data[o]] * a;
            sg += S2L[data[o + 1]] * a;
            sb += S2L[data[o + 2]] * a;
            sa += a;
          }
          n++;
        }
      }
      if (sa / n < 80) continue; // 基本透明 → 不放豆子
      const af = sa / (n * 255);
      // 线性空间平均值，半透明部分按白底（线性=1）合成
      let lr = sr / sa, lg = sg / sa, lb = sb / sa;
      lr = lr * af + (1 - af); lg = lg * af + (1 - af); lb = lb * af + (1 - af);
      let r = l2s(lr), g = l2s(lg), b = l2s(lb);
      if (enhance) {
        const e = boost(r, g, b);
        r = e[0]; g = e[1]; b = e[2];
      }
      if (whiteEmpty && r >= 242 && g >= 242 && b >= 242) continue;
      cells[cy * w + cx] = nearestPalette(r, g, b);
    }
  }
  return { w, h, cells };
}

// 统计每种颜色的豆子数，按色板顺序返回 [{pal, count}]
function colorStats(cells) {
  const m = new Map();
  for (const t of cells) if (t >= 0) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(e => ({ pal: e[0], count: e[1] }));
}

// 把图纸用色缩减到 n 种（n >= 2）：反复把数量最少的颜色并入 OKLab 最相近的存活色
function reduceColors(cells, n) {
  n = Math.max(2, n | 0);
  const alive = new Map(); // pal -> count
  for (const t of cells) if (t >= 0) alive.set(t, (alive.get(t) || 0) + 1);
  if (alive.size <= n) return cells;
  const remap = new Map();
  while (alive.size > n) {
    // 数量最少的颜色
    let minPal = -1, minC = Infinity;
    for (const [p, c] of alive) if (c < minC) { minC = c; minPal = p; }
    // 找最相近的存活色并入
    const lab = PAL_LAB[minPal];
    let best = -1, bd = Infinity;
    for (const [p] of alive) {
      if (p === minPal) continue;
      const q = PAL_LAB[p];
      const dl = lab[0] - q[0], da = lab[1] - q[1], db = lab[2] - q[2];
      const d = dl * dl + da * da + db * db;
      if (d < bd) { bd = d; best = p; }
    }
    alive.set(best, alive.get(best) + alive.get(minPal));
    alive.delete(minPal);
    remap.set(minPal, best);
  }
  // 展平映射链（A→B→C 归到 C）
  const resolve = p => { while (remap.has(p)) p = remap.get(p); return p; };
  return cells.map(t => (t >= 0 ? resolve(t) : -1));
}

// 把 cells 网格从 (w,h) 重采样到长边 = longSide 的新网格，保留色板下标（不重新量化）。
// 缩小：每个新格取覆盖区域里出现最多的格（含空格一起竞争，保住图案疏密）；放大：最近邻。
// 用于没有原图的作品（模板 / 图纸导入）改大小——放大会变糊、缩小会并色，属预期效果。
function resampleCells(cells, w, h, longSide) {
  const k = longSide / Math.max(w, h);
  const nw = Math.max(1, Math.round(w * k));
  const nh = Math.max(1, Math.round(h * k));
  const out = new Array(nw * nh);
  for (let ny = 0; ny < nh; ny++) {
    const y0 = Math.floor(ny * h / nh), y1 = Math.min(h, Math.max(y0 + 1, Math.floor((ny + 1) * h / nh)));
    for (let nx = 0; nx < nw; nx++) {
      const x0 = Math.floor(nx * w / nw), x1 = Math.min(w, Math.max(x0 + 1, Math.floor((nx + 1) * w / nw)));
      const count = new Map();
      let best = -1, bestN = -1;
      for (let oy = y0; oy < y1; oy++) {
        for (let ox = x0; ox < x1; ox++) {
          const c = cells[oy * w + ox];
          const n = (count.get(c) || 0) + 1;
          count.set(c, n);
          if (n > bestN) { bestN = n; best = c; }
        }
      }
      out[ny * nw + nx] = best;
    }
  }
  return { w: nw, h: nh, cells: out };
}

module.exports = { rgb2oklab, nearestPalette, loadImageToData, emojiToData, imageToPattern, colorStats, reduceColors, resampleCells, variantPal, variantCount };
