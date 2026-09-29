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
  shipping: {
    base: 1000,
    baseName: '其他省份',
    zones: [
      { key: 'zj',  name: '浙江省内',       fee: 600,  provinces: ['浙江'] },
      { key: 'jsh', name: '江苏/上海/安徽', fee: 800,  provinces: ['江苏', '上海', '安徽'] },
      { key: 'far', name: '偏远地区',       fee: 1800, provinces: ['新疆', '西藏', '内蒙古', '青海', '甘肃', '宁夏', '海南'] },
    ],
    blocked: ['香港', '澳门', '台湾'], // 暂不支持快递
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
      if (typeof s.baseName === 'string' && s.baseName) c.shipping.baseName = s.baseName;
      if (Array.isArray(s.zones) && s.zones.every(z => z && isNum(z.fee) && Array.isArray(z.provinces))) {
        c.shipping.zones = s.zones.map((z, i) => ({
          key: String(z.key || ('z' + i)), name: String(z.name || ''), fee: z.fee | 0,
          provinces: z.provinces.map(String),
        }));
      }
      if (Array.isArray(s.blocked)) c.shipping.blocked = s.blocked.map(String);
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
  if (hit(s.blocked)) return { key: 'blocked', name: p.replace(/特别行政区|省|市$/g, ''), fee: 0, blocked: true };
  for (const z of s.zones) if (hit(z.provinces)) return { key: z.key, name: z.name, fee: z.fee, blocked: false };
  return { key: 'base', name: s.baseName, fee: s.base, blocked: false };
}

function item(key, label, desc, baseFen) {
  return { key, label, desc, baseFen, fen: grossUp(baseFen) }; // baseFen 商家报价 / fen 用户价
}

// 报价。o: { w, h, beads, colorN, glitter, delivery: 'pickup'|'express', province }
// 返回 { ok, reason, items:[{key,label,desc,baseFen,fen}], goodsFen, shippingFen, totalFen（用户价，分）,
//        merchantQuoteFen（商品部分商家报价合计）, tier, rateTier, zone, colorOver, needAddress }
// ok=false 是硬阻断（豆数/尺寸/不可达地区）；快递未选地址时 ok 仍为 true 但 needAddress=true、运费暂计 0
function quote(o) {
  o = o || {};
  const w = o.w | 0, h = o.h | 0, beads = o.beads | 0;
  const side = Math.max(w, h);
  const res = {
    ok: true, reason: '', items: [], goodsFen: 0, shippingFen: 0, totalFen: 0, merchantQuoteFen: 0,
    tier: null, rateTier: null, zone: null, colorOver: false, needAddress: false,
  };
  if (beads < CFG.minBeads) {
    res.ok = false; res.reason = '豆子不足 ' + CFG.minBeads + ' 颗，暂不支持代拼';
    return res;
  }
  const tier = boardTier(side);
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
  res.colorOver = tier.colors > 0 && (o.colorN | 0) > tier.colors;
  res.totalFen = res.goodsFen + res.shippingFen;
  // 商品部分（代拼费 + 格利特）的商家报价合计：分账后商家到手保证 ≥ 它 + 运费 × 89.46%
  res.merchantQuoteFen = res.items.filter(it => it.key !== 'shipping').reduce((a, it) => a + it.baseFen, 0);
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
  configure, current, rates, quote, settle, grossUp, zoneOf, rateTier, boardTier, yuan, rateText,
};
