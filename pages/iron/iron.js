// 熨烫界面：按住熨斗划过豆子，烫平定型
const { store } = require('../../utils/store');
const { PALETTE } = require('../../utils/palette');
const { colorStats } = require('../../utils/convert');
const { BoardView, renderPatternTo, getBeadShape, workFinish } = require('../../utils/board');
const { audio } = require('../../utils/audio');
const { celebrate } = require('../../utils/confetti');
const ui = require('../../utils/ui');
const { cfg } = require('../../utils/config');
const { buildGuide, guideSeen, markGuideSeen } = require('../../utils/guidance');

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    capW: 700,
    capH: 900,
    title: '',
    workName: '',
    pct: 0,
    muted: false,
    debug: cfg.DEBUG,
    celebrating: false,
    modal: { show: false, img: '', imgW: 0, imgH: 0 },
    shareShow: false,
    workId: '',
    guideSteps: [],
    finish: 'grain', // 熨烫质感：grain 细腻纹理 / smooth 光滑平面
  },

  onLoad(q) {
    const work = store.get(q.id);
    if (!work) { ui.backHome(); return; }
    if (!work.completed) { wx.redirectTo({ url: '/pages/play/play?id=' + work.id }); return; }
    if (work.ironDone) { wx.redirectTo({ url: '/pages/view/view?id=' + work.id }); return; }
    if (!work.ironed || work.ironed.length !== work.cells.length) {
      work.ironed = new Array(work.cells.length).fill(0);
    }
    this.work = work;
    this.uq = ui.serialQueue();
    this.totalPlaced = work.cells.filter(t => t >= 0).length;
    this.ironedCount = work.ironed.reduce((a, b) => a + b, 0);
    this.finished = false;
    this.saveTimer = 0;
    this.pctTimer = 0;
    this.setData({
      insets: ui.navInsets(),
      title: '熨烫 · ' + work.name,
      workName: work.name,
      workId: work.id,
      muted: audio.muted,
      pct: this._pct(),
      finish: workFinish(work), // 老作品没这个字段：默认细腻纹理
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
        mode: 'iron', ironed: this.work.ironed,
        finish: this.data.finish,
        onIron: n => this._applyIron(n),
      });
      this.bv.setViewport(r.width, r.height, dpr, r.left, r.top);
      setTimeout(() => ui.syncBoardRect(this, this.bv), 600);
    });
    ui.queryNode(this, '#util').then(r => { if (r) this.utilCanvas = r.node; });
    // 首次熨烫：教操作
    // 质感选择是后加的：看过老版 iron 引导的用户只补看这一步（记在 iron-texture 上）
    const texStep = {
      sel: '.tex-row',
      text: '烫之前先挑个质感：「细腻纹理」有真实拼豆的手作颗粒感，「光滑平面」干净利落。烫的过程中也能随时换～',
    };
    if (guideSeen('iron')) {
      buildGuide(this, 'iron-texture', [texStep]);
    } else {
      buildGuide(this, 'iron', [
        { text: '豆子拼齐啦，最后一步：按住屏幕不放，熨斗就会出现，划过豆子把它们烫平定型！全部烫完就大功告成～' },
        texStep,
      ]);
    }
  },

  onGuideDone() {
    // 完整版 iron 引导已包含质感这一步，不用再补看单步版
    if (this.data.guideId === 'iron') markGuideSeen('iron-texture');
    this.setData({ guideSteps: [] });
  },

  onResize() {
    this.setData({ insets: ui.navInsets() });
    setTimeout(() => ui.syncBoardRect(this, this.bv), 120);
  },

  onHide() { this._flushSave(); },

  onUnload() {
    this._gone = true;
    clearTimeout(this.pctTimer);
    this._flushSave();
    if (this.bv) this.bv.destroy();
  },

  _pct() {
    return this.totalPlaced ? Math.round(this.ironedCount / this.totalPlaced * 100) : 0;
  },

  /* ---------- 画板事件 ---------- */
  onTS(e) { if (this.bv && !this.finished) this.bv.touchStart(e); },
  onTM(e) { if (this.bv && !this.finished) this.bv.touchMove(e); },
  onTE(e) { if (this.bv) this.bv.touchEnd(e); },
  zoomFit() { if (this.bv) this.bv.fit(); },

  goBack() {
    this._flushSave();
    ui.backHome();
  },
  toggleMute() {
    audio.setMuted(!audio.muted);
    this.setData({ muted: audio.muted });
  },

  // 熨烫质感三选一。随时可切（已烫的格子即时变），选择随作品持久化 ——
  // 之后的查看页、首页缩略图、分享卡都按它渲染
  pickFinish(e) {
    const f = e.currentTarget.dataset.f;
    if (!f || f === this.data.finish) return;
    this.setData({ finish: f });
    if (this.work) {
      this.work.finish = f;
      store.update(this.work.id, { finish: f });
    }
    if (this.bv) this.bv.setFinish(f);
  },
  debugFill() {
    if (this.finished || !this.bv) return;
    const n = this.bv.ironAll();
    if (n) this._applyIron(n);
  },

  /* ---------- 熨烫结算 ---------- */
  _applyIron(n) {
    if (this.finished || this._gone) return;
    this.ironedCount += n;
    audio.sizzle();
    if (!this.pctTimer) {
      this.pctTimer = setTimeout(() => {
        this.pctTimer = 0;
        this.setData({ pct: this._pct() });
      }, 100);
    }
    this._scheduleSave();
    if (this.ironedCount >= this.totalPlaced) this._finishIron();
  },

  _scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this._flushSave(), 600);
  },
  _flushSave() {
    clearTimeout(this.saveTimer);
    if (!this.work) return;
    store.update(this.work.id, {
      ironed: this.work.ironed,
      ironDone: this.work.ironDone || false,
    });
  },

  _finishIron() {
    if (this.finished) return;
    this.finished = true;
    const work = this.work;
    work.ironDone = true;
    store.update(work.id, {
      ironed: work.ironed, ironDone: true,
      finish: this.data.finish, // 定型时把质感选择一并落盘（缩略图/分享按它渲染）
      completedAt: Date.now(),
    });
    if (this.utilCanvas) {
      this.uq(() => ui.makeThumb(this, this.utilCanvas, work, true))
        .then(path => store.update(work.id, { thumb: path, thumbV: ui.THUMB_V, thumbShape: getBeadShape() }, true))
        .catch(() => { /* 忽略 */ });
    }
    setTimeout(() => {
      this.setData({ pct: 100 });
      audio.finish();
      // 里程碑中震：熨烫定型完成
      try { wx.vibrateShort({ type: 'medium' }); } catch (e) { /* 忽略 */ }
      this._celebrate();
    }, 300);
    setTimeout(() => this._showDoneModal(), 1200);
  },

  _celebrate() {
    this.setData({ celebrating: true }, () => {
      ui.queryNode(this, '#confetti').then(r => {
        if (!r || !r.node) { this.setData({ celebrating: false }); return; }
        const dpr = Math.min(2, ui.navInsets().dpr);
        const w = this.work;
        const hexes = colorStats(w.cells).map(s => (w.palette ? w.palette[s.pal] : PALETTE[s.pal].hex));
        celebrate(r.node, r.width, r.height, dpr, hexes, () => this.setData({ celebrating: false }));
      });
    });
  },

  _showDoneModal() {
    const work = this.work;
    // 预览尽量占满弹窗内宽（.modal max-width 340 - 边框内距 ≈ 285），高度限 300 防长图撑爆弹窗
    const show = (img, w, h) => {
      const k = Math.min(1, 300 / (h || 300), 285 / (w || 285));
      this.setData({ modal: { show: true, img: img || '', imgW: Math.round((w || 0) * k), imgH: Math.round((h || 0) * k) } });
    };
    if (!this.utilCanvas) { show('', 0, 0); return; }
    this.uq(() => {
      const cellPx = ui.clamp(Math.floor(300 / Math.max(work.w, work.h)), 4, 20);
      let size = null; // captureCanvas 内部会先调 draw() 再导出
      const draw = () => (size = renderPatternTo(this.utilCanvas, work, {
        cellPx, fused: true, finish: this.data.finish, scale: 2,
      }));
      return ui.captureCanvas(this, this.utilCanvas, draw).then(path => show(path, size.width, size.height));
    }).catch(() => show('', 0, 0));
  },

  /* ---------- 完成后的分享 ---------- */
  openShare() { this.setData({ shareShow: true }); },
  closeShare() { this.setData({ shareShow: false }); },
  onCardBuilt(e) { this.shareImg = e.detail.path; },

  goHome() { ui.backHome(); },

  onShareAppMessage() {
    const msg = {
      title: '我拼好了「' + (this.work ? this.work.name : '拼豆作品') + '」，来拼豆便利店逛逛！',
      path: '/pages/home/home',
    };
    if (this.shareImg) msg.imageUrl = this.shareImg;
    return msg;
  },
});
