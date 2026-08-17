// 作品查看：完成后的展示与分享
const { store } = require('../../utils/store');
const { BoardView } = require('../../utils/board');
const { createCode, format, markCodePrompted } = require('../../utils/importcode');
const ui = require('../../utils/ui');

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    title: '',
    fusedOn: false, // 默认图纸显示；点「熨烫效果」切到质感图
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
        chart: true, // 默认网格图纸显示，与分享图纸一致
      });
      this.bv.setViewport(r.width, r.height, dpr, r.left, r.top);
      setTimeout(() => ui.syncBoardRect(this, this.bv), 600);
    });
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

  // 图纸显示 ↔ 熨烫效果 切换
  toggleFused() {
    if (!this.bv) return;
    const showEffect = this.bv.chart; // 当前是图纸 → 切到熨烫效果
    this.bv.setChart(!showEffect);
    this.setData({ fusedOn: showEffect });
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
    // 预标记自家口令：复制后回到前台，不被剪贴板自动识别弹窗打扰
    markCodePrompted(this.work.shareCode);
    wx.setClipboardData({
      data: '我在拼豆便利店拼了「' + this.work.name + '」！复制这段话打开「拼豆便利店」小程序，' +
        '自动识别口令 ' + this.data.codeText + '，一键拼同款；也可以在 新作品 → 输入导入码 里粘贴～',
      success: () => ui.toast('口令已复制，去粘贴给好友吧 ✨'),
    });
  },
  closeCode() { this.setData({ codeShow: false }); },
  noop() {},

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
