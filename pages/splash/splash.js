// 启动页：便利店开门仪式感 —— 底部进度条，豆豆骑着进度前沿一路蹦进店。
// 进度是演出节奏（随机小步进 + 尾段减速，全程约 2.2s），不阻塞在网络上；
// 期间顺手预热云登录，让首页的云同步更快返回。
// 分享卡直达 /pages/home/home 不走这里，只有正常冷启动会看到。
const ui = require('../../utils/ui');

const STAGES = [
  [0, '擦亮豆子'],
  [30, '摆放货架'],
  [62, '整理色板'],
  [88, '打开店门'],
];

Page({
  data: {
    safeH: 68, // 状态栏+胶囊占位（初始估值给静态渲染缓存用，onLoad 实测覆盖）
    pct: 0,
    leftPx: 24,
    stage: STAGES[0][1],
    blink: false,
    landed: false,
  },

  // 云登录预热由 app.js onLaunch 统一做，这里不重复发起

  onLoad() {
    // onLoad 在首帧渲染前执行：内容块避开状态栏+胶囊，首帧位置就是对的
    const ins = ui.navInsets();
    this.setData({ safeH: ins.top + ins.h + 6 });
    // 轨道几何：进度条左右各留 24px，豆豆 54px 宽骑在填充前沿
    this.trackX = 24;
    this.trackW = ins.winW - 24 * 2;
  },

  onReady() {
    this._pct = 0;
    this._sync(0);
    this._tick();
    this._blinkLoop();
  },

  onUnload() {
    clearTimeout(this._t);
    clearTimeout(this._bt);
    clearTimeout(this._bt2);
    this._gone = true;
  },

  _tick() {
    if (this._gone) return;
    // 小步随机推进，85 之后放慢，压一点"最后冲刺"的节奏感
    const p = this._pct;
    const step = p < 85 ? 2.5 + Math.random() * 4 : 0.8 + Math.random() * 1.6;
    this._pct = Math.min(100, p + step);
    this._sync(this._pct);
    if (this._pct >= 100) { this._land(); return; }
    this._t = setTimeout(() => this._tick(), 88);
  },

  _sync(p) {
    const pct = Math.round(p);
    let stage = STAGES[0][1];
    for (const [at, txt] of STAGES) if (pct >= at) stage = txt;
    this.setData({
      pct,
      stage,
      // 豆豆中心跟随填充前沿，两端收在轨道内
      leftPx: Math.round(this.trackX + (this.trackW - 54) * (p / 100)),
    });
  },

  // 到站：停跳，来一个大落地弹跳，然后进店
  _land() {
    this.setData({ landed: true });
    try { wx.vibrateShort({ type: 'light' }); } catch (e) { /* 忽略 */ }
    setTimeout(() => {
      if (!this._gone) wx.redirectTo({ url: '/pages/home/home' });
    }, 520);
  },

  _blinkLoop() {
    if (this._gone) return;
    this._bt = setTimeout(() => {
      this.setData({ blink: true });
      this._bt2 = setTimeout(() => {
        this.setData({ blink: false });
        this._blinkLoop();
      }, 140);
    }, 1400 + Math.random() * 1800);
  },
});
