// 作品查看：完成后的展示与分享
const { store } = require('../../utils/store');
const { BoardView, workFinish } = require('../../utils/board');
const { createCode, format, markCodePrompted } = require('../../utils/importcode');
const ui = require('../../utils/ui');
const { buildGuide } = require('../../utils/guidance');

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    title: '',
    // 能进到这一页的都是熨烫定型完的作品，默认就展示成品的样子（熨烫质感，
    // 含熨烫时选的纹理）；点一下「熨烫效果」可切回网格图纸看格子
    fusedOn: true,
    shareShow: false,
    workId: '',
    codeShow: false,
    codeText: '',
    guideSteps: [],
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
        finish: workFinish(this.work), // 熨烫时选的质感档位
        chart: false, // 默认成品效果（与首页缩略图、分享卡一致）
      });
      this.bv.setViewport(r.width, r.height, dpr, r.left, r.top);
      setTimeout(() => ui.syncBoardRect(this, this.bv), 600);
    });
    // 首次看成品：讲清这页能做的三件事（切图纸 / 分享 / 导入码）
    buildGuide(this, 'view', [
      { text: '这里收着你烫好的成品～双指放大能细看每一颗豆子的质感。' },
      { sel: '.vt-effect', text: '想看每格的颜色和位置？点这里切回「图纸」模式，再点一下切回成品。' },
      { sel: '.vt-share', text: '「分享」生成一张带小程序码的作品卡片，发好友或朋友圈都行；「🔑 导入码」是给好友拼同款用的口令。' },
    ]);
  },

  onGuideDone() { this.setData({ guideSteps: [] }); },

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
