// 图纸导入（utils/chart.js）回归测试：node tests/chart.test.js
// 用 chart-synth.js 程序化合成「小红书图纸工坊」风格的图纸截图
// （标题/四边坐标数字/5格参考线/底部图例/JPEG噪声/缩放模糊），
// 与 ground truth 逐格比对。tests 目录已在 project.config.json 里排除出小程序包。
const { analyzeChart } = require('../utils/chart.js');
const { mulberry32, img, crop, resize, CHART_COLORS, makeTruth, makeChart } = require('./chart-synth.js');

/* ---------- 校验 ---------- */
const { rgb2oklab } = require('../utils/convert.js');
const { hexToRgb } = require('../utils/palette.js');
const lab2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function verify(name, truth, cols, rows, out, expectInjective, palette) {
  palette = palette || CHART_COLORS;
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
    const t = palette[tc];
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
function run(name, im, truth, cols, rows, expectInjective, palette) {
  const t0 = Date.now();
  const out = analyzeChart(im.data, im.w, im.h);
  const ms = Date.now() - t0;
  const ok = verify(`${name} (${im.w}×${im.h}, ${ms}ms)`, truth, cols, rows, out, expectInjective, palette);
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

// O. 满铺图纸（RED 导出的风景/背景类：每格都有颜色、没有白底、逐格色号标签、
// 豆色上层有格间分隔线）：整页 + 紧贴网格的裁剪。真机踩过（2026-08-19）：
// 白底区定位用白标签/白豆拼碎带把天空整段裁掉；裁剪图的 pageBg 落在天空色上
// 把 1/4 张图当页面底色剔了；纯白 H2 豆被判空；标签把格子中间的能量填出来，
// 半格距候选骗过弱齿判别（靠格线支撑率否决）
{
  const { makeRealChart, REAL_COLORS } = require('./chart-real.js');
  const FB_COLORS = REAL_COLORS.concat([[254, 254, 254]]);
  const cols = 78, rows = 78;
  const truth = makeTruth(cols, rows, mulberry32(1));
  const rF = mulberry32(99);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (truth[i] < 0) truth[i] = y < rows * 0.32 ? 4 : y < rows * 0.44 ? 19 : 23; // 天空/远山/地面
  }
  for (let k = 0; k < 45; k++) { // 白云：纯白豆（H2），不能被当空格吞掉
    const x = Math.floor(rF() * cols), y = Math.floor(rF() * rows * 0.28);
    if (truth[y * cols + x] === 4) truth[y * cols + x] = 24;
  }
  const im = makeRealChart(truth, cols, rows, { seed: 41, colors: FB_COLORS, cellLabels: true, cellSep: true });
  run('O1 满铺整页(标签)', im, truth, cols, rows, false, FB_COLORS);
  // 紧贴网格裁剪：四边分别落在天空/地面豆子上，没有统一页面底色
  const pitch = 14.16, gx0 = 90.5, gy0 = 168;
  const cim = crop(im, Math.round(gx0) - 4, Math.round(gy0) - 4,
    Math.round(cols * pitch) + 8, Math.round(rows * pitch) + 8);
  run('O2 满铺裁剪(标签)', cim, truth, cols, rows, false, FB_COLORS);
  // 微信传图两种常见形态：压缩到 1080 / 高清 2568 缩到解码上限 2048
  // （高清版曾在底部多出一整行幻影白豆 —— 坐标数字撑大主体后外推格采到面板白）
  run('O3 满铺压缩1080', resize(im, 1080 / 1284), truth, cols, rows, false, FB_COLORS);
  const hiF = makeRealChart(truth, cols, rows, { seed: 42, colors: FB_COLORS, cellLabels: true, cellSep: true, pitch: 28.32 });
  run('O4 满铺2568→2048', resize(hiF, 2048 / hiF.w), truth, cols, rows, false, FB_COLORS);
}

// M. 往返闭环：buildChartExportTo（图纸样式导出）的像素镜像 → analyzeChart 全量还原。
// 版式镜像在 tests/export-synth.js（米黄页 + 白卡片 + 逐格色号 + 坐标数字 + 图例），
// 与 utils/share.js 的版式常量保持逐项一致；share.js 改版式必须同步镜像
{
  const { makeAppExport } = require('./export-synth.js');
  const W0 = 40, H0 = 30;
  const palette = ['#F0EBE2', '#F0A034', '#1E1E20', '#2C9EE7', '#D8C4B8', '#F7C52D', '#C4986C', '#CED0D2'];
  const cells = new Int16Array(W0 * H0).fill(-1);
  const r9 = mulberry32(9);
  // 图案贴满四边（保证 trim 后尺寸不变），中间随机留空
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) {
    if (x === 0 || y === 0 || x === W0 - 1 || y === H0 - 1 || r9() < 0.55) {
      cells[y * W0 + x] = Math.floor(r9() * palette.length);
    }
  }
  const hex2rgb = hx => [parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16)];
  const { im } = makeAppExport(cells, W0, H0, palette, { seed: 51 });
  const out = analyzeChart(im.data, im.w, im.h);
  let ok = !!out.ok && out.w === W0 && out.h === H0;
  let colorMiss = 0, cellMiss = 0;
  if (ok) {
    for (let i = 0; i < cells.length; i++) {
      const a = cells[i], b = out.cells[i];
      if ((a < 0) !== (b < 0)) { cellMiss++; continue; }
      if (a >= 0) {
        const ra = hex2rgb(palette[a]), rb = hex2rgb(out.palette[b]);
        if (Math.max(Math.abs(ra[0] - rb[0]), Math.abs(ra[1] - rb[1]), Math.abs(ra[2] - rb[2])) > 2) colorMiss++;
      }
    }
    ok = cellMiss === 0 && colorMiss === 0;
  }
  console.log(`${ok ? '✓' : '✗'} M 图纸导出往返闭环: ${out.ok ? out.w + '×' + out.h + ' 色' + out.colorN + ' 空格错' + cellMiss + ' 串色' + colorMiss : '识别失败-' + out.reason}`);
  if (!ok) allPass = false;
}

// N. 小作品往返：6×10 网格、图案净宽 5 格、单色（真机踩过：MIN_CELLS=6 时报「图案太小」）
// —— 同样走新版式镜像（窄作品：卡片居中浮在米黄页上，白底区占比是这里的敏感点）
{
  const { makeAppExport } = require('./export-synth.js');
  const W0 = 6, H0 = 10;
  const art = ['..X...', '..X...', '.XX...', '.X....', '.X....', '.XXXX.', '.X..X.', 'XX.XX.', 'X..X..', '..X...'];
  const cells = new Int16Array(W0 * H0).fill(-1);
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (art[y][x] === 'X') cells[y * W0 + x] = 0;
  const { im } = makeAppExport(cells, W0, H0, ['#FF4D45'], { seed: 52 });
  const out = analyzeChart(im.data, im.w, im.h);
  // 图案净范围 5×10（第 6 列全空被裁掉），19 颗
  const ok = !!out.ok && out.w === 5 && out.h === 10 && out.total === 19 && out.colorN === 1;
  console.log(`${ok ? '✓' : '✗'} N 小作品往返5×10: ${out.ok ? out.w + '×' + out.h + ' pitch=' + out.pitch + ' 豆' + out.total : '识别失败-' + out.reason}`);
  if (!ok) allPass = false;
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
