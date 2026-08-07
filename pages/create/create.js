// 创建作品：图片转图纸 / 图案库 / 表情图案
const { store } = require('../../utils/store');
const { PALETTE } = require('../../utils/palette');
const { loadImageToData, emojiToData, imageToPattern, colorStats } = require('../../utils/convert');
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

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    tab: 'image',
    mode: 'pick',
    templates: [],
    emojis: EMOJIS,
    sizes: [16, 24, 32, 48],
    size: 32,
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
    this.srcData = null;   // {data, w, h} 图片像素
    this.pattern = null;   // {w, h, cells}
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
        renderPatternTo(this.utilCanvas, p, { cellPx, scale: 2 });
        return ui.canvasToTemp(this.utilCanvas).then(path => {
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

  onWhiteChange(e) {
    this.setData({ whiteEmpty: e.detail.value });
    this._renderConfig();
  },

  onName(e) {
    this.name = e.detail.value;
  },

  _renderConfig() {
    if (!this.fromTpl) {
      if (!this.srcData) return;
      this.pattern = imageToPattern(
        this.srcData.data, this.srcData.w, this.srcData.h,
        this.data.size, { whiteEmpty: this.data.whiteEmpty });
    }
    const p = this.pattern;
    if (!p) return;
    const stats = colorStats(p.cells);
    const total = stats.reduce((a, s) => a + s.count, 0);
    const chips = stats.slice().sort((a, b) => b.count - a.count).slice(0, 12)
      .map(s => ({ hex: PALETTE[s.pal].hex, count: s.count }));

    const ins = ui.navInsets();
    const maxPx = Math.min(340, ins.winW - 72);
    const cellPx = ui.clamp(Math.floor(maxPx / Math.max(p.w, p.h)), 3, 14);
    const size = patternSize(p, { cellPx });

    this.setData({
      mode: 'config',
      fromTpl: this.fromTpl,
      name: this.name,
      dimText: p.w + ' × ' + p.h + ' 板',
      total,
      colorN: stats.length,
      chips,
      pvW: size.width,
      pvH: size.height,
    }, () => {
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
    this.uq(() => ui.makeThumb(this.utilCanvas, work, false))
      .then(path => { store.update(work.id, { thumb: path }); go(); })
      .catch(go);
  },

  onShareAppMessage() {
    return {
      title: '指尖拼豆 · 把喜欢的图片，一颗一颗拼出来',
      path: '/pages/home/home',
    };
  },
});
