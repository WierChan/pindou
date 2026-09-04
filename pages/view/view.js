// 作品查看：完成后的展示、换烫法、分享
const { store } = require('../../utils/store');
const { BoardView, workFinish, workHole, finishList, finishInfo, getBeadShape } = require('../../utils/board');
const { ensureFinishSwatches } = require('../../utils/finishswatch');
const { createCode, format, markCodePrompted } = require('../../utils/importcode');
const { bgm } = require('../../utils/audio');
const ui = require('../../utils/ui');
const { buildGuide, guideSeen, markGuideSeen } = require('../../utils/guidance');

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    capW: 700,
    capH: 900,
    title: '',
    // 已定型作品：可在「未烫成品 / 烫后效果」间切看，并横滑换烫法、保存
    fusedOn: true,      // true 烫后效果（融合+烫法） / false 未烫成品（原豆）
    finish: 'smooth',
    finishName: '',
    cats: [],           // 三类 Tab [{cat,label}]
    finishTab: 'common',
    cards: [],          // 当前 Tab 的烫法卡片
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
    this.uq = ui.serialQueue();
    this.finishImg = {};
    const finish = workFinish(work);
    this.setData({
      insets: ui.navInsets(),
      title: work.name,
      workId: work.id,
      finish,
      finishName: finishInfo(finish).name,
      finishTab: finishInfo(finish).cat,
      cats: finishList().map(g => ({ cat: g.cat, label: g.label })),
      cards: this._cardsFor(finishInfo(finish).cat, finish),
    });
  },

  // 某分类下的卡片（带预览图与选中态）
  _cardsFor(cat, finish) {
    const g = finishList().find(x => x.cat === cat) || { items: [] };
    return g.items.map(it => ({ key: it.key, name: it.name, sub: it.sub, img: (this.finishImg && this.finishImg[it.key]) || '', active: it.key === finish }));
  },
  // 切换分类 Tab
  switchFinishTab(e) {
    const cat = e.currentTarget.dataset.cat;
    if (!cat || cat === this.data.finishTab) return;
    this.setData({ finishTab: cat, cards: this._cardsFor(cat, this.data.finish) });
    this._loadSwatches();
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
        hole: workHole(this.work),     // 熨烫时选的豆孔大小
        chart: false, // 默认成品效果（与首页缩略图、分享卡一致）
      });
      this.bv.setViewport(r.width, r.height, dpr, r.left, r.top);
      setTimeout(() => ui.syncBoardRect(this, this.bv), 600);
    });
    ui.queryNode(this, '#util').then(r => { if (r) { this.utilCanvas = r.node; this._loadSwatches(); } });
    // 首次看成品：讲清这页能做的事；换烫法是后加的，老用户单步补看（view-finish）
    if (!guideSeen('view')) {
      buildGuide(this, 'view', [
        { text: '这里收着你烫好的成品～双指放大能细看每一颗豆子的质感。' },
        { sel: '.vt-toggle', text: '「未烫成品 / 烫后效果」随时切看：一边是原豆，一边是熨烫定型后的样子。' },
        { sel: '.fp-tabs', text: '底下能换烫法：点「常用 / 特殊工艺 / 闪粉」切类，再选卡片，选中就即时预览，满意点「保存这个效果」。' },
      ]);
    } else {
      buildGuide(this, 'view-finish', [
        { sel: '.fp-tabs', text: '新增：成品也能换烫法啦——点「常用 / 特殊工艺 / 闪粉」切类选卡片，即时预览，满意点「保存这个效果」。' },
      ]);
    }
  },

  // 渲染所有烫法卡片的预览图（会话内缓存，渲染完 patch 进对应卡片）
  _loadSwatches() {
    const keys = this.data.cards.filter(c => c.key).map(c => c.key);
    ensureFinishSwatches(this, keys, (key, path) => {
      this.finishImg[key] = path;
      const i = this.data.cards.findIndex(c => c.key === key);
      if (i >= 0) this.setData({ ['cards[' + i + '].img']: path });
    });
  },

  onGuideDone() {
    if (this.data.guideId === 'view') markGuideSeen('view-finish'); // 完整版已含换烫法讲解，别再补看
    this.setData({ guideSteps: [] });
  },

  onResize() {
    this.setData({ insets: ui.navInsets() });
    setTimeout(() => ui.syncBoardRect(this, this.bv), 120);
  },

  onShow() { bgm.stop(); }, // 查看页是安静的展示页：进来就把熨烫带过来的 BGM 停掉
  onUnload() {
    if (this.bv) this.bv.destroy();
  },

  onTS(e) { if (this.bv) this.bv.touchStart(e); },
  onTM(e) { if (this.bv) this.bv.touchMove(e); },
  onTE(e) { if (this.bv) this.bv.touchEnd(e); },

  goBack() { ui.backHome(); },

  // 未烫成品 ↔ 烫后效果 切换（seg：data-v '1' 烫后 / '0' 未烫）
  toggleFused(e) {
    const on = e.currentTarget.dataset.v === '1';
    if (on === this.data.fusedOn) return;
    this.setData({ fusedOn: on });
    if (this.bv) { this.bv.setChart(false); this.bv.setFused(on); }
  },

  // 选烫法（底部横滑卡片）：即时预览 + 落盘烫法（分享/导出跟着一致）；封面缩略图留给「保存这个效果」刷新
  pickFinish(e) {
    const f = e.currentTarget.dataset.f;
    if (!f || f === this.data.finish) return;
    const patch = { finish: f, finishName: finishInfo(f).name };
    this.data.cards.forEach((c, i) => { if (!c.key) return; const on = c.key === f; if (c.active !== on) patch['cards[' + i + '].active'] = on; });
    if (!this.data.fusedOn) patch.fusedOn = true; // 选了就切到烫后效果看
    this.setData(patch);
    this._thumbDirty = true; // 封面还没跟上，提示保存
    if (this.work) { this.work.finish = f; store.update(this.work.id, { finish: f }); }
    if (this.bv) { this.bv.setChart(false); this.bv.setFused(true); this.bv.setFinish(f); }
  },

  // 保存这个效果：重刷封面缩略图（首页/作品册按新烫法显示）——烫法本身在选时已落盘
  saveFinish() {
    const work = this.work;
    if (!work) return;
    if (!this.utilCanvas) { ui.toast('已保存 ✨'); return; }
    this.uq(() => ui.makeThumb(this, this.utilCanvas, work, true))
      .then(path => {
        store.update(work.id, { thumb: path, thumbV: ui.THUMB_V, thumbShape: getBeadShape() }, true);
        this._thumbDirty = false;
        ui.toast('已保存这个效果 ✨');
      })
      .catch(() => ui.toast('保存失败，再试一次'));
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
