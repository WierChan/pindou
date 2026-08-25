// 拼豆界面
const { store } = require('../../utils/store');
const { PALETTE, textColorFor, hexToRgb } = require('../../utils/palette');
const { colorStats, nearestPalette } = require('../../utils/convert');
const { BoardView, renderPatternTo, getBeadShape, setBeadShape } = require('../../utils/board');
const { audio } = require('../../utils/audio');
const { celebrate } = require('../../utils/confetti');
const ui = require('../../utils/ui');
const { cfg } = require('../../utils/config');
const { buildGuide } = require('../../utils/guidance');

const PAINT_KEY = 'pindou.paintMode.v1'; // 划动模式:1 = 连续上豆 / 其余 = 拖动平移（跨作品记忆）

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    capW: 700,
    capH: 900,
    title: '',
    pct: 0,
    chips: [],
    paintOn: false,
    beadShape: 'square',
    muted: false,
    debug: cfg.DEBUG,
    total: 0,
    colorN: 0,
    scrollInto: '',
    celebrating: false,
    modal: { show: false, img: '', imgW: 0, imgH: 0 },
    guideSteps: [],
  },

  onLoad(q) {
    const work = store.get(q.id);
    if (!work) { ui.backHome(); return; }
    if (work.completed) {
      wx.redirectTo({ url: (work.ironDone ? '/pages/view/view?id=' : '/pages/iron/iron?id=') + work.id });
      return;
    }
    if (work.free) {
      // 自由画布作品走专属页面
      wx.redirectTo({ url: '/pages/free/free?id=' + work.id });
      return;
    }
    this.work = work;
    this.uq = ui.serialQueue();
    // 作品自带色板（图纸导入）：渲染与 UI 用图纸真实颜色，色名借最近的全局色名
    this.palHex = pal => (work.palette ? work.palette[pal] : PALETTE[pal].hex);
    this.palName = pal => {
      if (!work.palette) return PALETTE[pal].name;
      const c = hexToRgb(work.palette[pal]);
      return PALETTE[nearestPalette(c[0], c[1], c[2])].name;
    };
    // MARD 色号只对全局色板作品展示（自带色板的颜色不是实体豆色，标了会误导买豆）
    this.palCode = pal => (work.palette ? '' : PALETTE[pal].code + ' ');

    const stats = colorStats(work.cells);
    this.colorsUsed = stats.map(s => s.pal);
    this.numbers = new Map(this.colorsUsed.map((p, i) => [p, i + 1]));
    this.chipIdx = new Map(this.colorsUsed.map((p, i) => [p, i]));
    this.remaining = new Map(stats.map(s => [s.pal, s.count]));
    for (let i = 0; i < work.cells.length; i++) {
      if (work.placed[i]) this.remaining.set(work.cells[i], this.remaining.get(work.cells[i]) - 1);
    }
    this.total = stats.reduce((a, s) => a + s.count, 0);
    let left = 0;
    this.remaining.forEach(v => { left += v; });
    this.placedCount = this.total - left;
    this.sel = this.colorsUsed.find(p => this.remaining.get(p) > 0);
    if (this.sel == null) this.sel = this.colorsUsed[0];
    this.finished = false;
    this.pending = [];
    this.flushTimer = 0;
    this.saveTimer = 0;
    // 划动模式：关 = 单指拖动平移画布（默认，方便看图找色），开 = 划过格子连续上豆
    this.paintOn = false;
    try { this.paintOn = wx.getStorageSync(PAINT_KEY) === 1; } catch (e) { /* 忽略 */ }

    const chips = this.colorsUsed.map((pal, i) => {
      const n = this.remaining.get(pal);
      return {
        pal, num: i + 1,
        hex: this.palHex(pal),
        tcol: textColorFor(this.palHex(pal)),
        left: n > 0 ? n : '✓',
        done: n === 0,
        active: pal === this.sel,
      };
    });
    this.setData({
      insets: ui.navInsets(),
      title: work.name,
      chips,
      paintOn: this.paintOn,
      beadShape: getBeadShape(),
      muted: audio.muted,
      total: this.total,
      colorN: this.colorsUsed.length,
      pct: this._pct(),
    });
  },

  onReady() {
    if (!this.work) return;
    this._initBoard();
    ui.queryNode(this, '#util').then(r => { if (r) this.utilCanvas = r.node; });
    // 首次拼豆：讲核心三件事（选色 → 点格子 → 工具）
    buildGuide(this, 'play', [
      { sel: '.palette-bar', text: '先在这里选颜色！每种颜色有编号，下面的数字是还差几颗' },
      { text: '板上淡淡的格子就是图纸。点亮所有跟选中颜色一样的格子吧！点错了我会晃一晃提醒你。双指可以缩放看细节～' },
      { sel: '.tools-row', text: '打开「连续上豆」，手指划过格子就能连着拼，超解压！关掉就是单指拖动画布～' },
    ]);
  },

  onGuideDone() { this.setData({ guideSteps: [] }); },

  onResize() {
    this.setData({ insets: ui.navInsets() });
    this._refitBoard();
  },

  onHide() { this._flushSave(); },

  onUnload() {
    this._gone = true;
    clearTimeout(this.flushTimer);
    this._flushSave();
    if (this.bv) this.bv.destroy();
  },

  _pct() {
    return this.total ? Math.round(this.placedCount / this.total * 100) : 0;
  },

  _initBoard() {
    ui.queryNode(this, '#board').then(r => {
      if (!r || !r.node || !this.work) return;
      const dpr = Math.min(3, ui.navInsets().dpr);
      this.bv = new BoardView(r.node, {
        w: this.work.w, h: this.work.h,
        cells: this.work.cells, placed: this.work.placed,
        palette: this.work.palette || null,
        mode: 'play',
        numbers: this.numbers,
        getSelected: () => this.sel,
        canSwipe: () => this.paintOn,
        onPlace: i => this._onPlace(i),
        onWrong: () => {
          audio.wrong();
          try { wx.vibrateShort({ type: 'medium' }); } catch (e) { /* 忽略 */ }
        },
      });
      this.bv.setViewport(r.width, r.height, dpr, r.left, r.top);
      // 布局稳定后复测画布位置，防止部分机型触点参照系偏移
      setTimeout(() => ui.syncBoardRect(this, this.bv), 600);
      // 极端情况：存档已拼满但没标记完成
      if (this.total > 0 && this.placedCount >= this.total && !this.finished) this._finish();
    });
  },

  _refitBoard() {
    setTimeout(() => ui.syncBoardRect(this, this.bv), 120);
  },

  /* ---------- 画板事件 ---------- */
  onTS(e) { if (this.bv && !this.finished) this.bv.touchStart(e); },
  onTM(e) { if (this.bv && !this.finished) this.bv.touchMove(e); },
  onTE(e) { if (this.bv) this.bv.touchEnd(e); },
  zoomFit() { if (this.bv) this.bv.fit(); },

  /* ---------- 顶栏 ---------- */
  goBack() {
    this._flushSave();
    ui.backHome();
  },
  toggleMute() {
    audio.setMuted(!audio.muted);
    this.setData({ muted: audio.muted });
  },
  // 豆子形状切换：全局生效（画板/预览/缩略图/分享图同一套绘制）
  toggleShape() {
    const s = getBeadShape() === 'round' ? 'square' : 'round';
    setBeadShape(s);
    this.setData({ beadShape: s });
    if (this.bv) this.bv.requestRender();
    ui.toast(s === 'round' ? '已切换为圆形豆子 ●' : '已切换为方形豆子 ■');
  },
  debugFill() {
    if (this.finished || !this.bv) return;
    const idx = [];
    for (let i = 0; i < this.work.cells.length; i++) {
      if (this.work.cells[i] >= 0 && !this.work.placed[i]) idx.push(i);
    }
    if (idx.length) {
      this.bv.placeMany(idx);
      this._applyPlacement(idx, 'row');
    }
  },

  /* ---------- 色板 / 工具 ---------- */
  tapChip(e) {
    if (this.finished) return;
    this._setSel(+e.currentTarget.dataset.pal);
  },

  _setSel(pal) {
    const old = this.sel;
    this.sel = pal;
    const patch = { scrollInto: 'c' + pal };
    if (old != null && this.chipIdx.has(old)) patch['chips[' + this.chipIdx.get(old) + '].active'] = false;
    if (this.chipIdx.has(pal)) patch['chips[' + this.chipIdx.get(pal) + '].active'] = true;
    this.setData(patch);
    if (this.bv) this.bv.requestRender();
  },

  /* ---------- 划动模式：拖动平移 ↔ 连续上豆 ---------- */
  // 单指划动二选一（常驻开关，跨作品记忆）：关 = 平移画布，开 = 划过格子连续上豆
  togglePaint() {
    if (this.finished) return;
    this.paintOn = !this.paintOn;
    try { wx.setStorageSync(PAINT_KEY, this.paintOn ? 1 : 0); } catch (e) { /* 忽略 */ }
    this.setData({ paintOn: this.paintOn });
    ui.toast(this.paintOn ? '连续上豆：手指划过格子连着拼 ✨' : '已切回拖动画布');
  },

  /* ---------- 上豆结算 ---------- */
  _onPlace(i) {
    this.pending.push(i);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = 0;
        const idx = this.pending;
        this.pending = [];
        if (idx.length) this._applyPlacement(idx, 'tap');
      }, 50);
    }
  },

  _applyPlacement(indices, sound) {
    if (this._gone) return;
    this.placedCount += indices.length;
    const affected = new Set();
    for (const i of indices) {
      const t = this.work.cells[i];
      this.remaining.set(t, this.remaining.get(t) - 1);
      affected.add(t);
    }
    const patch = { pct: this._pct() };
    for (const t of affected) {
      const ci = this.chipIdx.get(t);
      const n = this.remaining.get(t);
      patch['chips[' + ci + '].left'] = n > 0 ? n : '✓';
      patch['chips[' + ci + '].done'] = n === 0;
    }
    this.setData(patch);
    this._scheduleSave();
    if (sound === 'tap') audio.tap();
    if (sound === 'row') audio.rowFill(); // 'row' 音效仅剩调试一键完成（debugFill）在用
    if (this.placedCount >= this.total) { this._finish(); return; }
    const doneNow = [...affected].filter(t => this.remaining.get(t) === 0);
    if (doneNow.length) {
      audio.colorDone();
      // 里程碑轻震：拼完一种颜色（普通上豆不震，震动语义留给错误与里程碑）
      try { wx.vibrateShort({ type: 'light' }); } catch (e) { /* 忽略 */ }
      ui.toast('「' + this.palCode(doneNow[0]) + this.palName(doneNow[0]) + '」拼完啦 ✓');
      if (doneNow.indexOf(this.sel) >= 0) {
        const start = this.colorsUsed.indexOf(this.sel);
        for (let k = 1; k <= this.colorsUsed.length; k++) {
          const pal = this.colorsUsed[(start + k) % this.colorsUsed.length];
          if (this.remaining.get(pal) > 0) { this._setSel(pal); break; }
        }
      }
    }
  },

  /* ---------- 存档 ---------- */
  _scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this._flushSave(), 600);
  },
  _flushSave() {
    clearTimeout(this.saveTimer);
    if (!this.work) return;
    store.update(this.work.id, {
      placed: this.work.placed,
      completed: this.work.completed || false,
    });
  },

  /* ---------- 豆子拼齐 → 引导去熨烫 ---------- */
  _finish() {
    if (this.finished) return;
    this.finished = true;
    const work = this.work;
    work.completed = true;
    if (!work.ironed || work.ironed.length !== work.cells.length) {
      work.ironed = new Array(work.cells.length).fill(0);
    }
    store.update(work.id, {
      placed: work.placed, completed: true, ironDone: false,
      ironed: work.ironed,
    });
    if (this.utilCanvas) {
      this.uq(() => ui.makeThumb(this, this.utilCanvas, work, false))
        .then(path => store.update(work.id, { thumb: path, thumbV: ui.THUMB_V, thumbShape: getBeadShape() }, true))
        .catch(() => { /* 缩略图失败不影响流程 */ });
    }
    if (this.bv) this.bv.o.mode = 'view';
    setTimeout(() => {
      audio.finish();
      // 里程碑中震：整幅豆子拼齐
      try { wx.vibrateShort({ type: 'medium' }); } catch (e) { /* 忽略 */ }
      this._celebrate();
    }, 350);
    setTimeout(() => this._showDoneModal(), 1300);
  },

  _celebrate() {
    this.setData({ celebrating: true }, () => {
      ui.queryNode(this, '#confetti').then(r => {
        if (!r || !r.node) { this.setData({ celebrating: false }); return; }
        const dpr = Math.min(2, ui.navInsets().dpr);
        const hexes = this.colorsUsed.map(p => this.palHex(p));
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
      let size = null; // captureCanvas 内部会先调 draw() 再导出
      const draw = () => (size = renderPatternTo(this.utilCanvas, work, { cellPx, scale: 2 }));
      return ui.captureCanvas(this, this.utilCanvas, draw).then(path => show(path, size.width, size.height));
    }).catch(() => show('', 0, 0));
  },

  goIron() {
    wx.redirectTo({ url: '/pages/iron/iron?id=' + this.work.id });
  },
  goHomeLater() { ui.backHome(); },

  onShareAppMessage() {
    return {
      title: '拼豆便利店 · 把喜欢的图片，一颗一颗拼出来',
      path: '/pages/home/home',
    };
  },
});
