// 图纸导入（utils/chart.js）回归测试：node tests/chart.test.js
// 用 chart-synth.js 程序化合成「小红书图纸工坊」风格的图纸截图
// （标题/四边坐标数字/5格参考线/底部图例/JPEG噪声/缩放模糊），
// 与 ground truth 逐格比对。tests 目录已在 project.config.json 里排除出小程序包。
const { analyzeChart } = require('../utils/chart.js');
const { mulberry32, img, resize, CHART_COLORS, makeTruth, makeChart } = require('./chart-synth.js');

/* ---------- 校验 ---------- */
const { rgb2oklab } = require('../utils/convert.js');
const { hexToRgb } = require('../utils/palette.js');
const lab2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function verify(name, truth, cols, rows, out, expectInjective) {
  if (!out.ok) { console.log(`✗ ${name}: 识别失败 - ${out.reason}`); return false; }
  // truth 的非空 bbox
  let r0 = rows, r1 = -1, c0 = cols, c1 = -1;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (truth[y * cols + x] >= 0) {
      if (y < r0) r0 = y; if (y > r1) r1 = y;
      if (x < c0) c0 = x; if (x > c1) c1 = x;
    }
  }
  const tw = c1 - c0 + 1, th = r1 - r0 + 1;
  if (out.w !== tw || out.h !== th) {
    console.log(`✗ ${name}: 尺寸 ${out.w}×${out.h}，应为 ${tw}×${th}`);
    return false;
  }
  // 每个图纸色的主流映射 & 逐格一致率
  const maj = new Map(); // truthColor -> Map(pal -> n)
  let beads = 0;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const tc = truth[(r0 + y) * cols + (c0 + x)];
    const oc = out.cells[y * tw + x];
    if (tc >= 0) {
      beads++;
      if (!maj.has(tc)) maj.set(tc, new Map());
      const m = maj.get(tc);
      m.set(oc, (m.get(oc) || 0) + 1);
    }
  }
  const majOf = new Map();
  for (const [tc, m] of maj) {
    let bp = -9, bc = -1;
    for (const [p, c] of m) if (c > bc) { bc = c; bp = p; }
    majOf.set(tc, bp);
  }
  let bad = 0, phantom = 0, missing = 0;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const tc = truth[(r0 + y) * cols + (c0 + x)];
    const oc = out.cells[y * tw + x];
    if (tc < 0 && oc >= 0) phantom++;
    else if (tc >= 0 && oc < 0) missing++;
    else if (tc >= 0 && oc !== majOf.get(tc)) bad++;
  }
  const rate = ((bad + phantom + missing) / beads * 100).toFixed(2);
  // 色彩保真：每个图纸色的主流映射色（作品自带色板）与原色的 OKLab 距离
  let maxD = 0;
  for (const [tc, palIdx] of majOf) {
    if (palIdx == null || palIdx < 0 || !out.palette || !out.palette[palIdx]) continue;
    const t = CHART_COLORS[tc];
    const c = hexToRgb(out.palette[palIdx]);
    const d = Math.sqrt(lab2(rgb2oklab(t[0], t[1], t[2]), rgb2oklab(c[0], c[1], c[2])));
    if (d > maxD) maxD = d;
  }
  const distinct = new Set(majOf.values());
  const injMsg = distinct.size === majOf.size ? '色号一一分开' : `(${majOf.size} 图纸色 → ${distinct.size} 板上色)`;
  const pass = (bad + phantom + missing) / beads <= 0.005 && maxD <= 0.035;
  console.log(`${pass ? '✓' : '✗'} ${name}: ${out.w}×${out.h} pitch=${out.pitch} conf=${out.conf} ` +
    `颜色${out.colorN} 豆${out.total} | 错格率 ${rate}% (串色${bad} 幻影${phantom} 漏豆${missing}) ` +
    `最大色差 ${maxD.toFixed(3)} ${injMsg}`);
  return pass;
}

/* ---------- 用例 ---------- */
let allPass = true;
function run(name, im, truth, cols, rows, expectInjective) {
  const t0 = Date.now();
  const out = analyzeChart(im.data, im.w, im.h);
  const ms = Date.now() - t0;
  const ok = verify(`${name} (${im.w}×${im.h}, ${ms}ms)`, truth, cols, rows, out, expectInjective);
  if (!ok) allPass = false;
  return out;
}

const rnd0 = mulberry32(42);

// A. 整页 78×78，pitch 16（接近真实图纸）
{
  const cols = 78, rows = 78;
  const truth = makeTruth(cols, rows, mulberry32(1));
  const { im } = makeChart(truth, cols, rows, 16, { seed: 11 });
  run('A 整页78×78', im, truth, cols, rows, true);

  // B. 同一张缩放 0.63（非整数格距 10.08 + 双线性模糊）
  const im2 = resize(im, 0.63);
  run('B 整页缩放0.63', im2, truth, cols, rows, true);

  // C. 缩放 0.45（pitch 7.2，逼近下限）
  const im3 = resize(im, 0.45);
  run('C 整页缩放0.45', im3, truth, cols, rows, false);
}

// D. 只截网格区域（用户手动裁剪）
{
  const cols = 78, rows = 78;
  const truth = makeTruth(cols, rows, mulberry32(2));
  const { im } = makeChart(truth, cols, rows, 15.4, { seed: 12, cropped: true });
  run('D 裁剪版78×78', im, truth, cols, rows, true);
}

// E. 小图纸 24×24 大格距，图案顶到网格边
{
  const cols = 24, rows = 24;
  const truth = makeTruth(cols, rows, mulberry32(3), { touchEdge: true });
  const { im } = makeChart(truth, cols, rows, 34, { seed: 13 });
  run('E 整页24×24大格', im, truth, cols, rows, false);
}

// F. 稀疏图案 + 5 格青色参考线（考验谐波纠偏：R 峰可能落在 5×格距上）
{
  const cols = 60, rows = 60;
  const truth = new Int16Array(cols * rows).fill(-1);
  const r2 = mulberry32(4);
  for (let i = 0; i < 90; i++) { // 全图只有 90 颗散豆
    const x = 4 + Math.floor(r2() * (cols - 8)), y = 4 + Math.floor(r2() * (rows - 8));
    truth[y * cols + x] = Math.floor(r2() * CHART_COLORS.length);
  }
  const { im } = makeChart(truth, cols, rows, 18, { seed: 14 });
  run('F 稀疏+参考线', im, truth, cols, rows, false);
}

// H. 重噪声（狠压过的 JPEG）
{
  const cols = 78, rows = 78;
  const truth = makeTruth(cols, rows, mulberry32(6));
  const { im } = makeChart(truth, cols, rows, 16, { seed: 15, noise: 7 });
  run('H 重噪声', im, truth, cols, rows, false);
}

// I. 超小图纸 8×8 双色棋盘（MIN_CELLS 边界）
{
  const cols = 8, rows = 8;
  const truth = new Int16Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    truth[y * cols + x] = (x + y) % 2 ? 18 : 0;
  }
  const { im } = makeChart(truth, cols, rows, 56, { seed: 16, cropped: true });
  run('I 8×8棋盘裁剪', im, truth, cols, rows, false);
}

// J. 大图纸 120×120 小格距
{
  const cols = 120, rows = 120;
  const truth = makeTruth(cols, rows, mulberry32(7));
  const { im } = makeChart(truth, cols, rows, 10, { seed: 17 });
  run('J 整页120×120', im, truth, cols, rows, false);
}

// K. 高仿真实 RED 版式（淡格线 + 紧凑图例 + 米黄底说明文字）三种分辨率
// —— 真机曾在这种版式上失败（谐波判别被噪声基线骗了），务必保持全绿
{
  const { makeRealChart } = require('./chart-real.js');
  const cols = 78, rows = 78;
  const truth = makeTruth(cols, rows, mulberry32(1));
  run('K1 真实版式1284', makeRealChart(truth, cols, rows, { seed: 21 }), truth, cols, rows, false);
  const hi = makeRealChart(truth, cols, rows, { seed: 22, pitch: 28.32 });
  run('K2 真实版式2568→2048', resize(hi, 2048 / hi.w), truth, cols, rows, false);
  run('K3 真实版式压缩1080', resize(makeRealChart(truth, cols, rows, { seed: 23 }), 1080 / 1284), truth, cols, rows, false);
}

// L. 工坊小程序预览页截屏版式：整页米黄底铺装饰网格纹理、无白面板、
// 标签/说明/图例都在米黄底上 —— 真机曾把图例一起导进作品（白底区域定位修复）
{
  const { makeRealChart } = require('./chart-real.js');
  const cols = 78, rows = 78;
  const truth = makeTruth(cols, rows, mulberry32(1));
  run('L1 纹理页面1284', makeRealChart(truth, cols, rows, { seed: 31, style2: true }), truth, cols, rows, false);
  run('L2 纹理页面压缩1080', resize(makeRealChart(truth, cols, rows, { seed: 32, style2: true }), 1080 / 1284), truth, cols, rows, false);
  const hi2 = makeRealChart(truth, cols, rows, { seed: 33, style2: true, pitch: 28.32 });
  run('L3 纹理页面2568→2048', resize(hi2, 2048 / hi2.w), truth, cols, rows, false);
}

// G. 负样本：噪声渐变照片 → 应礼貌失败
{
  const im = img(900, 1200, [128, 128, 128]);
  const r3 = mulberry32(5);
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const o = (y * im.w + x) * 4;
    im.data[o] = (x / im.w) * 255;
    im.data[o + 1] = (y / im.h) * 200 + r3() * 50;
    im.data[o + 2] = 120 + r3() * 80;
  }
  const out = analyzeChart(im.data, im.w, im.h);
  const ok = !out.ok;
  console.log(`${ok ? '✓' : '✗'} G 负样本照片: ${out.ok ? '误识别为 ' + out.w + '×' + out.h + ' conf=' + out.conf : '拒绝 - ' + out.reason}`);
  if (!ok) allPass = false;
}

console.log(allPass ? '\n全部通过 ✅' : '\n有用例失败 ❌');
process.exit(allPass ? 0 : 1);
