// 烫法预览小图：一小片纯色豆套上各烫法渲染成缩略图（不是苹果——纹理铺满整块、看得清），
// 给「选择烫法」卡片当图标。图案与作品无关：会话内模块级缓存 + 持久化到磁盘（跨会话秒载，
// 避免每次进熨烫页都重跑 canvasToTempFilePath 卡住流程）。
const { renderPatternTo } = require('./board');
const ui = require('./ui');

// 每种烫法的展示底色：挑最能凸显该质感的颜色——釉光用浅蓝(反光跳)、闪粉用中性藕灰(亮片跳)、
// 纹理用暖棕、普通用珊瑚。参照 tests/tang/*.jpg 的观感。
const SWATCH_BASE = {
  smooth: '#ED96A0', towel: '#D8BD98', bath: '#D2B285',
  glaze: '#BBD4EC', paper: '#EADDC7', mesh: '#DBC7A7',
  glitter: '#B5A8B0', glitterFine: '#B5A8B0', rainbow: '#ADA3A9', rainbowFine: '#ADA3A9',
};
const PATCH = 6;      // 6×6 颗豆的小色块，足够铺出纹理/网格/闪片
const SWATCH_V = 1;   // 渲染画法变了就 +1，作废旧的磁盘缓存
const cache = {};     // 会话内 finishKey -> 图路径

function swatchName(key) { return 'swatch-' + key + '-v' + SWATCH_V + '.png'; }
// 磁盘上已有就返回其路径（跨会话复用，不动 canvas），没有返回 null
function diskPath(key) {
  try {
    const p = wx.env.USER_DATA_PATH + '/' + swatchName(key);
    wx.getFileSystemManager().accessSync(p);
    return p;
  } catch (e) { return null; }
}

function patchPattern(base) {
  return { w: PATCH, h: PATCH, cells: new Array(PATCH * PATCH).fill(0), palette: [base] };
}

// 给 host（页面实例，需有 utilCanvas + uq 串行队列）渲染一批烫法预览图；每张就绪回调 onEach(key, path)。
function ensureFinishSwatches(host, keys, onEach) {
  if (!host || !host.utilCanvas || !host.uq) return;
  keys.forEach((key, i) => {
    if (cache[key]) { onEach(key, cache[key]); return; }
    const disk = diskPath(key);
    if (disk) { cache[key] = disk; onEach(key, disk); return; } // 磁盘已有 → 秒出，不跑 canvas
    // 磁盘没有才生成：逐张错开（captureCanvas 生成临时图较重），别一口气全压上去卡 UI；
    // host._gone / host._noSwatch 时中止（页面已走 / 已开始熨烫，预览不再需要）。
    setTimeout(() => {
      if (host._gone || host._noSwatch) return;
      if (cache[key]) { onEach(key, cache[key]); return; }
      const pat = patchPattern(SWATCH_BASE[key] || '#D8BD98');
      // pad:0 让纹理铺满整块（无白边）；hole:'none' 别让豆孔的小黑点弄脏小图
      const draw = () => renderPatternTo(host.utilCanvas, pat, { cellPx: 11, pad: 0, fused: true, finish: key, hole: 'none', scale: 2 });
      host.uq(() => ui.captureCanvas(host, host.utilCanvas, draw)).then(tmp => {
        const path = ui.persistFile(tmp, swatchName(key)); // 落盘，下次秒载
        cache[key] = path;
        onEach(key, path);
      }).catch(() => { /* 预览失败不影响选择 */ });
    }, i * 120);
  });
}

module.exports = { ensureFinishSwatches };
