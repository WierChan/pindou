// 创建作品：图片转图纸 / 图案库 / 表情图案
const { store } = require('../../utils/store');
const { PALETTE } = require('../../utils/palette');
const { loadImageToData, emojiToData, imageToPattern, colorStats, reduceColors } = require('../../utils/convert');
const { analyzeChart } = require('../../utils/chart');
const { TEMPLATES, templatePattern } = require('../../utils/templates');
const { renderPatternTo, patternSize, getBeadShape } = require('../../utils/board');
const ui = require('../../utils/ui');
const { FREE_ROW_USES } = require('../../utils/config');

// 表情库：每个 emoji 都是现成的拼豆图案（预先按字素拆好，❤️ 这类组合字符不被拆散）
const EMOJIS = [
  '😀', '😍', '🥳', '😎', '🥺', '😭', '🤩', '😴', '🤖', '👻', '💀', '🤡',
  '🐶', '🐱', '🐭', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵',
  '🐔', '🐧', '🦆', '🦉', '🦄', '🐝', '🦋', '🐢', '🐍', '🦖', '🐙', '🦀', '🐠', '🐬', '🐳',
  '🍎', '🍊', '🍉', '🍇', '🍓', '🍒', '🍑', '🥑', '🥕', '🍄', '🍔', '🍟', '🍕', '🌭',
  '🍜', '🍣', '🍦', '🍩', '🍪', '🎂', '🍭', '🍫', '🧋',
  '❤️', '💖', '⭐', '✨', '⚡', '🔥', '🌈', '☀️', '🌙', '☁️', '❄️', '⛄', '🌸', '🌻', '🌹', '🍀',
  '🎈', '🎁', '🎄', '🎃', '👑', '💎', '⚽', '🏀', '🎮', '🚗', '🚀', '⛵', '🏠',
];

// 模板缩略图会话级缓存（临时文件在小程序运行期内有效）
let TPL_THUMBS = null;

// 画布长边上限：受 wx storage 单 key 1MB 与画板渲染性能约束
const SIZE_CAP = 256;

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    capW: 700,
    capH: 900,
    tab: 'image',
    mode: 'pick',
    templates: [],
    emojis: EMOJIS,
    size: 32,
    sizeMin: 8,
    sizeMax: 48,
    sizeHint: '',
    sizesShown: [16, 24, 32, 48],
    showColor: false,
    colorMax: 45,
    colorVal: 45,
    whiteEmpty: false,
    fixed: false,
    fromChart: false,
    cropShow: false,
    cropSrc: '',
    cropTitle: '裁剪图片',
    cropHint: '',
    name: '',
    dimText: '',
    total: 0,
    colorN: 0,
    chips: [],
    pvW: 0,
    pvH: 0,
  },

  onLoad() {
    // {data, w, h} 图片像素。解码时就缩到 ≤512：解码/读回/重采样都快，
    // 且 ≤256 豆的画布每格仍有 ≥2×2 采样，观感与全尺寸一致（小图不缩放，1:1 还原不受影响）
    this.srcData = null;
    this.pattern = null;    // {w, h, cells} 最终图纸
    this.fromChart = false; // 图纸导入模式：pattern 按图纸 1:1 还原，不可调大小/颜色
    this.colorLimit = null; // 用户设定的颜色数量（null = 不限制）
    this._base = null;      // 未做颜色缩减的基础图纸缓存
    this._baseKey = '';
    this._pvNode = null;    // 预览 canvas 节点缓存（退出配置页时失效）
    this.name = '';
    this.uq = ui.serialQueue(); // 工具画布串行队列
    this.setData({
      insets: ui.navInsets(),
      templates: TEMPLATES.map(t => {
        const p = templatePattern(t);
        return { name: t.name, count: p.cells.filter(x => x >= 0).length, img: '' };
      }),
    });
  },

  onReady() {
    ui.queryNode(this, '#util').then(r => {
      if (!r || !r.node) return;
      this.utilCanvas = r.node;
      this._buildTplThumbs();
    });
    ui.queryNode(this, '#util2').then(r => {
      if (r && r.node) this.decodeCanvas = r.node;
    });
  },

  // 图片/表情解码：优先用独立画布直接执行；
  // 拿不到独立画布时退回 util 队列（会排在模板缩略图生成后面）
  _loadSrc(job) {
    if (this.decodeCanvas) return Promise.resolve().then(() => job(this.decodeCanvas));
    return this.uq(() => job(this.utilCanvas));
  },

  onResize() {
    this.setData({ insets: ui.navInsets() });
    if (this.data.mode === 'config') this._renderConfig();
  },

  goBack() { ui.backHome(); },

  /* ---------- 选择阶段 ---------- */

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  // 自由画布：起始 80×80，画到边上自动扩容（视觉无边），完成时在自由页裁剪成作品
  startFree() {
    const n = 80;
    const work = store.create({
      name: '自由创作',
      w: n, h: n,
      cells: new Array(n * n).fill(-1),
      free: true,
    });
    wx.redirectTo({ url: '/pages/free/free?id=' + work.id });
  },

  _buildTplThumbs() {
    if (TPL_THUMBS) {
      this.setData({ templates: this.data.templates.map((t, i) => ({ ...t, img: TPL_THUMBS[i] })) });
      return;
    }
    const paths = [];
    let chain = Promise.resolve();
    TEMPLATES.forEach((t, i) => {
      chain = chain.then(() => this.uq(() => {
        const p = templatePattern(t);
        const cellPx = ui.clamp(Math.floor(120 / Math.max(p.w, p.h)), 6, 12);
        const draw = () => renderPatternTo(this.utilCanvas, p, { cellPx, scale: 2 });
        return ui.captureCanvas(this, this.utilCanvas, draw).then(path => {
          paths[i] = path;
          this.setData({ ['templates[' + i + '].img']: path });
        });
      }));
    });
    chain.then(() => { TPL_THUMBS = paths; }).catch(() => { /* 缩略图失败不影响功能 */ });
  },

  _pickImage(onPath) {
    const pick = wx.chooseMedia || wx.chooseImage;
    const opts = {
      count: 1,
      success: res => {
        onPath(res.tempFiles ? res.tempFiles[0].tempFilePath : res.tempFilePaths[0]);
      },
    };
    if (wx.chooseMedia) opts.mediaType = ['image'];
    pick(opts);
  },

  // 两个入口都先进裁剪弹窗：框哪里拼哪里（不裁直接「使用图片」= 整张）
  chooseImage() {
    this._pickImage(path => this._openCrop(path, 'image'));
  },

  chooseChart() {
    this._pickImage(path => this._openCrop(path, 'chart'));
  },

  _openCrop(path, mode) {
    this._cropMode = mode;
    this.setData({
      cropShow: true,
      cropSrc: path,
      cropTitle: mode === 'chart' ? '框出图纸网格' : '裁剪图片',
      cropHint: mode === 'chart'
        ? '双指缩放看细节，把网格框出来（标题、色号表留在框外）；识别会自动对齐格子，框得大概齐就行'
        : '拖四角框选想拼的部分，双指缩放；不裁剪就直接点「使用图片」',
    });
  },

  onCropCancel() { this.setData({ cropShow: false }); },

  onCropConfirm(e) {
    const rect = e.detail.rect;
    this.setData({ cropShow: false });
    if (this._cropMode === 'chart') this._importChart(this.data.cropSrc, rect);
    else this._importImage(this.data.cropSrc, rect);
  },

  _importImage(path, rect) {
    wx.showLoading({ title: '生成图纸中', mask: true });
    this._loadSrc(cv => loadImageToData(cv, path, 512, rect)).then(d => {
      this.srcData = d;
      this.fromTpl = false;
      this.fromChart = false;
      this.name = '我的拼豆';
      this._base = null;
      this.colorLimit = null;
      this._renderConfig();
      wx.hideLoading();
    }).catch(() => { wx.hideLoading(); ui.toast('图片打开失败，换一张试试'); });
  },

  // 导入拼豆图纸截图（小红书图纸工坊等生成的规整图纸图）：
  // 识别网格逐格取色，1:1 还原成可拼的作品
  _importChart(path, rect) {
    wx.showLoading({ title: '识别图纸中', mask: true });
    // 图纸必须高分辨率解码：上百格的图纸每格才有足够像素可采
    this._loadSrc(cv => loadImageToData(cv, path, 2048, rect)).then(d => {
      const r = analyzeChart(d.data, d.w, d.h);
      wx.hideLoading();
      if (!r.ok) {
        // 真机排查：vConsole 里能看到失败原因和中间量（格距/置信度/主体范围）
        console.warn('[图纸导入] 识别失败:', r.reason, r.debug || '', '图片', d.w + 'x' + d.h);
        wx.showModal({
          title: '没认出这张图纸',
          content: (r.reason || '识别失败') + '。试试发原图（别经过聊天/朋友圈压缩），或把网格部分框得再准一点',
          showCancel: false,
          confirmText: '知道了',
          confirmColor: '#C9838F',
        });
        return;
      }
      // palette = 图纸真实取样色（作品自带色板），预览/开拼颜色与原图纸一致
      this.pattern = { w: r.w, h: r.h, cells: r.cells, palette: r.palette };
      this.fromChart = true;
      this.fromTpl = false;
      this.name = '图纸拼豆';
      this._renderConfig();
    }).catch(() => { wx.hideLoading(); ui.toast('图片打开失败，换一张试试'); });
  },

  pickTpl(e) {
    const t = TEMPLATES[e.currentTarget.dataset.i];
    this.pattern = templatePattern(t);
    this.fromTpl = true;
    this.fromChart = false;
    this.name = t.name;
    this._renderConfig();
  },

  pickEmoji(e) {
    const ch = e.currentTarget.dataset.ch;
    this._loadSrc(cv => emojiToData(cv, ch)).then(d => {
      this.srcData = d;
      this.fromTpl = false;
      this.fromChart = false;
      this.name = ch + ' 拼豆';
      this._base = null;
      this.colorLimit = null;
      this._renderConfig();
    }).catch(() => ui.toast('生成失败，换一个试试'));
  },

  /* ---------- 配置阶段 ---------- */

  backToPick() {
    this._pvNode = null; // 配置页销毁，预览节点随之失效
    this.setData({ mode: 'pick' });
  },

  setSize(e) {
    const n = +e.currentTarget.dataset.n;
    if (n === this.data.size) return;
    this.setData({ size: n });
    this._renderConfig();
  },

  onSizeSlider(e) {
    const v = +e.detail.value;
    if (v === this.data.size) return;
    this.setData({ size: v });
    this._renderConfig();
  },

  onColorSlider(e) {
    this.colorLimit = +e.detail.value;
    this._renderConfig();
  },

  onWhiteChange(e) {
    this.setData({ whiteEmpty: e.detail.value });
    this._renderConfig();
  },

  onName(e) {
    this.name = e.detail.value;
  },

  _renderConfig() {
    const extra = {};
    const fixed = this.fromTpl || this.fromChart; // 图纸/模板：尺寸颜色都定死，1:1 还原
    let p;
    if (fixed) {
      p = this.pattern;
    } else {
      if (!this.srcData) return;
      // 画布大小：上限 = 图片像素长边（1:1 还原），再受 SIZE_CAP 保护
      const imgSide = Math.max(this.srcData.w, this.srcData.h);
      const sizeMax = Math.min(SIZE_CAP, imgSide);
      const sizeMin = Math.min(8, sizeMax);
      const size = ui.clamp(this.data.size, sizeMin, sizeMax);
      // 基础图纸缓存：只在大小 / 白底选项变化时重新采样，拖颜色滑杆不重算。
      // 源图已在解码时缩到 ≤512，重采样只有 ~26 万像素，切换尺寸不卡
      const key = size + '|' + this.data.whiteEmpty;
      if (!this._base || this._baseKey !== key) {
        this._base = imageToPattern(this.srcData.data, this.srcData.w, this.srcData.h,
          size, { whiteEmpty: this.data.whiteEmpty });
        this._baseKey = key;
      }
      const base = this._base;
      // 颜色数量：2 ~ 自然色数
      const natural = colorStats(base.cells).length;
      const colorMax = Math.max(2, natural);
      const colorVal = this.colorLimit == null ? colorMax : ui.clamp(this.colorLimit, 2, colorMax);
      let cells = base.cells;
      if (colorVal < natural) cells = reduceColors(base.cells, colorVal);
      p = this.pattern = { w: base.w, h: base.h, cells };
      extra.size = size;
      extra.sizeMin = sizeMin;
      extra.sizeMax = sizeMax;
      extra.sizeHint = sizeMax < imgSide
        ? '最大 ' + sizeMax + ' 豆'
        : '最大 ' + sizeMax + ' 豆 · 1:1 还原图片像素';
      extra.sizesShown = [16, 24, 32, 48].filter(n => n >= sizeMin && n <= sizeMax);
      extra.showColor = natural > 2;
      extra.colorMax = colorMax;
      extra.colorVal = colorVal;
    }
    if (!p) return;
    const stats = colorStats(p.cells);
    const total = stats.reduce((a, s) => a + s.count, 0);
    const chips = stats.slice().sort((a, b) => b.count - a.count).slice(0, 12)
      .map(s => ({ hex: p.palette ? p.palette[s.pal] : PALETTE[s.pal].hex, count: s.count }));

    const ins = ui.navInsets();
    const maxPx = Math.min(340, ins.winW - 72);
    const cellPx = ui.clamp(Math.floor(maxPx / Math.max(p.w, p.h)), 1, 14);
    const size = patternSize(p, { cellPx });

    this.setData(Object.assign(extra, {
      mode: 'config',
      fixed,
      fromChart: !!this.fromChart,
      name: this.name,
      dimText: p.w + ' × ' + p.h + ' 板',
      total,
      colorN: stats.length,
      chips,
      pvW: size.width,
      pvH: size.height,
    }), () => {
      const scale = Math.min(2, ins.dpr);
      if (this._pvNode) {
        renderPatternTo(this._pvNode, p, { cellPx, scale });
        return;
      }
      ui.queryNode(this, '#preview').then(r => {
        if (!r || !r.node) return;
        this._pvNode = r.node;
        renderPatternTo(r.node, p, { cellPx, scale });
      });
    });
  },

  start() {
    const p = this.pattern;
    if (!p) return;
    const name = (this.name || '').trim() || '我的拼豆';
    const work = store.create({ name, w: p.w, h: p.h, cells: p.cells, palette: p.palette });
    store.update(work.id, { boostRow: FREE_ROW_USES });
    const go = () => wx.redirectTo({ url: '/pages/play/play?id=' + work.id });
    this.uq(() => ui.makeThumb(this, this.utilCanvas, work, false))
      .then(path => { store.update(work.id, { thumb: path, thumbV: 7, thumbShape: getBeadShape() }, true); go(); })
      .catch(go);
  },

  onShareAppMessage() {
    return {
      title: '拼豆便利店 · 把喜欢的图片，一颗一颗拼出来',
      path: '/pages/home/home',
    };
  },
});
