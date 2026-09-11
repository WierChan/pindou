// 分享卡片 / 导出图片：直接绘制到传入的 canvas 上
const { drawPatternInto, patternSize, workFinish, workHole } = require('./board');
const { colorStats } = require('./convert');
const { PALETTE, textColorFor } = require('./palette');

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
  // finish / hole：作品在熨烫前选的质感与豆孔（withMargin 产出的是展示用副本，显式传进去）
  drawPatternInto(ctx, view, {
    cellPx: artCell, pad: artPad, fused: true, finish: workFinish(work), hole: workHole(work),
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

// 圆角矩形路径
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 文本截到给定宽度（超出加 …）
function fitText(ctx, s, maxW) {
  if (ctx.measureText(s).width <= maxW) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

// 图纸样式导出（分享弹窗「保存图纸」）：仿实体拼豆图纸版式（参照 RED 图纸工坊）——
// 米黄页面底 + 白底网格卡片；格内直接印 MARD 色号（对着图纸抓豆；自带色板作品没有
// 实体色号，退回 1..N 编号）、四边坐标数字、每格淡灰线 + 5 格淡青参考线；
// 底部「名称 · 尺寸 · 色数/总颗数」说明行 + 色号图例（编号 色号 ×数量 ——
// 编号是 app 拼豆页色卡的编号，图例即两套标识的对照桥）。
// 网格区仍是平色格（无豆孔/高光），保存的图可再从「导入拼豆图纸」识别回来（往返闭环）；
// 标题/坐标/图例都画在米黄底上，导入时白底区定位天然把它们排除。
// ⚠ 版式与 tests/export-synth.js 逐项镜像：改这里必须同步改镜像并跑 node tests/chart.test.js
function buildChartExportTo(canvas, work, opts) {
  opts = opts || {};
  const w = work.w, h = work.h, cells = work.cells;
  const maxSide = opts.maxSide || 1600;
  // 格内要塞 2-3 字符 MARD 色号：格子太小（大画布）色号会整幅印不出 → 下限抬到 12
  // 逻辑像素（6px 字号下 3 字符约 10-11px 才塞得进），大画布靠 scale 收进 4096 画布上限
  const cellPx = clamp(Math.floor(maxSide / Math.max(w, h)), opts.minCell || 12, opts.maxCell || 32);
  const hexOf = t => (work.palette ? work.palette[t] : PALETTE[t].hex);

  const stats = colorStats(cells);
  const numOf = new Map(stats.map((s, i) => [s.pal, i + 1]));
  const total = stats.reduce((a, s) => a + s.count, 0);
  // 格内标签：全局色板印 MARD 色号（对着图纸直接抓豆），自带色板作品退回编号
  const labelOf = t => (work.palette ? String(numOf.get(t)) : PALETTE[t].code);

  // 版式（逻辑像素）—— 常量改动要同步 tests/export-synth.js
  const P = 30, HEADER = 56, COORD = 30, CARD_PAD = 14;
  const INFO_H = 46, PILL_H = 42, PILL_GAP = 12, FOOT = 54;
  const gridW = w * cellPx, gridH = h * cellPx;
  const cardW = gridW + CARD_PAD * 2, cardH = gridH + CARD_PAD * 2;
  const lgCols = Math.min(5, stats.length);
  const lgMinW = lgCols ? lgCols * 110 + (lgCols - 1) * PILL_GAP : 0;
  const W = Math.max(COORD * 2 + cardW, lgMinW, 430) + P * 2;
  const CW = W - P * 2;
  const cardX = (W - cardW) / 2;
  const cardY = P + HEADER + COORD;
  const gridX = cardX + CARD_PAD, gridY = cardY + CARD_PAD;
  const infoY = cardY + cardH + COORD + 8;
  const lgY = infoY + INFO_H;
  const lgRows = lgCols ? Math.ceil(stats.length / lgCols) : 0;
  const lgH = lgRows ? lgRows * PILL_H + (lgRows - 1) * PILL_GAP : 0;
  const H = lgY + lgH + FOOT;

  // 分辨率目标 2x；超出 canvas 安全边（~4096）整体降清晰度而不是砍版式
  // （抬高 cellPx 后大画布逻辑尺寸变大，不再 floor 到 1，允许 <1 缩进画布上限内、别溢出）
  const scale = Math.min(opts.scale || 2, 4050 / Math.max(W, H));
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // 页面底 + 头部（品牌三连豆 + 标题 + 日期）
  ctx.fillStyle = '#FBF5EC';
  ctx.fillRect(0, 0, W, H);
  drawBrandBeads(ctx, P + 34, P + 26, 9, 8);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#5F4A4E';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('拼豆便利店', P + 78, P + 27);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#A59795';
  ctx.font = '17px sans-serif';
  ctx.fillText(fmtDate(work.completedAt || work.updatedAt), W - P, P + 28);

  // 白底网格卡片
  ctx.fillStyle = '#FFFFFF';
  rr(ctx, cardX, cardY, cardW, cardH, 14);
  ctx.fill();

  // 平色格（无孔无高光）
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = cells[y * w + x];
      if (t < 0) continue;
      ctx.fillStyle = hexOf(t);
      ctx.fillRect(gridX + x * cellPx, gridY + y * cellPx, cellPx, cellPx);
    }
  }
  // 格线画在豆色上层（真图纸同款，同色区域靠它分格）：每格淡灰、5 格淡青参考线
  for (let k = 0; k <= w; k++) {
    ctx.fillStyle = k % 5 === 0 ? '#C9E4DE' : '#E6E9EB';
    ctx.fillRect(gridX + k * cellPx, gridY, 1, gridH);
  }
  for (let k = 0; k <= h; k++) {
    ctx.fillStyle = k % 5 === 0 ? '#C9E4DE' : '#E6E9EB';
    ctx.fillRect(gridX, gridY + k * cellPx, gridW, 1);
  }
  // 逐格标签（深浅字按格色亮度选）。色号 2-3 字符比编号宽：从理想字号起，
  // 按本作品最宽的标签实测收缩到能塞进格子；缩到 6px 还不行（大板小格）就不印
  ctx.textAlign = 'center';
  const labelTexts = stats.map(s => labelOf(s.pal));
  let lf = Math.min(12, Math.max(6, Math.round(cellPx * 0.5)));
  const widest = () => {
    ctx.font = lf + 'px sans-serif';
    let m = 0;
    for (const t of labelTexts) m = Math.max(m, ctx.measureText(t).width);
    return m;
  };
  while (lf > 6 && widest() > cellPx - 2) lf--;
  // 缩到 6px 的地板后用「塞进整格」判定（居中标签宽 ≤ 格宽即算能印）：
  // cellPx 下限 12，3 字符色号 6px 约 10-11px，能稳稳印出，别再被 -1 的余量卡掉
  if (widest() <= cellPx) {
    ctx.font = lf + 'px sans-serif';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = cells[y * w + x];
        if (t < 0) continue;
        ctx.fillStyle = textColorFor(hexOf(t));
        ctx.fillText(labelOf(t), gridX + (x + 0.5) * cellPx, gridY + (y + 0.5) * cellPx + 0.5);
      }
    }
  }

  // 四边坐标数字（1, 6, 11, …, 尾数；在米黄底上）
  ctx.fillStyle = '#A59795';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  const marks = n => {
    const a = [];
    for (let k = 1; k <= n; k += 5) a.push(k);
    if (a[a.length - 1] !== n) a.push(n);
    return a;
  };
  for (const k of marks(w)) {
    const x = gridX + (k - 0.5) * cellPx;
    ctx.fillText(String(k), x, cardY - COORD / 2);
    ctx.fillText(String(k), x, cardY + cardH + COORD / 2);
  }
  for (const k of marks(h)) {
    const y = gridY + (k - 0.5) * cellPx;
    ctx.fillText(String(k), cardX - COORD / 2, y);
    ctx.fillText(String(k), cardX + cardW + COORD / 2, y);
  }

  // 说明行：「名字」 MARD · w×h · N 色 / 共 total 颗（与 RED 图纸工坊同位置的品牌标识；
  // 文字属色号体系的描述性标注。自带色板作品不是 MARD 豆色，不标）
  ctx.textAlign = 'left';
  ctx.fillStyle = '#5F4A4E';
  ctx.font = 'bold 23px sans-serif';
  const dims = ' ' + (work.palette ? '' : 'MARD · ') + w + '×' + h + ' · ' + stats.length + ' 色 / 共 ' + total + ' 颗';
  const nm = fitText(ctx, '「' + (work.name || '拼豆作品') + '」', CW - ctx.measureText(dims).width);
  ctx.fillText(nm + dims, P, infoY + INFO_H / 2);

  // 图例：色块药丸（编号 MARD色号 ×数量），5 列。
  // 编号与格内/拼豆页色卡一致；MARD 色号只对全局色板作品展示（自带色板不是实体豆色，
  // 标了会误导按码买豆）
  if (lgCols) {
    const pillW = (CW - (lgCols - 1) * PILL_GAP) / lgCols;
    ctx.textAlign = 'center';
    stats.forEach((s, i) => {
      const hex = hexOf(s.pal);
      const code = work.palette ? '' : PALETTE[s.pal].code + ' ';
      const px = P + (i % lgCols) * (pillW + PILL_GAP);
      const py = lgY + Math.floor(i / lgCols) * (PILL_H + PILL_GAP);
      ctx.fillStyle = hex;
      rr(ctx, px, py, pillW, PILL_H, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(95,74,78,.22)';
      ctx.lineWidth = 1.5;
      rr(ctx, px + 0.75, py + 0.75, pillW - 1.5, PILL_H - 1.5, 10);
      ctx.stroke();
      ctx.fillStyle = textColorFor(hex);
      ctx.font = 'bold 17px sans-serif';
      ctx.fillText((i + 1) + ' ' + code + '×' + s.count, px + pillW / 2, py + PILL_H / 2 + 1);
    });
  }

  // 页脚
  ctx.textAlign = 'center';
  ctx.fillStyle = '#B7A8A4';
  ctx.font = '15px sans-serif';
  ctx.fillText('图纸截图可在「新作品 → 导入拼豆图纸」里再拼同款', W / 2, H - FOOT / 2 + 4);

  ctx.textBaseline = 'alphabetic'; // 复位，避免影响共用 canvas 的后续绘制
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
  drawPatternInto(ctx, work, { cellPx, fused, finish: fused ? workFinish(work) : 'smooth', hole: fused ? workHole(work) : 'none' });
  return { width: size.width, height: size.height };
}

module.exports = { buildShareCardTo, buildExportTo, buildChartExportTo, loadShareAssets };
