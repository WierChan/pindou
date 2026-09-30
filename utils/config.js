// 运行时配置:来自后端 /api/config(不再内置业务数值)
// 启动时拉取并缓存;离线时沿用上一次服务端下发的缓存,拉到前相关功能保持关闭态
const api = require('./api');
const pricing = require('./pricing');

const KEY = 'pindou.config.v1';

// 流量主广告位表:值为后台的 adunit-xxxxxxxx,空串 = 该位关闭。
// 全部由后端下发,不发版即可逐位开关(接口契约见 docs/ad-config-api.md)
//   bannerHome       banner   首页作品列表底部
//   bannerTpl        banner   创建页选择阶段底部(三个 tab 通吃;配置阶段与零作品新用户不出现。
//                             key 名沿用最初挂在图案库 tab 时的叫法,接口字段不改)
//   rvChart          激励视频  分享弹窗「保存图纸」前置
//   rvExport         激励视频  自由画布「导出」前置
//   interstitialDone 插屏     熨烫完成「回到首页」时机
const AD_SLOTS = ['bannerHome', 'bannerTpl', 'rvChart', 'rvExport', 'interstitialDone'];

function pickAd(src) {
  const out = {};
  for (const k of AD_SLOTS) out[k] = (src && typeof src[k] === 'string') ? src[k] : '';
  return out;
}

// 代拼服务配置(/api/config 的 order 字段,契约见 docs/order-api.md):
//   enabled        总开关。缺省 = 开;后端下发 false 可整体收起入口,不用发版
//   pickupArea     自取范围文案(合作商家都在杭州;具体哪家由平台派单后决定,客户端不展示商家)
//   pickupHint     自取补充说明
//   notice         下单页展示的说明(可空)
//   finishImages   烫法示例放大图的高清 URL {finishKey: url}(可空;缺省用包内 assets/finish/<key>-l.jpg)
//   pricing        报价表覆盖 {minBeads, maxSide, tiers, shipping, parcel},缺省用 utils/pricing.js 内置表
//   multi          多图订单(代拼篮)开关。缺省 = 关:后端按 docs/order-api.md §11 支持 works[] 后下发 true 才出现「再加一张」
const ORDER_DEF = {
  enabled: true,
  multi: false,
  pickupArea: '杭州市内到店自取',
  pickupHint: '具体取货地址在派单后的订单详情里显示，做好后商家会电话联系你约时间',
  notice: '',
  finishImages: {},
  pricing: null,
};

function pickOrder(src) {
  const o = Object.assign({}, ORDER_DEF);
  if (src && typeof src === 'object') {
    if (typeof src.enabled === 'boolean') o.enabled = src.enabled;
    if (typeof src.multi === 'boolean') o.multi = src.multi;
    ['pickupArea', 'pickupHint', 'notice'].forEach(k => {
      if (typeof src[k] === 'string' && src[k]) o[k] = src[k];
    });
    if (src.finishImages && typeof src.finishImages === 'object') {
      o.finishImages = {};
      Object.keys(src.finishImages).forEach(k => {
        const u = src.finishImages[k];
        if (typeof u === 'string' && /^https:\/\//.test(u)) o.finishImages[k] = u;
      });
    }
    if (src.pricing && typeof src.pricing === 'object') o.pricing = src.pricing;
  }
  pricing.configure(o.pricing); // 报价引擎同步(null = 内置表)
  return o;
}

const cfg = {
  DEBUG: false,           // 调试开关:拼豆/熨烫页出现 ⚡ 一键完成按钮
  AD_UNITS: pickAd(null), // 广告位 ID 表 {slot: adUnitId}
  ORDER: pickOrder(null), // 代拼服务配置
  loaded: false,          // 本次会话是否已从后端拉到
};

// 上一次服务端下发的缓存(不是内置默认值,来源仍是后端)
try {
  const cached = wx.getStorageSync(KEY);
  if (cached && typeof cached === 'object') {
    cfg.DEBUG = !!cached.DEBUG;
    cfg.AD_UNITS = pickAd(cached.AD_UNITS);
    cfg.ORDER = pickOrder(cached.ORDER);
  }
} catch (e) { /* 忽略 */ }

function loadConfig() {
  return api.get('/api/config').then(d => {
    cfg.DEBUG = !!d.debug;
    cfg.AD_UNITS = pickAd(d.adUnits);
    cfg.ORDER = pickOrder(d.order);
    cfg.loaded = true;
    try {
      wx.setStorageSync(KEY, { DEBUG: cfg.DEBUG, AD_UNITS: cfg.AD_UNITS, ORDER: cfg.ORDER });
    } catch (e) { /* 忽略 */ }
    return cfg;
  });
}

module.exports = { cfg, loadConfig };
