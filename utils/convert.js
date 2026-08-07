// 图片 → 拼豆图纸：降采样 + OKLab 感知空间最近色匹配
const { PALETTE_RGB } = require('./palette');

function s2l(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }

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

function nearestPalette(r, g, b) {
  const lab = rgb2oklab(r, g, b);
  let bi = 0, bd = Infinity;
  for (let i = 0; i < PAL_LAB.length; i++) {
    const p = PAL_LAB[i];
    const dl = lab[0] - p[0], da = lab[1] - p[1], db = lab[2] - p[2];
    const d = dl * dl * 1.2 + da * da + db * db; // 亮度差略加权，保住明暗关系
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

// 把图片文件解码并降采样后读出像素（借用一块 2d canvas）
function loadImageToData(canvas, src, maxSide) {
  maxSide = maxSide || 1024;
  return new Promise((resolve, reject) => {
    const img = canvas.createImage();
    img.onload = () => {
      try {
        const k = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * k));
        const h = Math.max(1, Math.round(img.height * k));
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
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

// longSide = 长边豆子数；透明像素留空；whiteEmpty 时近白色也留空（适合白底图）
function imageToPattern(data, iw, ih, longSide, opts) {
  const whiteEmpty = !!(opts && opts.whiteEmpty);
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
          sr += data[o] * a; sg += data[o + 1] * a; sb += data[o + 2] * a;
          sa += a; n++;
        }
      }
      if (sa / n < 80) continue; // 基本透明 → 不放豆子
      const af = sa / (n * 255);
      let r = sr / sa, g = sg / sa, b = sb / sa;
      // 半透明部分按白底合成
      r = r * af + 255 * (1 - af); g = g * af + 255 * (1 - af); b = b * af + 255 * (1 - af);
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

module.exports = { rgb2oklab, nearestPalette, loadImageToData, emojiToData, imageToPattern, colorStats };
