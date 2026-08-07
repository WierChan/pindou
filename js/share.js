// 分享卡片：作品图 + 底部二维码，生成可保存的长图
import { renderPattern } from './board.js';
import { colorStats } from './convert.js';
import { qrMatrix, drawQR } from './qrcode.js';

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

export function buildShareCard(work) {
  const W = 750, M = 48;
  const stats = colorStats(work.cells);
  const total = stats.reduce((a, s) => a + s.count, 0);

  // 作品图（熨烫后的质感）
  const artCell = Math.max(4, Math.min(26, Math.floor((W - M * 2 - 64) / Math.max(work.w, work.h))));
  const art = renderPattern(work, { cellPx: artCell, fused: true, pad: Math.round(artCell * 1.1) });
  const artMaxW = W - M * 2 - 64, artMaxH = 620;
  const k = Math.min(1, artMaxW / art.width, artMaxH / art.height);
  const artW = art.width * k, artH = art.height * k;

  const headerH = 130;
  const panelH = artH + 64;
  const infoH = 116;
  const qrH = 210;
  const footH = 66;
  const H = headerH + panelH + infoH + qrH + footH;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // 背景 + 波点
  ctx.fillStyle = '#FAF6EF';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(120,90,60,.05)';
  for (let y = 10; y < H; y += 22) for (let x = 10; x < W; x += 22) {
    ctx.beginPath(); ctx.arc(x, y, 1.3, 0, 7); ctx.fill();
  }

  // 头部：三颗豆 + 标题
  const beads = [['#FF7D54', '#A8431F'], ['#57ACE8', '#2A5E8F'], ['#FFC913', '#A87F00']];
  beads.forEach(([c1, c2], i) => {
    const bx = W / 2 - 52 + i * 52, by = 52;
    ctx.beginPath(); ctx.arc(bx, by, 17, 0, 7); ctx.fillStyle = c1; ctx.fill();
    ctx.beginPath(); ctx.arc(bx, by, 6.5, 0, 7); ctx.fillStyle = c2; ctx.fill();
  });
  ctx.fillStyle = '#3D3630';
  ctx.textAlign = 'center';
  ctx.font = '800 40px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('指尖拼豆', W / 2, 112);

  // 作品面板
  const py = headerH;
  ctx.save();
  ctx.shadowColor = 'rgba(120,90,60,.16)';
  ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  roundRect(ctx, M, py, W - M * 2, panelH, 24);
  ctx.fillStyle = '#FFFFFF'; ctx.fill();
  ctx.restore();
  ctx.drawImage(art, W / 2 - artW / 2, py + 32, artW, artH);

  // 作品信息
  const iy = py + panelH;
  ctx.fillStyle = '#3D3630';
  ctx.font = '700 34px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`「${work.name}」`, W / 2, iy + 52);
  ctx.fillStyle = '#8C8177';
  ctx.font = '400 24px "PingFang SC", "Microsoft YaHei", sans-serif';
  const d = new Date(work.completedAt || work.updatedAt || Date.now());
  const ds = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  ctx.fillText(`我拼好了 ${total} 颗豆子 · ${stats.length} 种颜色 · ${ds}`, W / 2, iy + 94);

  // 二维码区
  const qy = iy + infoH;
  roundRect(ctx, M, qy, W - M * 2, qrH - 20, 20);
  ctx.fillStyle = '#FFFFFF'; ctx.fill();
  ctx.strokeStyle = 'rgba(120,90,60,.12)'; ctx.lineWidth = 1.5; ctx.stroke();
  let qrOK = true;
  try {
    const mat = qrMatrix(location.origin + '/');
    const px = Math.floor(140 / mat.size);
    const qs = px * mat.size;
    const qx = M + 36, qyy = qy + (qrH - 20) / 2 - qs / 2;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(qx - 10, qyy - 10, qs + 20, qs + 20);
    drawQR(ctx, mat, qx, qyy, px);
  } catch (e) { qrOK = false; }
  ctx.textAlign = 'left';
  const tx = M + 36 + 150 + 34;
  ctx.fillStyle = '#3D3630';
  ctx.font = '700 30px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(qrOK ? '扫码来一起拼' : '搜索「指尖拼豆」', tx, qy + 78);
  ctx.fillStyle = '#8C8177';
  ctx.font = '400 23px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('把喜欢的图片，', tx, qy + 118);
  ctx.fillText('一颗一颗拼出来', tx, qy + 152);

  // 页脚
  ctx.textAlign = 'center';
  ctx.fillStyle = '#B4A99C';
  ctx.font = '400 21px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('—— 指尖拼豆 · 电子拼豆手作 ——', W / 2, qy + qrH + 26);

  return cv;
}

// 导出用的作品图：暖底 + 白色画框 + 作品名 + 底部品牌落款（无二维码，纯收藏版）
export function buildExportImage(work, fused = true) {
  const stats = colorStats(work.cells);
  const total = stats.reduce((a, s) => a + s.count, 0);
  const cellPx = Math.max(10, Math.min(28, Math.floor(1100 / Math.max(work.w, work.h))));
  const art = renderPattern(work, { cellPx, fused, pad: Math.round(cellPx * 1.1) });

  const M = 64;
  const panelPad = 30;
  const panelW = art.width + panelPad * 2;
  const panelH = art.height + panelPad * 2;
  const W = Math.max(640, panelW + M * 2);
  const topM = 56, infoH = 118, footH = 100;
  const H = topM + panelH + infoH + footH;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // 背景 + 波点
  ctx.fillStyle = '#FAF6EF';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(120,90,60,.05)';
  for (let y = 11; y < H; y += 22) for (let x = 11; x < W; x += 22) {
    ctx.beginPath(); ctx.arc(x, y, 1.3, 0, 7); ctx.fill();
  }

  // 白色画框
  const px0 = W / 2 - panelW / 2, py0 = topM;
  ctx.save();
  ctx.shadowColor = 'rgba(120,90,60,.16)';
  ctx.shadowBlur = 26; ctx.shadowOffsetY = 8;
  roundRect(ctx, px0, py0, panelW, panelH, 26);
  ctx.fillStyle = '#FFFFFF'; ctx.fill();
  ctx.restore();
  ctx.drawImage(art, W / 2 - art.width / 2, py0 + panelPad);

  // 作品名 + 信息
  const iy = py0 + panelH;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#3D3630';
  ctx.font = '700 36px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`「${work.name}」`, W / 2, iy + 56);
  const d = new Date(work.completedAt || work.updatedAt || Date.now());
  const ds = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  ctx.fillStyle = '#8C8177';
  ctx.font = '400 23px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`${work.w}×${work.h} · ${total} 颗豆子 · ${ds}`, W / 2, iy + 96);

  // 底部品牌落款：三颗小豆 + 应用名
  const fy = iy + infoH + 34;
  ctx.font = '700 26px "PingFang SC", "Microsoft YaHei", sans-serif';
  const brand = '指尖拼豆';
  const tw = ctx.measureText(brand).width;
  const beadR = 8, gap = 8, beadsW = beadR * 2 * 3 + gap * 2;
  const totalW = beadsW + 16 + tw;
  let bx = W / 2 - totalW / 2 + beadR;
  for (const [c1, c2] of [['#FF7D54', '#A8431F'], ['#57ACE8', '#2A5E8F'], ['#FFC913', '#A87F00']]) {
    ctx.beginPath(); ctx.arc(bx, fy - 9, beadR, 0, 7); ctx.fillStyle = c1; ctx.fill();
    ctx.beginPath(); ctx.arc(bx, fy - 9, beadR * 0.4, 0, 7); ctx.fillStyle = c2; ctx.fill();
    bx += beadR * 2 + gap;
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6B5F53';
  ctx.fillText(brand, W / 2 - totalW / 2 + beadsW + 16, fy);

  return cv;
}

// 弹出分享卡片预览
export function showShareModal(work, host) {
  const cv = buildShareCard(work);
  const url = cv.toDataURL('image/png');

  const ov = document.createElement('div');
  ov.className = 'overlay';
  const modal = document.createElement('div');
  modal.className = 'modal share';
  const img = new Image();
  img.src = url;
  img.className = 'share-img';
  img.alt = '分享卡片';
  modal.appendChild(img);
  modal.insertAdjacentHTML('beforeend',
    '<div class="share-tip">手机上长按图片即可保存 / 转发到朋友圈</div>');
  const btns = document.createElement('div');
  btns.className = 'modal-btns';
  const save = document.createElement('button');
  save.className = 'btn-primary';
  save.textContent = '保存图片';
  save.onclick = () => {
    const a = document.createElement('a');
    a.download = `${work.name}-分享卡.png`;
    a.href = url;
    a.click();
  };
  const close = document.createElement('button');
  close.className = 'btn-ghost';
  close.textContent = '关闭';
  close.onclick = () => ov.remove();
  btns.append(save, close);
  modal.appendChild(btns);
  ov.appendChild(modal);
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  (host || document.body).appendChild(ov);
}
