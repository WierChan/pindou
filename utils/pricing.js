// 代拼报价引擎（纯函数、零 wx 依赖）：
//   · Node 直接跑 `node tests/pricing.test.js` 回归；
//   · pindou-server 可原样拷贝本文件复算 —— 下单金额以服务端复算为准，客户端只做即时展示。
//
// 两层价格（2026-09-16 用户定）：
//   · 商家报价（DEFAULTS 里的数字）= 商家到手的钱，来自商家价目（docs/order-api.md 收录原表）。原表是三种
//     独立服务：材料包（只买豆子）、代烫（自己拼好寄去烫）、代拼（备豆+拼+烫寄成品）；小程序只卖代拼，
//     代拼价已含豆子和熨烫，不另收材料包与代烫费。
//   · 分账铁律（用户 2026-09-17 最终拍板）：**微信先从实付里扣 0.6% 手续费，剩下的商家 90%、平台 10%**，
//     含运费、没有例外。即商家得实付的 0.994 × 90% = 89.46%，平台得 9.94%。
//   · 用户价 = 商家报价 ÷ 0.8946，向上取整到角（0.1 元）——这样分账后商家到手 ≥ 报价（取整零头归商家）。
//     代拼费 / 格利特 各自加价，不单列「平台服务费」。
//   · 运费：shipping 表里的数字**就是客户付的运费**（整数，不再另外加价，用户要求运费显示不能贵），
//     分账时和商品一起按上面比例切——商家报运费价时自己把这 10% 算进去（想净收 6 报 7）。代拼费不随配送方式变。
// 所有金额用整数「分」运算（每颗单价用「厘」），避免浮点误差；微信支付接口本身也按分计。
//
// 商家报价规则：
//   · 代拼费 = 豆数 × 每颗单价，**精确到分、不抹零**（用户 2026-09-17 定：1242 颗就是 12.42 元；价目表上
//     2704 颗写 40 是展示时抹的零，不照搬），档位按豆数、**达到哪档按哪档**
//     （不足 1600 颗 0.01 / 1600~6083 颗 0.015 / 6084 颗起 0.02；1600 颗报 24 元即 0.015）
//   · 格利特（闪粉类烫法）按板子档加收（原表写「代烫基础上额外收费」；代拼已含烫，闪粉是额外工艺，
//     仍按档加收——待商家确认，不加收就把 tiers 里的 glitter 全置 0）
//   · 门槛：豆数 ≥ 100；板子长边 ≤ 104（原表「104 以上根据图纸具体情况收费」，v1 不自助下单）
//   · 每档「含色数」（15/25/30）只做提示不加价

const DEFAULTS = {
  minBeads: 100,   // 少于这个豆数不接代拼
  maxSide: 104,    // 板子长边上限（原表最大档）
  // size 板子边长（格）；beads 满板豆数（工费档位的分界）；rate 代拼 厘/颗；glitter 格利特加收 分；colors 该档含色数
  tiers: [
    { size: 10,  beads: 100,   rate: 10, glitter: 50,  colors: 15 },
    { size: 20,  beads: 400,   rate: 10, glitter: 50,  colors: 15 },
    { size: 30,  beads: 900,   rate: 10, glitter: 50,  colors: 15 },
    { size: 40,  beads: 1600,  rate: 15, glitter: 50,  colors: 15 },
    { size: 52,  beads: 2704,  rate: 15, glitter: 100, colors: 15 },
    { size: 78,  beads: 6084,  rate: 20, glitter: 150, colors: 25 },
    { size: 104, beads: 10816, rate: 20, glitter: 200, colors: 30 },
  ],
  // 快递分区（分，**客户付的运费**，整数元；分账时按比例切）：按 wx.chooseAddress 的 provinceName 前缀匹配；没命中任何区走 base。
  // ⚠ 默认值是杭州发通达系的常见价，正式上线前和商家定（也可由 /api/config 的 order.pricing.shipping 下发覆盖）
  // fee = 首重价；extra = 续重价（每 parcel.stepG 克，只有多图订单超首重才用得上）
  shipping: {
    base: 1000,
    baseExtra: 500,
    baseName: '其他省份',
    zones: [
      { key: 'zj',  name: '浙江省内',       fee: 600,  extra: 200,  provinces: ['浙江'] },
      { key: 'jsh', name: '江苏/上海/安徽', fee: 800,  extra: 300,  provinces: ['江苏', '上海', '安徽'] },
      { key: 'far', name: '偏远地区',       fee: 1800, extra: 1000, provinces: ['新疆', '西藏', '内蒙古', '青海', '甘肃', '宁夏', '海南'] },
    ],
    blocked: ['香港', '澳门', '台湾'], // 暂不支持快递
  },
  // 多图订单（quoteCart）的包裹估算。⚠ 全是占位值，要商家称重、量箱子、给快递合同价后改（或 /api/config 下发覆盖）
  //   计费重 = max(实重, 箱子体积 ÷ 抛比)；运费 = 首重价 + ceil((计费重 − 首重) ÷ 续重粒度) × 续重价
  parcel: {
    maxItems: 10,      // 一单最多几张图
    firstG: 1000,      // 首重（克）
    stepG: 1000,       // 续重粒度（克）
    volDivisor: 8000,  // 抛比（cm³/kg；通达系常见 8000，顺丰 6000）
    maxG: 5000,        // 计费重超过这个不自助下单
    beadMg: 10,        // 每颗成品豆重（毫克）：2.6mm 豆按体积估约 10mg，待商家称
    pitchMm: 2.6,      // 豆距（毫米）：板子实物边长 = 格数 × 豆距
    marginMm: 20,      // 成品放进箱子时长宽各留的余量
    sheetMm: 5,        // 每张成品叠放占的厚度（成品 + 隔板）
    padMm: 10,         // 箱底/箱顶缓冲
    packG: 150,        // 箱子 + 隔板 + 缓冲的重量
    // 箱型内径（毫米），从小到大挑第一个装得下的
    boxes: [
      { key: 's',  name: '小箱', l: 180, w: 180, h: 40 },
      { key: 'm',  name: '中箱', l: 250, w: 250, h: 50 },
      { key: 'l',  name: '大箱', l: 320, w: 320, h: 60 },
      { key: 'xl', name: '加高大箱', l: 320, w: 320, h: 120 },
    ],
  },
};

const WX_FEE_RATE = 0.006;   // 支付通道手续费默认值（微信渠道 0.6%，按实付总额、交易时由支付机构先扣；合同费率不同时用 pricing.feeRate 覆盖）
const PLATFORM_RATE = 0.10;  // 平台份额（按扣除手续费后的净额）
const MERCHANT_SHARE = (1 - WX_FEE_RATE) * (1 - PLATFORM_RATE); // 0.8946：默认费率下商家分得的实付比例
const ROUND_FEN = 10;        // 用户价取整粒度：10 分 = 1 角（代拼费 / 格利特）

let CFG = clone(DEFAULTS);
let FEE_RATE = WX_FEE_RATE;  // 当前生效的通道费率

// 当前生效的比例 { feeRate, platformRate, merchantShare }
function rates() {
  return { feeRate: FEE_RATE, platformRate: PLATFORM_RATE, merchantShare: (1 - FEE_RATE) * (1 - PLATFORM_RATE) };
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function isNum(v) { return typeof v === 'number' && isFinite(v) && v >= 0; }

// 运行时覆盖（/api/config 的 order.pricing）：只接受形状合法的项，其余保持默认。
// over: { feeRate?, minBeads?, maxSide?, tiers?, shipping? }；传 null 恢复默认
function configure(over) {
  const c = clone(DEFAULTS);
  FEE_RATE = WX_FEE_RATE;
  if (over && typeof over === 'object') {
    if (isNum(over.feeRate) && over.feeRate < 0.05) FEE_RATE = over.feeRate; // 通道费率，0～5%
    if (isNum(over.minBeads) && over.minBeads >= 1) c.minBeads = over.minBeads | 0;
    if (isNum(over.maxSide) && over.maxSide >= 1) c.maxSide = over.maxSide | 0;
    if (Array.isArray(over.tiers) && over.tiers.length &&
        over.tiers.every(t => t && isNum(t.size) && isNum(t.rate))) {
      c.tiers = over.tiers.map(t => ({
        size: t.size | 0, beads: isNum(t.beads) ? t.beads | 0 : (t.size | 0) * (t.size | 0),
        rate: t.rate, glitter: isNum(t.glitter) ? t.glitter | 0 : 0, colors: isNum(t.colors) ? t.colors | 0 : 0,
      })).sort((a, b) => a.size - b.size);
    }
    const s = over.shipping;
    if (s && typeof s === 'object') {
      if (isNum(s.base)) c.shipping.base = s.base | 0;
      if (isNum(s.baseExtra)) c.shipping.baseExtra = s.baseExtra | 0;
      if (typeof s.baseName === 'string' && s.baseName) c.shipping.baseName = s.baseName;
      if (Array.isArray(s.zones) && s.zones.every(z => z && isNum(z.fee) && Array.isArray(z.provinces))) {
        c.shipping.zones = s.zones.map((z, i) => ({
          key: String(z.key || ('z' + i)), name: String(z.name || ''), fee: z.fee | 0,
          extra: isNum(z.extra) ? z.extra | 0 : c.shipping.baseExtra, // 没给续重价按 baseExtra
          provinces: z.provinces.map(String),
        }));
      }
      if (Array.isArray(s.blocked)) c.shipping.blocked = s.blocked.map(String);
    }
    const p = over.parcel;
    if (p && typeof p === 'object') {
      const pc = c.parcel;
      ['maxItems', 'firstG', 'stepG', 'volDivisor', 'maxG', 'marginMm', 'sheetMm', 'padMm', 'packG'].forEach(k => {
        if (isNum(p[k])) pc[k] = p[k] | 0;
      });
      if (isNum(p.beadMg)) pc.beadMg = p.beadMg;
      if (isNum(p.pitchMm) && p.pitchMm > 0) pc.pitchMm = p.pitchMm;
      if (pc.maxItems < 1) pc.maxItems = 1;
      if (pc.stepG < 1) pc.stepG = DEFAULTS.parcel.stepG;
      if (pc.volDivisor < 1) pc.volDivisor = DEFAULTS.parcel.volDivisor;
      if (Array.isArray(p.boxes) && p.boxes.length &&
          p.boxes.every(b => b && isNum(b.l) && isNum(b.w) && isNum(b.h))) {
        pc.boxes = p.boxes.map((b, i) => {
          const l = b.l | 0, w = b.w | 0;
          return { key: String(b.key || ('b' + i)), name: String(b.name || ''), l: Math.max(l, w), w: Math.min(l, w), h: b.h | 0 };
        }).sort((a, b) => a.l * a.w * a.h - b.l * b.w * b.h);
      }
    }
  }
  CFG = c;
  return CFG;
}

function current() { return CFG; }

// 金额格式：分 → '13.90'
function yuan(fen) { return ((fen | 0) / 100).toFixed(2); }
// 每颗单价格式：厘 → '0.01' / '0.015'
function rateText(rate) { return String(rate / 1000); }

// 商家报价（分）→ 用户价（分）：÷ 0.8946 后向上取整到角。减 1e-7 抵消浮点误差（0.8946 的整倍数除回去可能多出 1e-13）
function grossUp(fen) {
  if (!(fen > 0)) return 0;
  return Math.ceil(fen / rates().merchantShare / ROUND_FEN - 1e-7) * ROUND_FEN;
}

// 工费档（按豆数）：「满板豆数 ≤ 实际豆数」的最大档——达到哪档按哪档的单价
// （商家口径：4592 颗已达 52 档 2704 颗、未达 78 档 6084 颗 → 按 52 档 0.015；1600 颗起就是 0.015）；不足最小档按最小档
function rateTier(beads) {
  const t = CFG.tiers;
  let hit = t[0];
  for (let i = 0; i < t.length; i++) if (beads >= t[i].beads) hit = t[i];
  return hit;
}
// 板子档（按长边）：能放下的最小板；超过最大档返回 null
function boardTier(side) {
  const t = CFG.tiers;
  for (let i = 0; i < t.length; i++) if (side <= t[i].size) return t[i];
  return null;
}

function laborFen(beads, rate) {
  return Math.round(beads * rate / 10); // 厘 → 分，四舍五入到分（0.015 × 奇数颗才会出现半分）
}

// 省份 → 分区。province 取 wx.chooseAddress 的 provinceName（如「浙江省」「新疆维吾尔自治区」），前缀匹配
function zoneOf(province) {
  const p = String(province || '').trim();
  if (!p) return null;
  const s = CFG.shipping;
  const hit = list => list.some(name => p.indexOf(name) === 0);
  if (hit(s.blocked)) return { key: 'blocked', name: p.replace(/特别行政区|省|市$/g, ''), fee: 0, extra: 0, blocked: true };
  for (const z of s.zones) if (hit(z.provinces)) return { key: z.key, name: z.name, fee: z.fee, extra: z.extra, blocked: false };
  return { key: 'base', name: s.baseName, fee: s.base, extra: s.baseExtra, blocked: false };
}

// 包裹估算。pieces: [{ w, h, beads }]（每张成品）→
//   { ok, box, actualG, volG, billedG, steps（续重份数）, tooBig }；装不下任何箱型或计费重超 maxG 时 ok=false、tooBig=true
function parcelOf(pieces) {
  const pc = CFG.parcel;
  let long = 0, short = 0, beads = 0;
  for (const p of pieces) {
    const a = Math.max(p.w | 0, p.h | 0), b = Math.min(p.w | 0, p.h | 0);
    if (a > long) long = a;
    if (b > short) short = b;
    beads += p.beads | 0;
  }
  const needL = Math.ceil(long * pc.pitchMm) + pc.marginMm;
  const needW = Math.ceil(short * pc.pitchMm) + pc.marginMm;
  const needH = pieces.length * pc.sheetMm + pc.padMm;
  const actualG = Math.ceil(beads * pc.beadMg / 1000) + pc.packG;
  const res = { ok: false, box: null, actualG, volG: 0, billedG: actualG, steps: 0, tooBig: true };
  const box = pc.boxes.find(b => b.l >= needL && b.w >= needW && b.h >= needH);
  if (!box) return res;
  // 体积重：mm³ → cm³ ÷ 抛比(cm³/kg) → 克
  const volG = Math.ceil(box.l * box.w * box.h / 1000 / pc.volDivisor * 1000);
  const billedG = Math.max(actualG, volG);
  res.box = { key: box.key, name: box.name, l: box.l, w: box.w, h: box.h };
  res.volG = volG;
  res.billedG = billedG;
  if (billedG > pc.maxG) return res;
  res.ok = true;
  res.tooBig = false;
  res.steps = billedG > pc.firstG ? Math.ceil((billedG - pc.firstG) / pc.stepG) : 0;
  return res;
}

function item(key, label, desc, baseFen) {
  return { key, label, desc, baseFen, fen: grossUp(baseFen) }; // baseFen 商家报价 / fen 用户价
}

// 报价。o: { w, h, beads, colorN, glitter, delivery: 'pickup'|'express', province }
// 返回 { ok, reason, items:[{key,label,desc,baseFen,fen}], goodsFen, shippingFen, totalFen（用户价，分）,
//        merchantQuoteFen（商品部分商家报价合计）, tier, rateTier, zone, colorOver, needAddress }
// ok=false 是硬阻断（豆数/尺寸/不可达地区）；快递未选地址时 ok 仍为 true 但 needAddress=true、运费暂计 0
// 单张图的商品部分（代拼费 + 格利特），不含运费。o: { w, h, beads, colorN, glitter }
// 返回 { ok, reason, items, goodsFen, merchantQuoteFen, tier, rateTier, colorOver }
function goods(o) {
  o = o || {};
  const w = o.w | 0, h = o.h | 0, beads = o.beads | 0;
  const res = { ok: true, reason: '', items: [], goodsFen: 0, merchantQuoteFen: 0, tier: null, rateTier: null, colorOver: false };
  if (beads < CFG.minBeads) {
    res.ok = false; res.reason = '豆子不足 ' + CFG.minBeads + ' 颗，暂不支持代拼';
    return res;
  }
  const tier = boardTier(Math.max(w, h));
  if (!tier) {
    res.ok = false; res.reason = '超过 ' + CFG.maxSide + ' 格的大图需要联系商家单独报价';
    return res;
  }
  const rt = rateTier(beads);
  res.tier = tier;
  res.rateTier = rt;
  res.items.push(item('labor', '代拼费', beads + ' 颗 · 含豆子与熨烫定型', laborFen(beads, rt.rate)));
  if (o.glitter && tier.glitter > 0) res.items.push(item('glitter', '格利特闪粉', tier.size + ' 板档 · 闪粉烫法加收', tier.glitter));
  res.goodsFen = res.items.reduce((a, it) => a + it.fen, 0);
  res.merchantQuoteFen = res.items.reduce((a, it) => a + it.baseFen, 0);
  res.colorOver = tier.colors > 0 && (o.colorN | 0) > tier.colors;
  return res;
}

function quote(o) {
  o = o || {};
  const g = goods(o);
  const res = {
    ok: g.ok, reason: g.reason, items: g.items, goodsFen: g.goodsFen, shippingFen: 0, totalFen: 0, merchantQuoteFen: 0,
    tier: g.tier, rateTier: g.rateTier, zone: null, colorOver: false, needAddress: false,
  };
  if (!g.ok) return res;

  if (o.delivery === 'express') {
    const z = zoneOf(o.province);
    res.zone = z;
    if (!z) {
      res.needAddress = true;
      res.items.push(item('shipping', '运费', '选择收货地址后计算', 0));
    } else if (z.blocked) {
      res.ok = false; res.reason = z.name + '暂不支持快递，可选到店自取';
      res.items.push(item('shipping', '运费', '暂不支持', 0));
    } else {
      // 运费表值就是客户付的运费（整数），不再加价；分账时和商品一起按比例切
      res.items.push({ key: 'shipping', label: '运费', desc: z.name, baseFen: z.fee, fen: z.fee });
      res.shippingFen = z.fee;
    }
  } else {
    res.items.push(item('shipping', '运费', '到店自取', 0));
  }
  res.colorOver = g.colorOver;
  res.totalFen = res.goodsFen + res.shippingFen;
  // 商品部分（代拼费 + 格利特）的商家报价合计：分账后商家到手保证 ≥ 它 + 运费 × 89.46%
  res.merchantQuoteFen = g.merchantQuoteFen;
  return res;
}

// 多图订单报价（一单多张图，整单派给一个商家、合寄一个包裹）。
//   · 每张图各自按 goods() 定档计价，**豆数不加总**（加总会跳到更贵的档）；
//   · 运费整单只收一次：首重价 + 续重份数 × 续重价，计费重见 parcelOf()。单张图结果与 quote() 完全一致。
// list: [{ w, h, beads, colorN, glitter, name? }]；o: { delivery, province }
// 返回 { ok, reason, badIndex（出问题的那张，-1 表示不是某一张的问题）, lines:[goods() 结果 + name],
//        shipping（运费行）, goodsFen, shippingFen, totalFen, merchantQuoteFen, zone, parcel, needAddress, colorOver }
function quoteCart(list, o) {
  list = Array.isArray(list) ? list : [];
  o = o || {};
  const pc = CFG.parcel;
  const res = {
    ok: true, reason: '', badIndex: -1, lines: [], shipping: null,
    goodsFen: 0, shippingFen: 0, totalFen: 0, merchantQuoteFen: 0,
    zone: null, parcel: null, needAddress: false, colorOver: false,
  };
  const fail = (reason, idx) => {
    if (res.ok) { res.ok = false; res.reason = reason; res.badIndex = idx == null ? -1 : idx; }
  };
  if (!list.length) fail('还没有选择作品');
  else if (list.length > pc.maxItems) fail('一单最多 ' + pc.maxItems + ' 张图，请分开下单');

  list.forEach((x, i) => {
    const g = goods(x);
    g.name = String((x && x.name) || '');
    res.lines.push(g);
    if (!g.ok) fail('第 ' + (i + 1) + ' 张' + (g.name ? '「' + g.name + '」' : '') + '：' + g.reason, i);
    res.goodsFen += g.goodsFen;
    res.merchantQuoteFen += g.merchantQuoteFen;
    if (g.colorOver) res.colorOver = true;
  });

  if (o.delivery === 'express') {
    const z = zoneOf(o.province);
    res.zone = z;
    if (!z) {
      res.needAddress = true;
      res.shipping = item('shipping', '运费', '选择收货地址后计算', 0);
    } else if (z.blocked) {
      fail(z.name + '暂不支持快递，可选到店自取');
      res.shipping = item('shipping', '运费', '暂不支持', 0);
    } else if (list.length) {
      const pk = parcelOf(list.map(x => x || {}));
      res.parcel = pk;
      if (!pk.ok) {
        fail('这些图装一个包裹太大了，请分成两单或联系客服');
        res.shipping = item('shipping', '运费', '包裹超出范围', 0);
      } else {
        const fee = z.fee + pk.steps * z.extra;
        const desc = z.name + (pk.steps ? ' · 计费重 ' + (pk.billedG / 1000).toFixed(1) + 'kg' : '');
        res.shipping = { key: 'shipping', label: '运费', desc, baseFen: fee, fen: fee };
        res.shippingFen = fee;
      }
    }
  } else {
    res.shipping = item('shipping', '运费', '到店自取', 0);
  }
  res.totalFen = res.goodsFen + res.shippingFen;
  return res;
}

// 分账：实付总额 → 通道手续费（字段名沿用 wxFeeFen）/ 平台 / 商家（分）。含运费、没有例外：
//   手续费 = round(实付 × feeRate)；净额 = 实付 − 手续费；平台 = round(净额 × 10%)；商家 = 净额 − 平台（默认费率下 ≈ 实付的 89.46%，取整零头归商家）
function settle(totalFen) {
  const total = totalFen | 0;
  const wxFeeFen = Math.round(total * FEE_RATE);
  const netFen = total - wxFeeFen;
  const platformFen = Math.round(netFen * PLATFORM_RATE);
  return { totalFen: total, wxFeeFen, netFen, platformFen, merchantFen: netFen - platformFen };
}

module.exports = {
  DEFAULTS, WX_FEE_RATE, PLATFORM_RATE, MERCHANT_SHARE,
  configure, current, rates, quote, quoteCart, parcelOf, settle, grossUp, zoneOf, rateTier, boardTier, yuan, rateText,
};
