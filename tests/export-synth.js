// utils/share.js buildChartExportTo 的像素级镜像：往返闭环回归用（Node 无 canvas，
// 用 chart-synth 的 fill/fakeText 复刻同一版式）。
// 版式常量（P/HEADER/COORD/CARD_PAD/INFO_H/PILL_H/PILL_GAP/FOOT、cellPx 取法、
// scale 上限公式、格线/底色色值）与 share.js 逐项一致 —— share.js 改版式必须同步这里。
const { img, fill, fakeText, mulberry32 } = require('./chart-synth.js');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hex2rgb = hx => [parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16)];

function makeAppExport(cells, w, h, paletteHex, opts) {
  opts = opts || {};
  const maxSide = opts.maxSide || 1600;
  const cellPx = clamp(Math.floor(maxSide / Math.max(w, h)), 12, 32);
  // share.js 真实规则是「按最宽色号实测缩字号，塞不下不印」；镜像没有字体，
  // 用 cellPx>=10 近似（M 用例 cellPx=32 两边都印，笔画应力与真实 2-3 字符色号相当）
  const labelOn = cellPx >= 10;

  // 色号统计（画图例用；顺序对像素校验无影响）
  const cnt = new Map();
  for (const t of cells) if (t >= 0) cnt.set(t, (cnt.get(t) || 0) + 1);
  const stats = [...cnt.entries()].map(([pal, count]) => ({ pal, count }));

  const P = 30, HEADER = 56, COORD = 30, CARD_PAD = 14;
  const INFO_H = 46, PILL_H = 42, PILL_GAP = 12, FOOT = 54;
  const gridW = w * cellPx, gridH = h * cellPx;
  const cardW = gridW + CARD_PAD * 2, cardH = gridH + CARD_PAD * 2;
  const lgCols = Math.min(5, stats.length);
  const lgMinW = lgCols ? lgCols * 110 + (lgCols - 1) * PILL_GAP : 0;
  const W = Math.max(COORD * 2 + cardW, lgMinW, 430) + P * 2;
  const CW = W - P * 2;
  const cardX = (W - cardW) / 2;
  const cardY = P + HEADER + COORD;
  const gridX = cardX + CARD_PAD, gridY = cardY + CARD_PAD;
  const infoY = cardY + cardH + COORD + 8;
  const lgY = infoY + INFO_H;
  const lgRows = lgCols ? Math.ceil(stats.length / lgCols) : 0;
  const lgH = lgRows ? lgRows * PILL_H + (lgRows - 1) * PILL_GAP : 0;
  const H = lgY + lgH + FOOT;
  const scale = Math.min(opts.scale || 2, 4050 / Math.max(W, H));

  const S = v => Math.round(v * scale);
  const lw = Math.max(1, Math.round(scale)); // 1 逻辑像素线宽
  const im = img(S(W), S(H), [251, 245, 236]); // #FBF5EC
  const rnd = mulberry32(opts.seed || 77);
  const TEXT = [165, 151, 149], DARK = [95, 74, 78];

  // 头部：品牌豆块 + 标题 + 日期（伪文字）
  fill(im, S(P + 8), S(P + 10), S(52), S(32), [234, 191, 195]);
  fakeText(im, S(P + 78), S(P + 12), S(250), S(30), DARK, rnd, 0.22);
  fakeText(im, S(W - P - 110), S(P + 18), S(100), S(20), TEXT, rnd, 0.16);

  // 白卡片（镜像用直角；真图圆角 14px 的角部差异对白底区定位无影响）
  fill(im, S(cardX), S(cardY), S(cardW), S(cardH), [255, 255, 255]);
  const BAND = Math.min(w, h) < 12 ? [245, 245, 245] : [217, 217, 217];
  fill(im, S(gridX), S(gridY - COORD), S(gridW), S(COORD), BAND);
  fill(im, S(gridX), S(gridY + gridH), S(gridW), S(COORD), BAND);
  fill(im, S(gridX - COORD), S(gridY), S(COORD), S(gridH), BAND);
  fill(im, S(gridX + gridW), S(gridY), S(COORD), S(gridH), BAND);
  fill(im, S(gridX - COORD), S(gridY - COORD), S(COORD), S(COORD), BAND);
  fill(im, S(gridX + gridW), S(gridY - COORD), S(COORD), S(COORD), BAND);
  fill(im, S(gridX - COORD), S(gridY + gridH), S(COORD), S(COORD), BAND);
  fill(im, S(gridX + gridW), S(gridY + gridH), S(COORD), S(COORD), BAND);

  // 平色格
  const rgbOf = t => hex2rgb(paletteHex[t]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = cells[y * w + x];
      if (t < 0) continue;
      const x0 = S(gridX + x * cellPx), y0 = S(gridY + y * cellPx);
      fill(im, x0, y0, S(gridX + (x + 1) * cellPx) - x0, S(gridY + (y + 1) * cellPx) - y0, rgbOf(t));
    }
  }
  // 格线画在豆色上层：每格浅酒红 + 参考线深酒红（#8C2F43）——10 格实线、
  // 夹中间的 5 格虚线（边界强制实线），加粗 2 逻辑像素骑缝居中、半透明叠在豆色上。
  // 细线用 A_FINE、参考线用较重的 A_MAJOR，虚线实/空段 DASH/GAP 逻辑像素
  // （与 share.js 的 GRID_* 常量一致）。
  const A_FINE = 0.36, A_MAJOR = 0.9;
  const lineBand = Math.min(w, h) < 12 ? 0 : COORD;
  const DASH = 5, GAP = 4;
  const MAJ = [140, 47, 67], FINE = [119, 119, 119];
  const lwM = Math.max(1, Math.round(2 * scale)); // 参考线 2 逻辑像素线宽
  const blendLine = (x, y, ww, hh, rgb, a) => {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(im.w, Math.round(x + ww)), y1 = Math.min(im.h, Math.round(y + hh));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const o = (yy * im.w + xx) * 4;
      im.data[o] = Math.round(im.data[o] * (1 - a) + rgb[0] * a);
      im.data[o + 1] = Math.round(im.data[o + 1] * (1 - a) + rgb[1] * a);
      im.data[o + 2] = Math.round(im.data[o + 2] * (1 - a) + rgb[2] * a);
    }
  };
  for (let k = 0; k <= w; k++) {
    const major = k % 5 === 0;
    if (!major) {
      blendLine(S(gridX + k * cellPx), S(gridY - lineBand), lw, S(gridH + lineBand * 2), FINE, A_FINE);
      continue;
    }
    const x = S(gridX + k * cellPx - 0.5); // 骑缝居中（与 share.js 的 mOff 一致）
    if (k % 10 === 5 && k !== w) {
      for (let s = 0; s < gridH + lineBand * 2; s += DASH + GAP) {
        const y0 = S(gridY - lineBand + s);
        blendLine(x, y0, lwM, S(gridY - lineBand + Math.min(s + DASH, gridH + lineBand * 2)) - y0, MAJ, A_MAJOR);
      }
    } else {
      blendLine(x, S(gridY - lineBand), lwM, S(gridH + lineBand * 2), MAJ, A_MAJOR);
    }
  }
  for (let k = 0; k <= h; k++) {
    const major = k % 5 === 0;
    if (!major) {
      blendLine(S(gridX - lineBand), S(gridY + k * cellPx), S(gridW + lineBand * 2), lw, FINE, A_FINE);
      continue;
    }
    const y = S(gridY + k * cellPx - 0.5);
    if (k % 10 === 5 && k !== h) {
      for (let s = 0; s < gridW + lineBand * 2; s += DASH + GAP) {
        const x0 = S(gridX - lineBand + s);
        blendLine(x0, y, S(gridX - lineBand + Math.min(s + DASH, gridW + lineBand * 2)) - x0, lwM, MAJ, A_MAJOR);
      }
    } else {
      blendLine(S(gridX - lineBand), y, S(gridW + lineBand * 2), lwM, MAJ, A_MAJOR);
    }
  }

  // 逐格色号伪笔画：同号固定种子 → 跨格笔画对齐（与 chart-real 的 cellLabels 同思路，
  // 也是对格距检测最狠的干扰形态）；深浅字按格色亮度
  if (labelOn) {
    const num = new Map(stats.map((s, i) => [s.pal, i + 1]));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = cells[y * w + x];
        if (t < 0) continue;
        const rgb = rgbOf(t);
        const luma = (rgb[0] * 77 + rgb[1] * 150 + rgb[2] * 29) >> 8;
        const tc = luma > 128 ? [45, 35, 28] : [252, 252, 252];
        const lr = mulberry32(9000 + num.get(t));
        const cx = S(gridX + x * cellPx), cy = S(gridY + y * cellPx), cs = S(cellPx);
        const n = 3 + (num.get(t) % 3);
        for (let k = 0; k < n; k++) {
          const sx = cx + cs * (0.2 + lr() * 0.5), sy = cy + cs * (0.32 + lr() * 0.26);
          if (lr() < 0.6) fill(im, sx, sy, lw, 1 + lr() * cs * 0.28, tc);
          else fill(im, sx, sy, 1 + lr() * cs * 0.26, lw, tc);
        }
      }
    }
  }

  // 四边灰色坐标带逐格编号。
  for (let k = 1; k <= w; k++) {
    const x = S(gridX + (k - 0.5) * cellPx - 8);
    fakeText(im, x, S(gridY - COORD / 2 - 6), S(16), S(12), TEXT, rnd, 0.16);
    fakeText(im, x, S(gridY + gridH + COORD / 2 - 6), S(16), S(12), TEXT, rnd, 0.16);
  }
  for (let k = 1; k <= h; k++) {
    const y = S(gridY + (k - 0.5) * cellPx - 6);
    fakeText(im, S(gridX - COORD / 2 - 8), y, S(16), S(12), TEXT, rnd, 0.16);
    fakeText(im, S(gridX + gridW + COORD / 2 - 8), y, S(16), S(12), TEXT, rnd, 0.16);
  }

  // 说明行 + 图例药丸 + 页脚
  fakeText(im, S(P), S(infoY + 10), S(Math.min(CW, 420)), S(26), DARK, rnd, 0.5);
  if (lgCols) {
    const pillW = (CW - (lgCols - 1) * PILL_GAP) / lgCols;
    stats.forEach((s, i) => {
      const px = P + (i % lgCols) * (pillW + PILL_GAP);
      const py = lgY + Math.floor(i / lgCols) * (PILL_H + PILL_GAP);
      const rgb = rgbOf(s.pal);
      fill(im, S(px), S(py), S(pillW), S(PILL_H), rgb);
      const luma = (rgb[0] * 77 + rgb[1] * 150 + rgb[2] * 29) >> 8;
      fakeText(im, S(px + pillW * 0.32), S(py + 12), S(pillW * 0.36), S(16),
        luma > 128 ? [45, 35, 28] : [252, 252, 252], rnd, 0.3);
    });
  }
  fakeText(im, S(W / 2 - 150), S(H - FOOT / 2 - 7), S(300), S(14), [183, 168, 164], rnd, 0.2);

  return { im, cellPx, scale };
}

module.exports = { makeAppExport };
