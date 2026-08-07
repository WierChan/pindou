// 页面通用工具：导航安全区、canvas 出图、相册保存、串行队列
const { renderPatternTo } = require('./board');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function winInfo() {
  try { return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); }
  catch (e) { return { statusBarHeight: 20, windowWidth: 375, windowHeight: 667, pixelRatio: 2 }; }
}

// 自定义导航条的安全区参数（避开状态栏和右上角胶囊，兼容 iPad / 分屏 / 转屏）
function navInsets() {
  const win = winInfo();
  let menu = null;
  try { menu = wx.getMenuButtonBoundingClientRect(); } catch (e) { /* 忽略 */ }
  const sb = win.statusBarHeight != null ? win.statusBarHeight : 20;
  const ok = menu && menu.width > 0 && menu.bottom > 0 && menu.top >= 0;
  const top = ok ? Math.max(sb, menu.top - 4) : sb + 4;
  const h = ok ? menu.height + 8 : 44;
  const right = ok ? Math.max(8, win.windowWidth - menu.left + 8) : 8;
  return {
    top, h, right,
    winW: win.windowWidth, winH: win.windowHeight,
    dpr: win.pixelRatio || 2,
  };
}

function toast(msg) {
  wx.showToast({ title: msg, icon: 'none', duration: 1800 });
}

// 返回上一页；没有上一页（例如从分享直达）就回首页
function backHome() {
  const pages = getCurrentPages();
  if (pages.length > 1) wx.navigateBack();
  else wx.reLaunch({ url: '/pages/home/home' });
}

// 查询 canvas 节点（含尺寸位置），偶发的时序问题重试一次
function queryNode(host, sel) {
  const once = () => new Promise(resolve => {
    const q = host.createSelectorQuery();
    q.select(sel).fields({ node: true, size: true, rect: true });
    q.exec(res => resolve(res && res[0] ? res[0] : null));
  });
  return once().then(r => {
    if (r && r.node) return r;
    return new Promise(resolve => setTimeout(() => once().then(resolve), 150));
  });
}

// canvas 整个缓冲区导出为临时图片文件
function canvasToTemp(canvas) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      wx.canvasToTempFilePath({
        canvas,
        x: 0, y: 0,
        width: canvas.width, height: canvas.height,
        destWidth: canvas.width, destHeight: canvas.height,
        fileType: 'png',
        success: r => resolve(r.tempFilePath),
        fail: reject,
      });
    }, 60); // 留一帧确保绘制已提交
  });
}

// 把临时文件持久化到用户目录，返回持久路径；oldPath 为被替换的旧文件
function persistFile(tempPath, name, oldPath) {
  try {
    const fs = wx.getFileSystemManager();
    const dest = wx.env.USER_DATA_PATH + '/' + name;
    if (oldPath && oldPath.indexOf(wx.env.USER_DATA_PATH) === 0 && oldPath !== dest) {
      try { fs.unlinkSync(oldPath); } catch (e) { /* 忽略 */ }
    }
    try { fs.unlinkSync(dest); } catch (e) { /* 忽略 */ }
    fs.copyFileSync(tempPath, dest);
    return dest;
  } catch (e) {
    return tempPath; // 持久化失败就先用临时路径
  }
}

// 生成作品缩略图（持久化文件），并清掉旧图
function makeThumb(canvas, work, fused) {
  const cellPx = clamp(Math.floor(140 / Math.max(work.w, work.h)), 2, 10);
  renderPatternTo(canvas, work, { cellPx, fused, scale: 2 });
  return canvasToTemp(canvas).then(tmp =>
    persistFile(tmp, 'thumb-' + work.id + '-' + Date.now() + '.png', work.thumb));
}

// 保存图片到相册，处理授权被拒的情况
function saveToAlbum(path) {
  return new Promise(resolve => {
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => { toast('已保存到相册 ✨'); resolve(true); },
      fail: err => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0 || msg.indexOf('denied') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存图片到相册',
            confirmText: '去设置',
            confirmColor: '#FF7D54',
            success: r => { if (r.confirm) wx.openSetting(); },
          });
        } else if (msg.indexOf('cancel') < 0) {
          toast('保存失败，再试一次');
        }
        resolve(false);
      },
    });
  });
}

// 复测画板 canvas 的尺寸与位置（布局迟到 / 转屏 / iPad 分屏后调用）
// 尺寸变了就整体重设视口，只是位置变了就只校准触点参照系
function syncBoardRect(host, bv, sel) {
  if (!bv) return;
  queryNode(host, sel || '#board').then(r => {
    if (!r || !bv.alive) return;
    if (Math.abs(r.width - bv.vw) > 1 || Math.abs(r.height - bv.vh) > 1) {
      bv.setViewport(r.width, r.height, bv.dpr, r.left, r.top);
    } else {
      bv.setRect(r.left, r.top);
    }
  });
}

// 串行任务队列：多个流程共用一块隐藏 canvas 时避免互相踩踏
function serialQueue() {
  let tail = Promise.resolve();
  return job => {
    const run = tail.then(() => job());
    tail = run.then(() => {}, () => {});
    return run;
  };
}

module.exports = {
  clamp, winInfo, navInsets, toast, backHome,
  queryNode, canvasToTemp, persistFile, makeThumb, saveToAlbum,
  serialQueue, syncBoardRect,
};
