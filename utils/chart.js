// 拼豆图纸导入：识别「图纸截图」（小红书图纸工坊等生成的规整图片，非拍照）
// 里的网格，逐格取色还原成本程序的图纸 {w, h, cells}。
//
// 流程：
//   1. 非背景掩码（既非白也非页面底色；格线本身就算内容）按行、列直方图
//      找到网格区，甩开页面标题、坐标数字、底部图例
//   2. 网格区内对亮度做水平/垂直边缘能量投影，自相关求格距（亚像素）+ 相位
//      —— 像素画只在格线处有颜色跳变，能量呈严格周期
//   3. 每格中心区域网点采样取中位数色：细格线/参考线/坐标文字笔画/
//      逐格色号标签/抗锯齿都被中位数滤掉；接近纯白的格判空
//   4. 相近取样色聚成「图纸用色」，按用量排序后作为作品自带色板输出
//      （颜色与图纸一致，不量化到全局色板），cells 存自带色板的下标
//
// 满铺图纸（每格都有颜色，如风景/照片类，没有白底）：页面非白且找不到
// 可信白底区时进入满铺模式 —— 近白格按「白色豆子」保留（只有主体保护圈
// 外的才判空）；紧贴网格的裁剪图四边落在不同色豆子上，pageBg 判定
// 无统一页面底色返回 null，整图按内容处理
//
// 已知边界：拍照/透视图纸不支持（需要规整截图）；白底图纸上纯白豆与空格无法区分
const { rgb2oklab } = require('./convert');

const MIN_PITCH = 5.5;   // 每格最少像素：再小取色就不可靠了，让用户换清晰截图
const MAX_CELLS = 256;   // 与创建页 SIZE_CAP 一致（storage / 渲染性能约束）
// 裁剪后图案的最小边长。别设太高：自由画布的小作品（5×5 爱心）走
// 图纸样式导出→再导入是合法路径；照片误识别由 conf/ratio 门槛拦
const MIN_CELLS = 4;
const MAX_COLORS = 48;   // 自带色板上限：正常图纸 ≤ 40 色，超出的并入最近色

function lab2(a, b) {
  const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

/* ---------- 1. 网格区域定位 ---------- */

// 全图单遍扫描，一次产出后续都要用的两样东西：
//   mask —— 非背景像素（既不接近纯白，也不接近页面底色）。网格线、参考线、
//           豆子（含近白豆）、文字都算内容；网格区布满格线，每行每列内容量
//           稳定，整块连成图里最大的连续带
//   whiteRows —— 每行近白像素数，白底区定位（findWhiteBody）用
// 原本是三个独立的全图循环（亮度表 + 掩码 + 近白），真机解释器上每遍全图
// 都是几百毫秒量级，合并成一遍；亮度改由 edgeProfiles 就地现算
function scanImage(data, iw, ih, bg) {
  const n = iw * ih;
  const mask = new Uint8Array(n);
  const whiteRows = new Float64Array(ih);
  const T = 20;      // 非背景判定容差
  const TW = 14;     // 近白判定容差（白底区定位用）
  const hasBg = !!bg;
  const br = hasBg ? bg[0] : 0, bgc = hasBg ? bg[1] : 0, bb = hasBg ? bg[2] : 0;
  for (let y = 0; y < ih; y++) {
    let wc = 0, i = y * iw, o = i * 4;
    for (let x = 0; x < iw; x++, i++, o += 4) {
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const wr = 255 - r, wg = 255 - g, wb = 255 - b;
      if (wr <= TW && wg <= TW && wb <= TW) wc++;
      let dw = wr;                    // 与白的最大通道差
      if (wg > dw) dw = wg;
      if (wb > dw) dw = wb;
      if (dw <= T) continue;          // 近白：不算内容
      if (hasBg) {                    // 近页面底色：不算内容
        let db = r - br; if (db < 0) db = -db;
        let d2 = g - bgc; if (d2 < 0) d2 = -d2; if (d2 > db) db = d2;
        let d3 = b - bb; if (d3 < 0) d3 = -d3; if (d3 > db) db = d3;
        if (db <= T) continue;
      }
      mask[i] = 1;
    }
    whiteRows[y] = wc;
  }
  return { mask, whiteRows };
}

// 直方图里最佳的一段连续高值带；小缺口（bridge 像素内）当作连续。
// 评分 = 累计值 × √带高：图案主体又高又密，优先于底部矮而密的图例色块带
function mainBand(hist, thr, bridge) {
  let bs = -1, be = -1, bn = -1; // 最佳带
  let s = -1, e = -1, n = 0;     // 当前带
  let gap = 0;
  for (let i = 0; i <= hist.length; i++) {
    const on = i < hist.length && hist[i] > thr;
    if (on) {
      if (s < 0) { s = i; n = 0; }
      e = i; n += hist[i]; gap = 0;
    } else if (s >= 0) {
      gap++;
      if (gap > bridge || i === hist.length) {
        const score = n * Math.sqrt(e - s + 1);
        if (score > bn) { bn = score; bs = s; be = e; }
        s = -1;
      }
    }
  }
  return bs < 0 ? null : { s: bs, e: be };
}

// 白底区域定位：图纸网格永远铺在白底上，而页面底色（米黄、可能带装饰
// 网格纹理）、标题、说明文字、图例色块都在非白底上 —— 按「近白像素」的
// 行列直方图框出白底区，比内容掩码更稳。页面本身就是白的时候不可用（调用方回退）
function findWhiteBody(data, iw, ih, rows) {
  const T = 14;
  const bridge = Math.max(12, Math.round(ih * 0.022));
  const rb = mainBand(rows, iw * 0.04, bridge);
  if (!rb) return null;

  const cols = new Float64Array(iw);
  for (let y = rb.s; y <= rb.e; y++) {
    let o = y * iw * 4;
    for (let x = 0; x < iw; x++, o += 4) {
      if (255 - data[o] <= T && 255 - data[o + 1] <= T && 255 - data[o + 2] <= T) cols[x]++;
    }
  }
  const cb = mainBand(cols, (rb.e - rb.s + 1) * 0.04, Math.max(12, Math.round(iw * 0.022)));
  if (!cb) return null;
  const rect = { x0: cb.s, x1: cb.e + 1, y0: rb.s, y1: rb.e + 1 };
  // 尺寸校验：白底网格区必然占图片相当比例；满铺图里成片的纯白豆
  // （如角色的白眼睛）也能凑出一小块高白占比区域，不设下限会被框走
  // （真机：紧裁剪的满铺图被 clip 到眼睛区，输出 11×13）
  if (rect.x1 - rect.x0 < iw * 0.3 || rect.y1 - rect.y0 < ih * 0.3) return null;
  // 校验：框内近白占比够高才是真的「白底网格区」。满铺图纸（每格都有颜色）
  // 没有白底，直方图会用白豆/白色标签/浅格线拼出碎带 —— 拿去当裁剪范围，
  // 网格会整段丢失（真机：满铺风景图的天空全被裁掉）
  let wc = 0, tot = 0;
  const step = Math.max(1, Math.round(Math.min(rect.x1 - rect.x0, rect.y1 - rect.y0) / 200));
  for (let y = rect.y0; y < rect.y1; y += step) {
    for (let x = rect.x0; x < rect.x1; x += step) {
      const o = (y * iw + x) * 4;
      if (255 - data[o] <= T && 255 - data[o + 1] <= T && 255 - data[o + 2] <= T) wc++;
      tot++;
    }
  }
  if (!tot || wc / tot < 0.2) return null;
  return rect;
}

// 找图案主体 bbox：行带 → 带内列带。clip 限定统计范围（白底区），
// 让页面纹理、白底区外的图例/说明进不了直方图。
// thrFrac：分带阈值（默认 5%，稀疏图案的行也有格线交点/描边垫底）；
// 满铺模式没有白底区可裁，改传高阈值（网格是全图最密的内容带），
// 免得紧贴网格的坐标数字/图例被 bridge 桥进主体
function findBody(mask, iw, ih, clip, thrFrac) {
  thrFrac = thrFrac || 0.05;
  const cx0 = clip ? clip.x0 : 0, cx1 = clip ? clip.x1 : iw;
  const cy0 = clip ? clip.y0 : 0, cy1 = clip ? clip.y1 : ih;
  const rows = new Float64Array(ih);
  for (let y = cy0; y < cy1; y++) {
    let c = 0;
    const base = y * iw;
    for (let x = cx0; x < cx1; x++) c += mask[base + x];
    rows[y] = c;
  }
  let rMax = 0;
  for (let y = cy0; y < cy1; y++) if (rows[y] > rMax) rMax = rows[y];
  if (rMax < (cx1 - cx0) * 0.04) return null; // 范围内几乎没有内容
  // 底部图例色块行虽然也密，但带高远小于图案区，评分挑不过
  const bridge = Math.max(12, Math.round(ih * 0.022));
  const rb = mainBand(rows, rMax * thrFrac, bridge);
  if (!rb) return null;

  const cols = new Float64Array(iw);
  for (let y = rb.s; y <= rb.e; y++) {
    const base = y * iw;
    for (let x = cx0; x < cx1; x++) cols[x] += mask[base + x];
  }
  let cMax = 0;
  for (let x = cx0; x < cx1; x++) if (cols[x] > cMax) cMax = cols[x];
  const cb = mainBand(cols, cMax * thrFrac, Math.max(12, Math.round(iw * 0.022)));
  if (!cb) return null;
  return { x0: cb.s, x1: cb.e + 1, y0: rb.s, y1: rb.e + 1 };
}

/* ---------- 2. 格距 / 相位 ---------- */

// 主体内的亮度边缘能量投影：gx[x] = Σy |L(x+1)-L(x)|（行方向 step 抽样）。
// 同时统计「支撑率」sx[x] = 有明显跳变（|d|>8）的采样行占比 ——
// 真格线是贯穿主体的线（几乎每行都有跳变），逐格色号标签只是局部纹理
// （只有笔画经过的行有），支撑率把二者分开
// 亮度直接从 RGBA 算，不建全图亮度表：投影只看主体内的抽样行/列，
// 现算比建 200 万项的表再读回更省（真机上这一项就是几百毫秒）
function edgeProfiles(data, iw, body) {
  const { x0, x1, y0, y1 } = body;
  const gx = new Float64Array(x1 - x0 - 1);
  const gy = new Float64Array(y1 - y0 - 1);
  const sx = new Float64Array(x1 - x0 - 1);
  const sy = new Float64Array(y1 - y0 - 1);
  // 抽样上限 360 行/列：投影是几百行的累加，再密提升不了信噪比，
  // 却成倍拉高真机（无 JIT）耗时
  const stepY = Math.max(1, Math.round((y1 - y0) / 360));
  const stepX = Math.max(1, Math.round((x1 - x0) / 360));
  let nRow = 0;
  for (let y = y0; y < y1; y += stepY) {
    nRow++;
    let o = (y * iw + x0) * 4;
    let prev = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8;
    for (let x = x0; x < x1 - 1; x++) {
      o += 4;
      const cur = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8;
      const d = cur - prev;
      const a = d < 0 ? -d : d;
      gx[x - x0] += a;
      if (a > 8) sx[x - x0]++;
      prev = cur;
    }
  }
  let nCol = 0;
  for (let x = x0; x < x1; x += stepX) nCol++;
  // 上一行（抽样列）的亮度缓存：每个像素只算一次
  const prevRow = new Uint8Array(nCol);
  {
    let c = 0;
    for (let x = x0; x < x1; x += stepX, c++) {
      const o = (y0 * iw + x) * 4;
      prevRow[c] = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8;
    }
  }
  for (let y = y0; y < y1 - 1; y++) {
    const b1 = (y + 1) * iw;
    let c = 0;
    for (let x = x0; x < x1; x += stepX, c++) {
      const o = (b1 + x) * 4;
      const cur = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8;
      const d = cur - prevRow[c];
      const a = d < 0 ? -d : d;
      gy[y - y0] += a;
      if (a > 8) sy[y - y0]++;
      prevRow[c] = cur;
    }
  }
  if (nRow) for (let i = 0; i < sx.length; i++) sx[i] /= nRow;
  if (nCol) for (let i = 0; i < sy.length; i++) sy[i] /= nCol;
  return { gx, gy, sx, sy };
}

// 线性插值取样
function sampleAt(g, x) {
  const i = Math.floor(x);
  if (i < 0 || i >= g.length - 1) return i === g.length - 1 ? g[i] : 0;
  const f = x - i;
  return g[i] * (1 - f) + g[i + 1] * f;
}

// 给定浮点格距，扫描相位：返回最佳 {offset, score}
// score = 落在格线上的平均能量（亚像素梳齿采样）
function bestPhase(g, pitch) {
  let bo = 0, bscore = -1;
  const n = Math.floor((g.length - 2) / pitch);
  if (n < 2) return { offset: 0, score: 0 };
  for (let o = 0; o < pitch; o += 0.25) {
    let s = 0, c = 0;
    for (let k = 0; k * pitch + o < g.length - 1; k++) {
      s += sampleAt(g, o + k * pitch);
      c++;
    }
    const sc = s / c;
    if (sc > bscore) { bscore = sc; bo = o; }
  }
  return { offset: bo, score: bscore };
}

// 梳齿统计（扣基线）。基线 = 能量中位数 ≈ 每格中间位置的累积噪声：
// JPEG 噪声按行累加后底子很高，绝对能量骗人，扣掉基线才看得出结构。
// fracWeak = 明显弱于「强齿平均」的齿占比 —— 判别谐波的关键：
//   真格距：每条格线都有累积能量，弱齿很少；
//   半格距：一半齿落在格子中间，扣基线后≈0，弱齿占比≈50%，一票否决
function combStats(g, pitch, offset, baseline) {
  const teeth = [];
  for (let k = 0; ; k++) {
    const c = offset + k * pitch;
    if (c > g.length - 1) break;
    let m = 0;
    for (let d = -1; d <= 1; d++) {
      const v = sampleAt(g, c + d);
      if (v > m) m = v;
    }
    teeth.push(Math.max(0, m - baseline));
  }
  if (!teeth.length) return { fracWeak: 1 };
  const sorted = teeth.slice().sort((a, b) => b - a);
  const nTop = Math.max(1, sorted.length >> 1);
  let topMean = 0;
  for (let i = 0; i < nTop; i++) topMean += sorted[i];
  topMean /= nTop;
  const floor = topMean * 0.3;
  let weak = 0;
  for (const t of teeth) if (t < floor) weak++;
  return { fracWeak: weak / teeth.length };
}

// 在给定格距附近 ±0.4px 亚像素精化（相位同步优化），并算弱齿占比。
// 必须先精化再评估：非整数格距下 R 峰只给整数近似，
// 几十根齿的累计漂移会把弱齿统计全毁掉
function refineAt(g, p, baseline) {
  let cand = null;
  for (let dp = -0.4; dp <= 0.4; dp += 0.04) {
    const cp = p + dp;
    if (cp < MIN_PITCH) continue;
    const ph = bestPhase(g, cp);
    if (!cand || ph.score > cand.score) cand = { pitch: cp, offset: ph.offset, score: ph.score };
  }
  if (cand) cand.fracWeak = combStats(g, cand.pitch, cand.offset, baseline).fracWeak;
  return cand;
}

// 候选梳的「格线支撑率」：齿位上有贯穿性格线（支撑率明显高于基准）的齿占比。
// 半格距候选一半齿落在格子中间 —— 满铺图纸的逐格色号标签能把那里的累积
// 能量填出来（骗过弱齿判别），但格子中间没有贯穿的线，支撑率露馅
function lineFrac(s, pitch, offset, sBase) {
  let cnt = 0, n = 0;
  for (let k = 0; ; k++) {
    const c = offset + k * pitch;
    if (c > s.length - 1) break;
    let m = 0;
    for (let d = -1; d <= 1; d++) {
      const v = sampleAt(s, c + d);
      if (v > m) m = v;
    }
    if (m >= sBase + 0.25) cnt++;
    n++;
  }
  return n ? cnt / n : 0;
}

// 自相关求格距：R(p) 全局峰 → 抛物线亚像素精化。
// 峰有时落在真实格距的整数倍上（5 格参考线强于淡格线 / 图案 2 格一色时），
// 所以在 峰值/k 候选里选「弱齿占比达标的最小格距」——
// 整数倍候选虽然每齿都强但格距偏大，减半候选弱齿过半被否，真格距恰好全对齐。
// s 为支撑率投影：格线支撑率达标是首选条件（防满铺标签的半格距陷阱），
// 全都不达标时退回按能量弱齿挑（格线被豆子盖住的版式没有支撑率可用）
function detectPitch(g, s) {
  const len = g.length;
  // 除数 3.5：4 格边长的小图纸也够放下真格距的自相关滞后
  const pMax = Math.min(220, Math.floor(len / 3.5));
  if (pMax < Math.ceil(MIN_PITCH) + 2) return null;
  const R = new Float64Array(pMax + 2);
  for (let p = Math.floor(MIN_PITCH); p <= pMax + 1; p++) {
    let s = 0;
    for (let x = 0; x + p < len; x++) s += g[x] * g[x + p];
    R[p] = s / (len - p);
  }
  let p0 = 0, r0 = -1;
  for (let p = Math.floor(MIN_PITCH) + 1; p <= pMax; p++) {
    if (R[p] > r0) { r0 = R[p]; p0 = p; }
  }
  if (p0 <= 0) return null;
  const ra = R[p0 - 1], rb = R[p0], rc = R[p0 + 1];
  const denom = ra - 2 * rb + rc;
  const pBase = p0 + (denom ? 0.5 * (ra - rc) / denom : 0);

  // 基线：能量中位数（绝大多数位置不是格线）
  const tmp = Array.from(g).sort((a, b) => a - b);
  const baseline = tmp[tmp.length >> 1];

  const sTmp = Array.from(s).sort((a, b) => a - b);
  const sBase = sTmp[sTmp.length >> 1];

  const cands = [];
  // 除数上不封顶（MIN_PITCH 兜底）：真机踩过 R 全局峰落在真格距 7 倍上
  // （满铺+逐格标签的重纹理图），k≤6 会让真格距根本进不了候选
  for (let k = 1; k <= 48; k++) {
    const p = pBase / k;
    if (p < MIN_PITCH) break;
    const cand = refineAt(g, p, baseline);
    if (cand) {
      cand.fracLine = lineFrac(s, cand.pitch, cand.offset, sBase);
      cands.push(cand);
    }
  }
  if (!cands.length) return null;
  // 弱齿占比 ≤ 0.34 且格线支撑达标的候选里取最小格距；
  // 支撑率全不达标（格线被豆子盖住/压缩抹掉的版式）就退回只按弱齿挑。
  // 能量判别对「压缩后格线消失的满铺图」可能整体失效（半格距被标签能量
  // 抬到达标）—— 那一类由 analyzeChart 的内容终检 halfLocked 兜底翻倍
  let pick = null;
  for (let i = cands.length - 1; i >= 0; i--) {
    if (cands[i].fracWeak <= 0.34 && cands[i].fracLine >= 0.6) { pick = cands[i]; break; }
  }
  if (!pick) {
    for (let i = cands.length - 1; i >= 0; i--) {
      if (cands[i].fracWeak <= 0.34) { pick = cands[i]; break; }
    }
  }
  if (!pick) {
    pick = cands[0];
    for (const c of cands) if (c.fracWeak < pick.fracWeak) pick = c;
  }
  const best = pick;
  // 置信度：格线上的能量 vs 全线平均能量
  let mean = 0;
  for (let x = 0; x < len; x++) mean += g[x];
  mean /= len;
  return {
    pitch: best.pitch, offset: best.offset,
    conf: mean > 0 ? best.score / mean : 0,
    fracLine: best.fracLine,
  };
}

// 十字救援：图纸格子必为正方形，两轴挑了不同谐波时，
// 拿可信轴的格距按到问题轴上重试（只搜相位和 ±0.4px 微调）
function forcePitch(g, s, pitch) {
  const tmp = Array.from(g).sort((a, b) => a - b);
  const cand = refineAt(g, pitch, tmp[tmp.length >> 1]);
  if (!cand) return null;
  let mean = 0;
  for (let x = 0; x < g.length; x++) mean += g[x];
  mean /= g.length;
  cand.conf = mean > 0 ? cand.score / mean : 0;
  const sTmp = Array.from(s).sort((a, b) => a - b);
  cand.fracLine = lineFrac(s, cand.pitch, cand.offset, sTmp[sTmp.length >> 1]);
  return cand;
}

/* ---------- 3. 取样 ---------- */

// 图片四边外圈估计页面底色。四边各取 24 点求通道中位数，任一边与整体偏差
// 过大说明图片没有统一的页面边距（比如紧贴满铺网格的裁剪图：四边分别落在
// 天空/地面等不同色的豆子上）—— 返回 null，调用方按「无页面底色」处理，
// 免得把某种豆色当背景剔掉半张图
function pageBg(data, iw, ih) {
  const m = Math.max(2, Math.round(Math.min(iw, ih) * 0.01));
  const mid = a => { a.sort((u, v) => u - v); return a[a.length >> 1]; };
  const edgeMed = pts => {
    const rs = [], gs = [], bs = [];
    for (const [x, y] of pts) {
      const o = (y * iw + x) * 4;
      rs.push(data[o]); gs.push(data[o + 1]); bs.push(data[o + 2]);
    }
    return [mid(rs), mid(gs), mid(bs)];
  };
  const top = [], bot = [], lef = [], rig = [];
  for (let i = 0; i < 24; i++) {
    const x = m + Math.round((iw - 2 * m) * (i / 23));
    const y = m + Math.round((ih - 2 * m) * (i / 23));
    top.push([x, m]); bot.push([x, ih - 1 - m]);
    lef.push([m, y]); rig.push([iw - 1 - m, y]);
  }
  const meds = [top, bot, lef, rig].map(edgeMed);
  const all = [0, 1, 2].map(c => {
    const v = meds.map(e => e[c]);
    v.sort((u, w) => u - w);
    return v[2];
  });
  for (const e of meds) {
    if (Math.abs(e[0] - all[0]) > 24 || Math.abs(e[1] - all[1]) > 24 || Math.abs(e[2] - all[2]) > 24) return null;
  }
  return all;
}

/* 取色用的模块级缓冲与直方图 —— cellColor 每格调用一次（大图上万次），
   真机是无 JIT 的解释器，逐次分配数组 + 闭包 sort 是压倒性开销（实测占总耗时
   一半以上）。这里全部改成定长缓冲 + 值域直方图，零分配零闭包 */
const SAMP_CAP = 11 * 11;
const sR = new Uint8Array(SAMP_CAP), sG = new Uint8Array(SAMP_CAP), sB = new Uint8Array(SAMP_CAP);
const kR = new Uint8Array(SAMP_CAP), kG = new Uint8Array(SAMP_CAP), kB = new Uint8Array(SAMP_CAP);
const HIST = new Uint16Array(256);

// 0-255 值域的中位数：计数 → 累加过半 → 只清被用到的桶（等价于 sort()[n>>1]）
function medOf(buf, n) {
  for (let i = 0; i < n; i++) HIST[buf[i]]++;
  const half = n >> 1;
  let acc = 0, m = 0;
  for (let v = 0; v < 256; v++) {
    acc += HIST[v];
    if (acc > half) { m = v; break; }
  }
  for (let i = 0; i < n; i++) HIST[buf[i]] = 0;
  return m;
}

// 单格取色：中心区域 n×n 网点，逐通道取中位数，再收敛一轮 ——
// 剔除与中位数差得远的少数派像素（逐格色号标签的笔画、格线、抗锯齿、噪点）
// 重取中位数，让结果落回豆色本身。格子够大时取到 72%（留 14% 边距避开格线）：
// 采样面积越大，印在格子中央的色号标签占比越低，中位数越稳
function cellColor(data, iw, ih, cx, cy, pitch) {
  const half = pitch * (pitch >= 9 ? 0.36 : 0.3);
  const n = Math.min(11, Math.max(3, Math.round(pitch * 0.7)));
  const span = 2 * half, den = n === 1 ? 1 : n - 1;
  let cnt = 0;
  for (let j = 0; j < n; j++) {
    const y = Math.round(cy - half + span * (n === 1 ? 0.5 : j / den));
    if (y < 0 || y >= ih) continue;
    const row = y * iw;
    for (let i = 0; i < n; i++) {
      const x = Math.round(cx - half + span * (n === 1 ? 0.5 : i / den));
      if (x < 0 || x >= iw) continue;
      const o = (row + x) * 4;
      if (data[o + 3] < 200) { sR[cnt] = 255; sG[cnt] = 255; sB[cnt] = 255; cnt++; continue; }
      sR[cnt] = data[o]; sG[cnt] = data[o + 1]; sB[cnt] = data[o + 2]; cnt++;
    }
  }
  if (!cnt) return [255, 255, 255];
  const mr = medOf(sR, cnt), mg = medOf(sG, cnt), mb = medOf(sB, cnt);
  let k = 0;
  for (let i = 0; i < cnt; i++) {
    const r = sR[i], g = sG[i], b = sB[i];
    if (r - mr > 30 || mr - r > 30 || g - mg > 30 || mg - g > 30 || b - mb > 30 || mb - b > 30) continue;
    kR[k] = r; kG[k] = g; kB[k] = b; k++;
  }
  // 多数派太少说明初值就落在了杂色上（标签浓到过半），收敛无意义，保持原中位数
  if (k < cnt * 0.4) return [mr, mg, mb];
  return [medOf(kR, k), medOf(kG, k), medOf(kB, k)];
}

// 半格距相位锁定检测（内容终检）：沿轴取几条带的连续格中心色，看相邻对的
// 同色率。若当前格距是真格距的一半，k=偶 与 k=偶+1 是同一颗豆的两半 ——
// 偶起对几乎全同色、奇起对只有邻豆恰好同色时才同色，两者严重不对称；
// 真格距下同色率与起点奇偶无关。压缩把格线抹掉、标签又把能量域判别骗过时，
// 这是唯一还站得住的信号（直接看图像内容，不依赖格线/能量）
function halfLocked(data, iw, ih, inner, pitch, offset, vertical) {
  // 同色阈取 0.045（真机压缩图上同一颗豆两半的取样差可到 0.03+；
  // 阈值收太紧时两边同色率都掉，不对称性反而被噪声淹没）
  const D2 = 0.045 * 0.045;
  const L = vertical ? inner.y1 - inner.y0 : inner.x1 - inner.x0;
  const W2 = vertical ? inner.x1 - inner.x0 : inner.y1 - inner.y0;
  const n = Math.min(160, Math.floor((L - 2) / pitch) - 1);
  if (n < 8) return false;
  const m = [0, 0], cnt = [0, 0];
  for (let t = 0; t < 7; t++) {
    const cross = (vertical ? inner.x0 : inner.y0) + (t + 0.5) * W2 / 7;
    let prev = null;
    for (let k = 0; k < n; k++) {
      const along = (vertical ? inner.y0 : inner.x0) + offset + (k + 0.5) * pitch;
      const cx = vertical ? cross : along;
      const cy = vertical ? along : cross;
      if (cx < 1 || cy < 1 || cx >= iw - 1 || cy >= ih - 1) { prev = null; continue; }
      const rgb = cellColor(data, iw, ih, cx, cy, pitch);
      const lab = rgb2oklab(rgb[0], rgb[1], rgb[2]);
      if (prev) {
        const par = (k - 1) & 1;
        cnt[par]++;
        if (lab2(prev, lab) < D2) m[par]++;
      }
      prev = lab;
    }
  }
  if (cnt[0] < 20 || cnt[1] < 20) return false;
  const a = m[0] / cnt[0], b = m[1] / cnt[1];
  const hi = Math.max(a, b), lo = Math.min(a, b);
  // 真机实测：半格距 hi≈0.93/0.96、差≈0.15/0.17；真格距差≈0.04
  return hi >= 0.85 && hi - lo >= 0.12;
}

/* ---------- 4. 聚色 ---------- */

// 把每格取样色聚成图纸用色（生成图 + JPEG 噪声，同色格取样值非常接近）。
// 阈值收紧到 0.016：C16/C20 这类相邻藏青色号也要分开，各自成板上一色
const GROUP_D2 = 0.016 * 0.016;

function groupColors(samples) {
  // samples: [{rgb, lab}]，返回 groups + 每格所属 group
  const groups = []; // {lab, sum:[r,g,b], count}
  const gi = new Int32Array(samples.length).fill(-1);
  for (let s = 0; s < samples.length; s++) {
    const it = samples[s];
    if (!it) continue;
    let best = -1, bd = GROUP_D2, nearest = -1, nd = Infinity;
    for (let g = 0; g < groups.length; g++) {
      const d = lab2(it.lab, groups[g].lab);
      if (d < bd) { bd = d; best = g; }
      if (d < nd) { nd = d; nearest = g; }
    }
    // 组数封顶：渐变类的病态输入不至于聚出上千组拖慢流程（正常图纸 ≤ 几十色）
    if (best < 0 && groups.length >= 400) best = nearest;
    if (best < 0) {
      groups.push({
        lab: it.lab.slice(),
        sum: [it.rgb[0], it.rgb[1], it.rgb[2]],
        count: 1,
      });
      gi[s] = groups.length - 1;
    } else {
      const g = groups[best];
      g.sum[0] += it.rgb[0]; g.sum[1] += it.rgb[1]; g.sum[2] += it.rgb[2];
      g.count++;
      // 运行均值让组中心逐渐贴住真实色
      const r = g.sum[0] / g.count, gg = g.sum[1] / g.count, b = g.sum[2] / g.count;
      g.lab = rgb2oklab(r, gg, b);
      gi[s] = best;
    }
  }
  // 双胞胎合并：贪心一遍聚出的组心会因均值漂移/归组顺序出现距离仍 < 阈值的
  // 重复组（压缩噪声大的图能把一种颜色裂成好几组），并到用量大的一方再压实。
  // 阈值就是 GROUP_D2 —— 真正相邻的图纸色号（C16/C20）组心距离在阈值之上，不受影响
  const remap = groups.map((_, i) => i);
  let merged = true;
  while (merged) {
    merged = false;
    for (let a = 0; a < groups.length; a++) {
      if (remap[a] !== a) continue;
      for (let b = a + 1; b < groups.length; b++) {
        if (remap[b] !== b) continue;
        if (lab2(groups[a].lab, groups[b].lab) >= GROUP_D2) continue;
        const big = groups[a].count >= groups[b].count ? a : b;
        const small = big === a ? b : a;
        const G = groups[big], S = groups[small];
        G.sum[0] += S.sum[0]; G.sum[1] += S.sum[1]; G.sum[2] += S.sum[2];
        G.count += S.count;
        G.lab = rgb2oklab(G.sum[0] / G.count, G.sum[1] / G.count, G.sum[2] / G.count);
        remap[small] = big;
        merged = true;
        if (big === b) break; // a 已被并掉，换下一个 a
      }
    }
  }
  const resolve = g => { while (remap[g] !== g) g = remap[g]; return g; };
  const idx = new Array(groups.length);
  const compact = [];
  for (let i = 0; i < groups.length; i++) {
    if (resolve(i) === i) { idx[i] = compact.length; compact.push(groups[i]); }
  }
  for (let i = 0; i < gi.length; i++) if (gi[i] >= 0) gi[i] = idx[resolve(gi[i])];
  return { groups: compact, gi };
}

// 组数超上限时：把用量最少的组并入最近的存活组，返回组下标重映射表
function capGroups(groups, cap) {
  const remap = groups.map((_, i) => i);
  if (groups.length <= cap) return remap;
  const alive = new Set(groups.map((_, i) => i));
  while (alive.size > cap) {
    let minG = -1, minC = Infinity;
    for (const g of alive) if (groups[g].count < minC) { minC = groups[g].count; minG = g; }
    let best = -1, bd = Infinity;
    for (const g of alive) {
      if (g === minG) continue;
      const d = lab2(groups[minG].lab, groups[g].lab);
      if (d < bd) { bd = d; best = g; }
    }
    groups[best].count += groups[minG].count;
    alive.delete(minG);
    remap[minG] = best;
  }
  const resolve = g => { while (remap[g] !== g) g = remap[g]; return g; };
  return remap.map((_, i) => resolve(i));
}

const hex2 = v => (v < 16 ? '0' : '') + Math.round(v).toString(16).toUpperCase();
const rgbToHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);

/* ---------- 主入口 ---------- */

// data/iw/ih：RGBA 像素（convert.loadImageToData 的产物）
// 成功 → { ok:true, w, h, cells, colorN, total, pitch, conf }
// 失败 → { ok:false, reason }
function analyzeChart(data, iw, ih, opts) {
  opts = opts || {};
  if (!data || iw < 60 || ih < 60) return { ok: false, reason: '图片太小' };

  const bg = pageBg(data, iw, ih); // null = 没有统一页面底色（紧贴网格的裁剪图）
  // 亮度图 + 非背景掩码 + 近白行直方图（单遍全图）
  const { mask, whiteRows } = scanImage(data, iw, ih, bg);
  // 页面底色不是白（或没有底色）→ 先框出白底区（网格铺在白底上；图例/说明/
  // 页面装饰纹理都在非白底上，天然排除），再在白底区内取内容 bbox 作为主体。
  // 页面就是白的则直接全图取内容 bbox（图例靠留白与主体分带）
  const bgNotWhite = !bg || 255 - Math.min(bg[0], bg[1], bg[2]) > 20;
  let clipW = null;
  if (bgNotWhite) clipW = findWhiteBody(data, iw, ih, whiteRows);
  // 满铺模式（页面非白且无白底区）：网格全图最密，高阈值分带
  const body = findBody(mask, iw, ih, clipW, bgNotWhite && !clipW ? 0.45 : 0.05);
  if (!body) return { ok: false, reason: '找不到图案区域' };
  if (body.x1 - body.x0 < 40 || body.y1 - body.y0 < 40) {
    return { ok: false, reason: '图案区域太小' };
  }

  // 主体向内收 3%，避免边缘文字/描边干扰周期检测
  const inX = Math.round((body.x1 - body.x0) * 0.03);
  const inY = Math.round((body.y1 - body.y0) * 0.03);
  const inner = { x0: body.x0 + inX, x1: body.x1 - inX, y0: body.y0 + inY, y1: body.y1 - inY };
  const { gx, gy, sx, sy } = edgeProfiles(data, iw, inner);
  let px = detectPitch(gx, sx);
  let py = detectPitch(gy, sy);
  if (!px || !py) return { ok: false, reason: '识别不出网格', debug: { body } };
  // 半格距终检（内容裁决）：检测到相邻格成对同色的相位锁定就翻倍重精化
  const promote = (a, g, s, vertical) => {
    for (let t = 0; t < 2; t++) {
      if (a.pitch * 2 > g.length / 3) break;
      if (!halfLocked(data, iw, ih, inner, a.pitch, a.offset, vertical)) break;
      const up = forcePitch(g, s, a.pitch * 2);
      if (!up) break;
      a = up;
    }
    return a;
  };
  px = promote(px, gx, sx, false);
  py = promote(py, gy, sy, true);
  // 满铺模式：网格铺满主体（高阈值 dense band 的边界就是网格边界，实测精确
  // 到 2px 内），直接用主体边到边校准相位和格距 —— 这类图的能量相位会被
  // 逐格色号标签带偏（标签梳强过格界梳），采样中心偏到格界上会串半格/丢首末行
  if (bgNotWhite && !clipW) {
    const snap = (a, lo, hi, innerLo) => {
      const span = hi - lo;
      const n = Math.round(span / a.pitch);
      if (n >= MIN_CELLS && Math.abs(span - n * a.pitch) < a.pitch * 0.35) {
        a.pitch = span / n;
        a.offset = lo - innerLo;
      }
    };
    snap(px, body.x0, body.x1, inner.x0);
    snap(py, body.y0, body.y1, inner.y0);
  }
  let ratio = px.pitch / py.pitch;
  if (ratio < 0.88 || ratio > 1.14) {
    // 两轴挑了不同谐波 → 十字救援：可信轴的格距按到另一轴上重试
    const xGood = px.conf >= py.conf;
    const forced = forcePitch(xGood ? gy : gx, xGood ? sy : sx, (xGood ? px : py).pitch);
    if (forced && forced.fracWeak <= 0.4) {
      if (xGood) py = forced; else px = forced;
      ratio = px.pitch / py.pitch;
    }
  }
  // 失败时带上关键中间量，真机 vConsole 里能直接看到卡在哪
  const dbg = () => ({
    body,
    px: Math.round(px.pitch * 100) / 100, py: Math.round(py.pitch * 100) / 100,
    confX: Math.round(px.conf * 100) / 100, confY: Math.round(py.conf * 100) / 100,
    lineX: Math.round((px.fracLine || 0) * 100) / 100, lineY: Math.round((py.fracLine || 0) * 100) / 100,
  });
  if (ratio < 0.88 || ratio > 1.14) return { ok: false, reason: '网格不规整', debug: dbg() };
  // 置信度门槛：满铺+逐格色号标签的图纸，文字纹理把平均能量抬得很高，conf 天然
  // 偏低。硬门槛降到 1.1（照片类负样本 ≈1.0 仍被拒），1.1~1.35 的「低置信」
  // 图先往下走，聚色后用「颜色数是否像图纸」补一道验收（照片聚出上百色兜不住）
  const strong = a => a.conf >= 1.35 || (a.conf >= 1.0 && a.fracLine >= 0.8);
  if (px.conf < 1.1 || py.conf < 1.1) return { ok: false, reason: '网格太模糊', debug: dbg() };
  const lowConf = !(strong(px) && strong(py));
  const pitch = (px.pitch + py.pitch) / 2;
  if (pitch < MIN_PITCH) return { ok: false, reason: '格子太小，换更清晰的截图', debug: dbg() };

  // 相位换算回整图坐标；主体（内容 bbox）连浅色豆一起框住了，
  // 只外推 2 格兜住边界取整误差 —— 再远就够到坐标数字/说明文字了
  const offX = inner.x0 + px.offset;
  const offY = inner.y0 + py.offset;
  const EXT = 2;
  const k0x = Math.floor((body.x0 - offX) / pitch) - EXT;
  const k1x = Math.ceil((body.x1 - offX) / pitch) + EXT;
  const k0y = Math.floor((body.y0 - offY) / pitch) - EXT;
  const k1y = Math.ceil((body.y1 - offY) / pitch) + EXT;
  const w0 = k1x - k0x, h0 = k1y - k0y;
  if (w0 > MAX_CELLS + EXT * 2 || h0 > MAX_CELLS + EXT * 2) {
    return { ok: false, reason: '图纸超过 ' + MAX_CELLS + '×' + MAX_CELLS };
  }

  // 只要网格几何（裁剪弹窗的格线磁吸 + 初始框）：到此为止，
  // 跳过最贵的逐格取色与聚色。选图后的预识别走这条路，弹窗开得快
  if (opts.gridOnly) {
    return {
      ok: true, gridOnly: true,
      pitch: Math.round(pitch * 10) / 10,
      conf: Math.round(Math.min(px.conf, py.conf) * 100) / 100,
      grid: { px: px.pitch, py: py.pitch, offX, offY },
      // 网格区即主体：直接拿它当裁剪框初值（吸附到格线）
      rectPx: {
        x: offX + Math.round((body.x0 - offX) / pitch) * pitch,
        y: offY + Math.round((body.y0 - offY) / pitch) * pitch,
        w: Math.round((body.x1 - body.x0) / pitch) * pitch,
        h: Math.round((body.y1 - body.y0) / pitch) * pitch,
      },
    };
  }

  // 逐格取色 + 判空。
  // 判空只对比纯白（网格内的底色就是白）：米黄页面底色与米白豆在 OKLab 里
  // 距离很近，拿页面底色判空会把大片近白豆误吞掉。
  // 满铺模式（页面非白且没有可信白底区）：网格没有白底，近白格是白色豆子
  // （H2 白豆），不能当空格 —— 留到下面的保护圈判空里处理
  const whiteAsBead = bgNotWhite && !clipW;
  const whiteLab = rgb2oklab(255, 255, 255);
  const EMPTY_D2 = 0.034 * 0.034;
  const samples = new Array(w0 * h0).fill(null);
  for (let ky = 0; ky < h0; ky++) {
    const cy = offY + (k0y + ky + 0.5) * pitch;
    if (cy < 1 || cy >= ih - 1) continue;
    for (let kx = 0; kx < w0; kx++) {
      const cx = offX + (k0x + kx + 0.5) * pitch;
      if (cx < 1 || cx >= iw - 1) continue;
      const rgb = cellColor(data, iw, ih, cx, cy, pitch);
      const lab = rgb2oklab(rgb[0], rgb[1], rgb[2]);
      if (!whiteAsBead && lab2(lab, whiteLab) < EMPTY_D2) continue; // 空格
      samples[ky * w0 + kx] = { rgb, lab };
    }
  }

  // 页面底色（米黄）/满铺模式下近白 的格子判空 —— 但保护主体内部（收 0.35 格），
  // 免得图案里恰好和页面同色的豆（或满铺图里的白豆）被误吞；
  // 外推带里的这类格子都是网格外的页面/面板边距
  const bgLab = bg ? rgb2oklab(bg[0], bg[1], bg[2]) : null;
  const guard = 0.35 * pitch;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!s) continue;
    const nearBg = bgLab && lab2(s.lab, bgLab) < EMPTY_D2;
    const nearWhite = whiteAsBead && lab2(s.lab, whiteLab) < EMPTY_D2;
    if (!nearBg && !nearWhite) continue;
    const ky = (i / w0) | 0, kx = i % w0;
    const ccx = offX + (k0x + kx + 0.5) * pitch;
    const ccy = offY + (k0y + ky + 0.5) * pitch;
    const inBody = ccx >= body.x0 + guard && ccx <= body.x1 - guard &&
      ccy >= body.y0 + guard && ccy <= body.y1 - guard;
    if (!inBody) samples[i] = null;
  }

  // 满铺模式：贴边的「整行/整列都近白」是网格外的白面板边距 —— 坐标数字把
  // 主体 bbox 撑出网格时，外推格会采到面板白且躲过保护圈判空。从四边向内剥，
  // 一遇到彩豆就停：真实白豆（H2）是图案内容，不会以满宽纯白贴边行出现
  if (whiteAsBead) {
    // 0 = 行内有彩豆（停止剥边）；1 = 只有近白（剥掉）；2 = 全空（跳过继续）
    const rowState = ky => {
      let white = false;
      for (let kx = 0; kx < w0; kx++) {
        const s = samples[ky * w0 + kx];
        if (!s) continue;
        if (lab2(s.lab, whiteLab) >= EMPTY_D2) return 0;
        white = true;
      }
      return white ? 1 : 2;
    };
    const colState = kx => {
      let white = false;
      for (let ky = 0; ky < h0; ky++) {
        const s = samples[ky * w0 + kx];
        if (!s) continue;
        if (lab2(s.lab, whiteLab) >= EMPTY_D2) return 0;
        white = true;
      }
      return white ? 1 : 2;
    };
    const clearRow = ky => { for (let kx = 0; kx < w0; kx++) samples[ky * w0 + kx] = null; };
    const clearCol = kx => { for (let ky = 0; ky < h0; ky++) samples[ky * w0 + kx] = null; };
    for (let ky = 0; ky < h0; ky++) { const st = rowState(ky); if (!st) break; if (st === 1) clearRow(ky); }
    for (let ky = h0 - 1; ky >= 0; ky--) { const st = rowState(ky); if (!st) break; if (st === 1) clearRow(ky); }
    for (let kx = 0; kx < w0; kx++) { const st = colState(kx); if (!st) break; if (st === 1) clearCol(kx); }
    for (let kx = w0 - 1; kx >= 0; kx--) { const st = colState(kx); if (!st) break; if (st === 1) clearCol(kx); }

    // 边缘密度剥边：满铺网格每行豆数接近满行，网格外的卡片边框线/坐标数字
    // 只会剩零星几颗 —— 边缘行/列豆数不足中位行的一半就剥掉（空行继续剥）
    const rowCnt = ky => { let c = 0; for (let kx = 0; kx < w0; kx++) if (samples[ky * w0 + kx]) c++; return c; };
    const colCnt = kx => { let c = 0; for (let ky = 0; ky < h0; ky++) if (samples[ky * w0 + kx]) c++; return c; };
    const medOf = (len, cnt) => {
      const arr = [];
      for (let i = 0; i < len; i++) { const c = cnt(i); if (c) arr.push(c); }
      arr.sort((u, v) => u - v);
      return arr.length ? arr[arr.length >> 1] : 0;
    };
    const medR = medOf(h0, rowCnt), medC = medOf(w0, colCnt);
    for (let ky = 0; ky < h0; ky++) { if (rowCnt(ky) >= medR * 0.5) break; clearRow(ky); }
    for (let ky = h0 - 1; ky >= 0; ky--) { if (rowCnt(ky) >= medR * 0.5) break; clearRow(ky); }
    for (let kx = 0; kx < w0; kx++) { if (colCnt(kx) >= medC * 0.5) break; clearCol(kx); }
    for (let kx = w0 - 1; kx >= 0; kx--) { if (colCnt(kx) >= medC * 0.5) break; clearCol(kx); }
  }

  // 非空 bbox 收边
  let r0 = -1, r1 = -1, c0 = -1, c1 = -1;
  for (let y = 0; y < h0; y++) {
    for (let x = 0; x < w0; x++) {
      if (!samples[y * w0 + x]) continue;
      if (r0 < 0) r0 = y;
      r1 = y;
      if (c0 < 0 || x < c0) c0 = x;
      if (x > c1) c1 = x;
    }
  }
  if (r0 < 0) return { ok: false, reason: '图纸是空的' };

  const w = c1 - c0 + 1, h = r1 - r0 + 1;
  if (w < MIN_CELLS || h < MIN_CELLS) return { ok: false, reason: '图案太小' };
  if (w > MAX_CELLS || h > MAX_CELLS) {
    return { ok: false, reason: '图纸超过 ' + MAX_CELLS + '×' + MAX_CELLS };
  }

  const kept = new Array(w * h).fill(null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      kept[y * w + x] = samples[(r0 + y) * w0 + (c0 + x)];
    }
  }

  // 聚色 → 作品自带色板（图纸真实颜色，按用量从大到小排）→ cells
  const { groups, gi } = groupColors(kept);
  if (!groups.length) return { ok: false, reason: '图纸是空的' };
  // 低置信验收：真图纸的豆子高度集中在前几十个颜色组里（压缩噪声能把 24 色
  // 打碎成 300+ 组，但碎组都是零星几格，top-48 仍占 9 成以上）；照片/织物纹理
  // 在假格距下取色会摊平到海量组 —— conf 1.1~1.35 放进来的图在这里兜底
  if (lowConf) {
    const cs = groups.map(g => g.count).sort((u, v) => v - u);
    let top = 0, beads = 0;
    for (let i = 0; i < cs.length; i++) {
      beads += cs[i];
      if (i < MAX_COLORS) top += cs[i];
    }
    if (top < beads * 0.85) {
      const d = dbg();
      d.rawGroups = groups.length;
      d.topShare = Math.round(top / beads * 100) / 100;
      return { ok: false, reason: '网格太模糊', debug: d };
    }
  }
  // 先定格各组均值色，再做超限合并（合并只累计用量，颜色以存活组为准）
  for (const g of groups) {
    g.mean = [g.sum[0] / g.count, g.sum[1] / g.count, g.sum[2] / g.count];
  }
  const capMap = capGroups(groups, MAX_COLORS);
  const order = [...new Set(capMap)].sort((a, b) => groups[b].count - groups[a].count);
  const rank = new Map(order.map((g, i) => [g, i]));
  const palette = order.map(g => rgbToHex(groups[g].mean[0], groups[g].mean[1], groups[g].mean[2]));
  const cells = new Array(w * h).fill(-1);
  let total = 0;
  for (let i = 0; i < kept.length; i++) {
    if (gi[i] >= 0) { cells[i] = rank.get(capMap[gi[i]]); total++; }
  }

  return {
    ok: true, w, h, cells, palette, colorN: palette.length, total,
    pitch: Math.round(pitch * 10) / 10,
    conf: Math.round(Math.min(px.conf, py.conf) * 100) / 100,
    // 网格几何（输入图片像素坐标系）：裁剪弹窗用它做格线磁吸；
    // rectPx = 最终保留图案的像素范围，可作为裁剪框的初始位置
    grid: { px: px.pitch, py: py.pitch, offX, offY },
    rectPx: {
      x: offX + (k0x + c0) * pitch,
      y: offY + (k0y + r0) * pitch,
      w: w * pitch,
      h: h * pitch,
    },
  };
}

module.exports = { analyzeChart };
// 供单元测试检视中间步骤（小程序端不会用到）
module.exports._internals = { scanImage, findBody, findWhiteBody, edgeProfiles, detectPitch, bestPhase, combStats, refineAt, lineFrac, pageBg, cellColor, groupColors, capGroups };
