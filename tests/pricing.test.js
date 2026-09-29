// 代拼报价回归：node tests/pricing.test.js
// 两层价格：商家报价（baseFen，豆数 × 单价精确到分 + 格利特）→ 用户价（fen = ÷0.8946 向上取整到角）。
// 分账铁律：支付机构先扣通道手续费（微信渠道 0.6%，可由 pricing.feeRate 覆盖），剩下商家 90%、平台 10%（商家 ≈ 实付 89.46%），含运费没有例外。
// 运费表值就是客户付的运费（整数、不加价）。代拼价已含豆子与熨烫，不收材料包/代烫。
const assert = require('assert');
const P = require('../utils/pricing');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }
const base = (q, k) => q.items.filter(i => i.key === k).reduce((a, i) => a + i.baseFen, 0); // 商家报价
const cust = (q, k) => q.items.filter(i => i.key === k).reduce((a, i) => a + i.fen, 0);     // 用户价
const keys = q => q.items.map(i => i.key).join(',');
const gross = fen => Math.ceil(fen / 0.8946 / 10 - 1e-7) * 10;
// 期望分账：先扣 0.6%，净额 10/90
function expectSettle(T) {
  const wx = Math.round(T * 0.006), net = T - wx, plat = Math.round(net * 0.1);
  return { wx, plat, merchant: net - plat };
}

t('feeRate 覆盖：通道费率变了，分账和用户价跟着变；超范围忽略；configure(null) 恢复 0.6%', () => {
  P.configure({ feeRate: 0.0038 });
  assert.strictEqual(P.rates().feeRate, 0.0038);
  const s = P.settle(10000);
  assert.deepStrictEqual([s.wxFeeFen, s.netFen, s.platformFen, s.merchantFen], [38, 9962, 996, 8966]);
  assert.strictEqual(P.grossUp(1000), 1120); // 1000 ÷ ((1−0.0038)×0.9) = 1115.3 → 向上到角
  P.configure({ feeRate: 0.2 });
  assert.strictEqual(P.rates().feeRate, 0.006);
  P.configure(null);
  assert.strictEqual(P.rates().feeRate, 0.006);
  assert.strictEqual(P.settle(10000).wxFeeFen, 60);
});

// 商家价目（2026-09-16 二版：1,600 颗归入 0.015 档报 24 元）：尺寸 / 格利特 / 豆数 / 代拼（元）。
// 代拼费精确到分（2704 × 0.015 = 40.56，价目表上的 40 是抹零展示，不照搬）
const TABLE = [
  [10, 0.5, 100, 1],
  [20, 0.5, 400, 4],
  [30, 0.5, 900, 9],
  [40, 0.5, 1600, 24],
  [52, 1, 2704, 40.56],
  [78, 1.5, 6084, 121.68],
  [104, 2, 10816, 216.32],
];
t('七档满板：商家报价 = 豆数 × 单价精确到分，用户价 = 报价 ÷ 0.8946 向上取整到角', () => {
  for (const [size, glitter, beads, labor] of TABLE) {
    const q = P.quote({ w: size, h: size, beads, colorN: 10, delivery: 'pickup' });
    assert.ok(q.ok, size + ' ok');
    assert.strictEqual(keys(q), 'labor,shipping', size + ' 只有代拼费与运费两项');
    assert.strictEqual(base(q, 'labor'), Math.round(labor * 100), size + ' 商家代拼报价');
    assert.strictEqual(cust(q, 'labor'), gross(Math.round(labor * 100)), size + ' 用户价');
    assert.strictEqual(q.totalFen, cust(q, 'labor'), size + ' 合计 = 代拼用户价');
    assert.strictEqual(q.merchantQuoteFen, Math.round(labor * 100));
    const g = P.quote({ w: size, h: size, beads, colorN: 10, glitter: true, delivery: 'pickup' });
    assert.strictEqual(keys(g), 'labor,glitter,shipping');
    assert.strictEqual(base(g, 'glitter'), Math.round(glitter * 100), size + ' 格利特报价');
    assert.strictEqual(cust(g, 'glitter'), gross(Math.round(glitter * 100)), size + ' 格利特用户价');
  }
});

t('用户给的例子：1242 颗商家 12.42，用户付 13.90；微信 0.08，剩 13.82 → 平台 1.38、商家 12.44', () => {
  const q = P.quote({ w: 76, h: 78, beads: 1242, delivery: 'pickup' });
  assert.strictEqual(q.rateTier.rate, 10);
  assert.strictEqual(base(q, 'labor'), 1242);
  assert.strictEqual(q.totalFen, 1390);      // 12.42 ÷ 0.8946 = 13.88 → 13.90
  const s = P.settle(q.totalFen);
  assert.deepStrictEqual([s.wxFeeFen, s.netFen, s.platformFen, s.merchantFen], [8, 1382, 138, 1244]);
  assert.ok(s.merchantFen >= 1242);
});

t('商家给的例子：4592 颗报 68.88 元，用户付 77.00，商家到手 ≥ 68.88', () => {
  const q = P.quote({ w: 68, h: 68, beads: 4592, delivery: 'pickup' });
  assert.strictEqual(q.rateTier.size, 52);
  assert.strictEqual(base(q, 'labor'), 6888);
  assert.strictEqual(q.totalFen, 7700);      // 68.88 ÷ 0.8946 = 76.995 → 77.00
  const s = P.settle(q.totalFen), e = expectSettle(7700);
  assert.deepStrictEqual([s.wxFeeFen, s.platformFen, s.merchantFen], [e.wx, e.plat, e.merchant]);
  assert.ok(s.merchantFen >= 6888);
  assert.strictEqual(s.wxFeeFen + s.platformFen + s.merchantFen, 7700);
});

t('运费：表值就是客户付的整数运费，不加价；代拼费不随配送方式变；分账连运费一起切', () => {
  const pickup = P.quote({ w: 68, h: 68, beads: 4592, glitter: true, delivery: 'pickup' });
  const zj = P.quote({ w: 68, h: 68, beads: 4592, glitter: true, delivery: 'express', province: '浙江省' });
  assert.strictEqual(cust(zj, 'labor'), cust(pickup, 'labor'));
  assert.strictEqual(cust(zj, 'glitter'), cust(pickup, 'glitter'));
  assert.strictEqual(zj.shippingFen, 600);
  assert.strictEqual(cust(zj, 'shipping'), 600);
  assert.strictEqual(zj.totalFen, pickup.totalFen + 600);
  const sz = P.settle(zj.totalFen), e = expectSettle(zj.totalFen);
  assert.deepStrictEqual([sz.wxFeeFen, sz.platformFen, sz.merchantFen], [e.wx, e.plat, e.merchant]);
  // 商家到手 ≥ 商品报价 + 运费 × 89.46%
  assert.ok(sz.merchantFen >= zj.merchantQuoteFen + Math.floor(600 * 0.8946) - 1);
});

t('分账保证：任意订单 微信=0.6% 实付、平台=10% 净额、商家=其余且 ≥ 商品报价（+ 运费 89.46%），三方相加 = 实付', () => {
  const cases = [
    { w: 10, h: 10, beads: 100, delivery: 'pickup' },
    { w: 10, h: 10, beads: 100, glitter: true, delivery: 'express', province: '浙江省' },
    { w: 40, h: 40, beads: 1599, delivery: 'express', province: '北京市' },
    { w: 52, h: 52, beads: 2704, glitter: true, delivery: 'express', province: '新疆维吾尔自治区' },
    { w: 104, h: 104, beads: 10816, glitter: true, delivery: 'express', province: '上海市' },
    { w: 30, h: 30, beads: 8946, delivery: 'pickup' },                      // 89.46 ÷ 0.8946 = 100.000…，浮点边界
    { w: 30, h: 30, beads: 8946, delivery: 'express', province: '浙江省' },
  ];
  for (const c of cases) {
    const q = P.quote(c);
    assert.ok(q.ok, JSON.stringify(c));
    const s = P.settle(q.totalFen), e = expectSettle(q.totalFen);
    assert.deepStrictEqual([s.wxFeeFen, s.platformFen, s.merchantFen], [e.wx, e.plat, e.merchant], JSON.stringify(c));
    const floor = q.merchantQuoteFen + Math.floor(q.shippingFen * 0.8946) - 1;
    assert.ok(s.merchantFen >= floor, JSON.stringify(c) + ' 商家到手 ' + s.merchantFen + ' < ' + floor);
    assert.ok(s.merchantFen - floor < 100, JSON.stringify(c) + ' 多给商家超过 1 元');
    assert.strictEqual(s.wxFeeFen + s.platformFen + s.merchantFen, q.totalFen);
    assert.strictEqual(q.totalFen % 10, 0, '用户价取整到角');
  }
  assert.strictEqual(P.grossUp(8946), 10000); // 浮点边界：不能进位成 10010
  assert.strictEqual(P.grossUp(0), 0);
});

t('不再收材料费、代烫费', () => {
  const q = P.quote({ w: 30, h: 30, beads: 900, delivery: 'pickup' });
  assert.strictEqual(base(q, 'material'), 0);
  assert.strictEqual(base(q, 'iron'), 0);
  assert.strictEqual(q.merchantQuoteFen, 900);
  assert.strictEqual(q.totalFen, 1010); // 9 ÷ 0.8946 = 10.06 → 10.10
});

t('门槛：不足 100 颗 / 长边超 104 拒绝，边界值放行', () => {
  assert.strictEqual(P.quote({ w: 10, h: 10, beads: 99 }).ok, false);
  assert.ok(/100 颗/.test(P.quote({ w: 10, h: 10, beads: 99 }).reason));
  assert.strictEqual(P.quote({ w: 10, h: 10, beads: 100 }).ok, true);
  assert.strictEqual(P.quote({ w: 105, h: 10, beads: 500 }).ok, false);
  assert.ok(/104/.test(P.quote({ w: 10, h: 105, beads: 500 }).reason));
  assert.strictEqual(P.quote({ w: 104, h: 104, beads: 500 }).ok, true);
});

t('非满板：工费档「达到哪档按哪档」、精确到分，格利特按板子档（都按商家报价验）', () => {
  let q = P.quote({ w: 45, h: 45, beads: 2025, delivery: 'pickup' }); // 达到 40 档 0.015 → 30.375 → 30.38
  assert.strictEqual(q.rateTier.size, 40);
  assert.strictEqual(base(q, 'labor'), 3038);
  assert.strictEqual(q.tier.size, 52);
  assert.strictEqual(base(P.quote({ w: 40, h: 40, beads: 1599 }), 'labor'), 1599); // 0.01 → 15.99
  assert.strictEqual(base(P.quote({ w: 40, h: 40, beads: 1600 }), 'labor'), 2400); // 0.015 → 24.00
  assert.strictEqual(base(P.quote({ w: 52, h: 52, beads: 2703 }), 'labor'), 4055); // 40.545 → 40.55
  assert.strictEqual(base(P.quote({ w: 78, h: 78, beads: 6083 }), 'labor'), 9125); // 91.245 → 91.25
  assert.strictEqual(base(P.quote({ w: 78, h: 78, beads: 6084 }), 'labor'), 12168); // 0.02 → 121.68
  q = P.quote({ w: 60, h: 60, beads: 500, glitter: true, delivery: 'pickup' }); // 0.01 档 5 元；闪粉按 78 板档 1.5 元
  assert.strictEqual(base(q, 'labor'), 500);
  assert.strictEqual(base(q, 'glitter'), 150);
  q = P.quote({ w: 104, h: 20, beads: 2080, delivery: 'pickup' }); // 0.015 → 31.20；板子档按长边 104
  assert.strictEqual(q.tier.size, 104);
  assert.strictEqual(base(q, 'labor'), 3120);
  assert.strictEqual(base(P.quote({ w: 20, h: 20, beads: 150 }), 'labor'), 150); // 1.50
});

t('含色数超档只提示不加价', () => {
  const a = P.quote({ w: 20, h: 20, beads: 400, colorN: 15, delivery: 'pickup' });
  const b = P.quote({ w: 20, h: 20, beads: 400, colorN: 16, delivery: 'pickup' });
  assert.strictEqual(a.colorOver, false);
  assert.strictEqual(b.colorOver, true);
  assert.strictEqual(a.totalFen, b.totalFen);
});

t('快递分区：省内 / 江浙沪皖 / 其他 / 偏远 / 港澳台 / 未选地址（运费即表值）', () => {
  const bs = { w: 20, h: 20, beads: 400, delivery: 'express' };
  const ship = prov => P.quote({ ...bs, province: prov });
  assert.strictEqual(ship('浙江省').shippingFen, 600);
  assert.strictEqual(ship('上海市').shippingFen, 800);
  assert.strictEqual(ship('江苏省').shippingFen, 800);
  assert.strictEqual(ship('北京市').shippingFen, 1000);
  assert.strictEqual(ship('新疆维吾尔自治区').shippingFen, 1800);
  assert.strictEqual(ship('内蒙古自治区').shippingFen, 1800);
  const hk = ship('香港特别行政区');
  assert.strictEqual(hk.ok, false);
  assert.ok(/香港/.test(hk.reason));
  const none = P.quote(bs);
  assert.strictEqual(none.ok, true);
  assert.strictEqual(none.needAddress, true);
  assert.strictEqual(none.shippingFen, 0);
  assert.strictEqual(none.totalFen, none.goodsFen);
  assert.strictEqual(ship('浙江省').totalFen, 1050); // 代拼用户价 4.50（4 ÷ 0.8946 = 4.47 → 4.50）+ 运费 6.00
  assert.strictEqual(P.quote({ w: 20, h: 20, beads: 400, delivery: 'pickup' }).shippingFen, 0);
});

t('分账公式：先扣通道手续费 0.6%，净额平台 10% / 商家 90%', () => {
  const s = P.settle(10000);
  assert.deepStrictEqual([s.wxFeeFen, s.netFen, s.platformFen, s.merchantFen], [60, 9940, 994, 8946]);
  const z = P.settle(0);
  assert.deepStrictEqual([z.wxFeeFen, z.platformFen, z.merchantFen], [0, 0, 0]);
});

t('格式：分 → 元字符串，厘 → 单价', () => {
  assert.strictEqual(P.yuan(1390), '13.90');
  assert.strictEqual(P.yuan(100), '1.00');
  assert.strictEqual(P.yuan(0), '0.00');
  assert.strictEqual(P.rateText(10), '0.01');
  assert.strictEqual(P.rateText(15), '0.015');
});

t('配置覆盖：合法项生效、非法项忽略、null 恢复默认', () => {
  P.configure({ minBeads: 50, shipping: { base: 1200, zones: [{ key: 'zj', name: '省内', fee: 500, provinces: ['浙江'] }] } });
  assert.strictEqual(P.quote({ w: 10, h: 10, beads: 60 }).ok, true);
  assert.strictEqual(P.quote({ w: 10, h: 10, beads: 100, delivery: 'express', province: '浙江省' }).shippingFen, 500);
  assert.strictEqual(P.quote({ w: 10, h: 10, beads: 100, delivery: 'express', province: '北京市' }).shippingFen, 1200);
  P.configure({ tiers: [{ size: 50, rate: 20 }] }); // 缺 glitter/colors 时按 0 = 不加收/不提示
  const q = P.quote({ w: 30, h: 30, beads: 900, colorN: 99, glitter: true, delivery: 'pickup' });
  assert.strictEqual(base(q, 'labor'), 1800);
  assert.strictEqual(base(q, 'glitter'), 0);
  assert.strictEqual(keys(q), 'labor,shipping');
  assert.strictEqual(q.colorOver, false);
  assert.strictEqual(P.quote({ w: 51, h: 10, beads: 200 }).ok, false);
  P.configure({ tiers: [{ size: 'x' }], minBeads: -1 });
  assert.strictEqual(P.current().tiers.length, 7);
  assert.strictEqual(P.current().minBeads, 100);
  P.configure(null);
  assert.deepStrictEqual(P.current(), P.DEFAULTS);
});

console.log('\n全部通过：' + n + ' 组');
