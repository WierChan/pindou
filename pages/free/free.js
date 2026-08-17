// 自由画布：真·无边——豆子按世界坐标稀疏存储（Map），
// 画板上的密集数组只是一个 240×240 的"渲染窗口"，随平移/绘画自动跟随；
// 离开窗口的豆子保留在稀疏表里，回来时重新出现。完成后裁剪进熨烫→查看流水线。
const { store } = require('../../utils/store');
const { PALETTE, textColorFor } = require('../../utils/palette');
const { BoardView, renderPatternTo, getBeadShape, setBeadShape } = require('../../utils/board');
const { audio } = require('../../utils/audio');
const ui = require('../../utils/ui');

const WIN = 240;      // 渲染窗口边长（格）
const CH = 40;        // 窗口位移对齐步长（10 的倍数，保证参考线不错位）
const MARGIN = 20;    // 视野距窗口边缘的最小余量，低于则滑动窗口
const MAX_SPAN = 240; // 完成定型时单幅作品的最大跨度（熨烫/分享按密集图处理）

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    capW: 700,
    capH: 900,
    title: '',
    count: 0,
    chips: [],
    eraser: false,
    beadShape: 'square',
    muted: false,
    scrollInto: '',
    exportShow: false,
    exportSrc: '',
  },

  onLoad(q) {
    const work = store.get(q.id);
    if (!work || !work.free) { ui.backHome(); return; }
    if (work.completed) {
      wx.redirectTo({ url: (work.ironDone ? '/pages/view/view?id=' : '/pages/iron/iron?id=') + work.id });
      return;
    }
    this.work = work;
    this.uq = ui.serialQueue();
    this.sel = 17; // 默认西瓜红，顺手就能画
    this.tool = null;
    this.saveTimer = 0;
    this.sndTimer = 0;

    // 世界坐标稀疏表：'x,y' -> 色号
    this.sparse = new Map();
    this.win = { x0: 0, y0: 0 }; // 窗口原点的世界坐标
    if (Array.isArray(work.freeBeads)) {
      for (const b of work.freeBeads) this.sparse.set(b[0] + ',' + b[1], b[2]);
    } else if (Array.isArray(work.cells) && work.cells.length === work.w * work.h) {
      // 兼容旧存档（密集窗口）：旧窗口原点视为世界 (0,0)
      for (let y = 0; y < work.h; y++) {
        for (let x = 0; x < work.w; x++) {
          const v = work.cells[y * work.w + x];
          if (v >= 0) this.sparse.set(x + ',' + y, v);
        }
      }
    }
    this.count = this.sparse.size;
    // 初始窗口：盖住已有作品（或世界原点附近）
    const bb = this._bboxWorld();
    this._rebuildWindow(bb ? (bb.x0 + bb.x1) / 2 : WIN / 2, bb ? (bb.y0 + bb.y1) / 2 : WIN / 2);

    this.setData({
      insets: ui.navInsets(),
      title: work.name,
      count: this.count,
      beadShape: getBeadShape(),
      muted: audio.muted,
      scrollInto: 'c' + this.sel,
      chips: PALETTE.map((c, i) => ({
        pal: i,
        hex: c.hex,
        tcol: textColorFor(c.hex),
        active: i === this.sel,
      })),
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
        mode: 'free',
        getSelected: () => this.sel,
        getTool: () => this.tool,
        onPlace: (i, isNew) => this._onPlaceFree(i, isNew),
        onErase: i => this._onEraseFree(i),
        onExpand: (cx, cy) => this._expandFor(cx, cy),
      });
      this.bv.setViewport(r.width, r.height, dpr, r.left, r.top);
      // 有作品就定位到作品范围，否则停在窗口中央、舒适缩放
      const bb = this._bboxWorld();
      if (bb) this._fitBBoxWorld(bb);
      else {
        const s0 = 20;
        this.bv.scale = s0;
        this.bv.ox = r.width / 2 - this.work.w * s0 / 2;
        this.bv.oy = r.height / 2 - this.work.h * s0 / 2;
        this.bv.dirty = true;
      }
      setTimeout(() => ui.syncBoardRect(this, this.bv), 600);
    });
    ui.queryNode(this, '#util').then(r => { if (r) this.utilCanvas = r.node; });
  },

  /* ---------- 渲染窗口管理 ---------- */

  // 以世界坐标 (cwx, cwy) 为中心重建窗口（原点按 CH 对齐）；画面上的豆子位置不变
  _rebuildWindow(cwx, cwy) {
    const work = this.work;
    const nx0 = Math.round((cwx - WIN / 2) / CH) * CH;
    const ny0 = Math.round((cwy - WIN / 2) / CH) * CH;
    if (nx0 === this.win.x0 && ny0 === this.win.y0 &&
        work.w === WIN && work.h === WIN && work.cells.length === WIN * WIN) return;
    const dx = nx0 - this.win.x0, dy = ny0 - this.win.y0;
    this.win.x0 = nx0; this.win.y0 = ny0;
    const cells = new Array(WIN * WIN).fill(-1);
    const placed = new Array(WIN * WIN).fill(0);
    for (const [k, v] of this.sparse) {
      const c = k.indexOf(',');
      const x = +k.slice(0, c) - nx0, y = +k.slice(c + 1) - ny0;
      if (x >= 0 && y >= 0 && x < WIN && y < WIN) {
        const i = y * WIN + x;
        cells[i] = v; placed[i] = 1;
      }
    }
    work.w = WIN; work.h = WIN;
    work.cells = cells; work.placed = placed;
    const bv = this.bv;
    if (bv) {
      bv.o.w = WIN; bv.o.h = WIN;
      bv.o.cells = cells; bv.o.placed = placed;
      bv.ox += dx * bv.scale;
      bv.oy += dy * bv.scale;
      bv.anims.clear(); // 索引整体位移，放弃进行中的入场动画
      bv.dirty = true;
    }
  },

  // 画到窗口外：把窗口滑过去（世界无边，永不失败）
  _expandFor(cx, cy) {
    this._rebuildWindow(this.win.x0 + cx, this.win.y0 + cy);
    return true;
  },

  // 平移/缩放后视野贴近窗口边缘时，把窗口滑到视野中心（捏合中不动，避免跳变）
  _maybeSlide() {
    const bv = this.bv;
    if (!bv || bv.pinch || bv.pointers.size >= 2) return;
    const t = Date.now();
    if (t - (this._slideT || 0) < 120) return;
    this._slideT = t;
    const s = bv.scale;
    const vx0 = -bv.ox / s, vx1 = (bv.vw - bv.ox) / s;
    const vy0 = -bv.oy / s, vy1 = (bv.vh - bv.oy) / s;
    if (vx0 < MARGIN || vy0 < MARGIN || vx1 > this.work.w - MARGIN || vy1 > this.work.h - MARGIN) {
      this._rebuildWindow(this.win.x0 + (vx0 + vx1) / 2, this.win.y0 + (vy0 + vy1) / 2);
    }
  },

  /* ---------- 作品范围（世界坐标） ---------- */
  _bboxWorld() {
    if (!this.sparse.size) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const k of this.sparse.keys()) {
      const c = k.indexOf(',');
      const x = +k.slice(0, c), y = +k.slice(c + 1);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  },

  // 从稀疏表裁出作品实际范围的密集图纸（熨烫 / 缩略图用）
  _croppedPattern() {
    const bb = this._bboxWorld();
    if (!bb) return null;
    const cw = bb.x1 - bb.x0 + 1, ch = bb.y1 - bb.y0 + 1;
    const cells = new Array(cw * ch).fill(-1);
    const placed = new Array(cw * ch).fill(0);
    for (const [k, v] of this.sparse) {
      const c = k.indexOf(',');
      const i = (+k.slice(c + 1) - bb.y0) * cw + (+k.slice(0, c) - bb.x0);
      cells[i] = v; placed[i] = 1;
    }
    return { w: cw, h: ch, cells, placed };
  },

  _fitBBoxWorld(bb) {
    // 先把窗口挪到作品中心，再取景
    this._rebuildWindow((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2);
    const bv = this.bv;
    const bw = bb.x1 - bb.x0 + 1, bh = bb.y1 - bb.y0 + 1;
    const m = 44;
    const s = ui.clamp(Math.min((bv.vw - m * 2) / bw, (bv.vh - m * 2) / bh), 2.5, 40);
    bv.scale = s;
    bv.ox = bv.vw / 2 - (bb.x0 - this.win.x0 + bw / 2) * s;
    bv.oy = bv.vh / 2 - (bb.y0 - this.win.y0 + bh / 2) * s;
    bv.dirty = true;
  },

  onResize() {
    this.setData({ insets: ui.navInsets() });
    setTimeout(() => ui.syncBoardRect(this, this.bv), 120);
  },

  onHide() {
    clearTimeout(this._thumbT); this._thumbT = 0;
    this._flushSave();
    this._refreshThumb();
  },

  onUnload() {
    this._gone = true;
    clearTimeout(this._thumbT); this._thumbT = 0;
    this._flushSave(); // 存档是同步写，页面销毁前能完成；缩略图靠停笔时的低频刷新 + 首页 heal 兜底
    if (this.bv) this.bv.destroy();
  },

  /* ---------- 画板事件 ---------- */
  onTS(e) { if (this.bv) this.bv.touchStart(e); },
  onTM(e) {
    if (!this.bv) return;
    this.bv.touchMove(e);
    this._maybeSlide();
  },
  onTE(e) {
    if (!this.bv) return;
    this.bv.touchEnd(e);
    this._maybeSlide();
  },
  zoomFit() {
    if (!this.bv) return;
    // ⛶ 定位到作品范围；空画布则回到窗口全览
    const bb = this._bboxWorld();
    if (bb) this._fitBBoxWorld(bb);
    else this.bv.fit();
  },

  /* ---------- 上豆 / 擦除结算 ---------- */
  _worldKey(i) {
    return (i % this.work.w + this.win.x0) + ',' + (Math.floor(i / this.work.w) + this.win.y0);
  },

  _onPlaceFree(i, isNew) {
    this.sparse.set(this._worldKey(i), this.work.cells[i]);
    this._onChange(isNew ? 1 : 0);
  },

  _onEraseFree(i) {
    this.sparse.delete(this._worldKey(i));
    this._onChange(-1);
  },

  // 计数 + 节流音效 + 延迟存档 + 停笔后自动更新缩略图
  _onChange(delta) {
    this.count += delta;
    if (this.count < 0) this.count = 0;
    if (!this.sndTimer) {
      this.sndTimer = setTimeout(() => {
        this.sndTimer = 0;
        if (this.tool === 'erase') audio.note(300);
        else audio.tap();
        this.setData({ count: this.count });
      }, 50);
    }
    this._scheduleSave();
    // 页面存活期间低频刷缩略图（onUnload 时页面已销毁、导出会失败，不能只靠退出时生成）
    clearTimeout(this._thumbT);
    this._thumbT = setTimeout(() => {
      this._thumbT = 0;
      this._refreshThumb();
    }, 3000);
  },

  /* ---------- 顶栏 ---------- */
  goBack() {
    this._flushSave();
    ui.backHome();
  },
  toggleMute() {
    audio.setMuted(!audio.muted);
    this.setData({ muted: audio.muted });
  },
  toggleShape() {
    const s = getBeadShape() === 'round' ? 'square' : 'round';
    setBeadShape(s);
    this.setData({ beadShape: s });
    if (this.bv) this.bv.requestRender();
    ui.toast(s === 'round' ? '已切换为圆形豆子 ●' : '已切换为方形豆子 ■');
  },

  /* ---------- 色板 / 工具 ---------- */
  tapChip(e) {
    const pal = +e.currentTarget.dataset.pal;
    const old = this.sel;
    this.sel = pal;
    this.tool = null;
    const patch = { eraser: false, scrollInto: 'c' + pal };
    if (old != null) patch['chips[' + old + '].active'] = false;
    patch['chips[' + pal + '].active'] = true;
    this.setData(patch);
    if (this.bv) this.bv.requestRender();
  },

  tapEraser() {
    this.tool = this.tool === 'erase' ? null : 'erase';
    this.setData({ eraser: !!this.tool });
    if (this.tool) ui.toast('橡皮：点或划格子擦掉豆子');
  },

  /* ---------- 区域导出 ---------- */
  // 📤：整幅渲染成预览图 → 裁剪弹窗框选区域 → 框到的格子高清重渲 → 存相册。
  // 预览 pad=0：图片边缘与格子矩阵严格对齐，框选矩形可直接按比例换算成格子范围
  exportRegion() {
    if (!this.count) { ui.toast('先拼几颗豆子呀 ✨'); return; }
    if (!this.utilCanvas) { ui.toast('画布还没就绪，再试一次'); return; }
    const cp = this._croppedPattern();
    if (!cp) return;
    this._exportCp = cp;
    wx.showLoading({ title: '生成预览', mask: true });
    const cellPx = ui.clamp(Math.floor(1400 / Math.max(cp.w, cp.h)), 2, 20);
    const draw = () => renderPatternTo(this.utilCanvas, cp, { cellPx, pad: 0, scale: 1 });
    this.uq(() => ui.captureCanvas(this, this.utilCanvas, draw))
      .then(path => {
        wx.hideLoading();
        // 传网格 → 裁剪弹窗按格磁吸，框到哪格是哪格
        this.setData({ exportShow: true, exportSrc: path, exportGrid: { cols: cp.w, rows: cp.h } });
      })
      .catch(() => { wx.hideLoading(); ui.toast('预览生成失败，再试一次'); });
  },

  onExportCancel() { this.setData({ exportShow: false }); },

  onExportConfirm(e) {
    this.setData({ exportShow: false });
    const cp = this._exportCp;
    if (!cp) return;
    const r = e.detail.rect;
    // 弹窗已按格磁吸，矩形恰好落在格线上：四舍五入消掉浮点毛刺即得格子范围
    const x0 = ui.clamp(Math.round(r.x * cp.w), 0, cp.w - 1);
    const y0 = ui.clamp(Math.round(r.y * cp.h), 0, cp.h - 1);
    const x1 = ui.clamp(Math.round((r.x + r.w) * cp.w) - 1, x0, cp.w - 1);
    const y1 = ui.clamp(Math.round((r.y + r.h) * cp.h) - 1, y0, cp.h - 1);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const cells = new Array(w * h).fill(-1);
    let n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = cp.cells[(y0 + y) * cp.w + (x0 + x)];
        if (v >= 0) { cells[y * w + x] = v; n++; }
      }
    }
    if (!n) { ui.toast('框里没有豆子哦'); return; }
    wx.showLoading({ title: '导出中', mask: true });
    const sub = { w, h, cells };
    const cellPx = ui.clamp(Math.floor(1600 / Math.max(w, h)), 3, 24);
    const draw = () => renderPatternTo(this.utilCanvas, sub, { cellPx, scale: 2 });
    this.uq(() => ui.captureCanvas(this, this.utilCanvas, draw))
      .then(path => {
        wx.hideLoading();
        return ui.saveToAlbum(path); // 内部有成功 toast 与权限引导
      })
      .catch(() => { wx.hideLoading(); ui.toast('导出失败，再试一次'); });
  },

  /* ---------- 完成 ---------- */
  finishWork() {
    if (!this.count) { ui.toast('先拼几颗豆子呀 ✨'); return; }
    const bb = this._bboxWorld();
    if (bb.x1 - bb.x0 + 1 > MAX_SPAN || bb.y1 - bb.y0 + 1 > MAX_SPAN) {
      ui.toast('作品跨度超过 ' + MAX_SPAN + ' 格，缩小一点范围再完成吧');
      return;
    }
    wx.showModal({
      title: '完成创作',
      content: '完成后进入熨烫定型，定型好的作品可以分享和导出。确定完成吗？',
      confirmText: '完成',
      confirmColor: '#C9838F',
      success: r => {
        if (!r.confirm || this._gone) return;
        const cp = this._croppedPattern();
        if (!cp) return;
        // 裁剪成作品实际范围，熨烫/查看/分享都用小图
        const work = this.work;
        work.w = cp.w; work.h = cp.h;
        work.cells = cp.cells; work.placed = cp.placed;
        work.completed = true;
        work.ironed = new Array(cp.cells.length).fill(0);
        clearTimeout(this.saveTimer); this.saveTimer = 0;
        store.update(work.id, {
          w: cp.w, h: cp.h, cells: cp.cells, placed: cp.placed,
          completed: true, ironDone: false, ironed: work.ironed,
          freeBeads: null, freeX0: 0, freeY0: 0, // 完成后回归密集存档
        });
        this._refreshThumb();
        wx.redirectTo({ url: '/pages/iron/iron?id=' + work.id });
      },
    });
  },

  /* ---------- 存档 / 缩略图 ---------- */
  _scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = 0;
      this._flushSave();
    }, 600);
  },
  // 进行中的自由作品只存稀疏豆表（几 KB 级），不存渲染窗口的大数组
  _flushSave() {
    if (!this.work || this.work.completed) return;
    clearTimeout(this.saveTimer); this.saveTimer = 0;
    const beads = [];
    for (const [k, v] of this.sparse) {
      const c = k.indexOf(',');
      beads.push([+k.slice(0, c), +k.slice(c + 1), v]);
    }
    store.update(this.work.id, {
      w: WIN, h: WIN, cells: [], placed: [],
      freeBeads: beads, freeX0: this.win.x0, freeY0: this.win.y0,
    });
  },
  _refreshThumb() {
    if (!this.utilCanvas || !this.work || this._gone) return;
    // 缩略图只画作品实际范围；thumbBeads 戳记供首页判断是否过期
    const cp = this._croppedPattern();
    if (!cp) return;
    const n = this.sparse.size;
    const work = this.work;
    const clone = { id: work.id, thumb: work.thumb, w: cp.w, h: cp.h, cells: cp.cells };
    this.uq(() => ui.makeThumb(this, this.utilCanvas, clone, false))
      .then(path => {
        work.thumb = path;
        store.update(work.id, { thumb: path, thumbV: ui.THUMB_V, thumbShape: getBeadShape(), thumbBeads: n }, true);
      })
      .catch(() => { /* 缩略图失败不影响流程 */ });
  },

  onShareAppMessage() {
    return {
      title: '拼豆便利店 · 自由画布，想拼什么拼什么',
      path: '/pages/home/home',
    };
  },
});
