// 熨烫界面：自动熨烫机流程（选烫法 → 盖烘焙布 → 上滑推托盘进机器 → 自动压合 → 拖动掀布揭晓 → 完成进查看页）
const { store } = require('../../utils/store');
const { PALETTE } = require('../../utils/palette');
const { colorStats } = require('../../utils/convert');
const { BoardView, renderPatternTo, getBeadShape, workFinish, workHole, finishList, finishInfo } = require('../../utils/board');
const { ensureFinishSwatches } = require('../../utils/finishswatch');
const { audio, bgm } = require('../../utils/audio');
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
    bgmOn: false,
    debug: cfg.DEBUG,
    // 熨烫方式：machine 自动熨烫机（默认）/ manual 手动熨斗（手指划过豆子熔合）
    method: 'machine',
    pct: 0, // 手动熨斗的进度
    // 选烫法
    finish: 'smooth',
    hole: 'none',
    holeLabel: '无孔',
    finishName: '',
    cats: [],
    finishTab: 'common',
    cards: [],
    // 机器流程
    phase: 'pick', // pick / cover / insert / press / peel（自动机器）/ manual（手动熨斗）
    stepT: '',
    stepS: '',
    ledText: 'READY',
    pressPct: 0,
    peelPct: 0,
    revealed: false, // 掀完：整张布淡出露成品全貌
    trayLift: 0,    // 托盘上移像素（上滑推入）
    trayDrag: false, // 拖动中：关掉过渡，让托盘跟手（松手/推入才用过渡）
    trayOp: 1,      // 托盘透明度（推入机器时淡出=被吞进去）
    trayScale: 1,   // 托盘缩放（推入时略缩，进机器口）
    peelW: 240,     // 揭晓大板上成品图的显示尺寸
    peelH: 300,
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
    // 手动熨斗进度：总豆数 / 已烫数（支持中途离开再回来接着烫）
    this.totalPlaced = work.cells.filter(t => t >= 0).length;
    this.ironedCount = work.ironed.reduce((a, b) => a + b, 0);
    const finish = workFinish(work);
    const hole = workHole(work);
    this.setData({
      pct: this._pct(),
      insets: ui.navInsets(),
      title: '熨烫 · ' + work.name,
      workName: work.name,
      workId: work.id,
      muted: audio.muted,
      bgmOn: bgm.enabled,
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
    // 预览小图延后渲染（captureCanvas 生成临时图较重，避免卡住刚进页面的首屏）
    ui.queryNode(this, '#util').then(r => { if (r) { this.utilCanvas = r.node; setTimeout(() => this._loadSwatches(), 450); } });
    // 首次熨烫引导：① 选方式（新增，最重要的分叉）② 挑烫法/豆孔 → 开始。
    // 流程里的手势（上滑推入 / 掀布 / 按住划豆）由常驻的行内提示负责，不塞进这个一次性蒙层。
    const methodStep = { sel: '.tex-method', text: '两种熨烫方式：「自动熨烫机」全自动（盖布→推入→压合→掀开揭晓），「手动熨斗」自己拿熨斗划过豆子——挑你喜欢的。' };
    const goStep = { sel: '.start-btn', text: '再挑烫法（常用 / 特殊工艺 / 闪粉）和豆孔，点「开始熨烫」——自动机器跟着提示走，手动就按住熨斗慢慢划过每颗豆子。' };
    if (!guideSeen('iron')) buildGuide(this, 'iron', [methodStep, goStep]);
    else if (!guideSeen('iron-method')) buildGuide(this, 'iron-method', [methodStep]); // 老用户补看「方式」这个新选项
  },

  // 渲染托盘里的图：fused=false 原豆 / true 融合成品。
  // 画幅是固定内框 FITW×FITH——图案按比例缩放后居中放进去，高矮宽窄的作品框都一样大。
  renderTray(fused) {
    if (!this.trayCanvas || !this.work) return;
    const work = this.work;
    const FITW = 264, FITH = 122; // 画幅内框（扁一点，跟 .pan 固定高 144 对齐；机器/托盘等高）
    const cellPx = ui.clamp(Math.floor(Math.min(FITW / work.w, FITH / work.h)), 3, 16); // 渲染分辨率≈框大小，缩放后清晰
    const size = renderPatternTo(this.trayCanvas, work, { cellPx, pad: 4, fused, finish: this.data.finish, hole: fused ? this.data.hole : 'none', scale: 2 });
    const k = Math.min(1, FITW / size.width, FITH / size.height);
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
    if (this.data.guideId === 'iron') markGuideSeen('iron-method'); // 看过完整版就别再补看方式那步
    this.setData({ guideSteps: [] });
  },

  onResize() {
    this.setData({ insets: ui.navInsets() });
    if (this.bv) setTimeout(() => ui.syncBoardRect(this, this.bv), 120); // 手动画板转屏校准
  },
  onShow() { if (this.work && bgm.enabled) bgm.start(); }, // 接着拼豆页的 BGM 播下去
  onHide() { this._flushSave(); bgm.stop(); },
  onUnload() {
    this._gone = true;
    clearInterval(this._peelTimer);
    clearTimeout(this._saveTimer);
    clearTimeout(this._pctTimer);
    this._flushSave();
    if (this.bv) this.bv.destroy();
    bgm.stop();
    if (this._itAd) this._itAd.destroy();
  },

  toggleBgm() { this.setData({ bgmOn: bgm.toggle() }); },
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
  // 熨烫方式：自动熨烫机 / 手动熨斗
  pickMethod(e) {
    const m = e.currentTarget.dataset.m;
    if (!m || m === this.data.method) return;
    this.setData({ method: m });
  },

  /* ---------- 机器流程 ---------- */
  _step(p) { this.setData({ phase: p, stepT: STEP[p] ? STEP[p].t : '', stepS: STEP[p] ? STEP[p].s : '' }); },

  // 开始熨烫：手动 → 画板熨斗；自动 → 盖布进机器
  startIron() {
    this._noSwatch = true;   // 开始熨烫后不再渲染预览图，别跟流程抢线程
    if (this.data.method === 'manual') { this._startManual(); return; }
    this._inserting = false;
    this._step('cover');
    setTimeout(() => { if (!this._gone && this.data.phase === 'cover') this._step('insert'); }, 700);
  },

  /* ---------- 手动熨斗（BoardView iron 模式：手指=熨斗，划过豆子熔合） ---------- */
  _startManual() {
    const work = this.work;
    // 等 phase=manual 渲染出 #board 再查节点建 BoardView（setData 回调=视图已更新）
    this.setData({ phase: 'manual', pct: this._pct() }, () => {
      ui.queryNode(this, '#board').then(r => {
        if (!r || !r.node || !work || this._gone) return;
        const dpr = Math.min(3, ui.navInsets().dpr);
        this.bv = new BoardView(r.node, {
          w: work.w, h: work.h, cells: work.cells, placed: work.placed,
          palette: work.palette || null,
          mode: 'iron', ironed: work.ironed,
          finish: this.data.finish, hole: this.data.hole,
          onIron: n => this._applyIron(n),
        });
        this.bv.setViewport(r.width, r.height, dpr, r.left, r.top);
        setTimeout(() => { if (!this._gone) ui.syncBoardRect(this, this.bv); }, 600);
      });
    });
  },
  onTS(e) { if (this.bv && !this._done) this.bv.touchStart(e); },
  onTM(e) { if (this.bv && !this._done) this.bv.touchMove(e); },
  onTE(e) { if (this.bv) this.bv.touchEnd(e); },
  zoomFit() { if (this.bv) this.bv.fit(); },
  _pct() { return this.totalPlaced ? Math.round(this.ironedCount / this.totalPlaced * 100) : 0; },
  // 熨到一批豆子：累计 + 刷进度（节流）+ 存档；全烫完就结算
  _applyIron(n) {
    if (this._done || this._gone) return;
    this.ironedCount += n;
    audio.sizzle();
    if (!this._pctTimer) {
      this._pctTimer = setTimeout(() => { this._pctTimer = 0; this.setData({ pct: this._pct() }); }, 100);
    }
    this._scheduleSave();
    if (this.ironedCount >= this.totalPlaced) this._finishIron();
  },
  _scheduleSave() { clearTimeout(this._saveTimer); this._saveTimer = setTimeout(() => this._flushSave(), 600); },

  // 推托盘：上滑手势（跟手，无过渡）。要推到顶(或大半)才推进去——避免轻轻一碰就自动压合
  onTrayTS(e) {
    if (this.data.phase !== 'insert' || this._inserting) return;
    const t = e.touches && e.touches[0]; if (!t) return;
    this._sy = t.clientY; this._lastLift = null;
  },
  onTrayTM(e) {
    if (this.data.phase !== 'insert' || this._inserting || this._sy == null) return;
    const t = e.touches && e.touches[0]; if (!t) return;
    const lift = Math.max(0, Math.min(150, this._sy - t.clientY));
    if (this._lastLift != null && Math.abs(lift - this._lastLift) < 3) return; // 节流
    this._lastLift = lift;
    this.setData({ trayLift: lift, trayDrag: true });
    if (lift >= 142) { this._sy = null; this.doInsert(); } // 推到顶=推进去
  },
  onTrayTE() {
    if (this.data.phase !== 'insert' || this._inserting) return;
    if (this.data.trayLift >= 96) this.doInsert();          // 推了大半，松手也算推进去
    else this.setData({ trayLift: 0, trayDrag: false });     // 没推够，弹回
    this._sy = null; this._lastLift = null;
  },
  doInsert() {
    if (this.data.phase !== 'insert' || this._inserting) return;
    this._inserting = true;
    // 上移进机器口 + 淡出 + 略缩 → 被机器"吞进去"（机器 z-index 更高，会遮住托盘）
    this.setData({ trayLift: 210, trayOp: 0, trayScale: 0.82, trayDrag: false });
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
      // 压合完 → 揭晓大板（拼板 + 成品 + 一整张烘焙布，掀开有纸张折角）。托盘/机器退场
      this._peeling = false;
      this.setData({ peelPct: 0, revealed: false });
      this._step('peel');
      // #peelcv 是 wx:if peel 才进 DOM，等它渲染出来再查节点、把成品渲进去
      setTimeout(() => ui.queryNode(this, '#peelcv').then(r => {
        if (r && r.node && !this._gone) { this.peelCanvas = r.node; this.renderPeel(); }
      }), 60);
    }, 2600);
  },

  // 揭晓大板上的成品图：竖幅大板，图案按比例缩放居中；周围露拼板孔洞（像真实拼板）
  renderPeel() {
    if (!this.peelCanvas || !this.work) return;
    const work = this.work;
    const FITW = 300, FITH = 372;
    const cellPx = ui.clamp(Math.floor(Math.min(FITW / work.w, FITH / work.h)), 3, 18);
    const size = renderPatternTo(this.peelCanvas, work, { cellPx, pad: 4, fused: true, finish: this.data.finish, hole: this.data.hole, scale: 2 });
    const k = Math.min(1, FITW / size.width, FITH / size.height);
    this.setData({ peelW: Math.round(size.width * k), peelH: Math.round(size.height * k) });
  },

  // 掀布：拖动手势（handler 挂在整个 .peelboard 上，点哪都算）。
  // 要拖得慢一点、更长一点才掀开（除数放大 = 跟手更"沉"）；松手后缓缓自动掀到底，不是"啪"一下。
  onClothTS(e) {
    if (this.data.phase !== 'peel' || this._peeling) return;
    const t = e.touches && e.touches[0]; if (!t) return;
    clearInterval(this._peelTimer); // 打断"合回去"的动画，接着这次拖
    this._px = t.clientX; this._py = t.clientY;
  },
  onClothTM(e) {
    if (this.data.phase !== 'peel' || this._px == null || this._peeling) return;
    const t = e.touches && e.touches[0]; if (!t) return;
    const dx = this._px - t.clientX, dy = this._py - t.clientY;
    const p = Math.max(0, Math.min(100, (dx + dy) / 3.6)); // 往左上拖，要拖更长才掀完，慢慢来
    this.setData({ peelPct: p });
    if (p >= 100) { this._px = null; this._revealPeel(); }
  },
  onClothTE() {
    if (this.data.phase !== 'peel' || this._peeling) return;
    this._px = null;
    if (this.data.peelPct >= 28) this._revealPeel();  // 掀过约 3 成，缓缓自动掀到底
    else this._animatePeel(0);                          // 没掀够，缓缓合回去
  },
  // 缓动把 peelPct 推到目标值（easeOutCubic），营造"慢慢掀开"的手感
  _animatePeel(to, done) {
    const from = this.data.peelPct;
    clearInterval(this._peelTimer);
    if (Math.abs(to - from) < 0.5) { this.setData({ peelPct: to }); if (done) done(); return; }
    const dur = Math.max(300, Math.abs(to - from) * 11); // 掀得越多动画越长，最慢约 1.1s
    const t0 = Date.now();
    this._peelTimer = setInterval(() => {
      if (this._gone) { clearInterval(this._peelTimer); return; }
      const k = Math.min(1, (Date.now() - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.setData({ peelPct: from + (to - from) * e });
      if (k >= 1) { clearInterval(this._peelTimer); if (done) done(); }
    }, 30);
  },
  _revealPeel() {
    if (this._peeling) return;
    this._peeling = true;
    this._animatePeel(100, () => this._finishIron());
  },

  /* ---------- 完成 → 查看页 ---------- */
  _finishIron() {
    if (this._done) return;
    this._done = true;
    if (this.data.method === 'machine') this.setData({ peelPct: 100, revealed: true }); // 整张布淡出，露成品全貌，再撒花
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
