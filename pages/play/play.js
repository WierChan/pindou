// 拼豆界面
const { store } = require('../../utils/store');
const { PALETTE, textColorFor, hexToRgb } = require('../../utils/palette');
const { colorStats, nearestPalette, loadImageToData, imageToPattern, reduceColors, resampleCells } = require('../../utils/convert');
const { BoardView, renderPatternTo, patternSize, getBeadShape, setBeadShape } = require('../../utils/board');
const { audio, bgm } = require('../../utils/audio');
const { celebrate } = require('../../utils/confetti');
const ui = require('../../utils/ui');
const { cfg } = require('../../utils/config');
const { buildGuide, guideSeen, markGuideSeen } = require('../../utils/guidance');
const ads = require('../../utils/ads');
const { buildChartExportTo } = require('../../utils/share');
const { createCode, format, markCodePrompted } = require('../../utils/importcode');

const SIZE_CAP = 256; // 画布长边上限（同 create 页），改大小时的最大豆数
const PAINT_KEY = 'pindou.paintMode.v1'; // 划动模式:1 = 连续上豆 / 其余 = 拖动平移（跨作品记忆）
const LOCATE_KEY = 'pindou.locate.v1';   // 定位高亮:1 = 开（当前色未拼格标红、其余变淡，跨作品记忆）

// 一键拼豆：每天 3 次（全局，跨作品共享，隔天自动重置；不接激励视频补次数——避免被当小游戏审）
const FILL_PER_DAY = 3;
const FILL_DAY_KEY = 'pindou.fillDay';
const FILL_N_KEY = 'pindou.fillLeft';
function _fillToday() { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function readFillLeft() {
  try {
    if (wx.getStorageSync(FILL_DAY_KEY) !== _fillToday()) return FILL_PER_DAY; // 新的一天：满额
    const n = wx.getStorageSync(FILL_N_KEY);
    return (n === '' || n == null) ? FILL_PER_DAY : n;
  } catch (e) { return FILL_PER_DAY; }
}
function useFill() {
  const left = Math.max(0, readFillLeft() - 1);
  try { wx.setStorageSync(FILL_DAY_KEY, _fillToday()); wx.setStorageSync(FILL_N_KEY, left); } catch (e) { /* 忽略 */ }
  return left;
}

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    capW: 700,
    capH: 900,
    title: '',
    pct: 0,
    chips: [],
    paintOn: false,
    locateOn: false,
    fillLeft: 3,        // 一键拼豆今日剩余次数
    fillArmed: false,   // 一键拼豆武装中：等用户点画板选一整片同色
    beadShape: 'square',
    muted: false,
    bgmOn: false,
    debug: cfg.DEBUG,
    total: 0,
    left: 0,
    colorN: 0,
    scrollInto: '',
    celebrating: false,
    modal: { show: false, img: '', imgW: 0, imgH: 0 },
    guideSteps: [],
    // 换色：把选中的颜色整幅换成另一个（已拼的豆也跟着变，不丢进度）
    swapShow: false,
    swapChips: [],
    swapFromName: '',
    // 改大小/颜色数（会清空进度）。有原图(work.src)=高质量重量化(size+颜色数)；没原图=重采样现图(仅 size)
    sizeShow: false,
    rzMode: 'source',   // source 照片/表情高质量 / resample 模板·图纸重采样
    rzHasColor: true,   // 是否显示颜色数滑杆（仅 source 模式）
    rzSize: 52, rzSizeMin: 8, rzSizeMax: 104,
    rzColor: 12, rzColorMax: 48,
    rzW: 0, rzH: 0, rzTotal: 0, rzColorN: 0, rzPvW: 0, rzPvH: 0,
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
    // 定位高亮：关 = 普通淡图纸，开 = 当前色未拼格标红、其余变淡（跨作品记忆）
    this.locateOn = false;
    try { this.locateOn = wx.getStorageSync(LOCATE_KEY) === 1; } catch (e) { /* 忽略 */ }
    this.fillArmed = false; // 一键拼豆武装态（不持久化：进页面永远是未武装）

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
      locateOn: this.locateOn,
      fillLeft: readFillLeft(),
      beadShape: getBeadShape(),
      muted: audio.muted,
      bgmOn: bgm.enabled,
      total: this.total,
      left: this.total - this.placedCount,
      colorN: this.colorsUsed.length,
      pct: this._pct(),
    });
  },

  onReady() {
    if (!this.work) return;
    this._initBoard();
    ui.queryNode(this, '#util').then(r => { if (r) this.utilCanvas = r.node; });
    // 首次拼豆：讲核心几件事（选色 → 点格子 → 工具 → 右下按钮）。
    // 分层补看：新用户看完整 play；看过 play 的补 play-tools（右下这排按钮后加的）；
    // 都看过的老用户补 play-edit（🎨换色 / 📐改大小 是更晚加的编辑工具，否则老用户发现不了）
    const toolsStep = { sel: '.tr-btns', text: '右下这排小工具：「◎」定位当前颜色没拼的格子；「🎨」把某个颜色整幅换掉（已拼的也跟着变）；「📐」改图纸大小/颜色数；另外两个是分享、复位视角。' };
    const editStep = { sel: '.tr-btns', text: '右下角两个编辑工具：「🎨」把某个颜色整幅换成别的（已拼的豆也跟着变）、「📐」改图纸大小和颜色数～' };
    if (!guideSeen('play')) {
      buildGuide(this, 'play', [
        { sel: '.palette-bar', text: '先在这里选颜色！每种颜色有编号，下面的数字是还差几颗' },
        { text: '板上淡淡的格子就是图纸。点亮所有跟选中颜色一样的格子吧！点错了我会晃一晃提醒你。双指可以缩放看细节～' },
        { sel: '.tools-row', text: '开「连续上豆」手指划过就能连着拼；旁边「一键拼豆」每天有限次——点一下它，再点画板上想拼的位置，就会以那里为中心、把周围一块（各色）都铺上～' },
        toolsStep,
      ]);
    } else if (!guideSeen('play-tools')) {
      buildGuide(this, 'play-tools', [toolsStep]);
    } else if (!guideSeen('play-edit')) {
      buildGuide(this, 'play-edit', [editStep]);
    }
  },

  onGuideDone() {
    // 上层引导已含下层内容，别再让这些用户重复补看
    const id = this.data.guideId;
    if (id === 'play') { markGuideSeen('play-tools'); markGuideSeen('play-edit'); }
    else if (id === 'play-tools') { markGuideSeen('play-edit'); }
    this.setData({ guideSteps: [] });
  },

  onResize() {
    this.setData({ insets: ui.navInsets() });
    this._refitBoard();
  },

  onShow() {
    if (!this.work) return;
    if (bgm.enabled) bgm.start();                 // 回到拼豆页续上背景音乐
    this.setData({ fillLeft: readFillLeft() });   // 一键拼豆是每天全局额度，回来刷新一下
    if (this.fillArmed) this._setFillArmed(false); // 回到页面清掉武装态，避免误触
  },

  onHide() { this._flushSave(); bgm.stop(); if (this.fillArmed) this._setFillArmed(false); },

  onUnload() {
    this._gone = true;
    clearTimeout(this.flushTimer);
    clearTimeout(this._rzTimer);
    clearTimeout(this._thumbTimer);
    this._flushSave();
    if (this.bv) this.bv.destroy();
    bgm.stop();
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
        locate: this.locateOn,
        numbers: this.numbers,
        getSelected: () => this.sel,
        canSwipe: () => this.paintOn,
        onPlace: i => this._onPlace(i),
        onWrong: () => {
          audio.wrong();
          try { wx.vibrateShort({ type: 'medium' }); } catch (e) { /* 忽略 */ }
        },
        onFill: (filled, cell) => this._onFill(filled, cell), // 一键拼豆：铺满点到的那一整片同色
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

  // 导出图纸：把这幅图纸（网格 + 色号）保存/分享，拼到一半也能导——对着拼、打印，
  // 或发给好友「导入拼豆图纸」拼同款。跟分享弹窗「保存图纸」同款，走同一激励视频位
  exportChart() {
    const work = this.work;
    if (!work || !this.utilCanvas) return;
    ads.rewarded('rvChart', {
      workId: work.id,
      title: '导出高清图纸',
      desc: '看一段短广告，即可把这幅图纸保存或分享',
    }).then(ok => {
      if (!ok) return;
      wx.showLoading({ title: '生成中', mask: true });
      this.uq(() => ui.captureCanvas(this, this.utilCanvas, () => buildChartExportTo(this.utilCanvas, work)))
        .then(path => { wx.hideLoading(); ui.shareImage(path); })
        .catch(() => { wx.hideLoading(); ui.toast('导出失败，再试一次'); });
    });
  },

  // 右下「分享」：导出图纸让好友拼同款，或邀请好友从当前进度接着拼
  shareMenu() {
    wx.showActionSheet({
      itemList: ['导出图纸 · 好友拼同款', '邀请好友接着拼 · 带进度'],
      success: r => {
        if (r.tapIndex === 0) this.exportChart();
        else if (r.tapIndex === 1) this.relayShare();
      },
      fail: () => { /* 取消 */ },
    });
  },

  // 接力分享：把当前图纸 + 进度上传成口令，好友复制口令打开小程序就能从这个进度接着拼
  relayShare() {
    const work = this.work;
    if (!work) return;
    const pct = this._pct();
    wx.showModal({
      title: '邀请好友接力',
      content: '会把这幅图纸和你「拼到 ' + pct + '%」的进度上传，好友凭口令就能接着拼。请确认这是你原创或已获授权分享的图纸。',
      confirmText: '生成口令',
      cancelText: '先不了',
      confirmColor: '#C9838F',
      success: r => {
        if (!r.confirm) return;
        wx.showLoading({ title: '生成中', mask: true });
        createCode(work, { placed: work.placed }).then(code => {
          wx.hideLoading();
          if (!code) { ui.toast('生成失败，稍后再试'); return; }
          markCodePrompted(code); // 自家口令：复制后回前台不被剪贴板识别弹窗打扰
          wx.setClipboardData({
            data: '我在拼豆便利店拼「' + work.name + '」拼到 ' + pct + '% 啦！复制这段话打开「拼豆便利店」小程序，' +
              '凭口令 ' + format(code) + ' 接着帮我拼～也可以在 新作品 → 输入导入码 里粘贴。',
            success: () => ui.toast('接力口令已复制，发给好友吧 ✨'),
          });
        }).catch(err => {
          wx.hideLoading();
          ui.toast((err && err.message) || '生成失败，稍后再试');
        });
      },
    });
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
  // 🎵 背景音乐开关：与音效静音各自独立，只管拼豆页的循环 BGM
  toggleBgm() {
    this.setData({ bgmOn: bgm.toggle() });
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

  /* ---------- 换色：把当前选中的颜色，整幅换成另一个（已拼的豆跟着变，进度不丢） ---------- */
  noop() { /* 挡住蒙层点击穿透 */ },
  openSwap() {
    if (this.finished) return;
    if (this.sel == null) { ui.toast('先在下面选一个要换的颜色'); return; }
    if (!this.data.swapChips.length) this._buildSwapChips();
    this.setData({ swapShow: true, swapFromName: this.palName(this.sel) });
  },
  closeSwap() { this.setData({ swapShow: false }); },
  // 取色器：全色板按色系排序（白灰黑→红→粉→橙棕→黄→绿→蓝青→紫→莫兰迪），同 create 页
  _buildSwapChips() {
    const chips = PALETTE.map((c, i) => ({
      pal: i, hex: c.hex,
      k: 'HFEGABCDM'.indexOf(c.code[0]) * 1000 + parseInt(c.code.slice(1), 10),
    })).sort((a, b) => a.k - b.k);
    this.setData({ swapChips: chips });
  },
  pickSwapColor(e) {
    const to = +e.currentTarget.dataset.pal;
    const from = this.sel;
    this.setData({ swapShow: false });
    this._applySwap(from, to);
  },
  // fromPal：当前选中色；toGlobalIdx：选的 MARD 全局色号
  _applySwap(fromPal, toGlobalIdx) {
    const work = this.work;
    if (work.palette) {
      // 图纸作品：cells 里是自带色板的下标，改这个下标的实际颜色即可（下标不变、不合并）
      const newHex = PALETTE[toGlobalIdx].hex;
      if (work.palette[fromPal] === newHex) return;
      work.palette[fromPal] = newHex;
      this._rebuildColors(fromPal);           // 色号没变，选中还是它
    } else {
      // 照片作品：cells 里是全局色号，把 fromPal 全部改成 toGlobalIdx（可能与已有色合并）
      if (toGlobalIdx === fromPal) return;
      const cells = work.cells;
      for (let i = 0; i < cells.length; i++) if (cells[i] === fromPal) cells[i] = toGlobalIdx;
      this._rebuildColors(toGlobalIdx);        // 选中切到换成的新色
    }
    if (this.bv) { this.bv.setColors(work.palette || null, this.numbers); this.bv.requestRender(); }
    this._savePattern();
    this._refreshThumb();
    ui.toast('换好啦 ✨');
  },
  // 换色后整套重算颜色相关状态（同 onLoad 里那段），preferSel 为换完后想选中的色
  _rebuildColors(preferSel) {
    const work = this.work;
    const stats = colorStats(work.cells);
    this.colorsUsed = stats.map(s => s.pal);
    this.numbers = new Map(this.colorsUsed.map((p, i) => [p, i + 1]));
    this.chipIdx = new Map(this.colorsUsed.map((p, i) => [p, i]));
    this.remaining = new Map(stats.map(s => [s.pal, s.count]));
    for (let i = 0; i < work.cells.length; i++) {
      if (work.placed[i] && work.cells[i] >= 0) this.remaining.set(work.cells[i], this.remaining.get(work.cells[i]) - 1);
    }
    this.total = stats.reduce((a, s) => a + s.count, 0);
    let left = 0; this.remaining.forEach(v => { left += v; });
    this.placedCount = this.total - left;
    if (preferSel != null && this.chipIdx.has(preferSel)) this.sel = preferSel;
    else { this.sel = this.colorsUsed.find(p => this.remaining.get(p) > 0); if (this.sel == null) this.sel = this.colorsUsed[0]; }
    const chips = this.colorsUsed.map((pal, i) => {
      const n = this.remaining.get(pal);
      return {
        pal, num: i + 1, hex: this.palHex(pal), tcol: textColorFor(this.palHex(pal)),
        left: n > 0 ? n : '✓', done: n === 0, active: pal === this.sel,
      };
    });
    this.setData({ chips, total: this.total, left: this.total - this.placedCount, colorN: this.colorsUsed.length, pct: this._pct() });
    if (this.total > 0 && this.placedCount >= this.total && !this.finished) this._finish();
  },
  _savePattern() {
    if (!this.work) return;
    const patch = { cells: this.work.cells };
    if (this.work.palette) patch.palette = this.work.palette;
    store.update(this.work.id, patch);
  },
  // 改了颜色/尺寸后刷新首页缩略图（缩略图是本地按当前 cells/palette 生成的文件，无需后端）；
  // debounce 防连续换色反复重画
  _refreshThumb() {
    if (!this.utilCanvas || !this.work) return;
    clearTimeout(this._thumbTimer);
    this._thumbTimer = setTimeout(() => {
      if (this._gone || !this.work) return;
      this.uq(() => ui.makeThumb(this, this.utilCanvas, this.work, false))
        .then(path => store.update(this.work.id, { thumb: path, thumbV: ui.THUMB_V, thumbShape: getBeadShape() }, true))
        .catch(() => { /* 缩略图刷新失败不影响 */ });
    }, 450);
  },

  /* ---------- 改大小 / 颜色数：从留档的原图高质量重新生成（换网格 → 清空进度） ---------- */
  openResize() {
    const work = this.work;
    if (!work) return;
    if (work.src) {
      // 照片/表情：有留档原图 → 高质量重量化（size + 颜色数）
      this._rzMode = 'source';
      if (this._srcData) { this._openResizeSheet(); return; }
      wx.showLoading({ title: '读取原图', mask: true });
      (this.utilCanvas ? Promise.resolve(this.utilCanvas) : ui.queryNode(this, '#util').then(r => (this.utilCanvas = r && r.node)))
        .then(cv => this.uq(() => loadImageToData(cv, work.src, 512))) // 串到 util canvas 队列，避开缩略图重画
        .then(d => { wx.hideLoading(); this._srcData = d; this._openResizeSheet(); })
        .catch(() => { wx.hideLoading(); ui.toast('原图读取失败，换不了大小'); });
      return;
    }
    // 模板 / 图纸导入（没原图）：重采样现有豆子图，仅调大小、保留原色板
    this._rzMode = 'resample';
    this._openResizeSheet();
  },
  _openResizeSheet() {
    const work = this.work;
    const source = this._rzMode === 'source';
    // 有原图：上限=原图长边；重采样：可放大到 SIZE_CAP（放大会糊）
    const max = source ? Math.min(SIZE_CAP, Math.max(this._srcData.w, this._srcData.h)) : SIZE_CAP;
    this._rzBase = null; this._rzBaseSize = 0; this._rzPv = null;
    this.setData({
      sizeShow: true,
      rzMode: this._rzMode,
      rzHasColor: source,
      rzSize: ui.clamp(Math.max(work.w, work.h), 8, max),
      rzSizeMin: 8, rzSizeMax: max,
      rzColor: this.colorsUsed.length, rzColorMax: 48,
    }, () => this._rzRender());
  },
  closeResize() { this._rzPv = null; this.setData({ sizeShow: false }); },
  // 生成给定大小/颜色数的图纸。source：imageToPattern 重量化（按 size 缓存 base、只改色数时复用）；
  // resample：直接重采样现有 cells（保留原色板，忽略颜色数）
  _rzGen(size, colorVal) {
    if (this._rzMode === 'resample') {
      const work = this.work;
      const r = resampleCells(work.cells, work.w, work.h, size);
      return { w: r.w, h: r.h, cells: r.cells, palette: work.palette || null,
        total: r.cells.filter(c => c >= 0).length, colorN: colorStats(r.cells).length };
    }
    const sd = this._srcData;
    if (!this._rzBase || this._rzBaseSize !== size) {
      this._rzBase = imageToPattern(sd.data, sd.w, sd.h, size, { whiteEmpty: !!this.work.whiteEmpty });
      this._rzBaseSize = size;
    }
    const base = this._rzBase;
    let cells = base.cells;
    const natural = colorStats(cells).length;
    const cn = Math.min(colorVal, natural);
    if (cn < natural) cells = reduceColors(cells, cn);
    return { w: base.w, h: base.h, cells, palette: null, total: cells.filter(c => c >= 0).length, colorN: colorStats(cells).length };
  },
  _rzRender() {
    const g = this._rzGen(this.data.rzSize, this.data.rzColor);
    this._rzPattern = { w: g.w, h: g.h, cells: g.cells, palette: g.palette || undefined };
    const ins = ui.navInsets();
    const maxPx = Math.min(300, ins.winW - 96);
    const cellPx = ui.clamp(Math.floor(maxPx / Math.max(g.w, g.h)), 1, 12);
    const size = patternSize(this._rzPattern, { cellPx });
    this.setData({ rzW: g.w, rzH: g.h, rzTotal: g.total, rzColorN: g.colorN, rzPvW: size.width, rzPvH: size.height }, () => {
      const paint = node => renderPatternTo(node, this._rzPattern, { cellPx, scale: Math.min(2, ins.dpr) });
      if (this._rzPv) { paint(this._rzPv); return; }
      ui.queryNode(this, '#rzpv').then(r => { if (r && r.node) { this._rzPv = r.node; paint(r.node); } });
    });
  },
  onRzSize(e) { const v = e.detail.value; if (v === this.data.rzSize) return; this.setData({ rzSize: v }); this._rzDebounce(); },
  onRzColor(e) { const v = e.detail.value; if (v === this.data.rzColor) return; this.setData({ rzColor: v }); this._rzDebounce(); },
  // 手动输入大小/颜色数（超范围自动收进 min~max，回写纠正显示；失焦/回车触发）
  onRzSizeInput(e) {
    let v = parseInt(e.detail.value, 10);
    if (!(v > 0)) v = this.data.rzSize;
    v = ui.clamp(v, this.data.rzSizeMin, this.data.rzSizeMax);
    const changed = v !== this.data.rzSize;
    this.setData({ rzSize: v });
    if (changed) this._rzRender();
  },
  onRzColorInput(e) {
    let v = parseInt(e.detail.value, 10);
    if (!(v > 0)) v = this.data.rzColor;
    v = ui.clamp(v, 2, this.data.rzColorMax);
    const changed = v !== this.data.rzColor;
    this.setData({ rzColor: v });
    if (changed) this._rzRender();
  },
  _rzDebounce() { clearTimeout(this._rzTimer); this._rzTimer = setTimeout(() => { if (!this._gone) this._rzRender(); }, 130); },
  confirmResize() {
    wx.showModal({
      title: '按新图纸重拼？',
      content: '会把图纸改成 ' + this.data.rzW + '×' + this.data.rzH + ' 板、' + this.data.rzColorN + ' 色。当前拼豆进度会清空、从头开始。',
      confirmText: '确定改', cancelText: '再想想', confirmColor: '#E86A7A',
      success: r => { if (r.confirm) this._applyResize(); },
    });
  },
  _applyResize() {
    clearTimeout(this._rzTimer);
    const g = this._rzGen(this.data.rzSize, this.data.rzColor);
    const work = this.work;
    work.w = g.w; work.h = g.h; work.cells = g.cells;
    work.placed = new Array(g.cells.length).fill(0);       // 换网格 → 进度全清
    work.ironed = new Array(g.cells.length).fill(0);
    work.completed = false; work.ironDone = false;
    store.update(work.id, {
      w: work.w, h: work.h, cells: work.cells, placed: work.placed, ironed: work.ironed,
      completed: false, ironDone: false,
    });
    this.finished = false;
    this._rzPv = null;
    this.setData({ sizeShow: false });
    this._rebuildColors();                                  // 重算颜色/进度（全部未拼）
    if (this.bv) { this.bv.destroy(); this.bv = null; }
    this._initBoard();                                      // 按新网格重建画板
    this._refreshThumb();                                   // 刷新首页缩略图
    ui.toast('图纸已更新，重新拼吧 ✨');
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

  // 定位高亮：把当前色还没拼的格子标红、其余变淡，一眼看清现在要拼哪（跨作品记忆）
  toggleLocate() {
    if (this.finished) return;
    this.locateOn = !this.locateOn;
    try { wx.setStorageSync(LOCATE_KEY, this.locateOn ? 1 : 0); } catch (e) { /* 忽略 */ }
    this.setData({ locateOn: this.locateOn });
    if (this.bv) this.bv.setLocate(this.locateOn);
    ui.toast(this.locateOn ? '定位开：红色就是现在要拼的地方' : '定位已关');
  },

  // 一键拼豆：点一下「武装」，再点画板上想拼的位置 → 以落点为中心，周围一块（各色）向外扩散铺满。每天有限次。
  // 做成两步（先武装再点画板）是因为要让用户指到「哪个位置」——点哪，哪的周围一块就拼上。
  oneKeyFill() {
    if (this.finished || !this.bv) return;
    if (this.fillArmed) { this._setFillArmed(false); return; } // 再点一下 = 取消武装
    if (readFillLeft() <= 0) { ui.toast('今天的一键拼豆用完啦，明天再来～'); return; }
    this._setFillArmed(true);
    ui.toast('点画板上想拼的位置，周围一块都拼上 ✨');
  },

  _setFillArmed(v) {
    this.fillArmed = v;
    this.setData({ fillArmed: v });
    if (this.bv) this.bv.setFillArmed(v);
  },

  // 画板回调：用户在武装态轻点了画板，filled 是刚铺下的那一块格子（各色）
  _onFill(filled, cell) {
    if (!filled || !filled.length) { // 这块没有可拼的豆（全空 / 已拼完）：不扣次数，保持武装让用户再点
      ui.toast('点画板上还没拼的地方试试～');
      return;
    }
    this._setFillArmed(false);                 // 用掉一次，收起武装
    this.setData({ fillLeft: useFill() });
    // 顺手把选中色切到点到的那颗，色板高亮跟上
    const tc = this.work.cells[cell];
    if (tc >= 0 && tc !== this.sel && this.chipIdx.has(tc)) this._setSel(tc);
    try { wx.vibrateShort({ type: 'light' }); } catch (e) { /* 忽略 */ }
    this._applyPlacement(filled, 'fill');
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
    const patch = { pct: this._pct(), left: this.total - this.placedCount };
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
    if (sound === 'fill') audio.rowFill(); // 一键拼豆：一声上扫，配扩散动画
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
