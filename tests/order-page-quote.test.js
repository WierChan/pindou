const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let page;
const requests = [];
const order = {
  quote() { return new Promise((resolve, reject) => requests.push({ resolve, reject })); },
  finishLabel: () => '普通烫',
  ORDER_FINISH: {},
};
const mocks = {
  '../../utils/store': { store: {} },
  '../../utils/board': {},
  '../../utils/finishimg': {},
  '../../utils/order': order,
  '../../utils/pricing': { yuan: fen => (fen / 100).toFixed(2) },
  '../../utils/config': { cfg: {} },
  '../../utils/ui': {},
};
vm.runInNewContext(fs.readFileSync(require.resolve('../pages/order/order.js'), 'utf8'), {
  require: id => mocks[id],
  Page: spec => { page = spec; },
  Date, Math, Number, Array, Error, String,
});
page.setData = function (patch) { Object.assign(this.data, patch); };
page.items = [{ work: { w: 60, h: 60, name: '测试' }, stats: { beads: 3027 }, finish: 'smooth' }];
page.data.works = [{}];

const response = (fen, needAddress) => ({
  ok: true, reason: '', needAddress: !!needAddress,
  lines: [{ items: [{ key: 'labor', label: '代拼费', desc: '3027 颗', fen }], goodsFen: fen }],
  shipping: { key: 'shipping', label: '运费', desc: needAddress ? '选择地址后计算' : '到店自取', fen: 0 },
  totalFen: fen, badIndex: -1,
});

(async () => {
  page._requote();
  assert.strictEqual(page.data.canPay, false);
  assert.strictEqual(page.data.totalYuan, '--');
  page._requote();
  requests[1].resolve(response(5240, false));
  await Promise.resolve();
  assert.strictEqual(page.data.totalYuan, '52.40');
  assert.strictEqual(page.data.items[0].yuan, '52.40');
  assert.strictEqual(page.data.canPay, true);
  requests[0].resolve(response(5080, false));
  await Promise.resolve();
  assert.strictEqual(page.data.totalYuan, '52.40', '旧请求不可覆盖新报价');

  page._requote();
  requests[2].resolve(response(5240, true));
  await Promise.resolve();
  assert.strictEqual(page.data.canPay, false, '未选地址不可下单');

  page.items.push({ work: { w: 20, h: 20, name: '爱心' }, stats: { beads: 400 }, finish: 'towel' });
  page.data.works = [{}, {}];
  page._requote();
  requests[3].resolve({
    ok: true, reason: '', badIndex: -1, needAddress: false,
    lines: [
      { name: '测试', items: [{ key: 'labor', fen: 5240 }], goodsFen: 5240 },
      { name: '爱心', items: [{ key: 'labor', fen: 470 }], goodsFen: 470 },
    ],
    shipping: { key: 'shipping', label: '运费', desc: '到店自取', fen: 0 },
    totalFen: 5710,
  });
  await Promise.resolve();
  assert.strictEqual(page.data.totalYuan, '57.10');
  assert.strictEqual(page.data.items.length, 3, '两张作品加一行整单运费');
  assert.strictEqual(page.data.canPay, true);
  console.log('order page quote states ok');
})().catch(err => { console.error(err); process.exitCode = 1; });
