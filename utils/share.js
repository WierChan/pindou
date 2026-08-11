// 分享卡片 / 导出图片：直接绘制到传入的 canvas 上
const { drawPatternInto, patternSize } = require('./board');
const { colorStats } = require('./convert');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 像素格子底纹（与 app.wxss 的页面底纹同款）
function bgGrid(ctx, W, H) {
  ctx.fillStyle = 'rgba(35,33,58,.05)';
  for (let x = 0; x <= W; x += 26) ctx.fillRect(x, 0, 2, H);
  for (let y = 0; y <= H; y += 26) ctx.fillRect(0, y, W, 2);
}

// 像素风面板：右下掉落式硬投影 + 白底 + 靛墨描边
function pixelPanel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(35,33,58,.16)';
  ctx.fillRect(x + 8, y + 8, w, h);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#23213A';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
}

const BRAND_BEADS = [['#E8504F', '#A93231'], ['#3E6FD8', '#27499A'], ['#F8C82C', '#C09314']];

// 品牌三连豆（像素方豆：方块 + 描边 + 方孔 + 左上高光）
function drawBrandBeads(ctx, cx, cy, r, gap) {
  let bx = cx - (r * 2 * 3 + gap * 2) / 2 + r;
  for (const pair of BRAND_BEADS) {
    const s = r * 2, x = bx - r, y = cy - r;
    ctx.fillStyle = pair[0];
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = '#23213A';
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

// 分享卡片：作品图 + 品牌邀请区，返回逻辑尺寸 {width, height}
function buildShareCardTo(canvas, work, scale) {
  scale = scale || 2;
  const W = 750, M = 48;
  const stats = colorStats(work.cells);
  const total = stats.reduce((a, s) => a + s.count, 0);

  // 作品图（熨烫后的质感）；min 2 保证 256 豆的大画布也能放进卡片
  const artCell = fitCell(work, W - M * 2 - 64, 620, 2, 26);
  const artPad = Math.round(artCell * 1.1);
  const artSize = patternSize(work, { cellPx: artCell, pad: artPad });
  const artW = artSize.width, artH = artSize.height;

  const headerH = 130;
  const panelH = artH + 64;
  const infoH = 116;
  const inviteH = 200;
  const footH = 66;
  const H = headerH + panelH + infoH + inviteH + footH;

  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // 背景 + 像素格纹
  ctx.fillStyle = '#F3EFDF';
  ctx.fillRect(0, 0, W, H);
  bgGrid(ctx, W, H);

  // 头部：三颗方豆 + 标题（带像素红错位阴影）
  drawBrandBeads(ctx, W / 2, 52, 17, 18);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillStyle = 'rgba(232,80,79,.3)';
  ctx.fillText('指尖拼豆', W / 2 + 4, 116);
  ctx.fillStyle = '#23213A';
  ctx.fillText('指尖拼豆', W / 2, 112);

  // 作品面板
  const py = headerH;
  pixelPanel(ctx, M, py, W - M * 2, panelH);
  ctx.save();
  ctx.translate(W / 2 - artW / 2, py + 32);
  drawPatternInto(ctx, work, { cellPx: artCell, pad: artPad, fused: true });
  ctx.restore();

  // 作品信息
  const iy = py + panelH;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#23213A';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('「' + work.name + '」', W / 2, iy + 52);
  ctx.fillStyle = '#8B87A6';
  ctx.font = '24px sans-serif';
  ctx.fillText('我拼好了 ' + total + ' 颗豆子 · ' + stats.length + ' 种颜色 · ' + fmtDate(work.completedAt || work.updatedAt), W / 2, iy + 94);

  // 邀请区（小程序无网页链接，用搜索引导替代二维码）
  const qy = iy + infoH;
  pixelPanel(ctx, M, qy, W - M * 2, inviteH - 20);
  drawBrandBeads(ctx, W / 2, qy + 46, 10, 10);
  ctx.fillStyle = '#23213A';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('微信搜索小程序「指尖拼豆」', W / 2, qy + 102);
  ctx.fillStyle = '#8B87A6';
  ctx.font = '23px sans-serif';
  ctx.fillText('把喜欢的图片，一颗一颗拼出来', W / 2, qy + 144);

  // 页脚
  ctx.fillStyle = '#A29DBB';
  ctx.font = '21px sans-serif';
  ctx.fillText('—— 指尖拼豆 · 电子拼豆手作 ——', W / 2, qy + inviteH + 26);

  return { width: W, height: H };
}

// 导出用的作品图：暖底 + 白色画框 + 作品名 + 底部品牌落款（纯收藏版）
function buildExportTo(canvas, work, fused, scale) {
  scale = scale || 1;
  if (fused == null) fused = true;
  const stats = colorStats(work.cells);
  const total = stats.reduce((a, s) => a + s.count, 0);
  const cellPx = clamp(Math.floor(1100 / Math.max(work.w, work.h)), 10, 28);
  const artPad = Math.round(cellPx * 1.1);
  const artSize = patternSize(work, { cellPx, pad: artPad });

  const M = 64;
  const panelPad = 30;
  const panelW = artSize.width + panelPad * 2;
  const panelH = artSize.height + panelPad * 2;
  const W = Math.max(640, panelW + M * 2);
  const topM = 56, infoH = 118, footH = 100;
  const H = topM + panelH + infoH + footH;

  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // 背景 + 像素格纹
  ctx.fillStyle = '#F3EFDF';
  ctx.fillRect(0, 0, W, H);
  bgGrid(ctx, W, H);

  // 白色画框
  const px0 = W / 2 - panelW / 2, py0 = topM;
  pixelPanel(ctx, px0, py0, panelW, panelH);
  ctx.save();
  ctx.translate(W / 2 - artSize.width / 2, py0 + panelPad);
  drawPatternInto(ctx, work, { cellPx, pad: artPad, fused });
  ctx.restore();

  // 作品名 + 信息
  const iy = py0 + panelH;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#23213A';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText('「' + work.name + '」', W / 2, iy + 56);
  ctx.fillStyle = '#8B87A6';
  ctx.font = '23px sans-serif';
  ctx.fillText(work.w + '×' + work.h + ' · ' + total + ' 颗豆子 · ' + fmtDate(work.completedAt || work.updatedAt), W / 2, iy + 96);

  // 底部品牌落款：三颗小方豆 + 应用名
  const fy = iy + infoH + 34;
  ctx.font = 'bold 26px sans-serif';
  const brand = '指尖拼豆';
  const tw = ctx.measureText(brand).width;
  const beadR = 8, gap = 8, beadsW = beadR * 2 * 3 + gap * 2;
  const totalW = beadsW + 16 + tw;
  drawBrandBeads(ctx, W / 2 - totalW / 2 + beadsW / 2, fy - 9, beadR, gap);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#4A4768';
  ctx.fillText(brand, W / 2 - totalW / 2 + beadsW + 16, fy);

  return { width: W, height: H };
}

module.exports = { buildShareCardTo, buildExportTo };
