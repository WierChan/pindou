const assert = require('assert');
const apiPath = require.resolve('../utils/api');
const calls = [];
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: {
  post(path, body) {
    calls.push({ path, body });
    if (body.works) return Promise.resolve({
      ok: true, reason: '', badIndex: -1,
      lines: [
        { name: '测试作品', items: [{ key: 'labor', label: '代拼费', desc: '3027 颗', fen: 5240 }], goodsFen: 5240 },
        { name: '爱心', items: [{ key: 'labor', label: '代拼费', desc: '400 颗', fen: 470 }], goodsFen: 470 },
      ],
      shipping: { key: 'shipping', label: '运费', desc: '到店自取', fen: 0 },
      goodsFen: 5710, shippingFen: 0, totalFen: 5710, needAddress: false,
    });
    return Promise.resolve({
      ok: true, reason: '',
      items: [
        { key: 'labor', label: '代拼费', desc: '3027 颗', baseFen: 4541, fen: 5240 },
        { key: 'shipping', label: '运费', desc: '到店自取', baseFen: 0, fen: 0 },
      ],
      goodsFen: 5240, shippingFen: 0, totalFen: 5240, needAddress: false,
    });
  },
} };
const order = require('../utils/order');

const cells = Array.from({ length: 60 * 60 }, (_, i) => i < 3027 ? 0 : -1);
const work = { id: 'test', name: '测试作品', w: 60, h: 60, cells };
const stats = { beads: 3027, colorN: 1, colors: [] };

(async () => {
    const q = await order.quote([{ work, finish: 'smooth', stats }], { hole: 'none', delivery: 'pickup', address: null });
    assert.strictEqual(calls[0].path, '/api/orders/quote');
    assert.strictEqual(calls[0].body.w, 60);
    assert.strictEqual(calls[0].body.finish, 'smooth');
    assert.strictEqual(calls[0].body.delivery, 'pickup');
    assert.strictEqual(calls[0].body.glitter, false);
    assert.strictEqual(JSON.parse(calls[0].body.payload).cells.length, 3600);
    assert.strictEqual(q.totalFen, 5240);
    assert.strictEqual(q.lines[0].items[0].fen, 5240);
    assert.strictEqual(q.shipping.fen, 0);
    const second = { work: { id: 'heart', name: '爱心', w: 20, h: 20, cells: new Array(400).fill(0) }, finish: 'towel', stats: { beads: 400, colorN: 1, colors: [] } };
    const multi = await order.quote([{ work, finish: 'smooth', stats }, second], { hole: 'none', delivery: 'pickup', address: null });
    assert.strictEqual(calls[1].path, '/api/orders/quote');
    assert.strictEqual(calls[1].body.works.length, 2);
    assert.strictEqual(calls[1].body.works[1].finish, 'towel');
    assert.strictEqual(calls[1].body.works[1].payload, order.buildPayload(second.work));
    assert.strictEqual(calls[1].body.works[1].colors, undefined, '报价只发送契约字段');
    assert.strictEqual(multi.lines[1].goodsFen, 470);
    assert.strictEqual(multi.totalFen, 5710);
    await order.create([{ work, finish: 'smooth', stats }, second], {
      clientOrderId: 'test-multi-order', hole: 'none', delivery: 'pickup', phone: '13800138000', quote: multi,
    });
    assert.strictEqual(calls[2].path, '/api/orders');
    assert.strictEqual(calls[2].body.works.length, 2);
    assert.strictEqual(calls[2].body.clientQuote.totalFen, 5710);
    assert.deepStrictEqual(calls[2].body.clientQuote.items.map(i => i.key), ['labor', 'labor', 'shipping']);
    console.log('order quote adapter ok');
})().catch(err => { console.error(err); process.exitCode = 1; });
