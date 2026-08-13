// 拼豆图纸导入：识别「图纸截图」（小红书图纸工坊等生成的规整图片，非拍照）
// 里的网格，逐格取色还原成本程序的图纸 {w, h, cells}。
//
// 流程：
//   1. 非背景掩码（既非白也非页面底色；格线本身就算内容）按行、列直方图
//      找到网格区，甩开页面标题、坐标数字、底部图例
//   2. 网格区内对亮度做水平/垂直边缘能量投影，自相关求格距（亚像素）+ 相位
//      —— 像素画只在格线处有颜色跳变，能量呈严格周期
//   3. 每格中心 60% 区域网点采样取中位数色：细格线/参考线/坐标文字笔画/
//      抗锯齿都被中位数滤掉；接近纯白的格判空
//   4. 相近取样色聚成「图纸用色」，按用量排序后作为作品自带色板输出
//      （颜色与图纸一致，不量化到全局色板），cells 存自带色板的下标
//
// 已知边界：拍照/透视图纸不支持（需要规整截图）；纯白豆与空格无法区分
const { rgb2oklab } = require('./convert');

const MIN_PITCH = 5.5;   // 每格最少像素：再小取色就不可靠了，让用户换清晰截图
const MAX_CELLS = 256;   // 与创建页 SIZE_CAP 一致（storage / 渲染性能约束）
const MIN_CELLS = 6;
const MAX_COLORS = 48;   // 自带色板上限：正常图纸 ≤ 40 色，超出的并入最近色

function lab2(a, b) {
  const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

/* ---------- 1. 网格区域定位 ---------- */

// 非背景像素：既不接近纯白（格子/面板底），也不接近页面底色（米黄边距）。
// 网格线、参考线、豆子（含近白豆）、文字都算内容 —— 网格区因为布满格线，
// 每一行每一列都有稳定的内容量，整块连成图里最大的连续带
function nonBgMask(data, iw, ih, bg) {
  const mask = new Uint8Array(iw * ih);
  const T = 20;
  const br = bg[0], bgc = bg[1], bb = bg[2];
  for (let i = 0, o = 0; i < iw * ih; i++, o += 4) {
    const r = data[o], g = data[o + 1], b = data[o + 2];
    let dw = 255 - r; // 与白的最大通道差
    if (255 - g > dw) dw = 255 - g;
    if (255 - b > dw) dw = 255 - b;
    if (dw <= T) continue;
    let db = Math.abs(r - br);
    const d2 = Math.abs(g - bgc); if (d2 > db) db = d2;
    const d3 = Math.abs(b - bb); if (d3 > db) db = d3;
    if (db <= T) continue;
    mask[i] = 1;
  }
  return mask;
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
function findWhiteBody(data, iw, ih) {
  const T = 14;
  const rows = new Float64Array(ih);
  for (let y = 0; y < ih; y++) {
    let c = 0, o = y * iw * 4;
    for (let x = 0; x < iw; x++, o += 4) {
      if (255 - data[o] <= T && 255 - data[o + 1] <= T && 255 - data[o + 2] <= T) c++;
    }
    rows[y] = c;
  }
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
  return { x0: cb.s, x1: cb.e + 1, y0: rb.s, y1: rb.e + 1 };
}

// 找图案主体 bbox：行带 → 带内列带。clip 限定统计范围（白底区），
// 让页面纹理、白底区外的图例/说明进不了直方图
function findBody(mask, iw, ih, clip) {
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
  // 阈值 5%：图案最稀的行也有格线交点/描边垫底；
  // 底部图例色块行虽然更密，但带高远小于图案区，评分挑不过
  const bridge = Math.max(12, Math.round(ih * 0.022));
  const rb = mainBand(rows, rMax * 0.05, bridge);
  if (!rb) return null;

  const cols = new Float64Array(iw);
  for (let y = rb.s; y <= rb.e; y++) {
    const base = y * iw;
    for (let x = cx0; x < cx1; x++) cols[x] += mask[base + x];
  }
  let cMax = 0;
  for (let x = cx0; x < cx1; x++) if (cols[x] > cMax) cMax = cols[x];
  const cb = mainBand(cols, cMax * 0.05, Math.max(12, Math.round(iw * 0.022)));
  if (!cb) return null;
  return { x0: cb.s, x1: cb.e + 1, y0: rb.s, y1: rb.e + 1 };
}

/* ---------- 2. 格距 / 相位 ---------- */

// 主体内的亮度边缘能量投影：gx[x] = Σy |L(x+1)-L(x)|（行方向 step 抽样）
function edgeProfiles(luma, iw, body) {
  const { x0, x1, y0, y1 } = body;
  const gx = new Float64Array(x1 - x0 - 1);
  const gy = new Float64Array(y1 - y0 - 1);
  const stepY = Math.max(1, Math.round((y1 - y0) / 700));
  const stepX = Math.max(1, Math.round((x1 - x0) / 700));
  for (let y = y0; y < y1; y += stepY) {
    const base = y * iw;
    for (let x = x0; x < x1 - 1; x++) {
      const d = luma[base + x + 1] - luma[base + x];
      gx[x - x0] += d < 0 ? -d : d;
    }
  }
  for (let y = y0; y < y1 - 1; y++) {
    const b0 = y * iw, b1 = (y + 1) * iw;
    for (let x = x0; x < x1; x += stepX) {
      const d = luma[b1 + x] - luma[b0 + x];
      gy[y - y0] += d < 0 ? -d : d;
    }
  }
  return { gx, gy };
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

// 自相关求格距：R(p) 全局峰 → 抛物线亚像素精化。
// 峰有时落在真实格距的整数倍上（5 格参考线强于淡格线 / 图案 2 格一色时），
// 所以在 峰值/k 候选里选「弱齿占比达标的最小格距」——
// 整数倍候选虽然每齿都强但格距偏大，减半候选弱齿过半被否，真格距恰好全对齐
function detectPitch(g) {
  const len = g.length;
  const pMax = Math.min(220, Math.floor(len / 4));
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

  const cands = [];
  for (let k = 1; k <= 6; k++) {
    const p = pBase / k;
    if (p < MIN_PITCH) break;
    const cand = refineAt(g, p, baseline);
    if (cand) cands.push(cand);
  }
  if (!cands.length) return null;
  // 弱齿占比 ≤ 0.34 的候选里取最小格距；都不达标就取弱齿最少的
  let pick = null;
  for (let i = cands.length - 1; i >= 0; i--) {
    if (cands[i].fracWeak <= 0.34) { pick = cands[i]; break; }
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
  return { pitch: best.pitch, offset: best.offset, conf: mean > 0 ? best.score / mean : 0 };
}

// 十字救援：图纸格子必为正方形，两轴挑了不同谐波时，
// 拿可信轴的格距按到问题轴上重试（只搜相位和 ±0.4px 微调）
function forcePitch(g, pitch) {
  const tmp = Array.from(g).sort((a, b) => a - b);
  const cand = refineAt(g, pitch, tmp[tmp.length >> 1]);
  if (!cand) return null;
  let mean = 0;
  for (let x = 0; x < g.length; x++) mean += g[x];
  mean /= g.length;
  cand.conf = mean > 0 ? cand.score / mean : 0;
  return cand;
}

/* ---------- 3. 取样 ---------- */

// 图片四角外圈估计页面底色（图例区大片留白也算白）
function pageBg(data, iw, ih) {
  const rs = [], gs = [], bs = [];
  const m = Math.max(2, Math.round(Math.min(iw, ih) * 0.01));
  const pts = [];
  for (let i = 0; i < 24; i++) {
    pts.push([m + Math.round((iw - 2 * m) * (i / 23)), m]);
    pts.push([m + Math.round((iw - 2 * m) * (i / 23)), ih - 1 - m]);
  }
  for (const [x, y] of pts) {
    const o = (y * iw + x) * 4;
    rs.push(data[o]); gs.push(data[o + 1]); bs.push(data[o + 2]);
  }
  const mid = a => { a.sort((u, v) => u - v); return a[a.length >> 1]; };
  return [mid(rs), mid(gs), mid(bs)];
}

// 单格取色：中心 60% 区域 n×n 网点，逐通道取中位数
// 中位数天然滤掉细格线、参考线、坐标文字笔画、边缘抗锯齿
function cellColor(data, iw, ih, cx, cy, pitch) {
  const half = pitch * 0.3;
  const n = Math.min(9, Math.max(3, Math.round(pitch * 0.7)));
  const rs = [], gs = [], bs = [];
  for (let j = 0; j < n; j++) {
    const y = Math.round(cy - half + (2 * half) * (n === 1 ? 0.5 : j / (n - 1)));
    if (y < 0 || y >= ih) continue;
    for (let i = 0; i < n; i++) {
      const x = Math.round(cx - half + (2 * half) * (n === 1 ? 0.5 : i / (n - 1)));
      if (x < 0 || x >= iw) continue;
      const o = (y * iw + x) * 4;
      if (data[o + 3] < 200) { rs.push(255); gs.push(255); bs.push(255); continue; }
      rs.push(data[o]); gs.push(data[o + 1]); bs.push(data[o + 2]);
    }
  }
  if (!rs.length) return [255, 255, 255];
  const mid = a => { a.sort((u, v) => u - v); return a[a.length >> 1]; };
  return [mid(rs), mid(gs), mid(bs)];
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
  return { groups, gi };
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
function analyzeChart(data, iw, ih) {
  if (!data || iw < 60 || ih < 60) return { ok: false, reason: '图片太小' };

  // 亮度图 + 非背景掩码
  const luma = new Uint8Array(iw * ih);
  for (let i = 0, o = 0; i < iw * ih; i++, o += 4) {
    luma[i] = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8;
  }
  const bg = pageBg(data, iw, ih);
  // 页面底色不是白 → 先框出白底区（网格铺在白底上；图例/说明/页面装饰纹理
  // 都在非白底上，天然排除），再在白底区内取内容 bbox 作为主体。
  // 页面就是白的则直接全图取内容 bbox（图例靠留白与主体分带）
  let clipW = null;
  if (255 - Math.min(bg[0], bg[1], bg[2]) > 20) clipW = findWhiteBody(data, iw, ih);
  const body = findBody(nonBgMask(data, iw, ih, bg), iw, ih, clipW);
  if (!body) return { ok: false, reason: '找不到图案区域' };
  if (body.x1 - body.x0 < 40 || body.y1 - body.y0 < 40) {
    return { ok: false, reason: '图案区域太小' };
  }

  // 主体向内收 3%，避免边缘文字/描边干扰周期检测
  const inX = Math.round((body.x1 - body.x0) * 0.03);
  const inY = Math.round((body.y1 - body.y0) * 0.03);
  const inner = { x0: body.x0 + inX, x1: body.x1 - inX, y0: body.y0 + inY, y1: body.y1 - inY };
  const { gx, gy } = edgeProfiles(luma, iw, inner);
  let px = detectPitch(gx);
  let py = detectPitch(gy);
  if (!px || !py) return { ok: false, reason: '识别不出网格', debug: { body } };
  let ratio = px.pitch / py.pitch;
  if (ratio < 0.88 || ratio > 1.14) {
    // 两轴挑了不同谐波 → 十字救援：可信轴的格距按到另一轴上重试
    const xGood = px.conf >= py.conf;
    const forced = forcePitch(xGood ? gy : gx, (xGood ? px : py).pitch);
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
  });
  if (ratio < 0.88 || ratio > 1.14) return { ok: false, reason: '网格不规整', debug: dbg() };
  if (Math.min(px.conf, py.conf) < 1.35) return { ok: false, reason: '网格太模糊', debug: dbg() };
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

  // 逐格取色 + 判空。
  // 判空只对比纯白（网格内的底色就是白）：米黄页面底色与米白豆在 OKLab 里
  // 距离很近，拿页面底色判空会把大片近白豆误吞掉
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
      if (lab2(lab, whiteLab) < EMPTY_D2) continue; // 空格
      samples[ky * w0 + kx] = { rgb, lab };
    }
  }

  // 页面底色（米黄）的格子判空 —— 但保护主体内部（收 0.35 格），
  // 免得图案里恰好和页面同色的豆被误吞；外推带里的米黄格都是网格外的页面
  const bgLab = rgb2oklab(bg[0], bg[1], bg[2]);
  const guard = 0.35 * pitch;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] && lab2(samples[i].lab, bgLab) < EMPTY_D2) {
      const ky = (i / w0) | 0, kx = i % w0;
      const ccx = offX + (k0x + kx + 0.5) * pitch;
      const ccy = offY + (k0y + ky + 0.5) * pitch;
      const inBody = ccx >= body.x0 + guard && ccx <= body.x1 - guard &&
        ccy >= body.y0 + guard && ccy <= body.y1 - guard;
      if (!inBody) samples[i] = null;
    }
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
  };
}

module.exports = { analyzeChart };
// 供单元测试检视中间步骤（小程序端不会用到）
module.exports._internals = { nonBgMask, findBody, findWhiteBody, edgeProfiles, detectPitch, bestPhase, combStats, pageBg, cellColor, groupColors, capGroups };
