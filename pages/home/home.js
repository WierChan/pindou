// 首页 / 作品库
const { store } = require('../../utils/store');
const ui = require('../../utils/ui');

Page({
  data: {
    padTop: 60,
    tab: 'doing',
    doing: [],
    done: [],
    shown: [],
    capW: 700,
    capH: 900,
  },

  onShow() {
    this.refresh();
    this._healThumbs();
  },

  // 老版本生成的缩略图可能只截到局部，重新生成一次（thumbV=4 为修复后版本）。
  // 失败不写版本号（下次启动还能重试），只在本次会话内跳过，避免每次 onShow 反复重跑。
  _healThumbs() {
    if (this._healing) return;
    const tried = this._healTried || (this._healTried = {});
    const list = store.list().filter(s => (!s.thumbV || s.thumbV < 4) && !tried[s.id]);
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
            .then(path => { store.update(work.id, { thumb: path, thumbV: 4 }); })
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

  goCreate() {
    wx.navigateTo({ url: '/pages/create/create' });
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
