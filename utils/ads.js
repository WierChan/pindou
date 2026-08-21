// 流量主广告统一封装。位 ID 全部来自后端下发(cfg.AD_UNITS,空 = 未接入/关闭)。
// 三条底线在这里兜住,页面不用各自处理:
//   1. 位 ID 为空:banner 不渲染,激励/插屏直接放行 —— 工具功能永远不被广告卡死;
//   2. 广告拉取/播放失败:静默放行(宁可少一次曝光,不能让用户存不下作品);
//   3. 激励视频按作品记账:同一作品同一位当天看完一次,当天内不再要求重看
//      (防「保存失败重试还要再看一遍」)。
const { cfg } = require('./config');

const GRANT_KEY = 'pindou.adGrant.v1';

// 取某个广告位的 adUnitId('' = 未接入)。banner 页面直接把它塞给 <ad unit-id>
function unit(slot) {
  return (cfg.AD_UNITS && cfg.AD_UNITS[slot]) || '';
}

function toast(t) {
  try { wx.showToast({ title: t, icon: 'none' }); } catch (e) { /* 忽略 */ }
}

/* ---------- 激励记账(当天有效,跨会话) ---------- */
function today() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function readGrants() {
  try {
    const g = wx.getStorageSync(GRANT_KEY);
    if (g && g.day === today() && g.ok) return g;
  } catch (e) { /* 忽略 */ }
  return { day: today(), ok: {} }; // 换天整表作废,storage 里最多躺一天的量
}
function hasGrant(slot, workId) {
  return !!(workId && readGrants().ok[slot + ':' + workId]);
}
function addGrant(slot, workId) {
  if (!workId) return;
  const g = readGrants();
  g.ok[slot + ':' + workId] = 1;
  try { wx.setStorageSync(GRANT_KEY, g); } catch (e) { /* 忽略 */ }
}

/* ---------- 激励视频 ---------- */
// 同一 adUnitId 全局单例(微信要求);onClose/onError 只挂一次,结果派发给当次调用
const rvPool = {};
function getRV(id) {
  let box = rvPool[id];
  if (box) return box;
  box = { ad: null, done: null };
  try {
    box.ad = wx.createRewardedVideoAd ? wx.createRewardedVideoAd({ adUnitId: id }) : null;
  } catch (e) { box.ad = null; }
  if (box.ad) {
    const settle = v => { const d = box.done; box.done = null; if (d) d(v); };
    box.ad.onClose(res => settle(res && res.isEnded ? 'ended' : 'quit'));
    box.ad.onError(() => settle('error'));
  }
  rvPool[id] = box;
  return box;
}

// 看激励视频换一次操作,resolve(true) = 放行执行 / false = 用户主动放弃。
// 先弹确认(合规:自愿观看 + 明确告知奖励),完整看完才发放;中途退出不发。
// opts: { workId, title, desc }
function rewarded(slot, opts) {
  const o = opts || {};
  const id = unit(slot);
  if (!id) return Promise.resolve(true);              // 未接入:直接放行
  if (hasGrant(slot, o.workId)) return Promise.resolve(true); // 当天已看过
  return new Promise(resolve => {
    wx.showModal({
      title: o.title || '看广告解锁',
      content: o.desc || '看一段短广告即可继续',
      confirmText: '看广告',
      cancelText: '先不了',
      confirmColor: '#C9838F',
      success: r => {
        if (!r.confirm) { resolve(false); return; }
        const box = getRV(id);
        if (!box.ad) { resolve(true); return; }       // 基础库不支持:放行
        box.done = v => {
          if (v === 'quit') { toast('完整看完广告才能解锁哦'); resolve(false); return; }
          if (v === 'ended') addGrant(slot, o.workId);
          resolve(true); // ended 发放;error(无库存等)放行
        };
        box.ad.show()
          .catch(() => box.ad.load().then(() => box.ad.show()))
          .catch(() => { box.done = null; resolve(true); }); // 拉不起来:放行
      },
      fail: () => resolve(true),
    });
  });
}

/* ---------- 插屏 ---------- */
// 插屏实例是页面级的且创建即开始预载,所以进页面时先 prepare(给加载留时间),
// 在自然停顿点(如熨烫完成回首页)再 showThen。关闭/未就绪/出错都会继续执行 cb,
// 导航永远不被广告卡住;未配置位 ID 时 prepare 返回空壳,showThen 直通 cb
function prepareInterstitial(slot) {
  const id = unit(slot);
  let ad = null;
  if (id && wx.createInterstitialAd) {
    try { ad = wx.createInterstitialAd({ adUnitId: id }); } catch (e) { ad = null; }
  }
  let done = null;
  const settle = () => { const f = done; done = null; if (f) f(); };
  if (ad) { ad.onClose(settle); ad.onError(settle); }
  return {
    showThen(cb) {
      if (!ad) { cb(); return; }
      done = cb;
      ad.show().catch(() => { done = null; cb(); });
    },
    destroy() {
      if (ad && ad.destroy) { try { ad.destroy(); } catch (e) { /* 忽略 */ } }
      ad = null;
    },
  };
}

module.exports = { unit, rewarded, prepareInterstitial };
