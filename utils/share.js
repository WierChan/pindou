// 分享卡片 / 导出图片：直接绘制到传入的 canvas 上
const { drawPatternInto, patternSize, workFinish } = require('./board');
const { colorStats } = require('./convert');
const { PALETTE } = require('./palette');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 分享二维码（assets/share-qr.jpg）：模块级缓存，加载失败静默（卡片退化为纯文字引导）
let qrImg = null;
let qrTried = false;
function loadShareAssets(canvas) {
  if (qrImg || qrTried) return Promise.resolve();
  return new Promise(resolve => {
    try {
      const img = canvas.createImage();
      img.onload = () => { qrImg = img; resolve(); };
      img.onerror = () => { qrTried = true; resolve(); };
      img.src = '/assets/share-qr.jpg';
    } catch (e) { qrTried = true; resolve(); }
  });
}

// 便利店遮阳棚：粉白条纹 + 方齿垂边（画在图顶部）
function awning(ctx, W) {
  const sw = 36;
  for (let x = 0, i = 0; x < W; x += sw, i++) {
    ctx.fillStyle = i % 2 ? '#FFFFFF' : '#EABFC3';
    ctx.fillRect(x, 0, Math.min(sw, W - x), 18);
    if (i % 2 === 0) ctx.fillRect(x, 18, Math.min(sw, W - x), 9); // 齿
  }
}

// 像素格子底纹（与 app.wxss 的页面底纹同款）
function bgGrid(ctx, W, H) {
  ctx.fillStyle = 'rgba(95,74,78,.06)';
  for (let x = 0; x <= W; x += 26) ctx.fillRect(x, 0, 2, H);
  for (let y = 0; y <= H; y += 26) ctx.fillRect(0, y, W, 2);
}

// 像素风面板：右下掉落式硬投影 + 白底 + 靛墨描边
function pixelPanel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(95,74,78,.14)';
  ctx.fillRect(x + 8, y + 8, w, h);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#5F4A4E';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
}

const BRAND_BEADS = [['#EABFC3', '#C9838F'], ['#F2CB8E', '#C29040'], ['#F5D5D9', '#C9939F']];

// 品牌三连豆（像素方豆：方块 + 描边 + 方孔 + 左上高光）
function drawBrandBeads(ctx, cx, cy, r, gap) {
  let bx = cx - (r * 2 * 3 + gap * 2) / 2 + r;
  for (const pair of BRAND_BEADS) {
    const s = r * 2, x = bx - r, y = cy - r;
    ctx.fillStyle = pair[0];
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = '#5F4A4E';
    ctx.lineWidth = Math.max(2, r * 0.2);
    ctx.strokeRect(x, y, s, s);
    ctx.fillStyle = pair[1];
    ctx.fillRect(bx - s * 0.18, cy - s * 0.18, s * 0.36, s * 0.36);
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.fillRect(x + s * 0.1, y + s * 0.1, s * 0.2, s * 0.2);
    bx += r * 2 + gap;
  }
}

function fmtDate(ts) {
  const d = new Date(ts || Date.now());
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
}

// 在给定的宽高限制内选一个豆子格尺寸（pad 系数 1.1 与绘制保持一致）
function fitCell(work, maxW, maxH, minC, maxC) {
  const cw = maxW / (work.w + 2.2);
  const ch = maxH / (work.h + 2.2);
  return clamp(Math.floor(Math.min(cw, ch)), minC, maxC);
}

// 保证作品四周至少有 margin 圈空白格再上卡片：完成时按包围盒紧裁的作品（豆子贴边）
// 也能有拼豆板的留白感；本身留白充足的（照片 / 图纸导入）原样返回。仅用于展示，不改存档
function withMargin(work, margin) {
  const w = work.w, h = work.h, cells = work.cells;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x] >= 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return work; // 空作品
  const L = Math.max(0, margin - x0), T = Math.max(0, margin - y0);
  const R = Math.max(0, margin - (w - 1 - x1)), B = Math.max(0, margin - (h - 1 - y1));
  if (!L && !T && !R && !B) return work;
  const nw = w + L + R, nh = h + T + B;
  const nc = new Array(nw * nh).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      nc[(y + T) * nw + (x + L)] = cells[y * w + x];
    }
  }
  return { w: nw, h: nh, cells: nc, palette: work.palette };
}

// 品牌分享卡（便利店门头 + 作品图 + 邀请区 + 小程序码）：分享弹窗（share-modal）的主图
function buildShareCardTo(canvas, work, scale) {
  scale = scale || 2;
  const W = 750, M = 48;
  const stats = colorStats(work.cells);
  const total = stats.reduce((a, s) => a + s.count, 0);
  const view = withMargin(work, 2); // 展示用视图：贴边作品补出板上留白

  // 作品图（熨烫后的质感）；min 2 保证 256 豆的大画布也能放进卡片
  const artCell = fitCell(view, W - M * 2 - 64, 700, 2, 40);
  const artPad = Math.round(artCell * 1.1);
  const artSize = patternSize(view, { cellPx: artCell, pad: artPad });
  const artW = artSize.width, artH = artSize.height;

  const headerH = 146;
  const panelH = artH + 64;
  const infoH = 116;
  const inviteH = 200;
  const footH = 66;
  const H = headerH + panelH + infoH + inviteH + footH;

  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // 背景 + 像素格纹 + 遮阳棚
  ctx.fillStyle = '#FBF5EC';
  ctx.fillRect(0, 0, W, H);
  bgGrid(ctx, W, H);
  awning(ctx, W);

  // 头部：三颗方豆 + 标题（带像素粉错位阴影）
  drawBrandBeads(ctx, W / 2, 60, 17, 18);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillStyle = 'rgba(201,131,143,.4)';
  ctx.fillText('拼豆便利店', W / 2 + 4, 134);
  ctx.fillStyle = '#5F4A4E';
  ctx.fillText('拼豆便利店', W / 2, 130);

  // 作品面板
  const py = headerH;
  pixelPanel(ctx, M, py, W - M * 2, panelH);
  ctx.save();
  ctx.translate(W / 2 - artW / 2, py + 32);
  // finish：作品在熨烫前选的质感（withMargin 产出的是展示用副本，显式传进去）
  drawPatternInto(ctx, view, {
    cellPx: artCell, pad: artPad, fused: true, finish: workFinish(work),
  });
  ctx.restore();

  // 作品信息
  const iy = py + panelH;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#5F4A4E';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('「' + work.name + '」', W / 2, iy + 52);
  ctx.fillStyle = '#A59795';
  ctx.font = '24px sans-serif';
  ctx.fillText('我拼好了 ' + total + ' 颗豆子 · ' + stats.length + ' 种颜色 · ' + fmtDate(work.completedAt || work.updatedAt), W / 2, iy + 94);

  // 邀请区：有小程序码则「左码右文案」，否则纯文字搜索引导
  const qy = iy + infoH;
  const panelInH = inviteH - 20;
  pixelPanel(ctx, M, qy, W - M * 2, panelInH);
  if (qrImg) {
    const qs = 136;
    const qx = M + 34, qyy = qy + (panelInH - qs) / 2;
    ctx.drawImage(qrImg, qx, qyy, qs, qs);
    const tx = qx + qs + (W - M - (qx + qs)) / 2; // 右侧文案区中心
    drawBrandBeads(ctx, tx, qy + 44, 9, 9);
    ctx.fillStyle = '#5F4A4E';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('扫码打开「拼豆便利店」', tx, qy + 96);
    ctx.fillStyle = '#A59795';
    ctx.font = '21px sans-serif';
    ctx.fillText('把喜欢的图片，一颗一颗拼出来', tx, qy + 134);
  } else {
    drawBrandBeads(ctx, W / 2, qy + 46, 10, 10);
    ctx.fillStyle = '#5F4A4E';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('微信搜索小程序「拼豆便利店」', W / 2, qy + 102);
    ctx.fillStyle = '#A59795';
    ctx.font = '23px sans-serif';
    ctx.fillText('把喜欢的图片，一颗一颗拼出来', W / 2, qy + 144);
  }

  // 页脚
  ctx.fillStyle = '#B7A8A4';
  ctx.font = '21px sans-serif';
  ctx.fillText('—— 拼豆便利店 · 电子拼豆手作 ——', W / 2, qy + inviteH + 26);

  return { width: W, height: H };
}

// 图纸样式导出（分享弹窗「保存图纸」）：纯白底 + 细格线（每格淡灰、5 格淡青参考线）+ 平色格。
// 没有豆孔/高光/蒙孔点 —— 保存的图片可以再从「导入拼豆图纸」识别回来（往返闭环），
// 颜色用色板原值（PNG 无损），识别后逐格逐色还原
function buildChartExportTo(canvas, work, opts) {
  opts = opts || {};
  const scale = opts.scale || 2;
  const maxSide = opts.maxSide || 1600;
  const w = work.w, h = work.h, cells = work.cells;
  const cellPx = clamp(Math.floor(maxSide / Math.max(w, h)), opts.minCell || 8, opts.maxCell || 24);
  const pad = Math.round(cellPx * 1.2);
  const W = w * cellPx + pad * 2, H = h * cellPx + pad * 2;
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  // 格线铺满网格区（色格随后覆盖，空格处露出格线 —— 和真图纸一致）；格子太小就不画线
  if (cellPx >= 5) {
    for (let k = 0; k <= w; k++) {
      ctx.fillStyle = k % 5 === 0 ? '#C9E4DE' : '#E6E9EB';
      ctx.fillRect(pad + k * cellPx, pad, 1, h * cellPx);
    }
    for (let k = 0; k <= h; k++) {
      ctx.fillStyle = k % 5 === 0 ? '#C9E4DE' : '#E6E9EB';
      ctx.fillRect(pad, pad + k * cellPx, w * cellPx, 1);
    }
  }
  // 平色格（无孔无高光）
  const hexOf = t => (work.palette ? work.palette[t] : PALETTE[t].hex);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = cells[y * w + x];
      if (t < 0) continue;
      ctx.fillStyle = hexOf(t);
      ctx.fillRect(pad + x * cellPx, pad + y * cellPx, cellPx, cellPx);
    }
  }
  return { width: W, height: H };
}

// 导出用的作品图：纯图纸本体（白板 + 豆子），不带背景/标题/日期/品牌落款
// —— 要装饰收藏版走「分享卡片」（buildShareCardTo）
function buildExportTo(canvas, work, fused, scale) {
  scale = scale || 2; // 高清导出
  if (fused == null) fused = true;
  const cellPx = clamp(Math.floor(1600 / Math.max(work.w, work.h)), 6, 32);
  const size = patternSize(work, { cellPx });
  canvas.width = Math.round(size.width * scale);
  canvas.height = Math.round(size.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);
  drawPatternInto(ctx, work, { cellPx, fused, finish: fused ? workFinish(work) : 'smooth' });
  return { width: size.width, height: size.height };
}

module.exports = { buildShareCardTo, buildExportTo, buildChartExportTo, loadShareAssets };
