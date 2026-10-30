const PLATFORM = typeof process !== 'undefined' && process.env ? process.env.UNI_PLATFORM || '' : '';
const APP_PLATFORMS = ['app', 'app-plus'];
const INSTALLATION_KEY = 'pindou.app.installation.v1';

function isApp() {
    return APP_PLATFORMS.indexOf(PLATFORM) >= 0;
}

function installationId() {
    let id = '';
    try {
        id = uni.getStorageSync(INSTALLATION_KEY) || '';
    } catch (e) {
        // 存储不可用时仍可生成当次安装标识。
    }
    if (!id) {
        id = 'pd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
        try {
            uni.setStorageSync(INSTALLATION_KEY, id);
        } catch (e) {
            // 离线功能不因存储异常中断。
        }
    }
    return id;
}

module.exports = { PLATFORM, isApp, installationId };
