// 导入码：把作品图纸变成一串口令分享（服务端存图纸，码是随机短索引，不可枚举）。
// 码为 8 位字符（去掉 0/O/1/I/L 易混字符），展示为 PD-XXXX-XXXX；
// normalize 能从聊天文案里捞出口令（「复制口令 PD-3K7F-9QWW 去拼同款」→ 3K7F9QWW）。
// 接口契约见 docs/import-code-api.md，由 pindou-server 实现。
const api = require('./api');
const { PALETTE } = require('./palette');
const { normFinish } = require('./board');

const CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_RE = new RegExp('[' + CHARSET + ']{8}');

// 任意文本 → 8 位码（提不出来返回 ''）
function normalize(text) {
  let t = String(text || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (t.length >= 10 && t.indexOf('PD') === 0) t = t.slice(2); // 去展示前缀
  const m = t.match(CODE_RE);
  return m ? m[0] : '';
}

// 聊天文案 → 口令，只认完整展示形态（PD-XXXX-XXXX，容忍空格和各种连字符）。
// 剪贴板自动识别专用：normalize 太宽松，作品名里的字母数字会被拼进码里造成误弹窗
const STRICT_RE = new RegExp('PD\\s*[-‐–—－]?\\s*([' + CHARSET + ']{4})\\s*[-‐–—－]?\\s*([' + CHARSET + ']{4})(?![' + CHARSET + '])');
function extractCode(text) {
  const m = String(text || '').toUpperCase().match(STRICT_RE);
  return m ? m[1] + m[2] : '';
}

// 剪贴板自动识别的去重：同一个码只弹一次「拼同款」提示
// （复制自家口令、已经导入过、点过「先不了」的都不再打扰）
const PROMPTED_KEY = 'pindou.codePrompted';
function markCodePrompted(code) {
  try { wx.setStorageSync(PROMPTED_KEY, code); } catch (e) { /* 忽略 */ }
}
function wasCodePrompted(code) {
  try { return wx.getStorageSync(PROMPTED_KEY) === code; } catch (e) { return true; }
}

function format(code) {
  return code ? 'PD-' + code.slice(0, 4) + '-' + code.slice(4, 8) : '';
}

// 进度位串：0/1 数组 ↔ 十六进制（每字符 4 格），接力口令带进度用，比原始数组省 8× 体积
function packPlaced(placed, n) {
  let s = '';
  for (let i = 0; i < n; i += 4) {
    let v = 0;
    if (placed[i]) v |= 1;
    if (placed[i + 1]) v |= 2;
    if (placed[i + 2]) v |= 4;
    if (placed[i + 3]) v |= 8;
    s += v.toString(16);
  }
  return s;
}

// 两组 32 位散列组成稳定快照键。图案、名称、色板或接力进度任一变化都会换键，
// 避免静默保存时间戳或“已拼数量相同但位置不同”时误取旧的审核结果。
function snapshotKey(value) {
  const s = String(value || '');
  let a = 2166136261, b = 5381;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a ^= c;
    a = Math.imul(a, 16777619);
    b = Math.imul(b, 33) ^ c;
  }
  return (a >>> 0).toString(16).padStart(8, '0') +
    (b >>> 0).toString(16).padStart(8, '0');
}
function unpackPlaced(s, n) {
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const v = parseInt(s.charAt(i >> 2) || '0', 16); // 非法字符 → NaN，下面按位与得 0，安全
    if (v & (1 << (i & 3))) out[i] = 1;
  }
  return out;
}

// 服务端数据不可信：导入前逐项校验，返回清洗后的图纸或 null
function validatePattern(p) {
  if (!p || !Number.isInteger(p.w) || !Number.isInteger(p.h)) return null;
  if (p.w < 1 || p.h < 1 || p.w > 256 || p.h > 256) return null;
  if (!Array.isArray(p.cells) || p.cells.length !== p.w * p.h) return null;
  const hasPal = Array.isArray(p.palette) && p.palette.length > 0;
  if (hasPal && (p.palette.length > 64 || !p.palette.every(x => typeof x === 'string' && /^#[0-9A-Fa-f]{6}$/.test(x)))) return null;
  const palN = hasPal ? p.palette.length : PALETTE.length;
  let beads = 0;
  for (const t of p.cells) {
    if (!Number.isInteger(t) || t < -1 || t >= palN) return null;
    if (t >= 0) beads++;
  }
  if (!beads) return null;
  // 进度（可选，只有接力口令才有）：十六进制位串还原成 0/1，且只认「该格有豆」的已拼
  let placed;
  if (typeof p.placed === 'string' && p.placed) {
    const raw = unpackPlaced(p.placed, p.w * p.h);
    placed = new Array(p.w * p.h);
    for (let i = 0; i < placed.length; i++) placed[i] = (raw[i] && p.cells[i] >= 0) ? 1 : 0;
  }
  const order = orderTag(p.order);
  const name = String(p.name || '口令拼豆');
  return {
    w: p.w, h: p.h, cells: p.cells,
    palette: hasPal ? p.palette : undefined,
    // 代拼订单的码：作品名前缀「订单号后 4 位-序号」，商家作品库里一眼对上是哪单第几张
    name: (order ? order.no + '-' + order.idx + ' ' + name : name).slice(0, 20),
    placed, // undefined（普通图纸口令）或 0/1 数组（接力口令）
    order,  // undefined（普通口令）或 { no, idx, n, finish }（代拼派单给商家的码，docs/order-api.md §5.3）
  };
}

// 代拼订单标记（后端派单建码时写进 payload.order）：{ no: 订单号后 4 位, idx: 第几张, n: 共几张, finish: 烫法 key }
function orderTag(o) {
  if (!o || typeof o !== 'object') return undefined;
  const no = String(o.no || '');
  const idx = o.idx, n = o.n;
  if (!/^[0-9A-Za-z]{1,8}$/.test(no) || !Number.isInteger(idx) || idx < 1 || idx > 99) return undefined;
  return {
    no, idx,
    n: Number.isInteger(n) && n >= idx && n <= 99 ? n : idx,
    finish: normFinish(o.finish) || '', // 客户选的烫法：导入后预选好，商家熨烫时不用再找
  };
}

// 生成（或取回）作品的导入码；服务端按 (用户, clientWorkId) 去重，重复调用返回同一个码。
// opts.placed（可选）：把当前进度一并带上（接力分享）——好友导入后从这个进度接着拼。
function createCode(work, opts) {
  opts = opts || {};
  const payload = {
    w: work.w, h: work.h, cells: work.cells,
    palette: work.palette || undefined, name: work.name,
  };
  if (opts.placed) {
    payload.placed = packPlaced(opts.placed, work.cells.length);
  }
  // 服务端按 clientWorkId 幂等；把实际提交内容纳入键，确保审核结果只对应当前快照。
  const clientWorkId = (work.id + '@' + snapshotKey(JSON.stringify(payload))).slice(0, 32);
  return api.post('/api/patterns', {
    clientWorkId,
    name: work.name,
    w: work.w,
    h: work.h,
    total: work.cells.filter(t => t >= 0).length,
    payload: JSON.stringify(payload),
  }).then(d => {
    const code = normalize(d && d.code);
    if (!code) throw { message: '生成口令失败' };
    if (d.reviewStatus === 'pass') return code;
    if (d.reviewStatus !== 'pending') throw { message: '图纸未通过审核，请修改后重试' };
    return waitForReview(code, 0);
  });
}

function waitForReview(code, attempt) {
  if (attempt >= 6) throw { message: '图纸还在审核中，稍后再点生成即可查看结果' };
  return new Promise(resolve => setTimeout(resolve, 5000)).then(() =>
    api.get('/api/patterns/code/' + code + '/review').then(r => {
      if (r.status === 'pass') return code;
      if (r.status === 'pending') return waitForReview(code, attempt + 1);
      throw { message: '图纸未通过审核，请修改后重试' };
    }));
}

// 凭码取图纸（已校验，可直接建作品）
function fetchByCode(code) {
  return api.get('/api/patterns/code/' + code).then(d => {
    let p = null;
    try { p = validatePattern(JSON.parse(d.payload)); } catch (e) { /* 落到 null */ }
    if (!p) throw { code: -2, message: '图纸数据不完整' };
    return p;
  });
}

// 举报（侵权/违规 → 服务端核实后作废码）
function reportCode(code, reason) {
  return api.post('/api/patterns/code/' + code + '/report', { reason: reason || 'user' });
}

function reportFlow(code) {
  if (!code) return;
  const reasons = ['违法违规', '色情低俗', '暴力血腥', '侵权盗用', '其他不适宜内容'];
  wx.showActionSheet({ itemList: reasons, success: r => {
    reportCode(code, reasons[r.tapIndex]).then(() => wx.showToast({ title: '举报已提交', icon: 'none' }))
      .catch(() => wx.showToast({ title: '举报提交失败', icon: 'none' }));
  } });
}

module.exports = {
  normalize, format, extractCode, markCodePrompted, wasCodePrompted,
  validatePattern, createCode, fetchByCode, reportCode, reportFlow,
};
