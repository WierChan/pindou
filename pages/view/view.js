// 作品查看：完成后的展示、分享、导出
const { store } = require('../../utils/store');
const { BoardView } = require('../../utils/board');
const { buildExportTo, buildChartExportTo } = require('../../utils/share');
const { createCode, format } = require('../../utils/importcode');
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
    codeShow: false,
    codeText: '',
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
        palette: this.work.palette || null,
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

  /* ---------- 导入码 ---------- */
  // 生成（或取回）本作品的口令：好友在「新作品 → 输入导入码」里输入即可拼同款。
  // 首次生成前确认分享权利（合规：上传者责任声明）
  shareCode() {
    const work = this.work;
    if (!work) return;
    if (work.shareCode) {
      this.setData({ codeShow: true, codeText: format(work.shareCode) });
      return;
    }
    wx.showModal({
      title: '生成导入码',
      content: '图纸会上传到云端，任何人凭口令都能导入。请确认这是你原创、或已获授权分享的图纸。',
      confirmText: '生成',
      confirmColor: '#C9838F',
      success: r => {
        if (!r.confirm) return;
        wx.showLoading({ title: '生成中', mask: true });
        createCode(work).then(code => {
          wx.hideLoading();
          if (!code) { ui.toast('生成失败，稍后再试'); return; }
          work.shareCode = code;
          store.update(work.id, { shareCode: code }, true);
          this.setData({ codeShow: true, codeText: format(code) });
        }).catch(err => {
          wx.hideLoading();
          ui.toast((err && err.message) || '生成失败，稍后再试');
        });
      },
    });
  },
  copyCode() {
    wx.setClipboardData({
      data: '我在拼豆便利店拼了「' + this.work.name + '」！复制口令 ' + this.data.codeText +
        '，打开小程序 → 新作品 → 输入导入码，拼同款～',
      success: () => ui.toast('口令已复制，去粘贴给好友吧 ✨'),
    });
  },
  closeCode() { this.setData({ codeShow: false }); },
  noop() {},

  // 两种导出：效果图（豆豆质感）/ 图纸（平色格+格线，保存后可再导入识别）
  exportImage() {
    if (!this.utilCanvas || !this.work) return;
    wx.showActionSheet({
      itemList: ['效果图（豆豆质感）', '拼豆图纸（可再导入）'],
      success: r => this._doExport(r.tapIndex === 1),
      fail: () => { /* 取消 */ },
    });
  },
  _doExport(asChart) {
    const fused = this.bv ? this.bv.fused : true;
    this.uq(() => {
      const draw = asChart
        ? () => buildChartExportTo(this.utilCanvas, this.work)
        : () => buildExportTo(this.utilCanvas, this.work, fused);
      return ui.captureCanvas(this, this.utilCanvas, draw).then(path => ui.saveToAlbum(path));
    }).catch(() => ui.toast('导出失败，再试一次'));
  },

  delWork() {
    wx.showModal({
      title: '删除作品',
      content: '确定删除「' + this.work.name + '」吗？删掉就找不回来啦',
      confirmText: '删除',
      confirmColor: '#C9838F',
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
      title: '我拼好了「' + (this.work ? this.work.name : '拼豆作品') + '」，来拼豆便利店逛逛！',
      path: '/pages/home/home',
    };
    if (this.shareImg) msg.imageUrl = this.shareImg;
    return msg;
  },
});
