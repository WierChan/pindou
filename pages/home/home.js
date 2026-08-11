// 首页 / 作品库
const { store } = require('../../utils/store');
const { audio } = require('../../utils/audio');
const { celebrate } = require('../../utils/confetti');
const ui = require('../../utils/ui');

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
    mBlink: false,    // 眨眼帧
    b0: '', b1: '', b2: '',  // 三颗豆的弹跳类
    titleWave: false, // 标题跳舞
    ctaAnim: '',      // CTA 按压回弹
    emotes: [],       // 表情泡 [{id, txt, x}]
    celebrating: false,
  },

  onShow() {
    this.refresh();
    this._healThumbs();
    this._startBlink();
  },

  onHide() { this._stopFx(); },
  onUnload() { this._stopFx(); },

  // 老缩略图需要重新生成：v4 之前可能只截到局部，v5 起为像素方豆，v6 起豆子去描边。
  // 失败不写版本号（下次启动还能重试），只在本次会话内跳过，避免每次 onShow 反复重跑。
  _healThumbs() {
    if (this._healing) return;
    const tried = this._healTried || (this._healTried = {});
    const list = store.list().filter(s => (!s.thumbV || s.thumbV < 6) && !tried[s.id]);
    if (!list.length) return;
    this._healing = true;
    ui.queryNode(this, '#util').then(r => {
      if (!r || !r.node) { this._healing = false; return; }
      let chain = Promise.resolve();
      for (const s of list) {
        chain = chain.then(() => {
          const work = store.get(s.id);
          if (!work) return null;
          tried[s.id] = 1;
          return ui.makeThumb(this, r.node, work, !!work.ironDone)
            .then(path => { store.update(work.id, { thumb: path, thumbV: 6 }); })
            .catch(() => { /* 保留旧图，下次启动再试 */ });
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
      const pct = s.total ? Math.round(s.placedN / s.total * 100) : 0;
      const vm = {
        id: s.id,
        name: s.name,
        thumb: s.thumb || '',
        dims: s.w + '×' + s.h + ' · ' + s.total + ' 颗',
        st: isDone ? 'done' : needIron ? 'iron' : 'doing',
        badgeText: isDone ? '已完成' : needIron ? '🔥 待熨烫' : '',
        pct: needIron ? 100 : pct,
        footText: needIron ? '豆子拼齐了 · 去熨烫 →' : pct + '%　继续拼 →',
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
    [0, 1, 2, 3].forEach(i =>
      setTimeout(() => audio.note(Math.round(523 * Math.pow(1.19, i))), i * 80));
    this._waveT = setTimeout(() => {
      this._waveT = 0;
      this.setData({ titleWave: false });
    }, 900);
  },

  // 复用完成庆祝的撒花模块
  _confetti() {
    if (this.data.celebrating) return;
    this.setData({ celebrating: true }, () => {
      ui.queryNode(this, '#confetti').then(r => {
        if (!r || !r.node) { this.setData({ celebrating: false }); return; }
        const dpr = Math.min(2, ui.navInsets().dpr);
        celebrate(r.node, r.width, r.height, dpr,
          ['#E8504F', '#3E6FD8', '#F8C82C', '#57B96A', '#F08080'],
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
    const page = d.st === 'done' ? 'view' : d.st === 'iron' ? 'iron' : 'play';
    wx.navigateTo({ url: '/pages/' + page + '/' + page + '?id=' + d.id });
  },

  delWork(e) {
    const d = e.currentTarget.dataset;
    wx.showModal({
      title: '删除作品',
      content: '确定删除「' + d.name + '」吗？删掉就找不回来啦',
      confirmText: '删除',
      confirmColor: '#E0453A',
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
      title: '指尖拼豆 · 把喜欢的图片，一颗一颗拼出来',
      path: '/pages/home/home',
    };
  },
});
