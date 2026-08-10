// 作品查看：完成后的展示、分享、导出
const { store } = require('../../utils/store');
const { BoardView } = require('../../utils/board');
const { buildExportTo } = require('../../utils/share');
const ui = require('../../utils/ui');

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    capW: 700,
    capH: 900,
    title: '',
    fusedOn: true,
    shareShow: false,
    workId: '',
  },

  onLoad(q) {
    const work = store.get(q.id);
    if (!work) { ui.backHome(); return; }
    if (work.completed && !work.ironDone) {
      wx.redirectTo({ url: '/pages/iron/iron?id=' + work.id });
      return;
    }
    this.work = work;
    this.uq = ui.serialQueue();
    this.setData({
      insets: ui.navInsets(),
      title: work.name,
      workId: work.id,
    });
  },

  onReady() {
    if (!this.work) return;
    ui.queryNode(this, '#board').then(r => {
      if (!r || !r.node || !this.work) return;
      const dpr = Math.min(3, ui.navInsets().dpr);
      this.bv = new BoardView(r.node, {
        w: this.work.w, h: this.work.h,
        cells: this.work.cells, placed: this.work.placed,
        mode: 'view', fused: true,
      });
      this.bv.setViewport(r.width, r.height, dpr, r.left, r.top);
      setTimeout(() => ui.syncBoardRect(this, this.bv), 600);
    });
    ui.queryNode(this, '#util').then(r => { if (r) this.utilCanvas = r.node; });
  },

  onResize() {
    this.setData({ insets: ui.navInsets() });
    setTimeout(() => ui.syncBoardRect(this, this.bv), 120);
  },

  onUnload() {
    if (this.bv) this.bv.destroy();
  },

  onTS(e) { if (this.bv) this.bv.touchStart(e); },
  onTM(e) { if (this.bv) this.bv.touchMove(e); },
  onTE(e) { if (this.bv) this.bv.touchEnd(e); },

  goBack() { ui.backHome(); },

  toggleFused() {
    if (!this.bv) return;
    this.bv.setFused(!this.bv.fused);
    this.setData({ fusedOn: this.bv.fused });
  },

  openShare() { this.setData({ shareShow: true }); },
  closeShare() { this.setData({ shareShow: false }); },
  onCardBuilt(e) { this.shareImg = e.detail.path; },

  exportImage() {
    if (!this.utilCanvas || !this.work) return;
    const fused = this.bv ? this.bv.fused : true;
    this.uq(() => {
      const draw = () => buildExportTo(this.utilCanvas, this.work, fused);
      return ui.captureCanvas(this, this.utilCanvas, draw).then(path => ui.saveToAlbum(path));
    }).catch(() => ui.toast('导出失败，再试一次'));
  },

  delWork() {
    wx.showModal({
      title: '删除作品',
      content: '确定删除「' + this.work.name + '」吗？删掉就找不回来啦',
      confirmText: '删除',
      confirmColor: '#E0453A',
      success: r => {
        if (r.confirm) {
          store.remove(this.work.id);
          ui.toast('已删除');
          ui.backHome();
        }
      },
    });
  },

  onShareAppMessage() {
    const msg = {
      title: '我拼好了「' + (this.work ? this.work.name : '拼豆作品') + '」，来一起玩指尖拼豆！',
      path: '/pages/home/home',
    };
    if (this.shareImg) msg.imageUrl = this.shareImg;
    return msg;
  },
});
