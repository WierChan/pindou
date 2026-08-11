// 自由画布：空白底板随便拼，全色板不限量，可覆盖换色、橡皮擦除；完成后走熨烫→查看
const { store } = require('../../utils/store');
const { PALETTE, textColorFor } = require('../../utils/palette');
const { BoardView, getBeadShape, setBeadShape } = require('../../utils/board');
const { audio } = require('../../utils/audio');
const ui = require('../../utils/ui');

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
    let count = 0;
    for (const p of work.placed) if (p) count++;
    this.count = count;

    this.setData({
      insets: ui.navInsets(),
      title: work.name,
      count,
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
        onPlace: (i, isNew) => this._onChange(isNew ? 1 : 0),
        onErase: () => this._onChange(-1),
        onExpand: (cx, cy) => this._expandFor(cx, cy),
      });
      this.bv.setViewport(r.width, r.height, dpr, r.left, r.top);
      // 超大底板不看全板：有作品就定位到作品范围，否则停在板中央、舒适缩放
      const bb = this._bbox();
      if (bb) this._fitBBox(bb);
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

  // 画到数据网格外时自动扩容：每次扩 40 格（保持 10 格参考线对齐不错位），
  // 上限 280×280（约 7.8 万格，防单条存档超过 storage 限制；视觉上底板永远无边）
  _expandFor(cx, cy) {
    const CH = 40, CAP = 280;
    const work = this.work;
    const w = work.w, h = work.h;
    let addL = cx < 0 ? Math.ceil(-cx / CH) * CH : 0;
    let addT = cy < 0 ? Math.ceil(-cy / CH) * CH : 0;
    let addR = cx >= w ? Math.ceil((cx - w + 1) / CH) * CH : 0;
    let addB = cy >= h ? Math.ceil((cy - h + 1) / CH) * CH : 0;
    const roomW = Math.max(0, CAP - w), roomH = Math.max(0, CAP - h);
    if (addL + addR > roomW) {
      if (addL > 0 && addR > 0) { addL = Math.min(addL, roomW); addR = Math.min(addR, roomW - addL); }
      else if (addL > 0) addL = Math.min(addL, roomW);
      else addR = Math.min(addR, roomW);
    }
    if (addT + addB > roomH) {
      if (addT > 0 && addB > 0) { addT = Math.min(addT, roomH); addB = Math.min(addB, roomH - addT); }
      else if (addT > 0) addT = Math.min(addT, roomH);
      else addB = Math.min(addB, roomH);
    }
    const nw = w + addL + addR, nh = h + addT + addB;
    const stillOut = cx + addL < 0 || cy + addT < 0 || cx + addL >= nw || cy + addT >= nh;
    if ((!addL && !addT && !addR && !addB) || stillOut) {
      if (!this._edgeT) {
        this._edgeT = setTimeout(() => { this._edgeT = 0; }, 3000);
        ui.toast('到画布尽头啦');
      }
      return false;
    }
    const cells = new Array(nw * nh).fill(-1);
    const placed = new Array(nw * nh).fill(0);
    for (let y = 0; y < h; y++) {
      const src = y * w, dst = (y + addT) * nw + addL;
      for (let x = 0; x < w; x++) {
        cells[dst + x] = work.cells[src + x];
        placed[dst + x] = work.placed[src + x];
      }
    }
    work.w = nw; work.h = nh;
    work.cells = cells; work.placed = placed;
    const bv = this.bv;
    if (bv) {
      bv.o.w = nw; bv.o.h = nh;
      bv.o.cells = cells; bv.o.placed = placed;
      // 平移原点跟着偏移，画面上的豆子纹丝不动
      bv.ox -= addL * bv.scale;
      bv.oy -= addT * bv.scale;
      bv.anims.clear(); // 索引整体位移，放弃进行中的入场动画
      bv.dirty = true;
    }
    this._scheduleSave();
    return true;
  },

  /* ---------- 作品范围（裁剪 / 定位用） ---------- */
  _bbox() {
    const w = this.work.w, h = this.work.h, placed = this.work.placed;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (placed[row + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  },

  // 裁出作品实际范围的图纸（熨烫 / 缩略图用小图，不带四周空板）
  _croppedPattern() {
    const bb = this._bbox();
    if (!bb) return null;
    const w = this.work.w;
    const cw = bb.x1 - bb.x0 + 1, ch = bb.y1 - bb.y0 + 1;
    const cells = new Array(cw * ch).fill(-1);
    const placed = new Array(cw * ch).fill(0);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const src = (bb.y0 + y) * w + (bb.x0 + x);
        cells[y * cw + x] = this.work.cells[src];
        placed[y * cw + x] = this.work.placed[src];
      }
    }
    return { w: cw, h: ch, cells, placed };
  },

  _fitBBox(bb) {
    const bv = this.bv;
    const bw = bb.x1 - bb.x0 + 1, bh = bb.y1 - bb.y0 + 1;
    const m = 44;
    const s = ui.clamp(Math.min((bv.vw - m * 2) / bw, (bv.vh - m * 2) / bh), 2.5, 40);
    bv.scale = s;
    bv.ox = bv.vw / 2 - (bb.x0 + bw / 2) * s;
    bv.oy = bv.vh / 2 - (bb.y0 + bh / 2) * s;
    bv.dirty = true;
  },

  onResize() {
    this.setData({ insets: ui.navInsets() });
    setTimeout(() => ui.syncBoardRect(this, this.bv), 120);
  },

  onHide() {
    this._flushSave();
    this._refreshThumb();
  },

  onUnload() {
    this._gone = true;
    this._flushSave();
    this._refreshThumb();
    if (this.bv) this.bv.destroy();
  },

  /* ---------- 画板事件 ---------- */
  onTS(e) { if (this.bv) this.bv.touchStart(e); },
  onTM(e) { if (this.bv) this.bv.touchMove(e); },
  onTE(e) { if (this.bv) this.bv.touchEnd(e); },
  zoomFit() {
    if (!this.bv) return;
    // ⛶ 定位到作品范围；空画布则回到整板
    const bb = this._bbox();
    if (bb) this._fitBBox(bb);
    else this.bv.fit();
  },

  // 上豆/擦除结算：计数 + 节流音效 + 延迟存档
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

  /* ---------- 完成 ---------- */
  finishWork() {
    if (!this.count) { ui.toast('先拼几颗豆子呀 ✨'); return; }
    wx.showModal({
      title: '完成创作',
      content: '完成后进入熨烫定型，定型好的作品可以分享和导出。确定完成吗？',
      confirmText: '完成',
      confirmColor: '#E8504F',
      success: r => {
        if (!r.confirm || this._gone) return;
        const cp = this._croppedPattern();
        if (!cp) { ui.toast('先拼几颗豆子呀 ✨'); return; }
        // 完成时把超大底板裁剪成作品实际范围，熨烫/查看/分享都用小图
        const work = this.work;
        work.w = cp.w; work.h = cp.h;
        work.cells = cp.cells; work.placed = cp.placed;
        work.completed = true;
        work.ironed = new Array(cp.cells.length).fill(0);
        clearTimeout(this.saveTimer); this.saveTimer = 0;
        store.update(work.id, {
          w: cp.w, h: cp.h, cells: cp.cells, placed: cp.placed,
          completed: true, ironDone: false, ironed: work.ironed,
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
  _flushSave() {
    if (!this.work) return;
    clearTimeout(this.saveTimer); this.saveTimer = 0;
    // 扩容会改 w/h，一并保存
    store.update(this.work.id, {
      w: this.work.w, h: this.work.h,
      cells: this.work.cells, placed: this.work.placed,
    });
  },
  _refreshThumb() {
    if (!this.utilCanvas || !this.work) return;
    // 缩略图只画作品实际范围（整块超大底板画进去就只剩一个小点了）
    const cp = this._croppedPattern();
    if (!cp) return;
    const work = this.work;
    const clone = { id: work.id, thumb: work.thumb, w: cp.w, h: cp.h, cells: cp.cells };
    this.uq(() => ui.makeThumb(this, this.utilCanvas, clone, false))
      .then(path => {
        work.thumb = path;
        store.update(work.id, { thumb: path, thumbV: 6, thumbShape: getBeadShape() }, true);
      })
      .catch(() => { /* 缩略图失败不影响流程 */ });
  },

  onShareAppMessage() {
    return {
      title: '指尖拼豆 · 自由画布，想拼什么拼什么',
      path: '/pages/home/home',
    };
  },
});
