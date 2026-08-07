// 分享卡片 / 导出图片：直接绘制到传入的 canvas 上
const { drawPatternInto, patternSize } = require('./board');
const { colorStats } = require('./convert');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function dots(ctx, W, H) {
  ctx.fillStyle = 'rgba(120,90,60,.05)';
  for (let y = 10; y < H; y += 22) for (let x = 10; x < W; x += 22) {
    ctx.beginPath(); ctx.arc(x, y, 1.3, 0, 7); ctx.fill();
  }
}

const BRAND_BEADS = [['#FF7D54', '#A8431F'], ['#57ACE8', '#2A5E8F'], ['#FFC913', '#A87F00']];

function drawBrandBeads(ctx, cx, cy, r, gap) {
  let bx = cx - (r * 2 * 3 + gap * 2) / 2 + r;
  for (const pair of BRAND_BEADS) {
    ctx.beginPath(); ctx.arc(bx, cy, r, 0, 7); ctx.fillStyle = pair[0]; ctx.fill();
    ctx.beginPath(); ctx.arc(bx, cy, r * 0.4, 0, 7); ctx.fillStyle = pair[1]; ctx.fill();
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

  // 作品图（熨烫后的质感）
  const artCell = fitCell(work, W - M * 2 - 64, 620, 4, 26);
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

  // 背景 + 波点
  ctx.fillStyle = '#FAF6EF';
  ctx.fillRect(0, 0, W, H);
  dots(ctx, W, H);

  // 头部：三颗豆 + 标题
  drawBrandBeads(ctx, W / 2, 52, 17, 18);
  ctx.fillStyle = '#3D3630';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText('指尖拼豆', W / 2, 112);

  // 作品面板
  const py = headerH;
  ctx.save();
  ctx.shadowColor = 'rgba(120,90,60,.16)';
  ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  roundRect(ctx, M, py, W - M * 2, panelH, 24);
  ctx.fillStyle = '#FFFFFF'; ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(W / 2 - artW / 2, py + 32);
  drawPatternInto(ctx, work, { cellPx: artCell, pad: artPad, fused: true });
  ctx.restore();

  // 作品信息
  const iy = py + panelH;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#3D3630';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('「' + work.name + '」', W / 2, iy + 52);
  ctx.fillStyle = '#8C8177';
  ctx.font = '24px sans-serif';
  ctx.fillText('我拼好了 ' + total + ' 颗豆子 · ' + stats.length + ' 种颜色 · ' + fmtDate(work.completedAt || work.updatedAt), W / 2, iy + 94);

  // 邀请区（小程序无网页链接，用搜索引导替代二维码）
  const qy = iy + infoH;
  roundRect(ctx, M, qy, W - M * 2, inviteH - 20, 20);
  ctx.fillStyle = '#FFFFFF'; ctx.fill();
  ctx.strokeStyle = 'rgba(120,90,60,.12)'; ctx.lineWidth = 1.5; ctx.stroke();
  drawBrandBeads(ctx, W / 2, qy + 46, 10, 10);
  ctx.fillStyle = '#3D3630';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('微信搜索小程序「指尖拼豆」', W / 2, qy + 102);
  ctx.fillStyle = '#8C8177';
  ctx.font = '23px sans-serif';
  ctx.fillText('把喜欢的图片，一颗一颗拼出来', W / 2, qy + 144);

  // 页脚
  ctx.fillStyle = '#B4A99C';
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

  // 背景 + 波点
  ctx.fillStyle = '#FAF6EF';
  ctx.fillRect(0, 0, W, H);
  dots(ctx, W, H);

  // 白色画框
  const px0 = W / 2 - panelW / 2, py0 = topM;
  ctx.save();
  ctx.shadowColor = 'rgba(120,90,60,.16)';
  ctx.shadowBlur = 26; ctx.shadowOffsetY = 8;
  roundRect(ctx, px0, py0, panelW, panelH, 26);
  ctx.fillStyle = '#FFFFFF'; ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(W / 2 - artSize.width / 2, py0 + panelPad);
  drawPatternInto(ctx, work, { cellPx, pad: artPad, fused });
  ctx.restore();

  // 作品名 + 信息
  const iy = py0 + panelH;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#3D3630';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText('「' + work.name + '」', W / 2, iy + 56);
  ctx.fillStyle = '#8C8177';
  ctx.font = '23px sans-serif';
  ctx.fillText(work.w + '×' + work.h + ' · ' + total + ' 颗豆子 · ' + fmtDate(work.completedAt || work.updatedAt), W / 2, iy + 96);

  // 底部品牌落款：三颗小豆 + 应用名
  const fy = iy + infoH + 34;
  ctx.font = 'bold 26px sans-serif';
  const brand = '指尖拼豆';
  const tw = ctx.measureText(brand).width;
  const beadR = 8, gap = 8, beadsW = beadR * 2 * 3 + gap * 2;
  const totalW = beadsW + 16 + tw;
  drawBrandBeads(ctx, W / 2 - totalW / 2 + beadsW / 2, fy - 9, beadR, gap);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6B5F53';
  ctx.fillText(brand, W / 2 - totalW / 2 + beadsW + 16, fy);

  return { width: W, height: H };
}

module.exports = { buildShareCardTo, buildExportTo };
