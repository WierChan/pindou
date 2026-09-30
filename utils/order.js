// 代拼订单：客户端下单 / 微信支付 / 查单封装 + 本地订单索引。
// 接口契约见 docs/order-api.md（pindou-server 实现）。金额以服务端复算为准，
// 本地 utils/pricing.js 只做即时展示；图纸随单以「导入码同款 payload」上传，商家可直接导入拼。
const api = require('./api');
const { ENV } = require('./env');
const { PALETTE, hexToRgb } = require('./palette');
const { colorStats, nearestPalette } = require('./convert');
const { finishInfo } = require('./board');
const pricing = require('./pricing');

const LOCAL_KEY = 'pindou.orders.v1';   // 本地订单索引 [{id, workId, name, status, totalFen, createdAt, ...}]：首页入口计数 / 离线兜底
const PHONE_KEY = 'pindou.order.phone'; // 上次自取留的手机号

// 订单状态（服务端权威，客户端只映射文案 / 样式）
const STATUS = {
  unpaid:    { text: '待支付', cls: 'unpaid', desc: '订单已创建，完成支付后商家才会接单' },
  paid:      { text: '待接单', cls: 'paid',   desc: '已付款，平台正在安排商家' },
  assigned:  { text: '已派单', cls: 'paid',   desc: '已派给商家，等待商家接单' },
  accepted:  { text: '制作中', cls: 'making', desc: '商家正在拼制，做好后会发货 / 通知取货' },
  shipped:   { text: '已发货', cls: 'ship',   desc: '商家已寄出，留意快递' },
  ready:     { text: '待自取', cls: 'ship',   desc: '做好啦，请按约定到店自取' },
  done:      { text: '已完成', cls: 'done',   desc: '交易完成，感谢支持' },
  cancelled: { text: '已取消', cls: 'off',    desc: '订单已取消' },
  refunded:  { text: '已退款', cls: 'off',    desc: '款项已原路退回' },
};
const HOLE_TEXT = { none: '无孔', small: '小孔', large: '大孔' };

// 代拼里闪粉只分粗闪 / 细闪两档（市面格利特款式太多，具体款式客户在备注里写）：
// 下单页只给这两个 chip，作品原来选的彩虹款归并到对应粗/细；订单里的名字也用这套
const ORDER_FINISH = {
  glitter:     { chip: '粗闪', name: '闪粉（粗闪）' },
  glitterFine: { chip: '细闪', name: '闪粉（细闪）' },
};
const FINISH_FOLD = { rainbow: 'glitter', rainbowFine: 'glitterFine' };
function orderFinish(key) { return FINISH_FOLD[key] || key; }          // 作品烫法 → 下单页可选的 key
function finishLabel(key) { return (ORDER_FINISH[key] && ORDER_FINISH[key].name) || finishInfo(key).name; }

function statusInfo(s) { return STATUS[s] || { text: s || '未知状态', cls: 'off', desc: '' }; }
function isGlitter(finish) { return finishInfo(finish).cat === 'glitter'; }

/* ---------- 作品 → 订单素材 ---------- */

// 豆数 / 色数 / 每色用量（商家备豆用）。
// 自带色板作品（图纸导入）的颜色不是实体豆色：标最近 MARD 码并 approx=true，仅供参考
function workStats(work) {
  const stats = colorStats(work.cells);
  const colors = stats.map((s, i) => {
    const hex = work.palette ? work.palette[s.pal] : PALETTE[s.pal].hex;
    let code, name, approx = false;
    if (work.palette) {
      const c = hexToRgb(hex);
      const gi = nearestPalette(c[0], c[1], c[2]);
      code = PALETTE[gi].code; name = PALETTE[gi].name; approx = true;
    } else {
      code = PALETTE[s.pal].code; name = PALETTE[s.pal].name;
    }
    return { num: i + 1, code, name, hex, count: s.count, approx };
  });
  return { beads: stats.reduce((a, s) => a + s.count, 0), colorN: stats.length, colors };
}

// 图纸 payload：与导入码（utils/importcode.js createCode）完全同构，服务端可直接给商家发一个导入码
function buildPayload(work) {
  return JSON.stringify({ w: work.w, h: work.h, cells: work.cells, palette: work.palette || undefined, name: work.name });
}

/* ---------- 接口 ---------- */

// 单张图的下单字段（单图订单平铺在请求体里；多图订单作为 works[] 的一项）
function workBody(work, finish, hole, st) {
  st = st || workStats(work);
  return {
    workId: work.id, name: work.name, w: work.w, h: work.h,
    beads: st.beads, colorN: st.colorN, colors: st.colors,
    finish, finishName: finishLabel(finish), glitter: isGlitter(finish), hole: hole || 'none',
    payload: buildPayload(work),
  };
}

// 创建订单并预下单。list: [{ work, finish, stats? }]（1 张 = 老的单图格式；多张 = works[]，docs/order-api.md §3.1b）
// o: { clientOrderId, hole, delivery, phone, address, note, quote（quoteCart 结果） }
// 返回 { order, payParams }；服务端按 (用户, clientOrderId) 幂等
function create(list, o) {
  const q = o.quote;
  let clientQuote = null;
  if (q) {
    const items = [];
    q.lines.forEach((l, i) => l.items.forEach(it => items.push({ key: it.key, fen: it.fen, work: i })));
    if (q.shipping) items.push({ key: 'shipping', fen: q.shipping.fen });
    clientQuote = { items, totalFen: q.totalFen };
  }
  const body = {
    clientOrderId: o.clientOrderId,
    delivery: o.delivery, phone: o.phone || '', address: o.address || null, note: o.note || '',
    clientQuote,
  };
  if (list.length === 1) Object.assign(body, workBody(list[0].work, list[0].finish, o.hole, list[0].stats));
  else body.works = list.map(x => workBody(x.work, x.finish, o.hole, x.stats));
  return api.post('/api/orders', body).then(d => {
    if (d && d.order) remember(d.order);
    return d;
  });
}

// 拉起微信支付。resolve 'ok' / 'cancel'（用户取消），其他失败 reject。
// 模拟支付：微信支付未开通期间，dev 后端（PAY_MOCK=true）建单时直接把订单置为 paid 并返回
// payParams:{mock:true}，这里不拉起收银台直接当支付成功。只认 dev 环境，线上包永远走真支付
function requestPay(p) {
  return new Promise((resolve, reject) => {
    if (p && p.mock === true && ENV === 'dev') { resolve('ok'); return; }
    if (!p || !p.package) { reject({ code: -3, message: '支付参数缺失，稍后再试' }); return; }
    wx.requestPayment({
      timeStamp: String(p.timeStamp), nonceStr: p.nonceStr, package: p.package,
      signType: p.signType || 'RSA', paySign: p.paySign,
      success: () => resolve('ok'),
      fail: err => {
        const m = (err && err.errMsg) || '';
        if (m.indexOf('cancel') >= 0) resolve('cancel');
        else reject({ code: -4, message: '支付没成功，稍后再试' });
      },
    });
  });
}

function list() {
  return api.get('/api/orders').then(d => {
    const orders = (d && d.orders) || [];
    writeLocal(orders.map(summ)); // 以服务端为准刷新本地索引
    return orders;
  });
}
function get(id) { return api.get('/api/orders/' + id).then(d => { const o = (d && d.order) || d; remember(o); return o; }); }
function payParams(id) { return api.post('/api/orders/' + id + '/pay', {}).then(d => (d && d.payParams) || d); }
function cancel(id) { return api.post('/api/orders/' + id + '/cancel', {}).then(d => { if (d && d.order) remember(d.order); return d; }); }
function confirm(id) { return api.post('/api/orders/' + id + '/confirm', {}).then(d => { if (d && d.order) remember(d.order); return d; }); }

// 接口错误 → 用户文案（未部署订单接口时 404 提示服务未开通）
function errText(err) {
  if (!err) return '操作失败，稍后再试';
  if (err.code === 404 && /HTTP/.test(err.message || '')) return '代拼服务还没开通，敬请期待';
  return err.message || '操作失败，稍后再试';
}

/* ---------- 本地索引 ---------- */

function summ(o) {
  return {
    id: o.id, workId: o.workId || '', name: o.name || '', w: o.w | 0, h: o.h | 0, beads: o.beads | 0, colorN: o.colorN | 0,
    status: o.status || 'unpaid', delivery: o.delivery || 'pickup', totalFen: o.totalFen | 0, createdAt: o.createdAt || 0,
    worksN: Array.isArray(o.works) ? o.works.length : (o.worksN | 0), // 多图订单的张数（离线列表显示「N 件」）
  };
}
function readLocal() {
  try { const v = wx.getStorageSync(LOCAL_KEY); if (Array.isArray(v)) return v; } catch (e) { /* 忽略 */ }
  return [];
}
function writeLocal(list) { try { wx.setStorageSync(LOCAL_KEY, list.slice(0, 100)); } catch (e) { /* 忽略 */ } }
function remember(o) {
  if (!o || !o.id) return;
  const list = readLocal().filter(x => x.id !== o.id);
  list.unshift(summ(o));
  writeLocal(list);
}
function localList() { return readLocal().slice().sort((a, b) => b.createdAt - a.createdAt); }
function localCount() { return readLocal().length; }

/* ---------- 代拼篮（多图订单的待下单作品，cfg.ORDER.multi 开了才用） ---------- */
// 只存作品 id 和选的烫法，不复制图纸（storage 1MB）；下单时才读作品、生成 payload 快照
const CART_KEY = 'pindou.order.cart.v1'; // [{ id, finish }]

function cartRead() {
  try { const v = wx.getStorageSync(CART_KEY); if (Array.isArray(v)) return v.filter(x => x && x.id); } catch (e) { /* 忽略 */ }
  return [];
}
function cartWrite(list) {
  try { wx.setStorageSync(CART_KEY, list.map(x => ({ id: x.id, finish: x.finish || '' }))); } catch (e) { /* 忽略 */ }
}
function cartClear() { try { wx.removeStorageSync(CART_KEY); } catch (e) { /* 忽略 */ } }

function lastPhone() { try { return wx.getStorageSync(PHONE_KEY) || ''; } catch (e) { return ''; } }
function rememberPhone(p) { try { wx.setStorageSync(PHONE_KEY, p || ''); } catch (e) { /* 忽略 */ } }

/* ---------- 展示 ---------- */

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// 服务端订单 VO → 页面视图模型（缺字段容错）
function toVM(o) {
  const st = statusInfo(o.status);
  let desc = st.desc;
  if (o.status === 'cancelled' && o.cancelReason) desc += '：' + o.cancelReason;
  if (o.status === 'shipped' && o.trackingNo) desc = '商家已寄出 · ' + (o.carrier || '快递') + ' ' + o.trackingNo;
  if (o.merchantNote) desc += '\n商家留言：' + o.merchantNote;
  const dimsOf = x => x.w + '×' + x.h + ' · ' + (x.beads | 0) + ' 颗' + (x.colorN ? ' · ' + x.colorN + ' 色' : '');
  const finishOf = x => (x.finish ? finishLabel(x.finish) : (x.finishName || ''));
  // 多图订单（works[]）：每张单列作品 / 规格 / 烫法 / 小计，顶层 items 只有运费
  const works = Array.isArray(o.works) && o.works.length > 1 ? o.works.map(x => ({
    name: x.name || '', dims: dimsOf(x), finishText: finishOf(x),
    yuan: pricing.yuan((x.items || []).reduce((a, i) => a + (i.fen | 0), 0)),
  })) : null;
  return Object.assign({}, o, {
    stText: st.text, stCls: st.cls, stDesc: desc,
    works,
    name: o.name || (works ? works[0].name + ' 等 ' + works.length + ' 件' : ''),
    dims: works ? works.length + ' 件 · 共 ' + o.works.reduce((a, x) => a + (x.beads | 0), 0) + ' 颗'
      : (o.worksN > 1 ? o.worksN + ' 件 · 共 ' + (o.beads | 0) + ' 颗' : dimsOf(o)),
    finishText: works ? '' : finishOf(o),
    holeText: HOLE_TEXT[o.hole] || '',
    deliveryText: o.delivery === 'express' ? '快递到家' : '到店自取',
    totalYuan: pricing.yuan(o.totalFen),
    timeText: fmtTime(o.createdAt),
    paidText: fmtTime(o.paidAt),
    items: (o.items || []).map(i => Object.assign({}, i, { yuan: pricing.yuan(i.fen) })),
    canPay: o.status === 'unpaid',
    canCancel: o.status === 'unpaid',
    canConfirm: o.status === 'shipped' || o.status === 'ready',
    canContact: ['paid', 'assigned', 'accepted', 'shipped', 'ready', 'done'].indexOf(o.status) >= 0,
  });
}

module.exports = {
  STATUS, ORDER_FINISH, statusInfo, isGlitter, orderFinish, finishLabel, workStats, buildPayload,
  create, requestPay, list, get, payParams, cancel, confirm, errText,
  cartRead, cartWrite, cartClear,
  remember, localList, localCount, lastPhone, rememberPhone, fmtTime, toVM,
};
