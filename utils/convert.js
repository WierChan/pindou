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
// longSide = 长边豆子数；透明像素留空；whiteEmpty 时「和四边连通的白」留空（适合白底图；
// 被描边围住的白——婚纱、头纱、白衬衫——是主体，不动。以前按颜色全局判空把这些一起抠掉了）
function imageToPattern(data, iw, ih, longSide, opts) {
  const whiteEmpty = !!(opts && opts.whiteEmpty);
  const wbg = whiteEmpty ? whiteMask(data, iw, ih) : null;
  const enhance = !opts || opts.enhance !== false;
  let w, h;
  if (iw >= ih) { w = longSide; h = Math.max(1, Math.round(longSide * ih / iw)); }
  else { h = longSide; w = Math.max(1, Math.round(longSide * iw / ih)); }
  const cells = new Array(w * h).fill(-1);
  for (let cy = 0; cy < h; cy++) {
    const y0 = Math.floor(cy * ih / h), y1 = Math.max(y0 + 1, Math.floor((cy + 1) * ih / h));
    for (let cx = 0; cx < w; cx++) {
      const x0 = Math.floor(cx * iw / w), x1 = Math.max(x0 + 1, Math.floor((cx + 1) * iw / w));
      let sr = 0, sg = 0, sb = 0, sa = 0, n = 0, nw = 0;
      for (let y = y0; y < y1; y++) {
        let o = (y * iw + x0) * 4, i = y * iw + x0;
        for (let x = x0; x < x1; x++, o += 4, i++) {
          const a = data[o + 3];
          if (a) {
            sr += S2L[data[o]] * a;
            sg += S2L[data[o + 1]] * a;
            sb += S2L[data[o + 2]] * a;
            sa += a;
          }
          if (wbg && wbg[i]) nw++;
          n++;
        }
      }
      if (sa / n < 80) continue; // 基本透明 → 不放豆子
      if (wbg && nw * 2 >= n) continue; // 这格一半以上是「连通四边的白背景」→ 留空
      const af = sa / (n * 255);
      // 线性空间平均值，半透明部分按白底（线性=1）合成
      let lr = sr / sa, lg = sg / sa, lb = sb / sa;
      lr = lr * af + (1 - af); lg = lg * af + (1 - af); lb = lb * af + (1 - af);
      let r = l2s(lr), g = l2s(lg), b = l2s(lb);
      if (enhance) {
        const e = boost(r, g, b);
        r = e[0]; g = e[1]; b = e[2];
      }
      cells[cy * w + cx] = nearestPalette(r, g, b);
    }
  }
  return { w, h, cells };
}

/* ---------- 端上轻量去背景（无 AI，纯本地）----------
   思路：背景 = 「颜色接近四边上出现的某种颜色、且和四边 4 邻接连通」的像素。
   ❶ 先剥掉贴边的纯色行/列（截图黑边、相框、大片空白），最多各边 25%；
   ❷ 内框四边的颜色贪心聚成 ≤4 簇（白底 + 红囍这类多色背景都认；零星像素不成簇，主体描边碰到边不会当背景色）；
   ❸ 从内框四边漫水：像素接近任一簇色（单通道差 ≤ 该簇容差 28~48）就并入；
   ❹ 结果再外扩 1px，吃掉两种背景色接缝处的反锯齿混色（否则红囍周围留一圈粉边豆）。
   以前用「四边均值 + 一个大容差(≤90)」：四边一混色（白底 + 黑边）均值就是灰，要么什么都圈不到，
   要么容差放到 90 把肤色/浅色顺着连通一路吞进人物——用户报「去掉背景会把人身体去掉一部分」。
   固有局限不变：主体贴四边、主体与背景同色会抠不干净。透明边（emoji）返回全 0 不处理。 */
const A_MIN = 128; // 够不透明才参与背景判断

// 剥贴边纯色行/列：从各边向内，整行/整列 ≥95% 像素与该行均色单通道差 ≤24 就算纯色，连续剥到不纯为止（各边最多 25%）
function peelFrame(data, iw, ih) {
  const uniformRow = (y, x0, x1) => uniformLine(data, iw, x0, x1, y, y + 1);
  const uniformCol = (x, y0, y1) => uniformLine(data, iw, x, x + 1, y0, y1);
  let x0 = 0, y0 = 0, x1 = iw, y1 = ih;
  const maxY = Math.floor(ih * 0.25), maxX = Math.floor(iw * 0.25);
  while (y0 < maxY && uniformRow(y0, x0, x1)) y0++;
  while (ih - y1 < maxY && uniformRow(y1 - 1, x0, x1)) y1--;
  while (x0 < maxX && uniformCol(x0, y0, y1)) x0++;
  while (iw - x1 < maxX && uniformCol(x1 - 1, y0, y1)) x1--;
  return { x0, y0, x1, y1 };
}
function uniformLine(data, iw, x0, x1, y0, y1) {
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * iw + x) * 4; if (data[o + 3] < A_MIN) return false; sr += data[o]; sg += data[o + 1]; sb += data[o + 2]; n++; }
  if (!n) return false;
  const cr = sr / n, cg = sg / n, cb = sb / n;
  let ok = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * iw + x) * 4;
    if (Math.abs(data[o] - cr) <= 24 && Math.abs(data[o + 1] - cg) <= 24 && Math.abs(data[o + 2] - cb) <= 24) ok++;
  }
  return ok >= n * 0.95;
}
// 遍历矩形四边一圈的像素下标（x0..x1-1, y0..y1-1）
function ringEach(iw, r, fn) {
  for (let x = r.x0; x < r.x1; x++) { fn(r.y0 * iw + x); if (r.y1 - 1 > r.y0) fn((r.y1 - 1) * iw + x); }
  for (let y = r.y0 + 1; y < r.y1 - 1; y++) { fn(y * iw + r.x0); if (r.x1 - 1 > r.x0) fn(y * iw + r.x1 - 1); }
}
// 四边颜色贪心聚类：单通道差 ≤40 归同簇（均值在线更新）；每簇容差按簇内离散度 28~48
// 只采平坦像素：与 4 邻居任一通道差 >16 的是边缘/接缝（白↔红过渡带），颜色是混出来的，不能当背景色
function flatAt(data, iw, ih, i) {
  const o = i * 4, x = i % iw, y = (i / iw) | 0;
  const R = data[o], G = data[o + 1], B = data[o + 2];
  const chk = j => { const q = j * 4; return Math.abs(data[q] - R) <= 16 && Math.abs(data[q + 1] - G) <= 16 && Math.abs(data[q + 2] - B) <= 16; };
  return (x === 0 || chk(i - 1)) && (x === iw - 1 || chk(i + 1)) && (y === 0 || chk(i - iw)) && (y === ih - 1 || chk(i + iw));
}
function ringClusters(data, iw, ih, r) {
  const cl = []; // {r,g,b,n,dev}
  let total = 0;
  ringEach(iw, r, i => {
    const o = i * 4;
    if (data[o + 3] < A_MIN) return;
    total++;
    if (!flatAt(data, iw, ih, i)) return;
    const R = data[o], G = data[o + 1], B = data[o + 2];
    let best = null, bd = 41;
    for (let k = 0; k < cl.length; k++) {
      const c = cl[k];
      const d = Math.max(Math.abs(R - c.r), Math.abs(G - c.g), Math.abs(B - c.b));
      if (d < bd) { bd = d; best = c; }
    }
    if (best) { best.n++; best.r += (R - best.r) / best.n; best.g += (G - best.g) / best.n; best.b += (B - best.b) / best.n; best.dev += bd; }
    else cl.push({ r: R, g: G, b: B, n: 1, dev: 0 });
  });
  // 占比 <4% 的零星色不算；簇内平均偏差 >18 的是接缝过渡色攒出来的「假簇」（容差还大，会顺着连通吞掉中间调），也不算
  return cl.filter(c => c.n >= total * 0.04 && c.dev / c.n <= 18).sort((a, b) => b.n - a.n).slice(0, 4)
    .map(c => ({ r: c.r, g: c.g, b: c.b, tol: Math.max(28, Math.min(48, 20 + (c.dev / c.n) * 2.4)) }));
}
// 4 邻接漫水：从 seeds 起，near(i) 为真的像素并入 mask（每格最多入栈一次）
function flood(mask, iw, ih, seeds, near) {
  const stack = new Int32Array(iw * ih);
  let sp = 0;
  const push = i => { if (!mask[i] && near(i)) { mask[i] = 1; stack[sp++] = i; } };
  seeds(push);
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % iw, y = (i / iw) | 0;
    if (x > 0) push(i - 1);
    if (x < iw - 1) push(i + 1);
    if (y > 0) push(i - iw);
    if (y < ih - 1) push(i + iw);
  }
}
// 返回 mask（1=背景）。data 为 RGBA、iw×ih。
function bgMask(data, iw, ih) {
  const N = iw * ih;
  const mask = new Uint8Array(N);
  let cnt = 0;
  ringEach(iw, { x0: 0, y0: 0, x1: iw, y1: ih }, i => { if (data[i * 4 + 3] >= A_MIN) cnt++; });
  if (cnt < iw + ih) return mask; // 边缘大多透明（如 emoji）→ 不做背景处理
  const r = peelFrame(data, iw, ih);
  const cls = ringClusters(data, iw, ih, r);
  if (!cls.length) return mask;
  const near = i => {
    const o = i * 4;
    if (data[o + 3] < A_MIN) return false;
    const R = data[o], G = data[o + 1], B = data[o + 2];
    for (let k = 0; k < cls.length; k++) {
      const c = cls[k];
      if (Math.abs(R - c.r) <= c.tol && Math.abs(G - c.g) <= c.tol && Math.abs(B - c.b) <= c.tol) return true;
    }
    return false;
  };
  flood(mask, iw, ih, push => ringEach(iw, r, push), near);
  // 剥掉的边框整体算背景
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) if (x < r.x0 || x >= r.x1 || y < r.y0 || y >= r.y1) mask[y * iw + x] = 1;
  dilate1(mask, iw, ih);
  return mask;
}
// mask 外扩 1px（4 邻接）：吃掉背景边缘的反锯齿混色
function dilate1(mask, iw, ih) {
  const src = mask.slice();
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
    const i = y * iw + x;
    if (src[i]) continue;
    if ((x > 0 && src[i - 1]) || (x < iw - 1 && src[i + 1]) || (y > 0 && src[i - iw]) || (y < ih - 1 && src[i + iw])) mask[i] = 1;
  }
}

// 「白色背景不拼豆」用的白背景 mask：近白（三通道 ≥238）且和四边连通的像素（1=白背景）。
// 种子取四边向内一小圈（截图常带 1~2px 黑边/灰缝，只看最外一圈会没种子）。
// 按源像素数组缓存：同一张图改大小/开关反复调用不重跑漫水（去背景只改 alpha，不影响本判定）
const whiteMaskCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
function whiteMask(data, iw, ih) {
  if (whiteMaskCache && whiteMaskCache.has(data)) return whiteMaskCache.get(data);
  const mask = new Uint8Array(iw * ih);
  const near = i => { const o = i * 4; return data[o + 3] >= A_MIN && data[o] >= 238 && data[o + 1] >= 238 && data[o + 2] >= 238; };
  const band = Math.max(2, Math.round(Math.min(iw, ih) * 0.01));
  flood(mask, iw, ih, push => {
    for (let k = 0; k < band && k < Math.min(iw, ih) / 2; k++) ringEach(iw, { x0: k, y0: k, x1: iw - k, y1: ih - k }, push);
  }, near);
  if (whiteMaskCache) whiteMaskCache.set(data, mask);
  return mask;
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

module.exports = { rgb2oklab, nearestPalette, loadImageToData, emojiToData, imageToPattern, bgMask, whiteMask, colorStats, reduceColors, resampleCells, variantPal, variantCount };
module.exports._bgInternals = { peelFrame, ringClusters };
