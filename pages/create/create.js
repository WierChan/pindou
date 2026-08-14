// 创建作品：图片转图纸 / 图案库 / 表情图案
const { store } = require('../../utils/store');
const { PALETTE } = require('../../utils/palette');
const { loadImageToData, emojiToData, imageToPattern, colorStats, reduceColors } = require('../../utils/convert');
const { analyzeChart } = require('../../utils/chart');
const { fetchTemplates, templatePattern } = require('../../utils/templates');
const { renderPatternTo, patternSize, getBeadShape } = require('../../utils/board');
const ui = require('../../utils/ui');
const { cfg } = require('../../utils/config');
const { buildGuide } = require('../../utils/guidance');
const { normalize, format, fetchByCode, reportCode: reportImportCode } = require('../../utils/importcode');

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
    tplError: '',
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
    cropGrid: null,
    cropInit: null,
    cropTitle: '裁剪图片',
    cropHint: '',
    codeShow: false,
    codeInput: '',
    importedCode: '',
    guideSteps: [],
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
    this.tpls = null; // 图案库数据(来自后端)
    this.setData({ insets: ui.navInsets() });
    this._loadTemplates();
  },

  // 图案库来自后端;失败给出提示,可点击重试(不回退本地数据)
  _loadTemplates() {
    this.setData({ tplError: '' });
    fetchTemplates().then(list => {
      this.tpls = list;
      this.setData({
        templates: list.map(t => {
          const p = templatePattern(t);
          return { name: t.name, count: p.cells.filter(x => x >= 0).length, img: '' };
        }),
      });
      this._buildTplThumbs();
    }).catch(e => {
      this.setData({ tplError: (e && e.message) || '图案库加载失败' });
    });
  },

  retryTemplates() {
    this._loadTemplates();
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
    // 首次进入：介绍三种创建方式
    buildGuide(this, 'create', [
      { sel: '.tabs', text: '三种玩法任选：照片表情包转图纸、临摹图案库，或者自由画布随手画～' },
      { sel: '.uz-chart', text: '小红书图纸工坊的图纸截图从这里导入！框住网格就能 1:1 还原，颜色和图纸一模一样' },
    ]);
  },

  onGuideDone() { this.setData({ guideSteps: [] }); },

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
    // 需要图案数据(后端)与工具画布(onReady)都就绪,两个入口各调一次,后到者执行
    if (!this.tpls || !this.utilCanvas) return;
    if (TPL_THUMBS) {
      this.setData({ templates: this.data.templates.map((t, i) => ({ ...t, img: TPL_THUMBS[i] })) });
      return;
    }
    const paths = [];
    let chain = Promise.resolve();
    this.tpls.forEach((t, i) => {
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
    this._pickImage(path => this._openCrop(path, 'image', {}));
  },

  // 图纸先预识别一遍网格：裁剪框自动吸附到图纸格线、开门就框在图案上；
  // 识别不出（拍照太歪等）就退化成普通裁剪，框完再由正式识别兜底
  chooseChart() {
    this._pickImage(path => {
      wx.showLoading({ title: '识别网格中', mask: true });
      this._loadSrc(cv => loadImageToData(cv, path, 2048)).then(d => {
        wx.hideLoading();
        const r = analyzeChart(d.data, d.w, d.h);
        const extra = {};
        if (r.ok && r.grid) {
          extra.cropGrid = {
            px: r.grid.px / d.w, py: r.grid.py / d.h,
            ox: r.grid.offX / d.w, oy: r.grid.offY / d.h,
          };
          extra.cropInit = r.rectPx ? {
            x: r.rectPx.x / d.w, y: r.rectPx.y / d.h,
            w: r.rectPx.w / d.w, h: r.rectPx.h / d.h,
          } : null;
        }
        this._openCrop(path, 'chart', extra);
      }).catch(() => { wx.hideLoading(); this._openCrop(path, 'chart', {}); });
    });
  },

  /* ---------- 导入码 ---------- */
  noop() {},
  openCodeInput() {
    this.setData({ codeShow: true, codeInput: '', codeFocus: false });
    // 弹窗布局稳定后再拉键盘：开门即可打字
    setTimeout(() => { if (this.data.codeShow) this.setData({ codeFocus: true }); }, 260);
  },
  closeCodeInput() { this.setData({ codeShow: false, codeFocus: false }); },
  onCodeInput(e) { this.setData({ codeInput: e.detail.value }); },
  // 从剪贴板捞口令（好友发来的整段文案直接粘贴也行）。
  // 注意：正式版需在小程序后台《用户隐私保护指引》声明「剪贴板」，
  // 未声明/被拒时降级提示长按输入框粘贴（系统级粘贴不受隐私接口限制）
  pasteCode() {
    wx.getClipboardData({
      success: r => {
        const c = normalize(r.data);
        if (c) this.setData({ codeInput: format(c) });
        else ui.toast('剪贴板里没找到口令');
      },
      fail: () => ui.toast('没拿到剪贴板权限，长按输入框粘贴也可以'),
    });
  },
  confirmCode() {
    const code = normalize(this.data.codeInput);
    if (!code) { ui.toast('口令不对哦，应是 8 位字符'); return; }
    this.setData({ codeShow: false });
    wx.showLoading({ title: '取图纸中', mask: true });
    fetchByCode(code).then(p => {
      wx.hideLoading();
      // 复用「外来固定图纸」配置路径：1:1 还原、自带色板
      this.pattern = { w: p.w, h: p.h, cells: p.cells, palette: p.palette };
      this.fromChart = true;
      this.fromTpl = false;
      this._importedCode = code;
      this.name = p.name;
      this._renderConfig();
    }).catch(err => {
      wx.hideLoading();
      const msg = err && (err.code === 404 || err.code === 410)
        ? '没找到这个口令对应的图纸，检查一下有没有抄错'
        : ((err && err.message) || '获取失败，稍后再试');
      wx.showModal({ title: '导入失败', content: msg, showCancel: false, confirmText: '知道了', confirmColor: '#C9838F' });
    });
  },
  // 举报口令图纸（侵权/违规 → 服务端核实后作废）
  reportCode() {
    const code = this.data.importedCode;
    if (!code) return;
    wx.showModal({
      title: '举报图纸',
      content: '如果这幅图纸涉及侵权或违规内容，我们会尽快核实并作废其导入码。确定举报吗？',
      confirmText: '举报',
      confirmColor: '#C9838F',
      success: r => {
        if (!r.confirm) return;
        reportImportCode(code, 'user').then(() => ui.toast('已收到，我们会尽快核实'))
          .catch(() => ui.toast('已记录'));
      },
    });
  },

  _openCrop(path, mode, extra) {
    this._cropMode = mode;
    this._importedCode = '';
    const snapped = !!(extra && extra.cropGrid);
    this.setData({
      cropShow: true,
      cropSrc: path,
      cropGrid: (extra && extra.cropGrid) || null,
      cropInit: (extra && extra.cropInit) || null,
      cropTitle: mode === 'chart' ? '框出图纸网格' : '裁剪图片',
      cropHint: mode === 'chart'
        ? (snapped
          ? '已识别到网格：框会自动吸附格线、按图案预先框好，微调四角即可'
          : '双指缩放看细节，把网格框出来（标题、色号表留在框外）；识别会自动对齐格子，框得大概齐就行')
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
    const t = this.tpls && this.tpls[e.currentTarget.dataset.i];
    if (!t) return;
    this.pattern = templatePattern(t);
    this.fromTpl = true;
    this.fromChart = false;
    this._importedCode = '';
    this.name = t.name;
    this._renderConfig();
  },

  pickEmoji(e) {
    const ch = e.currentTarget.dataset.ch;
    this._loadSrc(cv => emojiToData(cv, ch)).then(d => {
      this.srcData = d;
      this.fromTpl = false;
      this.fromChart = false;
      this._importedCode = '';
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
    // 首次进入"图片转图纸"的配置页 → 豆豆讲解三个调节项（拖滑杆重渲染不再触发）
    const firstConfig = this.data.mode !== 'config';
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
      importedCode: this._importedCode || '',
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

    // 图片/表情转图纸的配置页引导（模板/图纸导入没有滑杆，不需要）
    if (firstConfig && !fixed) {
      buildGuide(this, 'create-config', [
        { sel: '.preview-wrap', text: '图片变成拼豆图纸啦！上面是预览，下面标着一共要多少颗豆子、用几种颜色' },
        { sel: '.sz-opt', text: '「画布大小」= 长边的豆子数：调大细节更多、拼得也更久。第一次拼建议 32 豆上下～' },
        { sel: '.cl-opt', text: '颜色太多拼起来累！往小调会自动合并相近色，更好拼也更耐看；白底图片记得开下面的「白色背景不拼豆」' },
      ], 600);
    }
  },

  start() {
    const p = this.pattern;
    if (!p) return;
    const name = (this.name || '').trim() || '我的拼豆';
    // 两支合并：作品自带色板（图纸导入）+ 配置改走 cfg；口令导入的记来源
    const work = store.create({
      name, w: p.w, h: p.h, cells: p.cells, palette: p.palette,
      fromCode: this._importedCode || undefined,
    });
    store.update(work.id, { boostRow: cfg.FREE_ROW_USES });
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
