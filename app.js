// 拼豆便利店 · 小程序入口
const api = require('./utils/api');
const { loadConfig } = require('./utils/config');

App({
  onLaunch() {
    // 静默登录 + 拉运行时配置。失败不打扰：
    // 配置沿用上次服务端缓存，作品同步会在首页 onShow 时重试。
    api.ensureLogin()
      .then(() => loadConfig())
      .catch(err => console.warn('启动联网初始化失败（离线可继续本地使用）', err));
  },
});
