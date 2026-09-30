// 代拼下单：把图纸交给商家拼好（烫法 / 豆孔 → 自取或快递 → 报价 → 微信支付）。
// 金额本地 pricing.js 即时估算展示；创建订单时服务端复算并返回权威金额，不一致先告知再拉起支付。
// 多图订单（cfg.ORDER.multi）：一单可放几张作品（代拼篮，本地只存 id + 烫法），每张各选烫法、各自计价，
// 整单派给一个商家合寄，运费只收一次（pricing.quoteCart）。上面的作品卡 / 烫法 / 预览都跟着「当前选中的那张」走。
const { store } = require('../../utils/store');
const { finishList, finishInfo, workFinish, renderPatternTo, patternSize } = require('../../utils/board');
const finishimg = require('../../utils/finishimg');
const order = require('../../utils/order');
const pricing = require('../../utils/pricing');
const { cfg } = require('../../utils/config');
const ui = require('../../utils/ui');

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    capW: 700,
    capH: 900,
    multi: false,       // 多图订单开关（cfg.ORDER.multi）
    works: [],          // 代拼篮作品条 [{id,name,thumb,finishText,bad}]，multi 开了才显示
    cur: 0,             // 当前编辑的那张
    canAdd: false,      // 还能再加一张
    picker: null,       // 「再加一张」选作品弹层 [{id,name,dims,thumb,low}]
    title: '',
    dims: '',
    beads: 0,
    colorN: 0,
    preview: '',        // 成品预览（先用作品缩略图占位，canvas 就绪后按所选烫法重渲）
    finishGroups: [],   // [{cat,label,items:[{key,name,sub,fee,img}]}]，闪粉类带加价标注，img 为示例实拍缩略图
    zoom: null,         // 点缩略图放大：{key,name,sub,fee,img,desc}
    finish: 'smooth',
    hole: 'none',
    delivery: 'pickup', // pickup 到店自取 / express 快递到家
    pickupArea: '',     // 自取范围（商家由平台派单后决定，下单时不展示具体哪家）
    pickupHint: '',
    phone: '',
    addr: null,         // 微信收货地址 {name, tel, province, city, county, detail, full}
    note: '',
    items: [],          // 费用明细 [{key,label,desc,yuan}]
    totalYuan: '0.00',
    blocked: '',        // 不能下单的原因（豆数不足 / 尺寸超档 / 地区不可达）
    notice: '',
    canPay: false,
    submitting: false,
  },

  onLoad(q) {
    const work = store.get(q.id);
    if (!work) { ui.backHome(); return; }
    if (work.free && !work.completed) {
      ui.toast('自由画布先完成定型，再找商家代拼');
      setTimeout(() => ui.backHome(), 700);
      return;
    }
    this.uq = ui.serialQueue();
    this.addr = null;
    const o = cfg.ORDER;
    this.multi = !!o.multi;
    // 代拼篮：之前加过没下单的作品还在（作品被删 / 变回未定型的自动剔除）；这次点进来的那张没在就追加并选中
    const items = this.multi ? order.cartRead().map(c => this._mkItem(store.get(c.id), c.finish)).filter(Boolean) : [];
    let cur = items.findIndex(x => x.work.id === work.id);
    if (cur < 0) { items.push(this._mkItem(work)); cur = items.length - 1; }
    this.items = items;
    this.cur = cur;
    this._saveCart();
    this.setData({
      insets: ui.navInsets(),
      multi: this.multi,
      hole: 'none', // 商家只做单面无孔：页面只展示「无孔」不可选，固定 none 随单提交、预览按无孔渲
      pickupArea: o.pickupArea,
      pickupHint: o.pickupHint,
      notice: o.notice,
      phone: order.lastPhone(),
    });
    this._sync();
  },

  // 作品 → 篮子里的一项；烫法缺省用作品自己的（彩虹闪粉归并到粗闪/细闪，下单页只给这两档）
  _mkItem(work, finish) {
    if (!work || (work.free && !work.completed)) return null;
    return { work, stats: order.workStats(work), finish: finish || order.orderFinish(workFinish(work)) };
  },
  _saveCart() { if (this.multi) order.cartWrite(this.items.map(x => ({ id: x.work.id, finish: x.finish }))); },

  // 当前那张 → 作品卡 / 烫法 / 预览；作品条整体刷新，然后重新报价
  _sync() {
    const it = this.items[this.cur];
    this.work = it.work;
    this.stats = it.stats;
    this.setData({
      works: this.items.map(x => ({ id: x.work.id, name: x.work.name, thumb: x.work.thumb || '', finishText: order.finishLabel(x.finish), bad: false })),
      cur: this.cur,
      canAdd: this.multi && this.items.length < pricing.current().parcel.maxItems,
      title: it.work.name,
      dims: it.work.w + '×' + it.work.h,
      beads: it.stats.beads,
      colorN: it.stats.colorN,
      preview: it.work.thumb || '',
      finish: it.finish,
      finishGroups: this._finishGroups(),
    });
    this._requote();
    this._renderPreview();
  },

  onReady() {
    ui.queryNode(this, '#util').then(r => {
      if (r && r.node) { this.utilCanvas = r.node; this._renderPreview(); }
    });
  },

  onUnload() { clearTimeout(this._pvT); },

  /* ---------- 代拼篮 ---------- */
  selectWork(e) {
    const i = +e.currentTarget.dataset.i;
    if (!(i >= 0 && i < this.items.length) || i === this.cur) return;
    this.cur = i;
    this._sync();
  },
  removeWork(e) {
    const i = +e.currentTarget.dataset.i;
    if (!(i >= 0 && i < this.items.length) || this.items.length <= 1) return;
    this.items.splice(i, 1);
    if (this.cur > i || this.cur >= this.items.length) this.cur = Math.max(0, this.cur - 1);
    this._saveCart();
    this._sync();
  },
  // 「再加一张」：列出其它能代拼的作品（进行中的自由画布不行）
  openPicker() {
    const P = pricing.current();
    if (!this.data.canAdd) { ui.toast('一单最多 ' + P.parcel.maxItems + ' 张'); return; }
    const inCart = {};
    this.items.forEach(x => { inCart[x.work.id] = 1; });
    const list = store.list()
      .filter(s => !inCart[s.id] && !(s.free && !s.completed) && s.total > 0)
      .map(s => ({ id: s.id, name: s.name, thumb: s.thumb || '', dims: s.w + '×' + s.h + ' · ' + s.total + ' 颗', low: s.total < P.minBeads }));
    if (!list.length) { ui.toast('没有别的作品可以加了'); return; }
    this.setData({ picker: list });
  },
  closePicker() { this.setData({ picker: null }); },
  pickWork(e) {
    const d = e.currentTarget.dataset;
    if (d.low) { ui.toast('豆子不足 ' + pricing.current().minBeads + ' 颗，暂不支持代拼'); return; }
    const it = this._mkItem(store.get(d.id));
    if (!it) { ui.toast('这张作品暂时不能代拼'); return; }
    this.items.push(it);
    this.cur = this.items.length - 1;
    this._saveCart();
    this.setData({ picker: null });
    this._sync();
  },

  goBack() { wx.navigateBack({ fail: () => ui.backHome() }); },

  // 烫法分组卡片（示例实拍缩略图 + 名称）；闪粉只给「粗闪 / 细闪」两档并标出格利特加价（用户价），
  // 具体款式客户在备注里写
  _finishGroups() {
    const w = this.work;
    const tier = pricing.boardTier(Math.max(w.w, w.h));
    const fee = (tier && tier.glitter > 0) ? '+' + pricing.yuan(pricing.grossUp(tier.glitter)) : '';
    return finishList().map(g => ({
      cat: g.cat, label: g.label,
      items: g.cat === 'glitter'
        ? Object.keys(order.ORDER_FINISH).map(key => ({ key, name: order.ORDER_FINISH[key].chip, sub: finishInfo(key).sub, fee, img: finishimg.thumb(key) }))
        : g.items.map(it => ({ key: it.key, name: it.name, sub: it.sub, fee: '', img: finishimg.thumb(it.key) })),
    }));
  },

  // 点缩略图：放大看这种烫法的成品实拍（弹层，不改选中）
  previewFinish(e) {
    const d = e.currentTarget.dataset;
    const key = d.v;
    if (!key) return;
    this.setData({
      zoom: { key, name: d.n || finishInfo(key).name, sub: d.s || finishInfo(key).sub, fee: d.fee || '', img: finishimg.zoom(key), desc: finishimg.desc(key) },
    });
  },
  closeZoom() { this.setData({ zoom: null }); },
  // 放大弹层里的「就选这个」
  pickFromZoom(e) {
    this.pickFinish(e);
    this.setData({ zoom: null });
  },
  noop() {},

  // 本地报价（即时展示）。内容一变就换幂等键：同一内容重试沿用同一订单，改了选项再提交才是新单
  // 明细：单张照旧逐项（代拼费 / 格利特 / 运费）；多张每张一行小计 + 一行运费
  _requote() {
    const d = this.data;
    const q = pricing.quoteCart(this.items.map(x => ({
      w: x.work.w, h: x.work.h, beads: x.stats.beads, colorN: x.stats.colorN, name: x.work.name,
      glitter: order.isGlitter(x.finish),
    })), {
      delivery: d.delivery,
      province: (d.delivery === 'express' && this.addr) ? this.addr.province : '',
    });
    this.q = q;
    this.coid = genId();
    const row = (key, label, desc, fen) => ({ key, label, desc, yuan: pricing.yuan(fen) });
    let items;
    if (q.lines.length === 1) {
      items = q.lines[0].items.map(i => row(i.key, i.label, i.desc, i.fen));
    } else {
      items = q.lines.map((l, i) => {
        const g = l.items.find(x => x.key === 'glitter');
        const beads = this.items[i].stats.beads;
        return row('w' + i, l.name || ('第 ' + (i + 1) + ' 张'), beads + ' 颗' + (g ? ' · 含闪粉 ' + pricing.yuan(g.fen) : ''), l.goodsFen);
      });
    }
    if (q.shipping) items.push(row('shipping', q.shipping.label, q.shipping.desc, q.shipping.fen));
    const patch = {
      items,
      totalYuan: pricing.yuan(q.totalFen),
      blocked: q.ok ? '' : q.reason,
      canPay: q.ok, // 含色数超档（q.colorOver）不提示也不加价，商家在派单信息里自己看色数
    };
    this.data.works.forEach((w, i) => { patch['works[' + i + '].bad'] = i === q.badIndex; });
    this.setData(patch);
  },

  // 成品预览：按当前烫法 / 豆孔渲一张熨烫后的融合图（整幅图案，不看拼豆进度）
  _renderPreview() {
    if (!this.utilCanvas || !this.work) return;
    clearTimeout(this._pvT);
    this._pvT = setTimeout(() => {
      const work = this.work;
      const cellPx = ui.clamp(Math.floor(320 / Math.max(work.w, work.h)), 4, 16);
      const size = patternSize(work, { cellPx });
      const scale = Math.max(size.width, size.height) > 900 ? 1 : 2;
      const finish = this.data.finish, hole = this.data.hole;
      const draw = () => renderPatternTo(this.utilCanvas, work, { cellPx, fused: true, matte: true, finish, hole, scale });
      this.uq(() => ui.captureCanvas(this, this.utilCanvas, draw))
        .then(p => { if (work === this.work && finish === this.data.finish && hole === this.data.hole) this.setData({ preview: p }); })
        .catch(() => { /* 保留占位图 */ });
    }, 150);
  },

  /* ---------- 成品要求 ---------- */
  pickFinish(e) {
    const v = e.currentTarget.dataset.v;
    if (!v || v === this.data.finish) return;
    this.items[this.cur].finish = v;
    this._saveCart();
    this.setData({ finish: v, ['works[' + this.cur + '].finishText']: order.finishLabel(v) });
    this._requote();
    this._renderPreview();
  },

  /* ---------- 配送 ---------- */
  setDelivery(e) {
    const v = e.currentTarget.dataset.v;
    if (!v || v === this.data.delivery) return;
    this.setData({ delivery: v });
    this._requote();
    if (v === 'express' && !this.addr) this.chooseAddress();
  },
  // 微信收货地址（运费按省份分区计算）
  chooseAddress() {
    wx.chooseAddress({
      success: r => {
        this.addr = {
          name: r.userName || '', tel: r.telNumber || '',
          province: r.provinceName || '', city: r.cityName || '', county: r.countyName || '', detail: r.detailInfo || '',
          full: [r.provinceName, r.cityName, r.countyName, r.detailInfo].filter(Boolean).join(''),
        };
        this.setData({ addr: this.addr });
        this._requote();
      },
      fail: err => {
        const m = (err && err.errMsg) || '';
        if (m.indexOf('cancel') >= 0) return;
        if (m.indexOf('deny') >= 0 || m.indexOf('auth') >= 0) {
          wx.showModal({
            title: '需要收货地址权限',
            content: '请在设置里允许使用通讯地址，才能选择快递收货地址',
            confirmText: '去设置',
            confirmColor: '#C9838F',
            success: r => { if (r.confirm) wx.openSetting(); },
          });
        } else {
          ui.toast('没拿到地址，再试一次');
        }
      },
    });
  },
  onPhone(e) { this._phone = String(e.detail.value || ''); },
  onNote(e) { this._note = String(e.detail.value || ''); },

  /* ---------- 下单 + 支付 ---------- */
  submit() {
    if (this.data.submitting) return;
    const d = this.data, q = this.q;
    if (!q || !q.ok) { ui.toast(q ? q.reason : '报价中，稍等'); return; }
    let phone = String(this._phone != null ? this._phone : d.phone || '').replace(/\D/g, '');
    if (d.delivery === 'express') {
      if (!this.addr) { ui.toast('先选一下收货地址'); this.chooseAddress(); return; }
      phone = this.addr.tel;
    } else if (!/^1\d{10}$/.test(phone)) {
      ui.toast('请填 11 位手机号，做好后商家联系你取货');
      return;
    }
    const note = String(this._note != null ? this._note : d.note || '').trim().slice(0, 100);
    this.setData({ submitting: true });
    wx.showLoading({ title: '创建订单', mask: true });
    order.create(this.items.map(x => ({ work: x.work, finish: x.finish, stats: x.stats })), {
      clientOrderId: this.coid,
      hole: d.hole, delivery: d.delivery,
      phone, address: d.delivery === 'express' ? this.addr : null, note,
      quote: q,
    }).then(res => {
      wx.hideLoading();
      const o = res && res.order;
      if (!o || !o.id) throw { message: '下单失败，稍后再试' };
      if (d.delivery === 'pickup') order.rememberPhone(phone);
      if (this.multi) order.cartClear(); // 订单已建（付没付都在「我的订单」里），篮子清空
      // 服务端复算与本地估算不一致：以服务端为准，先告知再付
      if ((o.totalFen | 0) !== q.totalFen) {
        return new Promise(resolve => wx.showModal({
          title: '金额已更新',
          content: '服务器核算的金额为 ¥' + pricing.yuan(o.totalFen) + '（本地估算 ¥' + pricing.yuan(q.totalFen) + '），是否继续支付？',
          confirmText: '继续支付',
          cancelText: '稍后再说',
          confirmColor: '#C9838F',
          success: r => resolve(!!r.confirm),
          fail: () => resolve(false),
        })).then(ok => (ok ? this._pay(o, res.payParams) : this._goOrders(o.id, false)));
      }
      return this._pay(o, res.payParams);
    }).catch(err => {
      wx.hideLoading();
      this.setData({ submitting: false });
      ui.toast(order.errText(err));
    });
  },

  _pay(o, params) {
    return order.requestPay(params).then(r => {
      if (r === 'ok') ui.toast('支付成功 ✨');
      else ui.toast('还没支付，可在「我的订单」里继续');
      this._goOrders(o.id, r === 'ok');
    }).catch(err => {
      ui.toast(order.errText(err));
      this._goOrders(o.id, false);
    });
  },

  // 订单已创建：无论付没付都进订单页（待支付的可以继续付）
  _goOrders(id, paid) {
    wx.redirectTo({ url: '/pages/orders/orders?id=' + id + (paid ? '&paid=1' : '') });
  },
});
