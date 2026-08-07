// 熨烫界面：按住熨斗划过豆子，烫平定型
const { store } = require('../../utils/store');
const { PALETTE } = require('../../utils/palette');
const { colorStats } = require('../../utils/convert');
const { BoardView, renderPatternTo } = require('../../utils/board');
const { buildExportTo } = require('../../utils/share');
const { audio } = require('../../utils/audio');
const { celebrate } = require('../../utils/confetti');
const ui = require('../../utils/ui');
const { DEBUG } = require('../../utils/config');

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    title: '',
    workName: '',
    pct: 0,
    muted: false,
    debug: DEBUG,
    celebrating: false,
    modal: { show: false, img: '', imgW: 0, imgH: 0 },
    shareShow: false,
    workId: '',
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
        mode: 'iron', ironed: this.work.ironed,
        onIron: n => this._applyIron(n),
      });
      this.bv.setViewport(r.width, r.height, dpr, r.left, r.top);
    });
    ui.queryNode(this, '#util').then(r => { if (r) this.utilCanvas = r.node; });
  },

  onResize() {
    this.setData({ insets: ui.navInsets() });
    if (!this.bv) return;
    setTimeout(() => {
      ui.queryNode(this, '#board').then(r => {
        if (!r || !this.bv) return;
        this.bv.setViewport(r.width, r.height, this.bv.dpr, r.left, r.top);
      });
    }, 120);
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
  zoomIn() { if (this.bv) this.bv.zoomAt(1.3); },
  zoomOut() { if (this.bv) this.bv.zoomAt(1 / 1.3); },
  zoomFit() { if (this.bv) this.bv.fit(); },

  goBack() {
    this._flushSave();
    ui.backHome();
  },
  toggleMute() {
    audio.setMuted(!audio.muted);
    this.setData({ muted: audio.muted });
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
      completedAt: Date.now(),
    });
    if (this.utilCanvas) {
      this.uq(() => ui.makeThumb(this.utilCanvas, work, true))
        .then(path => store.update(work.id, { thumb: path }))
        .catch(() => { /* 忽略 */ });
    }
    setTimeout(() => {
      this.setData({ pct: 100 });
      audio.finish();
      this._celebrate();
    }, 300);
    setTimeout(() => this._showDoneModal(), 1200);
  },

  _celebrate() {
    this.setData({ celebrating: true }, () => {
      ui.queryNode(this, '#confetti').then(r => {
        if (!r || !r.node) { this.setData({ celebrating: false }); return; }
        const dpr = Math.min(2, ui.navInsets().dpr);
        const hexes = colorStats(this.work.cells).map(s => PALETTE[s.pal].hex);
        celebrate(r.node, r.width, r.height, dpr, hexes, () => this.setData({ celebrating: false }));
      });
    });
  },

  _showDoneModal() {
    const work = this.work;
    const show = (img, w, h) => {
      const k = Math.min(1, 240 / (h || 240), 250 / (w || 250));
      this.setData({ modal: { show: true, img: img || '', imgW: Math.round((w || 0) * k), imgH: Math.round((h || 0) * k) } });
    };
    if (!this.utilCanvas) { show('', 0, 0); return; }
    this.uq(() => {
      const cellPx = ui.clamp(Math.floor(240 / Math.max(work.w, work.h)), 4, 16);
      const size = renderPatternTo(this.utilCanvas, work, { cellPx, fused: true, scale: 2 });
      return ui.canvasToTemp(this.utilCanvas).then(path => show(path, size.width, size.height));
    }).catch(() => show('', 0, 0));
  },

  /* ---------- 完成后的分享 / 导出 ---------- */
  openShare() { this.setData({ shareShow: true }); },
  closeShare() { this.setData({ shareShow: false }); },
  onCardBuilt(e) { this.shareImg = e.detail.path; },

  exportImage() {
    if (!this.utilCanvas || !this.work) return;
    this.uq(() => {
      buildExportTo(this.utilCanvas, this.work, true);
      return ui.canvasToTemp(this.utilCanvas).then(path => ui.saveToAlbum(path));
    }).catch(() => ui.toast('导出失败，再试一次'));
  },

  goHome() { ui.backHome(); },

  onShareAppMessage() {
    const msg = {
      title: '我拼好了「' + (this.work ? this.work.name : '拼豆作品') + '」，来一起玩指尖拼豆！',
      path: '/pages/home/home',
    };
    if (this.shareImg) msg.imageUrl = this.shareImg;
    return msg;
  },
});
