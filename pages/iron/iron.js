// 熨烫界面：自动熨烫机流程（选烫法 → 盖烘焙布 → 上滑推托盘进机器 → 自动压合 → 拖动掀布揭晓 → 完成进查看页）
const { store } = require('../../utils/store');
const { PALETTE } = require('../../utils/palette');
const { colorStats } = require('../../utils/convert');
const { renderPatternTo, getBeadShape, workFinish, workHole, finishList, finishInfo } = require('../../utils/board');
const { ensureFinishSwatches } = require('../../utils/finishswatch');
const { audio } = require('../../utils/audio');
const { celebrate } = require('../../utils/confetti');
const ui = require('../../utils/ui');
const { cfg } = require('../../utils/config');
const ads = require('../../utils/ads');
const { buildGuide, guideSeen, markGuideSeen } = require('../../utils/guidance');

const HOLE_LABEL = { none: '无孔', small: '小孔', large: '大孔' };
// 每个流程步骤的标题/副标
const STEP = {
  cover: { t: '盖上烘焙布', s: '先给豆子盖一层烘焙布，保护表面、受热更均匀。' },
  insert: { t: '把托盘推进去', s: '烘焙布已盖好，手指上滑，把托盘推进机器。' },
  press: { t: '正在自动压合', s: '压板缓慢下降，把豆豆稳稳压住、均匀加热。' },
  peel: { t: '从右下角轻轻掀开', s: '按住布角，向左上方拖，慢慢掀开烘焙布。' },
};

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    capW: 700,
    capH: 900,
    title: '',
    workName: '',
    workId: '',
    muted: false,
    debug: cfg.DEBUG,
    // 选烫法
    finish: 'smooth',
    hole: 'none',
    holeLabel: '无孔',
    finishName: '',
    cats: [],
    finishTab: 'common',
    cards: [],
    // 机器流程
    phase: 'pick', // pick / cover / insert / press / peel
    stepT: '',
    stepS: '',
    ledText: 'READY',
    pressPct: 0,
    peelPct: 0,
    trayLift: 0,    // 托盘上移像素（上滑推入）
    trayDrag: false, // 拖动中：关掉过渡，让托盘跟手（松手/推入才用过渡）
    trayOp: 1,      // 托盘透明度（推入机器时淡出=被吞进去）
    trayScale: 1,   // 托盘缩放（推入时略缩，进机器口）
    trayW: 200,
    trayH: 200,
    celebrating: false,
    guideSteps: [],
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
    // 插屏预建（完成后回首页时弹）
    this._itAd = ads.prepareInterstitial('interstitialDone');
    this.finishImg = {};
    const finish = workFinish(work);
    const hole = workHole(work);
    this.setData({
      insets: ui.navInsets(),
      title: '熨烫 · ' + work.name,
      workName: work.name,
      workId: work.id,
      muted: audio.muted,
      finish,
      hole,
      holeLabel: HOLE_LABEL[hole],
      finishName: finishInfo(finish).name,
      finishTab: finishInfo(finish).cat,
      cats: finishList().map(g => ({ cat: g.cat, label: g.label })),
      cards: this._cardsFor(finishInfo(finish).cat, finish),
    });
  },

  _cardsFor(cat, finish) {
    const g = finishList().find(x => x.cat === cat) || { items: [] };
    return g.items.map(it => ({ key: it.key, name: it.name, sub: it.sub, img: (this.finishImg && this.finishImg[it.key]) || '', active: it.key === finish }));
  },

  onReady() {
    if (!this.work) return;
    ui.queryNode(this, '#tray').then(r => { if (r && r.node) { this.trayCanvas = r.node; this.renderTray(false); } });
    ui.queryNode(this, '#util').then(r => { if (r) { this.utilCanvas = r.node; this._loadSwatches(); } });
    // 首次熨烫引导（选烫法 → 开始）
    const pickStep = { sel: '.fp-tabs', text: '先挑烫法：常用 / 特殊工艺 / 闪粉三类，点上面切换、选卡片；下面再选豆孔。' };
    const goStep = { sel: '.start-btn', text: '点「开始熨烫」进自动熨烫机——盖布、上滑推托盘、自动压合、掀布揭晓，跟着提示走就行～' };
    if (!guideSeen('iron')) buildGuide(this, 'iron', [pickStep, goStep]);
    else if (!guideSeen('iron-texture')) buildGuide(this, 'iron-texture', [pickStep]);
  },

  // 渲染托盘里的图：fused=false 原豆 / true 融合成品
  renderTray(fused) {
    if (!this.trayCanvas || !this.work) return;
    const work = this.work;
    const cellPx = ui.clamp(Math.floor(200 / Math.max(work.w, work.h)), 3, 12);
    const size = renderPatternTo(this.trayCanvas, work, { cellPx, fused, finish: this.data.finish, hole: fused ? this.data.hole : 'none', scale: 2 });
    const k = Math.min(1, 230 / size.width, 250 / size.height);
    this.setData({ trayW: Math.round(size.width * k), trayH: Math.round(size.height * k) });
  },

  _loadSwatches() {
    const keys = this.data.cards.filter(c => c.key).map(c => c.key);
    ensureFinishSwatches(this, keys, (key, path) => {
      this.finishImg[key] = path;
      const i = this.data.cards.findIndex(c => c.key === key);
      if (i >= 0) this.setData({ ['cards[' + i + '].img']: path });
    });
  },

  onGuideDone() {
    if (this.data.guideId === 'iron') markGuideSeen('iron-texture');
    this.setData({ guideSteps: [] });
  },

  onResize() { this.setData({ insets: ui.navInsets() }); },
  onHide() { this._flushSave(); },
  onUnload() {
    this._gone = true;
    this._flushSave();
    if (this._itAd) this._itAd.destroy();
  },
  _flushSave() {
    if (!this.work) return;
    store.update(this.work.id, { ironed: this.work.ironed, ironDone: this.work.ironDone || false });
  },

  toggleMute() { audio.setMuted(!audio.muted); this.setData({ muted: audio.muted }); },
  goBack() { ui.backHome(); },

  /* ---------- 选烫法 / 豆孔 ---------- */
  switchFinishTab(e) {
    const cat = e.currentTarget.dataset.cat;
    if (!cat || cat === this.data.finishTab) return;
    this.setData({ finishTab: cat, cards: this._cardsFor(cat, this.data.finish) });
    this._loadSwatches();
  },
  pickFinish(e) {
    const f = e.currentTarget.dataset.f;
    if (!f || f === this.data.finish) return;
    const patch = { finish: f, finishName: finishInfo(f).name };
    this.data.cards.forEach((c, i) => { const on = c.key === f; if (c.active !== on) patch['cards[' + i + '].active'] = on; });
    this.setData(patch);
    if (this.work) { this.work.finish = f; store.update(this.work.id, { finish: f }); }
  },
  pickHole(e) {
    const h = e.currentTarget.dataset.h;
    if (!h || h === this.data.hole) return;
    this.setData({ hole: h, holeLabel: HOLE_LABEL[h] });
    if (this.work) { this.work.hole = h; store.update(this.work.id, { hole: h }); }
  },

  /* ---------- 机器流程 ---------- */
  _step(p) { this.setData({ phase: p, stepT: STEP[p] ? STEP[p].t : '', stepS: STEP[p] ? STEP[p].s : '' }); },

  // 开始熨烫：盖布 → 自动进入推入
  startIron() {
    this._step('cover');
    setTimeout(() => { if (!this._gone && this.data.phase === 'cover') this._step('insert'); }, 1000);
  },

  // 推托盘：上滑手势（跟手，无过渡；也可点按钮）
  onTrayTS(e) {
    if (this.data.phase !== 'insert') return;
    const t = e.touches && e.touches[0]; if (!t) return;
    this._sy = t.clientY; this._sMoved = 0; this._lastLift = null;
  },
  onTrayTM(e) {
    if (this.data.phase !== 'insert' || this._sy == null) return;
    const t = e.touches && e.touches[0]; if (!t) return;
    const dy = this._sy - t.clientY;
    this._sMoved = dy;
    const lift = Math.max(0, Math.min(140, dy));
    if (this._lastLift != null && Math.abs(lift - this._lastLift) < 3) return; // 节流
    this._lastLift = lift;
    this.setData({ trayLift: lift, trayDrag: true });
  },
  onTrayTE() {
    if (this.data.phase !== 'insert') return;
    const moved = this._sMoved;
    this._sy = null; this._lastLift = null;
    if (moved > 28) this.doInsert();               // 上滑一点就推入，更灵敏
    else this.setData({ trayLift: 0, trayDrag: false });
  },
  doInsert() {
    if (this.data.phase !== 'insert') return;
    // 上移进机器口 + 淡出 + 略缩 → 被机器"吞进去"，不飞到机器上方（机器 z-index 更高，会遮住托盘）
    this.setData({ trayLift: 180, trayOp: 0, trayScale: 0.82, trayDrag: false });
    try { wx.vibrateShort({ type: 'light' }); } catch (e) { /* 忽略 */ }
    setTimeout(() => this.startPress(), 520);
  },

  // 自动压合
  startPress() {
    this._step('press');
    this.setData({ ledText: 'PRESS', pressPct: 0 });
    setTimeout(() => { if (!this._gone) this.setData({ pressPct: 100 }); }, 60);
    audio.sizzle();
    setTimeout(() => { if (!this._gone) { this.setData({ ledText: 'HEAT' }); audio.sizzle(); } }, 1300);
    setTimeout(() => {
      if (this._gone) return;
      this.renderTray(true);                       // 融合成成品
      this.setData({ peelPct: 0, trayLift: 0, trayOp: 1, trayScale: 1 }); // 托盘弹出，准备掀布
      this._step('peel');
    }, 2600);
  },

  // 掀布：拖动手势（handler 挂在 .pan 上，点布角/布面都算——布角 grip 是 cloth 的兄弟，挂 cloth 上点不到）
  onClothTS(e) {
    if (this.data.phase !== 'peel') return;
    const t = e.touches && e.touches[0]; if (!t) return;
    this._px = t.clientX; this._py = t.clientY;
  },
  onClothTM(e) {
    if (this.data.phase !== 'peel' || this._px == null) return;
    const t = e.touches && e.touches[0]; if (!t) return;
    const dx = this._px - t.clientX, dy = this._py - t.clientY;
    const p = Math.max(0, Math.min(100, (dx + dy) / 1.8)); // 往左上拖，更省力
    this.setData({ peelPct: p });
    if (p >= 100) { this._px = null; this._finishIron(); }
  },
  onClothTE() {
    if (this.data.phase !== 'peel') return;
    if (this.data.peelPct >= 45) { this.setData({ peelPct: 100 }); this._finishIron(); }
    else this.setData({ peelPct: 0 });
    this._px = null;
  },

  /* ---------- 完成 → 查看页 ---------- */
  _finishIron() {
    if (this._done) return;
    this._done = true;
    const work = this.work;
    for (let i = 0; i < work.ironed.length; i++) if (work.cells[i] >= 0 && work.placed[i]) work.ironed[i] = 1;
    work.ironDone = true;
    store.update(work.id, {
      ironed: work.ironed, ironDone: true,
      finish: this.data.finish, hole: this.data.hole, completedAt: Date.now(),
    });
    if (this.utilCanvas) {
      this.uq(() => ui.makeThumb(this, this.utilCanvas, work, true))
        .then(path => store.update(work.id, { thumb: path, thumbV: ui.THUMB_V, thumbShape: getBeadShape() }, true))
        .catch(() => { /* 缩略图失败不影响 */ });
    }
    audio.finish();
    try { wx.vibrateShort({ type: 'medium' }); } catch (e) { /* 忽略 */ }
    this._celebrate();
    setTimeout(() => { if (!this._gone) wx.redirectTo({ url: '/pages/view/view?id=' + work.id }); }, 1500);
  },

  _celebrate() {
    this.setData({ celebrating: true }, () => {
      ui.queryNode(this, '#confetti').then(r => {
        if (!r || !r.node) return;
        const dpr = Math.min(2, ui.navInsets().dpr);
        const w = this.work;
        const hexes = colorStats(w.cells).map(s => (w.palette ? w.palette[s.pal] : PALETTE[s.pal].hex));
        celebrate(r.node, r.width, r.height, dpr, hexes, () => { /* 完成即将跳转 */ });
      });
    });
  },
});
