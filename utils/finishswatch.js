// 烫法预览小图：一小片纯色豆套上各烫法渲染成缩略图（不是苹果——纹理铺满整块、看得清），
// 给「选择烫法」卡片当图标。图案与作品无关，整会话缓存（熨烫页先渲染、查看页直接复用）。
const { renderPatternTo } = require('./board');
const ui = require('./ui');

// 每种烫法的展示底色：挑最能凸显该质感的颜色——釉光用浅蓝(反光跳)、闪粉用中性藕灰(亮片跳)、
// 纹理用暖棕、普通用珊瑚。参照 tests/tang/*.jpg 的观感。
const SWATCH_BASE = {
  smooth: '#ED96A0', towel: '#D8BD98', bath: '#D2B285',
  glaze: '#BBD4EC', paper: '#EADDC7', mesh: '#DBC7A7',
  glitter: '#B5A8B0', glitterFine: '#B5A8B0', rainbow: '#ADA3A9', rainbowFine: '#ADA3A9',
};
const PATCH = 6; // 6×6 颗豆的小色块，足够铺出纹理/网格/闪片
const cache = {}; // finishKey -> 临时图路径（会话内有效）

function patchPattern(base) {
  return { w: PATCH, h: PATCH, cells: new Array(PATCH * PATCH).fill(0), palette: [base] };
}

// 给 host（页面实例，需有 utilCanvas + uq 串行队列）渲染一批烫法预览图；每张渲染完回调 onEach(key, path)。
function ensureFinishSwatches(host, keys, onEach) {
  if (!host || !host.utilCanvas || !host.uq) return;
  keys.forEach(key => {
    if (cache[key]) { onEach(key, cache[key]); return; }
    const pat = patchPattern(SWATCH_BASE[key] || '#D8BD98');
    // pad:0 让纹理铺满整块（无白边）；hole:'none' 别让豆孔的小黑点弄脏小图
    const draw = () => renderPatternTo(host.utilCanvas, pat, { cellPx: 11, pad: 0, fused: true, finish: key, hole: 'none', scale: 2 });
    host.uq(() => ui.captureCanvas(host, host.utilCanvas, draw)).then(path => {
      cache[key] = path;
      onEach(key, path);
    }).catch(() => { /* 预览失败不影响选择 */ });
  });
}

module.exports = { ensureFinishSwatches };
