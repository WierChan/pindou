// 设置：集中项目里的各项偏好——音效 / 背景音乐 / 豆子形状 / 划动方式 / 定位高亮，
// 以及新作品熨烫时的默认质感、默认豆孔。都各自持久化，页面/组件读同样的 storage key。
const { audio, bgm } = require('../../utils/audio');
const { getBeadShape, setBeadShape, finishList, normFinish } = require('../../utils/board');
const ui = require('../../utils/ui');

const K_PAINT = 'pindou.paintMode.v1';   // 划动默认：1 连续上豆 / 其余 拖动画布
const K_LOCATE = 'pindou.locate.v1';     // 定位高亮默认：1 开
const K_FINISH = 'pindou.defaultFinish'; // 默认烫法：10 选 1（见 board.FINISHES）
const K_HOLE = 'pindou.defaultHole';     // 默认豆孔：none / small / large

function rd(k, def) {
  try { const v = wx.getStorageSync(k); return (v === '' || v == null) ? def : v; } catch (e) { return def; }
}
function wr(k, v) { try { wx.setStorageSync(k, v); } catch (e) { /* 忽略 */ } }

Page({
  data: {
    insets: { top: 24, h: 44, right: 8 },
    sfxOn: true,
    bgmOn: true,
    beadShape: 'square',
    paintOn: false,
    locateOn: false,
    finish: 'towel',
    finishGroups: [],
    hole: 'none',
  },

  onLoad() {
    this.setData({
      insets: ui.navInsets(),
      sfxOn: !audio.muted,
      bgmOn: bgm.enabled,
      beadShape: getBeadShape(),
      paintOn: rd(K_PAINT, 0) === 1,
      locateOn: rd(K_LOCATE, 0) === 1,
      finish: normFinish(rd(K_FINISH, 'towel')) || 'towel',
      finishGroups: finishList(),
      hole: rd(K_HOLE, 'none'),
    });
  },

  goBack() { wx.navigateBack({ fail: () => ui.backHome() }); },

  /* ---- 声音 ---- */
  setSfx(e) {
    const on = e.currentTarget.dataset.v === '1';
    audio.setMuted(!on);
    this.setData({ sfxOn: on });
    if (on) audio.note(880); // 打开时给个"叮"确认
  },
  setBgm(e) {
    const on = e.currentTarget.dataset.v === '1';
    bgm.setEnabled(on); // 只存偏好，不在设置页起播；关掉立即停
    this.setData({ bgmOn: on });
  },

  /* ---- 拼豆偏好 ---- */
  setShape(e) {
    setBeadShape(e.currentTarget.dataset.v);
    this.setData({ beadShape: getBeadShape() });
  },
  setPaint(e) {
    const v = +e.currentTarget.dataset.v;
    wr(K_PAINT, v);
    this.setData({ paintOn: v === 1 });
  },
  setLocate(e) {
    const v = +e.currentTarget.dataset.v;
    wr(K_LOCATE, v);
    this.setData({ locateOn: v === 1 });
  },

  /* ---- 熨烫成品默认 ---- */
  setFinish(e) {
    const v = e.currentTarget.dataset.v;
    wr(K_FINISH, v);
    this.setData({ finish: v });
  },
  setHole(e) {
    const v = e.currentTarget.dataset.v;
    wr(K_HOLE, v);
    this.setData({ hole: v });
  },
});
