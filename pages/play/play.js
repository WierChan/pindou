// 拼豆界面
const { store } = require('../../utils/store');
const { PALETTE, textColorFor } = require('../../utils/palette');
const { colorStats } = require('../../utils/convert');
const { BoardView, renderPatternTo } = require('../../utils/board');
const { audio } = require('../../utils/audio');
const { celebrate } = require('../../utils/confetti');
const ui = require('../../utils/ui');
const { DEBUG, FREE_ROW_USES } = require('../../utils/config');

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    title: '',
    pct: 0,
    chips: [],
    rowCount: 0,
    rowActive: false,
    muted: false,
    debug: DEBUG,
    total: 0,
    colorN: 0,
    scrollInto: '',
    celebrating: false,
    modal: { show: false, img: '', imgW: 0, imgH: 0 },
  },

  onLoad(q) {
    const work = store.get(q.id);
    if (!work) { ui.backHome(); return; }
    if (work.completed) {
      wx.redirectTo({ url: (work.ironDone ? '/pages/view/view?id=' : '/pages/iron/iron?id=') + work.id });
      return;
    }
    if (work.boostRow == null) work.boostRow = FREE_ROW_USES;
    this.work = work;
    this.uq = ui.serialQueue();

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
    this.tool = null;
    this.finished = false;
    this.pending = [];
    this.flushTimer = 0;
    this.saveTimer = 0;

    const chips = this.colorsUsed.map((pal, i) => {
      const n = this.remaining.get(pal);
      return {
        pal, num: i + 1,
        hex: PALETTE[pal].hex,
        tcol: textColorFor(PALETTE[pal].hex),
        left: n > 0 ? n : '✓',
        done: n === 0,
        active: pal === this.sel,
      };
    });
    this.setData({
      insets: ui.navInsets(),
      title: work.name,
      chips,
      rowCount: work.boostRow,
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
  },

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
        mode: 'play',
        numbers: this.numbers,
        getSelected: () => this.sel,
        getTool: () => this.tool,
        onPlace: i => this._onPlace(i),
        onWrong: () => {
          audio.wrong();
          try { wx.vibrateShort({ type: 'medium' }); } catch (e) { /* 忽略 */ }
        },
        onToolTap: i => this._onToolTap(i),
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
  zoomIn() { if (this.bv) this.bv.zoomAt(1.3); },
  zoomOut() { if (this.bv) this.bv.zoomAt(1 / 1.3); },
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
    this.tool = null;
    const patch = { rowActive: false, scrollInto: 'c' + pal };
    if (old != null && this.chipIdx.has(old)) patch['chips[' + this.chipIdx.get(old) + '].active'] = false;
    if (this.chipIdx.has(pal)) patch['chips[' + this.chipIdx.get(pal) + '].active'] = true;
    this.setData(patch);
    if (this.bv) this.bv.requestRender();
  },

  tapRowTool() {
    if (this.finished) return;
    if (!this.work.boostRow) {
      ui.toast('免费次数用完啦，正式版可解锁更多道具 ✨');
      return;
    }
    this.tool = this.tool === 'row' ? null : 'row';
    if (this.tool) ui.toast('点任意一行，整排自动拼好');
    this.setData({ rowActive: !!this.tool });
    if (this.bv) this.bv.requestRender();
  },

  _onToolTap(i) {
    if (!this.work.boostRow) return;
    const row = Math.floor(i / this.work.w);
    const idx = [];
    for (let x = 0; x < this.work.w; x++) {
      const j = row * this.work.w + x;
      if (this.work.cells[j] >= 0 && !this.work.placed[j]) idx.push(j);
    }
    if (!idx.length) { ui.toast('这一排已经拼好啦'); return; }
    this.work.boostRow--;
    this.tool = null;
    this.bv.placeMany(idx);
    this._applyPlacement(idx, 'row');
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
    if (sound === 'row') {
      patch.rowCount = this.work.boostRow;
      patch.rowActive = false;
    }
    this.setData(patch);
    this._scheduleSave();
    if (sound === 'tap') audio.tap();
    if (sound === 'row') audio.rowFill();
    if (this.placedCount >= this.total) { this._finish(); return; }
    const doneNow = [...affected].filter(t => this.remaining.get(t) === 0);
    if (doneNow.length) {
      audio.colorDone();
      ui.toast('「' + PALETTE[doneNow[0]].name + '」拼完啦 ✓');
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
      boostRow: this.work.boostRow,
      completed: this.work.completed || false,
    });
  },

  /* ---------- 豆子拼齐 → 引导去熨烫 ---------- */
  _finish() {
    if (this.finished) return;
    this.finished = true;
    this.tool = null;
    const work = this.work;
    work.completed = true;
    if (!work.ironed || work.ironed.length !== work.cells.length) {
      work.ironed = new Array(work.cells.length).fill(0);
    }
    store.update(work.id, {
      placed: work.placed, completed: true, ironDone: false,
      ironed: work.ironed, boostRow: work.boostRow,
    });
    if (this.utilCanvas) {
      this.uq(() => ui.makeThumb(this.utilCanvas, work, false))
        .then(path => store.update(work.id, { thumb: path }))
        .catch(() => { /* 缩略图失败不影响流程 */ });
    }
    if (this.bv) this.bv.o.mode = 'view';
    setTimeout(() => {
      audio.finish();
      this._celebrate();
    }, 350);
    setTimeout(() => this._showDoneModal(), 1300);
  },

  _celebrate() {
    this.setData({ celebrating: true }, () => {
      ui.queryNode(this, '#confetti').then(r => {
        if (!r || !r.node) { this.setData({ celebrating: false }); return; }
        const dpr = Math.min(2, ui.navInsets().dpr);
        const hexes = this.colorsUsed.map(p => PALETTE[p].hex);
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
      const size = renderPatternTo(this.utilCanvas, work, { cellPx, scale: 2 });
      return ui.canvasToTemp(this.utilCanvas).then(path => show(path, size.width, size.height));
    }).catch(() => show('', 0, 0));
  },

  goIron() {
    wx.redirectTo({ url: '/pages/iron/iron?id=' + this.work.id });
  },
  goHomeLater() { ui.backHome(); },

  onShareAppMessage() {
    return {
      title: '指尖拼豆 · 把喜欢的图片，一颗一颗拼出来',
      path: '/pages/home/home',
    };
  },
});
