// 照片转图纸的两个「去背景」开关回归测试（合成图，不依赖解码库）：node tests/bg.test.js
//   whiteEmpty（白色背景不拼豆）：只抠和四边连通的白，被描边围住的白（婚纱/头纱/白衬衫）必须保留
//   bgMask（去掉背景）：剥截图黑边 → 四边多色聚类（白底 + 红装饰都认）→ 连通漫水；主体内部不能被吞
const assert = require('assert');
const { imageToPattern, bgMask, whiteMask } = require('../utils/convert');

// 造 RGBA 图：fill(x,y) 返回 [r,g,b] 或 null(透明)
function make(w, h, fill) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fill(x, y), o = (y * w + x) * 4;
    if (!c) continue;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  return d;
}
const W = 200, H = 200;
const WHITE = [252, 252, 252], INK = [30, 28, 34], RED = [225, 50, 50], SKIN = [250, 222, 200];
// 主体：一个描边（3px 墨线）围住的方块，内部上半是肤色、下半是白（像白裙子）；外面白底，四角各贴一块红装饰
function scene(x, y) {
  const inBox = x >= 60 && x < 140 && y >= 40 && y < 170;
  const inner = x >= 63 && x < 137 && y >= 43 && y < 167;
  if (inner) return y < 100 ? SKIN : WHITE;
  if (inBox) return INK;
  if ((x < 30 || x >= 170) && (y < 30 || y >= 170)) return RED; // 四角红块，贴边
  return WHITE;
}
const cellsOf = (data, w, h, opts) => imageToPattern(data, w, h, 50, Object.assign({ enhance: false }, opts));
const at = (p, x, y) => p.cells[y * p.w + x]; // 以 50 格坐标取（源 4px = 1 格）

// 1) whiteEmpty：外面的白判空，裙子的白保留，肤色保留
{
  const d = make(W, H, scene);
  const p = cellsOf(d, W, H, { whiteEmpty: true });
  assert.strictEqual(at(p, 2, 25), -1, '外部白底应留空');
  assert.strictEqual(at(p, 48, 25), -1, '右侧中部（角落红块之外）的白底应留空');
  assert.ok(at(p, 25, 35) >= 0, '描边里的白裙子必须保留');
  assert.ok(at(p, 25, 15) >= 0, '肤色保留');
  assert.ok(at(p, 2, 2) >= 0, '红装饰不是白，白底开关不动它');
  console.log('1 whiteEmpty 只抠连通白 ✓');
}
// 2) whiteEmpty + 截图黑边（左右各 2px 黑列）：种子取四边向内一圈，仍能找到白底
{
  const d = make(W, H, (x, y) => (x < 2 || x >= W - 2 ? INK : scene(x, y)));
  const p = cellsOf(d, W, H, { whiteEmpty: true });
  assert.strictEqual(at(p, 5, 25), -1, '有黑边时外部白底仍留空');
  assert.ok(at(p, 25, 35) >= 0, '裙子白仍保留');
  console.log('2 whiteEmpty 带截图黑边 ✓');
}
// 3) bgMask：黑边 + 白底 + 贴边红块全算背景，主体（含白裙子）一个像素都不能进 mask
{
  const d = make(W, H, (x, y) => (x < 2 || x >= W - 2 ? INK : scene(x, y)));
  const m = bgMask(d, W, H);
  const bg = (x, y) => m[y * W + x];
  assert.strictEqual(bg(0, 100), 1, '黑边算背景');
  assert.strictEqual(bg(10, 100), 1, '白底算背景');
  assert.strictEqual(bg(5, 5), 1, '贴边红块算背景');
  let leak = 0;
  for (let y = 43; y < 167; y++) for (let x = 63; x < 137; x++) leak += bg(x, y);
  assert.strictEqual(leak, 0, '主体内部不能被吞（漏进 ' + leak + ' 像素）');
  let edge = 0;
  for (let y = 40; y < 170; y++) for (let x = 60; x < 140; x++) edge += bg(x, y);
  assert.ok(edge < 3 * 2 * (80 + 130) * 0.5, '描边最多被 1px 外扩啃掉一圈');
  console.log('3 bgMask 多色背景 + 黑边 ✓');
}
// 4) 透明边（emoji）：不处理
{
  const d = make(W, H, (x, y) => (x > 50 && x < 150 && y > 50 && y < 150 ? RED : null));
  const m = bgMask(d, W, H);
  assert.strictEqual(m.reduce((a, b) => a + b, 0), 0, '透明边不做背景处理');
  const wm = whiteMask(d, W, H);
  assert.strictEqual(wm.reduce((a, b) => a + b, 0), 0, '透明边没有白背景');
  console.log('4 透明边不处理 ✓');
}
// 5) 主体贴边（固有局限，行为要稳定）：白裙子碰到底边 → 白裙子会被当白底，但肤色部分不受影响
{
  const d = make(W, H, (x, y) => (y >= 167 && x >= 63 && x < 137 ? WHITE : scene(x, y)));
  const p = cellsOf(d, W, H, { whiteEmpty: true });
  assert.ok(at(p, 25, 15) >= 0, '肤色不受影响');
  console.log('5 主体贴边不崩 ✓');
}
console.log('bg.test 全部通过');
