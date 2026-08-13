// 运行时配置:来自后端 /api/config(不再内置业务数值)
// 启动时拉取并缓存;离线时沿用上一次服务端下发的缓存,拉到前相关功能保持关闭态
const api = require('./api');

const KEY = 'pindou.config.v1';

const cfg = {
  DEBUG: false,          // 调试开关:拼豆/熨烫页出现 ⚡ 一键完成按钮
  FREE_ROW_USES: 0,      // 整排工具每幅作品免费次数
  SWIPE_AD_SECONDS: 0,   // 看广告解锁的「滑动拼豆」时长(秒)
  SWIPE_AD_UNIT_ID: '',  // 激励视频广告位 ID;空 = 广告未接入
  loaded: false,         // 本次会话是否已从后端拉到
};

// 上一次服务端下发的缓存(不是内置默认值,来源仍是后端)
try {
  const cached = wx.getStorageSync(KEY);
  if (cached && typeof cached === 'object') {
    cfg.DEBUG = !!cached.DEBUG;
    cfg.FREE_ROW_USES = cached.FREE_ROW_USES || 0;
    cfg.SWIPE_AD_SECONDS = cached.SWIPE_AD_SECONDS || 0;
    cfg.SWIPE_AD_UNIT_ID = cached.SWIPE_AD_UNIT_ID || '';
  }
} catch (e) { /* 忽略 */ }

function loadConfig() {
  return api.get('/api/config').then(d => {
    cfg.DEBUG = !!d.debug;
    cfg.FREE_ROW_USES = d.freeRowUses || 0;
    cfg.SWIPE_AD_SECONDS = d.swipeAdSeconds || 0;
    cfg.SWIPE_AD_UNIT_ID = d.swipeAdUnitId || '';
    cfg.loaded = true;
    try {
      wx.setStorageSync(KEY, {
        DEBUG: cfg.DEBUG,
        FREE_ROW_USES: cfg.FREE_ROW_USES,
        SWIPE_AD_SECONDS: cfg.SWIPE_AD_SECONDS,
        SWIPE_AD_UNIT_ID: cfg.SWIPE_AD_UNIT_ID,
      });
    } catch (e) { /* 忽略 */ }
    return cfg;
  });
}

module.exports = { cfg, loadConfig };
