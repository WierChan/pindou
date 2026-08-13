// 合成「小红书图纸工坊」风格的图纸截图，验证 utils/chart.js 的识别精度
const { analyzeChart } = require('../utils/chart.js');
const { PALETTE } = require('../utils/palette.js');

/* ---------- 工具 ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function img(w, h, rgb) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255;
  }
  return { data, w, h };
}
function fill(im, x, y, w, h, rgb) {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(im.w, Math.round(x + w)), y1 = Math.min(im.h, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const o = (yy * im.w + xx) * 4;
      im.data[o] = rgb[0]; im.data[o + 1] = rgb[1]; im.data[o + 2] = rgb[2];
    }
  }
}
// 伪文字：在一个小盒子里画几笔深色短杆（没有字体，模拟坐标数字/标题的笔画）
function fakeText(im, x, y, w, h, rgb, rnd, density) {
  const n = Math.max(2, Math.round(w * h * (density || 0.10) / 6));
  for (let i = 0; i < n; i++) {
    const sx = x + rnd() * (w - 3), sy = y + rnd() * (h - 3);
    if (rnd() < 0.5) fill(im, sx, sy, 1 + rnd() * 3, 1.5, rgb);
    else fill(im, sx, sy, 1.5, 1 + rnd() * 3, rgb);
  }
}
function addNoise(im, amp, rnd) {
  for (let i = 0; i < im.w * im.h * 4; i += 4) {
    for (let c = 0; c < 3; c++) {
      im.data[i + c] = Math.max(0, Math.min(255, im.data[i + c] + (rnd() * 2 - 1) * amp));
    }
  }
}
// 双线性缩放（模拟转发/二次截图后的非整数格距 + 模糊）
function resize(im, k) {
  const w = Math.round(im.w * k), h = Math.round(im.h * k);
  const out = img(w, h, [0, 0, 0]);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(im.h - 1.001, y / k);
    const y0 = Math.floor(sy), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(im.w - 1.001, x / k);
      const x0 = Math.floor(sx), fx = sx - x0;
      const o00 = (y0 * im.w + x0) * 4, o01 = o00 + 4;
      const o10 = o00 + im.w * 4, o11 = o10 + 4;
      const oo = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = im.data[o00 + c] * (1 - fx) * (1 - fy) + im.data[o01 + c] * fx * (1 - fy)
          + im.data[o10 + c] * (1 - fx) * fy + im.data[o11 + c] * fx * fy;
        out.data[oo + c] = Math.round(v);
      }
      out.data[oo + 3] = 255;
    }
  }
  return out;
}

/* ---------- 图纸用色（仿 MARD 常用色） ---------- */
const CHART_COLORS = [
  [240, 160, 52], [247, 199, 90], [216, 196, 184], [247, 197, 45], [172, 224, 247],
  [44, 158, 231], [120, 205, 232], [32, 80, 164], [44, 138, 148], [28, 90, 158],
  [245, 140, 120], [92, 52, 36], [150, 110, 84], [222, 120, 50], [196, 152, 108],
  [120, 124, 130], [74, 78, 84], [56, 58, 62], [30, 30, 32], [206, 208, 210],
  [240, 235, 226], [170, 166, 158], [198, 110, 92], [130, 140, 130],
];

/* ---------- 生成 ground truth 图案（卡通脸：轮廓描边 + 大片近白 + 全色号点缀） ---------- */
function makeTruth(cols, rows, rnd, opts) {
  const t = new Int16Array(cols * rows).fill(-1);
  const margin = (opts && opts.touchEdge) ? 0 : 3;
  const cxm = cols / 2, cym = rows * 0.46;
  const rx = cols / 2 - margin - 1, ry = rows * 0.44 - (margin ? 2 : 0);
  const inside = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const dx = (x - cxm) / rx, dy = (y - cym) / ry;
      if (dx * dx + dy * dy <= 1) { t[y * cols + x] = 20; inside.push([x, y]); } // 大片近白 H19
    }
  }
  // 橙色斑块（头顶）
  for (const [px, py, pr] of [[cxm - rx * 0.5, cym - ry * 0.55, rx * 0.34], [cxm + rx * 0.45, cym - ry * 0.5, rx * 0.3]]) {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const d = (x - px) * (x - px) + (y - py) * (y - py);
      if (d <= pr * pr && t[y * cols + x] >= 0) t[y * cols + x] = 0; // A6 橙
    }
  }
  // 眼睛（黑）+ 浅卡其下巴 + 蓝色泪滴列
  for (const [px, py, pr] of [[cxm - rx * 0.4, cym - ry * 0.1, rx * 0.16], [cxm + rx * 0.4, cym - ry * 0.1, rx * 0.16]]) {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const d = (x - px) * (x - px) + (y - py) * (y - py);
      if (d <= pr * pr && t[y * cols + x] >= 0) t[y * cols + x] = 18; // H7 黑
    }
  }
  for (let y = Math.round(cym + ry * 0.4); y < Math.round(cym + ry * 0.9); y++) {
    for (let x = Math.round(cxm - rx * 0.4); x < Math.round(cxm + rx * 0.4); x++) {
      if (y >= 0 && y < rows && x >= 0 && x < cols && t[y * cols + x] >= 0) t[y * cols + x] = 2; // A23
    }
  }
  for (const ex of [Math.round(cxm - rx * 0.4), Math.round(cxm + rx * 0.4)]) {
    for (let y = Math.round(cym); y < Math.min(rows, Math.round(cym + ry * 0.5)); y++) {
      if (t[y * cols + ex] >= 0) t[y * cols + ex] = 5; // C5 蓝泪
    }
  }
  // 描边：图案与空白的交界描黑
  const t2 = Int16Array.from(t);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (t[y * cols + x] < 0) continue;
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx < 0 || ny < 0 || nx >= cols || ny >= rows || t[ny * cols + nx] < 0;
    });
    if (edge) t2[y * cols + x] = 18;
  }
  // 其余色号各点缀 3~6 格（模拟 C19 ×5 这类小用量色），落在近白区里
  const rest = CHART_COLORS.map((_, i) => i).filter(i => ![0, 2, 5, 18, 20].includes(i));
  for (const ci of rest) {
    const n = 3 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const [x, y] = inside[Math.floor(rnd() * inside.length)];
      if (t2[y * cols + x] === 20) t2[y * cols + x] = ci;
    }
  }
  return t2;
}

/* ---------- 生成整页图纸截图 ---------- */
function makeChart(truth, cols, rows, pitch, opts) {
  opts = opts || {};
  const rnd = mulberry32(opts.seed || 7);
  const cropped = !!opts.cropped;
  const labelPad = cropped ? 0 : 44;
  const gridW = Math.round(cols * pitch), gridH = Math.round(rows * pitch);
  const panelPad = cropped ? 0 : 26;
  const pageMargin = cropped ? 6 : 60;
  const titleH = cropped ? 0 : 110;
  const captionH = cropped ? 0 : 70;
  const legendRows = cropped ? 0 : Math.ceil(CHART_COLORS.length / 5);
  const legendH = cropped ? 0 : legendRows * 52 + 30;
  const W = pageMargin * 2 + panelPad * 2 + labelPad * 2 + gridW;
  const H = pageMargin * 2 + titleH + panelPad * 2 + labelPad * 2 + gridH + captionH + legendH;

  const BG = [246, 240, 227], WHITE = [255, 255, 255];
  const LINE = [225, 228, 230], TEAL = [170, 216, 208], TEXT = [109, 76, 49];
  const im = img(W, H, BG);

  const panelX = pageMargin, panelY = pageMargin + titleH;
  const panelW = W - pageMargin * 2, panelH = panelPad * 2 + labelPad * 2 + gridH;
  fill(im, panelX, panelY, panelW, panelH, WHITE);
  const gx0 = panelX + panelPad + labelPad, gy0 = panelY + panelPad + labelPad;

  if (!cropped) {
    // 标题 + 右上角作者
    fakeText(im, pageMargin, pageMargin + 20, 340, 44, [92, 60, 30], rnd, 0.22);
    fakeText(im, W - pageMargin - 120, pageMargin + 30, 100, 26, TEXT, rnd, 0.18);
  }

  // 网格线（细灰每格，5 格一条青色参考线）
  for (let k = 0; k <= cols; k++) {
    const x = Math.round(gx0 + k * pitch);
    fill(im, x, gy0, 1, gridH, k % 5 === 0 ? TEAL : LINE);
  }
  for (let k = 0; k <= rows; k++) {
    const y = Math.round(gy0 + k * pitch);
    fill(im, gx0, y, gridW, 1, k % 5 === 0 ? TEAL : LINE);
  }

  // 豆子：整格实色覆盖
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ci = truth[r * cols + c];
      if (ci < 0) continue;
      const x0 = Math.round(gx0 + c * pitch), x1 = Math.round(gx0 + (c + 1) * pitch);
      const y0 = Math.round(gy0 + r * pitch), y1 = Math.round(gy0 + (r + 1) * pitch);
      fill(im, x0, y0, x1 - x0, y1 - y0, CHART_COLORS[ci]);
    }
  }

  if (!cropped) {
    // 四边坐标数字（1, 6, 11, ...）
    for (let k = 0; k < cols; k += 5) {
      const x = gx0 + (k + 0.5) * pitch - 8;
      fakeText(im, x, gy0 - 26, 18, 14, TEXT, rnd, 0.16);
      fakeText(im, x, gy0 + gridH + 10, 18, 14, TEXT, rnd, 0.16);
    }
    for (let k = 0; k < rows; k += 5) {
      const y = gy0 + (k + 0.5) * pitch - 7;
      fakeText(im, gx0 - 30, y, 20, 14, TEXT, rnd, 0.16);
      fakeText(im, gx0 + gridW + 12, y, 20, 14, TEXT, rnd, 0.16);
    }
    // 底部说明（粗体：覆盖率高，考验裁剪逻辑）
    const capY = panelY + panelH + 26;
    fakeText(im, pageMargin, capY, Math.round(W * 0.42), 26, [90, 62, 40], rnd, 0.5);
    // 图例色块（5 列，实色块 + 白色伪文字）
    const chipW = Math.floor((panelW - 4 * 14) / 5), chipH = 34;
    CHART_COLORS.forEach((rgb, i) => {
      const cx = panelX + (i % 5) * (chipW + 14);
      const cy = capY + 44 + Math.floor(i / 5) * 52;
      fill(im, cx, cy, chipW, chipH, rgb);
      fakeText(im, cx + chipW * 0.3, cy + 10, chipW * 0.4, 14, WHITE, rnd, 0.3);
    });
  }

  addNoise(im, opts.noise == null ? 3 : opts.noise, rnd);
  return { im, gx0, gy0 };
}


module.exports = { mulberry32, img, fill, fakeText, addNoise, resize, CHART_COLORS, makeTruth, makeChart };
