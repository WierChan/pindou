// 页面通用工具：导航安全区、canvas 出图、相册保存、串行队列
const { renderPatternTo, patternSize, workFinish, workHole } = require('./board');

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

// canvas 整个缓冲区导出为临时图片文件。
// 不传 x/y/width/height：真机和开发者工具对区域参数的单位解释不一致
// （逻辑像素 / 物理像素 / 缓冲区像素都有），显式传值总会在某个环境截出局部；
// 省略后基础库按自己的口径默认导出"整张画布"，任何环境都完整。
// destWidth/destHeight 只控制输出分辨率，与截取区域无关，可以安全指定。
function canvasToTemp(canvas) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      wx.canvasToTempFilePath({
        canvas,
        destWidth: canvas.width, destHeight: canvas.height,
        fileType: 'png',
        success: r => resolve(r.tempFilePath),
        fail: reject,
      });
    }, 60); // 留一帧确保绘制已提交
  });
}

// 等 canvas 的 CSS 布局尺寸真正变成 w×h。
// setData 回调只代表数据已提交，布局在渲染层是异步生效的，必须轮询节点实测尺寸确认；
// 超时就放弃等待照常导出（导出可能不完整，但比一直卡住好）。
function waitLayout(host, sel, w, h, tries) {
  if (tries == null) tries = 12;
  return new Promise(resolve => {
    const q = host.createSelectorQuery();
    q.select(sel).boundingClientRect();
    q.exec(res => resolve(res && res[0] ? res[0] : null));
  }).then(r => {
    if (r && Math.abs(r.width - w) < 2 && Math.abs(r.height - h) < 2) return true;
    if (tries <= 0) return false;
    return new Promise(resolve => setTimeout(resolve, 80))
      .then(() => waitLayout(host, sel, w, h, tries - 1));
  });
}

// 绘制并整幅导出 canvas。
// 真机上导出区域按 canvas 的 CSS 坐标系解释，CSS 尺寸与缓冲区不一致时会截出
// "局部放大图"。因此：先绘制确定缓冲区尺寸 → 把 CSS 同步成同样大小并轮询确认
// 布局已生效 → 再重绘一次（防止原生层在缩放画布时丢内容）→ 导出。
// draw() 负责设置缓冲区尺寸并完成绘制，会被调用两次；
// canvas 元素需绑定 style="width:{{capW}}px;height:{{capH}}px"，sel 默认 '#util'。
function captureCanvas(host, canvas, draw, sel) {
  return Promise.resolve().then(() => {
    draw();
    const W = canvas.width, H = canvas.height;
    // 尺寸和上次一样就别再 setData（重复设同值也会触发整页重渲，多张预览连着来会卡）
    if (host.data && host.data.capW === W && host.data.capH === H) return;
    return new Promise(resolve => host.setData({ capW: W, capH: H }, resolve))
      .then(() => waitLayout(host, sel || '#util', W, H));
  }).then(() => {
    draw();
    return canvasToTemp(canvas);
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

// 缩略图样式版本：画法变了就 +1，首页 _healThumbs 会为旧版本号的缩略图重新生成
// v12：熨烫作品按质感选择铺颗粒纹理
// v13：色板对齐 MARD 实体色卡（色值整体更换，全部缩略图重新生成）
const THUMB_V = 15; // 15：烫法扩到 10 种（毛巾/澡巾/烫片/纸纹/网格/闪粉…），渲染变了，全量重刷

// 生成作品缩略图（持久化文件），并清掉旧图。
// 与详情画板「拼好的样子」同款布局：白底板 + 蒙孔 + 颗颗豆，熨烫过的作品用熔合质感（fused）；
// 豆子走纯色块（matte：不画高光也不画豆孔——缩略图尺寸下满屏细节显得杂乱），靠豆缝出颗粒感。
// 熨烫作品若选了纹理质感，缩略图也铺（与分享卡、详情页保持一致）。
// 格子至少给 7 逻辑像素，豆缝和底板蒙孔（要求 ≥5）才画得清楚；
// 清晰度用 scale 补（输出 2 倍），特大作品已经够大就不再翻倍，避免画布过大
function makeThumb(host, canvas, work, fused) {
  const cellPx = clamp(Math.floor(340 / Math.max(work.w, work.h)), 7, 20);
  const size = patternSize(work, { cellPx });
  const scale = Math.max(size.width, size.height) > 900 ? 1 : 2;
  const finish = fused ? workFinish(work) : 'smooth';
  const hole = fused ? workHole(work) : 'none';
  const draw = () => renderPatternTo(canvas, work, { cellPx, fused: !!fused, matte: true, finish, hole, scale });
  return captureCanvas(host, canvas, draw).then(tmp =>
    persistFile(tmp, 'thumb-' + work.id + '-' + Date.now() + '.png', work.thumb));
}

// 保存图片到相册，处理授权被拒的情况
// 调起系统图片分享菜单（发好友 / 朋友圈 / 保存到相册都在里面）；
// 老基础库不支持 showShareImageMenu 就退回直接保存到相册
function shareImage(path) {
  if (!path) return;
  if (!wx.showShareImageMenu) { saveToAlbum(path); return; }
  wx.showShareImageMenu({
    path,
    fail: err => {
      const msg = (err && err.errMsg) || '';
      if (msg.indexOf('cancel') >= 0) return; // 用户取消不提示
      saveToAlbum(path);                       // 调起失败就直接存相册
    },
  });
}

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
  queryNode, canvasToTemp, captureCanvas, persistFile, makeThumb, THUMB_V, saveToAlbum, shareImage,
  serialQueue, syncBoardRect,
};
