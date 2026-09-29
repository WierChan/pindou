// 我的代拼订单：列表（服务端权威，离线退回本地索引）+ 详情弹层
// （继续支付 / 取消未付订单 / 确认收货 / 联系客服）。刚支付完回来时轮询几次等支付回调落地。
const order = require('../../utils/order');
const { cfg } = require('../../utils/config');
const ui = require('../../utils/ui');

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    list: [],
    loading: true,
    offline: false,
    detail: null,       // 当前展开的订单视图模型
    pickupArea: '',     // 自取范围文案（派单前详情里没有具体地址时显示）
  },

  onLoad(q) {
    this.focusId = (q && q.id) || '';
    this.justPaid = !!(q && q.paid === '1');
    this.setData({ insets: ui.navInsets(), pickupArea: cfg.ORDER.pickupArea });
  },

  onShow() { this.refresh(); },
  onUnload() { this._polling = false; },

  goBack() { wx.navigateBack({ fail: () => ui.backHome() }); },
  noop() {},

  refresh() {
    order.list().then(list => {
      const vms = list.map(order.toVM);
      this.setData({ list: vms, loading: false, offline: false });
      this._afterLoad(vms);
    }).catch(err => {
      const vms = order.localList().map(order.toVM);
      this.setData({ list: vms, loading: false, offline: true });
      if (err && err.code === 404) ui.toast(order.errText(err));
      this._afterLoad(vms);
    });
  },

  // 从下单页带 id 进来：自动展开该单；刚支付完但回调可能还没到 → 轮询
  _afterLoad(vms) {
    const id = this.focusId;
    if (!id) return;
    this.focusId = '';
    const o = vms.find(x => x.id === id);
    if (o) this.setData({ detail: o });
    if (this.justPaid && o && o.status === 'unpaid') this._poll(id, 6);
    this.justPaid = false;
  },
  _poll(id, left) {
    if (left <= 0) return;
    this._polling = true;
    setTimeout(() => {
      if (!this._polling) return;
      order.get(id).then(o => {
        if (o.status !== 'unpaid') { this._patch(order.toVM(o)); return; }
        this._poll(id, left - 1);
      }).catch(() => this._poll(id, left - 1));
    }, 1500);
  },
  _patch(vm) {
    const list = this.data.list.map(x => (x.id === vm.id ? vm : x));
    const patch = { list };
    if (this.data.detail && this.data.detail.id === vm.id) patch.detail = vm;
    this.setData(patch);
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    const o = this.data.list.find(x => x.id === id);
    if (o) this.setData({ detail: o });
    order.get(id).then(x => this._patch(order.toVM(x))).catch(() => { /* 用列表里的 */ });
  },
  closeDetail() { this.setData({ detail: null }); },

  copyText(e) {
    const t = e.currentTarget.dataset.t;
    if (t) wx.setClipboardData({ data: String(t), success: () => ui.toast('已复制') });
  },

  /* ---------- 操作 ---------- */
  payAgain(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset.id) || (this.data.detail && this.data.detail.id);
    if (!id || this._busy) return;
    this._busy = true;
    wx.showLoading({ title: '拉起支付', mask: true });
    order.payParams(id)
      .then(p => { wx.hideLoading(); return order.requestPay(p); })
      .then(r => {
        this._busy = false;
        if (r === 'ok') { ui.toast('支付成功 ✨'); this.justPaid = true; }
        else ui.toast('还没支付');
        this.focusId = id;
        this.refresh();
      })
      .catch(err => {
        wx.hideLoading();
        this._busy = false;
        ui.toast(order.errText(err));
      });
  },

  cancelOrder() {
    const d = this.data.detail;
    if (!d || !d.canCancel) return;
    wx.showModal({
      title: '取消订单',
      content: '确定取消「' + d.name + '」的代拼订单吗？',
      confirmText: '取消订单',
      cancelText: '再想想',
      confirmColor: '#C9838F',
      success: r => {
        if (!r.confirm) return;
        order.cancel(d.id).then(() => { ui.toast('已取消'); this.focusId = d.id; this.refresh(); })
          .catch(err => ui.toast(order.errText(err)));
      },
    });
  },

  confirmReceipt() {
    const d = this.data.detail;
    if (!d || !d.canConfirm) return;
    wx.showModal({
      title: '确认收货',
      content: '收到成品了吗？确认后订单完成、款项结算给商家，之后不能再申请退款。有问题请先联系客服。',
      confirmText: '已收到',
      cancelText: '还没有',
      confirmColor: '#C9838F',
      success: r => {
        if (!r.confirm) return;
        order.confirm(d.id).then(() => { ui.toast('已完成，感谢支持 ✨'); this.focusId = d.id; this.refresh(); })
          .catch(err => ui.toast(order.errText(err)));
      },
    });
  },
});
