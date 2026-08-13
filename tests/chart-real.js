// 高仿真实 RED 图纸的合成器：按用户实拍图纸（1284×1648, 78×78, pitch≈14.16）测量还原。
// 与 chart-synth.js 的区别（也是真机识别失败的怀疑点）：
//   - 每格细格线非常淡（与白差 ~12，低于/贴近掩码阈值），只有 5 格青线明显
//   - 图例行间距很紧（~10px），行与行、图例与说明文字容易被 bridge 桥成一大带
//   - 说明文字/图例画在米黄页面底上（不在白面板里）
//   - 坐标数字画在白面板内、紧贴网格
const { mulberry32, img, fill, fakeText, addNoise } = require('./chart-synth.js');

// 真实图纸的 24 色（按图例目测）
const REAL_COLORS = [
  [240, 160, 52], [247, 199, 90], [216, 196, 184], [247, 197, 45], [172, 224, 247],
  [44, 158, 231], [120, 205, 232], [32, 80, 164], [44, 138, 148], [28, 90, 158],
  [245, 140, 120], [92, 52, 36], [150, 110, 84], [222, 120, 50], [196, 152, 108],
  [120, 124, 130], [74, 78, 84], [56, 58, 62], [30, 30, 32], [206, 208, 210],
  [240, 235, 226], [170, 166, 158], [198, 110, 92], [130, 140, 130],
];

// 仿真实版式生成整页图纸；整个版式随 pitch 等比缩放（基准 14.16 对应 1284 宽）。
// opts.style2：仿工坊小程序预览页截屏 —— 整页米黄底铺浅色网格纹理、
// 没有白面板（白底只垫在网格正下方）、坐标数字/说明/图例都在米黄底上
function makeRealChart(truth, cols, rows, opts) {
  opts = opts || {};
  const rnd = mulberry32(opts.seed || 21);
  const pitch = opts.pitch || 14.16;
  const s = pitch / 14.16 * (cols / 78);
  const W = Math.round(1284 * s), gridW = cols * pitch;
  const gx0 = 90.5 * s, gy0 = 168 * s;
  const gridH = rows * pitch;
  const panel = { x: 58 * s, y: 128 * s, w: 1168 * s, h: gridH + 80 * s };
  const capY = panel.y + panel.h + 38 * s;
  const legendY = capY + 44 * s;
  const legendRows = Math.ceil(REAL_COLORS.length / 5);
  const H = Math.round(legendY + legendRows * 40 * s + 28 * s);

  const BG = [245, 239, 226], WHITE = [255, 255, 255];
  const LINE = opts.strongLines ? [225, 228, 230] : [243, 243, 243]; // 淡格线：与白差 12
  const TEAL = [203, 233, 227];
  const TEXT = [109, 76, 49];
  const im = img(W, H, BG);
  if (opts.style2) {
    // 整页装饰性网格纹理（间距故意与图纸格距不同，容易骗周期检测）
    const tp = 27 * s, TEXLINE = [228, 220, 204];
    for (let x = tp / 2; x < W; x += tp) fill(im, x, 0, 1, H, TEXLINE);
    for (let y = tp / 2; y < H; y += tp) fill(im, 0, y, W, 1, TEXLINE);
    // 白底只垫在网格正下方（含一小圈留白）
    fill(im, gx0 - 8 * s, gy0 - 8 * s, gridW + 16 * s, gridH + 16 * s, WHITE);
  } else {
    fill(im, panel.x, panel.y, panel.w, panel.h, WHITE);
  }

  // 标题 + 作者（米黄底上）
  fakeText(im, 75 * s, 58 * s, 330 * s, 42 * s, [92, 60, 30], rnd, 0.22);
  fakeText(im, W - 170 * s, 84 * s, 110 * s, 22 * s, TEXT, rnd, 0.18);

  // 网格线：淡灰每格 + 青色每 5 格
  for (let k = 0; k <= cols; k++) {
    const x = Math.round(gx0 + k * pitch);
    fill(im, x, gy0, 1, gridH, k % 5 === 0 ? TEAL : LINE);
  }
  for (let k = 0; k <= rows; k++) {
    const y = Math.round(gy0 + k * pitch);
    fill(im, gx0, y, gridW, 1, k % 5 === 0 ? TEAL : LINE);
  }

  // 豆子（实色整格覆盖）
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ci = truth[r * cols + c];
      if (ci < 0) continue;
      const x0 = Math.round(gx0 + c * pitch), x1 = Math.round(gx0 + (c + 1) * pitch);
      const y0 = Math.round(gy0 + r * pitch), y1 = Math.round(gy0 + (r + 1) * pitch);
      fill(im, x0, y0, x1 - x0, y1 - y0, REAL_COLORS[ci]);
    }
  }

  // 四边坐标数字（白面板内，紧贴网格）
  for (let k = 0; k < cols; k += 5) {
    const x = gx0 + (k + 0.5) * pitch - 8 * s;
    fakeText(im, x, gy0 - 16 * s, 16 * s, 11 * s, TEXT, rnd, 0.16);
    fakeText(im, x, gy0 + gridH + 6 * s, 16 * s, 11 * s, TEXT, rnd, 0.16);
  }
  for (let k = 0; k < rows; k += 5) {
    const y = gy0 + (k + 0.5) * pitch - 5 * s;
    fakeText(im, gx0 - 20 * s, y, 16 * s, 11 * s, TEXT, rnd, 0.16);
    fakeText(im, gx0 + gridW + 6 * s, y, 16 * s, 11 * s, TEXT, rnd, 0.16);
  }

  // 说明文字（米黄底、粗体）：MARD · 78x78 · 24 色 / 共 4194 颗
  fakeText(im, 58 * s, capY, 430 * s, 24 * s, [90, 62, 40], rnd, 0.5);

  // 图例：5 列 × N 行，行距紧（30px 色块 + 10px 空隙）
  const chipW = 212 * s, chipH = 30 * s;
  REAL_COLORS.forEach((rgb, i) => {
    const cx = 75 * s + (i % 5) * (chipW + 14 * s);
    const cy = legendY + Math.floor(i / 5) * 40 * s;
    fill(im, cx, cy, chipW, chipH, rgb);
    fakeText(im, cx + chipW * 0.32, cy + 8 * s, chipW * 0.36, 13 * s, WHITE, rnd, 0.3);
  });

  addNoise(im, opts.noise == null ? 4 : opts.noise, rnd);
  return im;
}

module.exports = { makeRealChart, REAL_COLORS };
