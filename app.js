// 拼豆便利店 · 小程序入口
const api = require('./utils/api');
const { loadConfig } = require('./utils/config');
const { extractCode, format, markCodePrompted, wasCodePrompted } = require('./utils/importcode');

App({
  onLaunch() {
    // 静默登录 + 拉运行时配置。失败不打扰：
    // 配置沿用上次服务端缓存，作品同步会在首页 onShow 时重试。
    api.ensureLogin()
      .then(() => loadConfig())
      .catch(err => console.warn('启动联网初始化失败（离线可继续本地使用）', err));
  },

  // 回到前台看一眼剪贴板：好友复制了整段分享文案（含 PD-XXXX-XXXX 口令）打开小程序，
  // 直接弹「拼同款」确认，免去 新作品 → 输入导入码 的手动路径。
  // 同一个码只弹一次；自己复制自家口令时 view 页已预先标记，不会被打扰。
  // 注意：正式版需在小程序后台《用户隐私保护指引》声明「剪贴板」，
  // 未声明/用户拒绝时 fail 静默跳过，手动输入路径不受影响
  onShow() {
    wx.getClipboardData({
      success: r => {
        const code = extractCode(r.data);
        if (!code || wasCodePrompted(code)) return;
        markCodePrompted(code);
        wx.showModal({
          title: '发现拼豆口令',
          content: '检测到口令 ' + format(code) + '，要导入这张图纸拼同款吗？',
          confirmText: '拼同款',
          cancelText: '先不了',
          confirmColor: '#C9838F',
          success: res => {
            if (!res.confirm) return;
            const url = '/pages/create/create?code=' + code;
            wx.navigateTo({ url, fail: () => wx.reLaunch({ url }) });
          },
        });
      },
      fail: () => { /* 无剪贴板授权/隐私协议未同意：静默 */ },
    });
  },
});
