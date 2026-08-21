// 运行时配置:来自后端 /api/config(不再内置业务数值)
// 启动时拉取并缓存;离线时沿用上一次服务端下发的缓存,拉到前相关功能保持关闭态
const api = require('./api');

const KEY = 'pindou.config.v1';

// 流量主广告位表:值为后台的 adunit-xxxxxxxx,空串 = 该位关闭。
// 全部由后端下发,不发版即可逐位开关(接口契约见 docs/ad-config-api.md)
//   bannerHome       banner   首页作品列表底部
//   bannerTpl        banner   创建页「图案库」tab 底部
//   rvChart          激励视频  分享弹窗「保存图纸」前置
//   rvExport         激励视频  自由画布「导出」前置
//   interstitialDone 插屏     熨烫完成「回到首页」时机
const AD_SLOTS = ['bannerHome', 'bannerTpl', 'rvChart', 'rvExport', 'interstitialDone'];

function pickAd(src) {
  const out = {};
  for (const k of AD_SLOTS) out[k] = (src && typeof src[k] === 'string') ? src[k] : '';
  return out;
}

const cfg = {
  DEBUG: false,           // 调试开关:拼豆/熨烫页出现 ⚡ 一键完成按钮
  AD_UNITS: pickAd(null), // 广告位 ID 表 {slot: adUnitId}
  loaded: false,          // 本次会话是否已从后端拉到
};

// 上一次服务端下发的缓存(不是内置默认值,来源仍是后端)
try {
  const cached = wx.getStorageSync(KEY);
  if (cached && typeof cached === 'object') {
    cfg.DEBUG = !!cached.DEBUG;
    cfg.AD_UNITS = pickAd(cached.AD_UNITS);
  }
} catch (e) { /* 忽略 */ }

function loadConfig() {
  return api.get('/api/config').then(d => {
    cfg.DEBUG = !!d.debug;
    cfg.AD_UNITS = pickAd(d.adUnits);
    cfg.loaded = true;
    try {
      wx.setStorageSync(KEY, { DEBUG: cfg.DEBUG, AD_UNITS: cfg.AD_UNITS });
    } catch (e) { /* 忽略 */ }
    return cfg;
  });
}

module.exports = { cfg, loadConfig };
