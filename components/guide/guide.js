// 新手引导组件：豆豆吉祥物讲解。
// 聚光灯挖孔点亮目标控件（步骤间平滑移动），气泡逐字打出，
// 打字时豆豆嘴巴一张一合，平时随机眨眼；点任意处推进，跳过/看完记 storage。
// 用法：<guide gid="play" steps="{{guideSteps}}" bind:done="onGuideDone" />
// steps 由 utils/guidance.buildGuide 生成：[{ text, rect|null }]
const { markGuideSeen } = require('../../utils/guidance');
const ui = require('../../utils/ui');

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    gid: { type: String, value: '' },
    steps: {
      type: Array,
      value: [],
      observer(v) {
        if (v && v.length) this.start();
        else if (this.data.shown) this.stop(true);
      },
    },
  },
  data: {
    shown: false,
    idx: 0,
    total: 0,
    txt: '',
    hole: null,        // 聚光灯洞（视口坐标）
    mascotRight: false, // 洞在左半屏时豆豆站右边，不挡目标
    stageStyle: '',     // 气泡+豆豆的定位：贴着聚光灯（洞在下半屏→放洞上方，反之放下方）
    blink: false,
    talk: false,
    last: false,
  },
  lifetimes: {
    detached() { this.stop(false); },
  },
  methods: {
    start() {
      if (this.data.shown) return;
      this.setData({ shown: true, total: this.properties.steps.length });
      this._blinkLoop();
      this._step(0);
    },

    stop(hide) {
      clearTimeout(this._typeT);
      clearTimeout(this._blinkT);
      clearTimeout(this._blinkT2);
      clearInterval(this._talkT);
      this._typing = false;
      if (hide) this.setData({ shown: false, txt: '', hole: null });
    },

    _step(i) {
      const s = this.properties.steps[i];
      if (!s) { this.finish(); return; }
      const win = ui.winInfo();
      const H = win.windowHeight, W = win.windowWidth;
      let hole = null, mascotRight = false, stageStyle = '';
      if (s.rect) {
        hole = {
          x: Math.max(2, s.rect.left - 6),
          y: Math.max(2, s.rect.top - 6),
          w: s.rect.width + 12,
          h: s.rect.height + 12,
        };
        mascotRight = hole.x + hole.w / 2 < W / 2;
        // 气泡贴着聚光灯：洞在下半屏→底边压在洞顶上方（向上生长）；上半屏→放到洞下方
        const gap = 14;
        if (hole.y + hole.h / 2 > H * 0.5) {
          stageStyle = 'top:auto;bottom:' + Math.round(H - hole.y + gap) + 'px';
        } else {
          stageStyle = 'bottom:auto;top:' + Math.round(hole.y + hole.h + gap) + 'px';
        }
      }
      this.setData({
        idx: i, hole, mascotRight, stageStyle,
        last: i === this.properties.steps.length - 1,
        txt: '',
      });
      this._type(s.text);
    },

    // 逐字打出 + 说话嘴型（打完闭嘴）
    _type(full) {
      clearTimeout(this._typeT);
      clearInterval(this._talkT);
      this._typing = true;
      this._full = full;
      this._talkT = setInterval(() => this.setData({ talk: !this.data.talk }), 150);
      let n = 0;
      const tick = () => {
        n++;
        this.setData({ txt: full.slice(0, n) });
        if (n < full.length && this._typing) this._typeT = setTimeout(tick, 34);
        else this._doneTyping();
      };
      tick();
    },
    _doneTyping() {
      this._typing = false;
      clearInterval(this._talkT);
      this.setData({ talk: false, txt: this._full });
    },

    _blinkLoop() {
      const loop = () => {
        this._blinkT = setTimeout(() => {
          this.setData({ blink: true });
          this._blinkT2 = setTimeout(() => this.setData({ blink: false }), 150);
          loop();
        }, 1800 + Math.random() * 2400);
      };
      loop();
    },

    next() {
      if (this._typing) { this._doneTyping(); return; } // 先把这句话放完
      this._step(this.data.idx + 1);
    },

    skip() { this.finish(); },

    finish() {
      this.stop(true);
      if (this.properties.gid) markGuideSeen(this.properties.gid);
      this.triggerEvent('done');
    },

    noop() {},
  },
});
