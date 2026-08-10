// 创建作品：图片转图纸 / 图案库 / 表情图案
const { store } = require('../../utils/store');
const { PALETTE } = require('../../utils/palette');
const { loadImageToData, emojiToData, imageToPattern, colorStats, reduceColors } = require('../../utils/convert');
const { TEMPLATES, templatePattern } = require('../../utils/templates');
const { renderPatternTo, patternSize } = require('../../utils/board');
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
    colorMax: 38,
    colorVal: 38,
    whiteEmpty: false,
    fromTpl: false,
    name: '',
    dimText: '',
    total: 0,
    colorN: 0,
    chips: [],
    pvW: 0,
    pvH: 0,
  },

  onLoad() {
    this.srcData = null;    // {data, w, h} 图片像素
    this.pattern = null;    // {w, h, cells} 最终图纸
    this.colorLimit = null; // 用户设定的颜色数量（null = 不限制）
    this._base = null;      // 未做颜色缩减的基础图纸缓存
    this._baseKey = '';
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

  chooseImage() {
    const pick = wx.chooseMedia || wx.chooseImage;
    const opts = {
      count: 1,
      success: res => {
        const path = res.tempFiles ? res.tempFiles[0].tempFilePath : res.tempFilePaths[0];
        this.uq(() => loadImageToData(this.utilCanvas, path, 2048)).then(d => {
          this.srcData = d;
          this.fromTpl = false;
          this.name = '我的拼豆';
          this._base = null;
          this.colorLimit = null;
          this._renderConfig();
        }).catch(() => ui.toast('图片打开失败，换一张试试'));
      },
    };
    if (wx.chooseMedia) opts.mediaType = ['image'];
    pick(opts);
  },

  pickTpl(e) {
    const t = TEMPLATES[e.currentTarget.dataset.i];
    this.pattern = templatePattern(t);
    this.fromTpl = true;
    this.name = t.name;
    this._renderConfig();
  },

  pickEmoji(e) {
    const ch = e.currentTarget.dataset.ch;
    this.uq(() => Promise.resolve(emojiToData(this.utilCanvas, ch))).then(d => {
      this.srcData = d;
      this.fromTpl = false;
      this.name = ch + ' 拼豆';
      this._base = null;
      this.colorLimit = null;
      this._renderConfig();
    }).catch(() => ui.toast('生成失败，换一个试试'));
  },

  /* ---------- 配置阶段 ---------- */

  backToPick() {
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
    let p;
    if (this.fromTpl) {
      p = this.pattern;
    } else {
      if (!this.srcData) return;
      // 画布大小：上限 = 图片像素长边（1:1 还原），再受 SIZE_CAP 保护
      const imgSide = Math.max(this.srcData.w, this.srcData.h);
      const sizeMax = Math.min(SIZE_CAP, imgSide);
      const sizeMin = Math.min(8, sizeMax);
      const size = ui.clamp(this.data.size, sizeMin, sizeMax);
      // 基础图纸缓存：只在大小 / 白底选项变化时重新采样，拖颜色滑杆不重算
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
      .map(s => ({ hex: PALETTE[s.pal].hex, count: s.count }));

    const ins = ui.navInsets();
    const maxPx = Math.min(340, ins.winW - 72);
    const cellPx = ui.clamp(Math.floor(maxPx / Math.max(p.w, p.h)), 1, 14);
    const size = patternSize(p, { cellPx });

    this.setData(Object.assign(extra, {
      mode: 'config',
      fromTpl: this.fromTpl,
      name: this.name,
      dimText: p.w + ' × ' + p.h + ' 板',
      total,
      colorN: stats.length,
      chips,
      pvW: size.width,
      pvH: size.height,
    }), () => {
      ui.queryNode(this, '#preview').then(r => {
        if (!r || !r.node) return;
        const scale = Math.min(2, ins.dpr);
        renderPatternTo(r.node, p, { cellPx, scale });
      });
    });
  },

  start() {
    const p = this.pattern;
    if (!p) return;
    const name = (this.name || '').trim() || '我的拼豆';
    const work = store.create({ name, w: p.w, h: p.h, cells: p.cells });
    store.update(work.id, { boostRow: FREE_ROW_USES });
    const go = () => wx.redirectTo({ url: '/pages/play/play?id=' + work.id });
    this.uq(() => ui.makeThumb(this, this.utilCanvas, work, false))
      .then(path => { store.update(work.id, { thumb: path, thumbV: 4 }); go(); })
      .catch(go);
  },

  onShareAppMessage() {
    return {
      title: '指尖拼豆 · 把喜欢的图片，一颗一颗拼出来',
      path: '/pages/home/home',
    };
  },
});
