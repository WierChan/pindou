// 首页 / 作品库
const { store } = require('../../utils/store');
const { audio } = require('../../utils/audio');
const { celebrate } = require('../../utils/confetti');
const { getBeadShape } = require('../../utils/board');
const ui = require('../../utils/ui');
const sync = require('../../utils/sync');
const { buildGuide } = require('../../utils/guidance');

// 从自由画布的稀疏豆表裁出密集图纸（heal 重建缩略图用）
function freePattern(work) {
  const bs = work && work.freeBeads;
  if (!Array.isArray(bs) || !bs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of bs) {
    if (b[0] < x0) x0 = b[0];
    if (b[0] > x1) x1 = b[0];
    if (b[1] < y0) y0 = b[1];
    if (b[1] > y1) y1 = b[1];
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const cells = new Array(w * h).fill(-1);
  for (const b of bs) cells[(b[1] - y0) * w + (b[0] - x0)] = b[2];
  return { w, h, cells };
}

const EMOTES = ['♪', '★', '!', '✦', '♥'];
const BEAD_NOTES = [523, 659, 784]; // do mi sol
const MASCOT_X = 'calc(50% - 51px)'; // 表情泡锚点：豆豆头顶
const BEADS_X = 'calc(50% + 28px)';  // 表情泡锚点：豆子上方

Page({
  data: {
    padTop: 60,
    tab: 'doing',
    doing: [],
    done: [],
    shown: [],
    capW: 700,
    capH: 900,
    mAnim: '',        // 豆豆动画类：jump / wobble
    stAnim: '',       // 便利店小房子弹跳
    mBlink: false,    // 眨眼帧
    b0: '', b1: '', b2: '',  // 三颗豆的弹跳类
    titleWave: false, // 标题跳舞
    ctaAnim: '',      // CTA 按压回弹
    emotes: [],       // 表情泡 [{id, txt, x}]
    celebrating: false,
    guideSteps: [],
  },

  onShow() {
    this.refresh();
    this._healThumbs();
    this._startBlink();
    this._cloudSync();
  },

  onReady() {
    // 首次进入：豆豆开场引导
    buildGuide(this, 'home', [
      { text: '欢迎光临拼豆便利店！我是豆豆～这里可以把喜欢的图片一颗一颗拼出来，跟你转一圈！' },
      { sel: '.cta-new', text: '一切从这里开始：选一张图片、导入拼豆图纸，或者开一块自由画布随便画！' },
      { sel: '.home-tabs', text: '拼到一半的作品放在「进行中」，拼完熨烫定型的收藏在「已完成」。去开你的第一个作品吧！' },
    ]);
  },

  onGuideDone() { this.setData({ guideSteps: [] }); },

  onHide() { this._stopFx(); },
  onUnload() { this._stopFx(); },

  // 作品云同步：补发挂起操作 → 拉取合并云端 → 有变化则刷新列表
  _cloudSync() {
    if (this._syncing) return;
    this._syncing = true;
    sync.syncAll().then(changed => {
      this._syncing = false;
      if (changed) {
        this.refresh();
        this._healThumbs(); // 拉下来的作品没有本地缩略图，就地重建
      }
    }).catch(err => {
      this._syncing = false;
      console.warn('云同步失败（下次进入首页重试）', err);
    });
  },

  // 老缩略图需要重新生成：v4 之前可能只截到局部，v5 起为像素方豆，v6 去豆子描边、v7 起奶油淡彩配色；
  // 另外豆子形状设置变化后（thumbShape 与当前不一致）也重新生成。
  // 失败不写版本号（下次启动还能重试），只在本次会话内跳过，避免每次 onShow 反复重跑。
  _healThumbs() {
    if (this._healing) return;
    const shape = getBeadShape();
    const tried = this._healTried || (this._healTried = {});
    const list = store.list().filter(s => {
      if (tried[s.id + '|' + shape]) return false;
      if (s.free && !s.completed) {
        // 进行中的自由画布：豆子数戳记或形状对不上（或还没有图）就重建
        return s.placedN > 0 &&
          (!s.thumb || s.thumbBeads !== s.placedN || (s.thumbShape || 'square') !== shape);
      }
      return !s.thumbV || s.thumbV < 7 || (s.thumbShape || 'square') !== shape;
    });
    if (!list.length) return;
    this._healing = true;
    ui.queryNode(this, '#util').then(r => {
      if (!r || !r.node) { this._healing = false; return; }
      let chain = Promise.resolve();
      for (const s of list) {
        chain = chain.then(() => {
          const work = store.get(s.id);
          if (!work) return null;
          const isFreeLive = work.free && !work.completed;
          // 自由画布进行中：从稀疏豆表裁出作品图；其余作品直接画整幅
          const src = isFreeLive ? freePattern(work) : work;
          if (!src) return null;
          const target = isFreeLive
            ? { id: work.id, thumb: work.thumb, w: src.w, h: src.h, cells: src.cells }
            : work;
          return ui.makeThumb(this, r.node, target, !!work.ironDone)
            .then(path => {
              const patch = { thumb: path, thumbV: 7, thumbShape: shape };
              if (isFreeLive) patch.thumbBeads = work.freeBeads.length;
              store.update(work.id, patch, true);
            })
            // 只在失败时标记跳过（保留旧图，本次会话不再重试）；
            // 成功后戳记已更新，下次内容/形状变化时才会再生成
            .catch(() => { tried[s.id + '|' + shape] = 1; });
        });
      }
      chain.then(() => {
        this._healing = false;
        this.refresh();
      });
    });
  },

  onResize() {
    this.setData({ padTop: this._padTop() });
  },

  _padTop() {
    const ins = ui.navInsets();
    return ins.top + ins.h;
  },

  refresh() {
    const works = store.list();
    const doing = [], done = [];
    for (const s of works) {
      const isDone = s.completed && s.ironDone;
      const needIron = s.completed && !s.ironDone;
      const isFree = s.free && !s.completed; // 自由画布进行中
      const pct = s.total ? Math.round(s.placedN / s.total * 100) : 0;
      const vm = {
        id: s.id,
        name: s.name,
        thumb: s.thumb || '',
        dims: isFree ? ('自由画布 · 已拼 ' + s.placedN + ' 颗')
          : (s.w + '×' + s.h + ' · ' + s.total + ' 颗'),
        st: isDone ? 'done' : needIron ? 'iron' : isFree ? 'free' : 'doing',
        badgeText: isDone ? '已完成' : needIron ? '🔥 待熨烫' : isFree ? '✏️ 自由' : '',
        pct: needIron ? 100 : isFree ? 0 : pct,
        footText: needIron ? '豆子拼齐了 · 去熨烫 →' : isFree ? '自由创作 · 继续 →' : pct + '%　继续拼 →',
      };
      (isDone ? done : doing).push(vm);
    }
    let tab = 'doing';
    try { if (wx.getStorageSync('pindou.homeTab') === 'done') tab = 'done'; } catch (e) { /* 忽略 */ }
    this.setData({
      doing, done, tab,
      shown: tab === 'done' ? done : doing,
      padTop: this._padTop(),
    });
  },

  /* ---------- 顶部小互动（纯装饰层，不影响任何功能） ---------- */

  // 豆豆待机眨眼
  _startBlink() {
    clearInterval(this._blinkT);
    this._blinkT = setInterval(() => {
      this.setData({ mBlink: true });
      setTimeout(() => this.setData({ mBlink: false }), 140);
    }, 3200);
  },
  _stopFx() {
    clearInterval(this._blinkT);
  },

  // 重新触发某个动画类：先清空再设值（同名 class 不会重播动画）
  _animCls(key, cls, dur) {
    this._animT = this._animT || {};
    clearTimeout(this._animT[key]);
    this.setData({ [key]: '' });
    setTimeout(() => this.setData({ [key]: cls }), 30);
    this._animT[key] = setTimeout(() => this.setData({ [key]: '' }), dur);
  },

  // 冒一个表情泡
  _emote(txt, x) {
    this._emoteId = (this._emoteId || 0) + 1;
    const id = this._emoteId;
    this.setData({ emotes: this.data.emotes.concat({ id, txt, x }).slice(-4) });
    setTimeout(() => {
      this.setData({ emotes: this.data.emotes.filter(e => e.id !== id) });
    }, 900);
  },

  tapMascot() {
    const now = Date.now();
    this._mTaps = (this._mTaps || []).filter(t => now - t < 2500);
    this._mTaps.push(now);
    audio.hop();
    this._animCls('mAnim', 'jump', 560);
    if (this._mTaps.length >= 5) {
      // 彩蛋：连戳 5 下，晕头转向 + 撒花 + 号角
      this._mTaps = [];
      setTimeout(() => this._animCls('mAnim', 'wobble', 860), 80);
      this._emote('@_@', MASCOT_X);
      audio.fanfare();
      this._confetti();
    } else {
      this._emote(EMOTES[Math.floor(Math.random() * EMOTES.length)], MASCOT_X);
    }
  },

  // 点便利店小房子：叮咚门铃 + 弹跳 + 欢迎光临气泡
  tapStore() {
    audio.note(784);
    setTimeout(() => audio.note(587), 140);
    this._animCls('stAnim', 'pop', 460);
    this._emote('欢迎光临', 'calc(3% + 32px)');
  },

  tapBead(e) {
    const i = +e.currentTarget.dataset.i;
    audio.note(BEAD_NOTES[i]);
    this._animCls('b' + i, 'pop', 460);
    this._emote('♪', BEADS_X);
    // 短时间内三颗都点过：依次波浪弹跳 + 高八度琶音
    const now = Date.now();
    this._bTaps = (this._bTaps || []).filter(t => now - t.t < 1300);
    this._bTaps.push({ i, t: now });
    const got = {};
    this._bTaps.forEach(t => { got[t.i] = 1; });
    if (got[0] && got[1] && got[2]) {
      this._bTaps = [];
      [0, 1, 2].forEach(k => setTimeout(() => {
        this._animCls('b' + k, 'pop', 460);
        audio.note(BEAD_NOTES[k] * 2);
      }, 140 + k * 110));
    }
  },

  tapTitle() {
    if (this._waveT) return;
    this.setData({ titleWave: true });
    [0, 1, 2, 3, 4].forEach(i =>
      setTimeout(() => audio.note(Math.round(523 * Math.pow(1.19, i))), i * 80));
    this._waveT = setTimeout(() => {
      this._waveT = 0;
      this.setData({ titleWave: false });
    }, 1000);
  },

  // 复用完成庆祝的撒花模块
  _confetti() {
    if (this.data.celebrating) return;
    this.setData({ celebrating: true }, () => {
      ui.queryNode(this, '#confetti').then(r => {
        if (!r || !r.node) { this.setData({ celebrating: false }); return; }
        const dpr = Math.min(2, ui.navInsets().dpr);
        celebrate(r.node, r.width, r.height, dpr,
          ['#EABFC3', '#F2CB8E', '#F5D5D9', '#9EB995', '#C9838F'],
          () => this.setData({ celebrating: false }));
      });
    });
  },

  goCreate() {
    if (this._navT) return;
    // 一点小仪式感：按钮回弹 + 豆豆起跳，再进入创建页
    audio.hop();
    this._animCls('ctaAnim', 'pump', 420);
    this._animCls('mAnim', 'jump', 560);
    this._navT = setTimeout(() => {
      this._navT = 0;
      wx.navigateTo({ url: '/pages/create/create' });
    }, 140);
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    try { wx.setStorageSync('pindou.homeTab', tab); } catch (err) { /* 忽略 */ }
    this.setData({ tab, shown: tab === 'done' ? this.data.done : this.data.doing });
  },

  openWork(e) {
    const d = e.currentTarget.dataset;
    const page = d.st === 'done' ? 'view' : d.st === 'iron' ? 'iron' : d.st === 'free' ? 'free' : 'play';
    wx.navigateTo({ url: '/pages/' + page + '/' + page + '?id=' + d.id });
  },

  delWork(e) {
    const d = e.currentTarget.dataset;
    wx.showModal({
      title: '删除作品',
      content: '确定删除「' + d.name + '」吗？删掉就找不回来啦',
      confirmText: '删除',
      confirmColor: '#C9838F',
      success: r => {
        if (r.confirm) {
          store.remove(d.id);
          ui.toast('已删除');
          this.refresh();
        }
      },
    });
  },

  onShareAppMessage() {
    return {
      title: '拼豆便利店 · 把喜欢的图片，一颗一颗拼出来',
      path: '/pages/home/home',
    };
  },
});
