// 创建页原图审核缓存：同一设备上的相同文件审核通过一次后复用。
// 只用于本地创建预览；分享/口令/订单仍由各自服务端审核把关。
const KEY = 'pindou.approvedSourceImages.v1';
const MAX = 100;

function fileKey(path) {
  return new Promise(resolve => {
    let fs;
    try { fs = wx.getFileSystemManager && wx.getFileSystemManager(); } catch (e) { /* 低版本回退 */ }
    const get = fs && fs.getFileInfo ? fs.getFileInfo.bind(fs) : wx.getFileInfo;
    if (!get) { resolve(''); return; }
    try {
      get({ filePath: path, digestAlgorithm: 'sha1',
        success: r => resolve(r && r.digest && typeof r.size === 'number' && r.size >= 0 ? 'sha1:' + r.digest + ':' + r.size : ''),
        fail: () => resolve(''),
      });
    } catch (e) { resolve(''); }
  });
}

function read() {
  try {
    const list = wx.getStorageSync(KEY);
    return Array.isArray(list) ? list.filter(x => typeof x === 'string').slice(-MAX) : [];
  } catch (e) { return []; }
}

function approved(key) { return !!key && read().indexOf(key) >= 0; }
function remember(key) {
  if (!key) return;
  const list = read().filter(x => x !== key);
  list.push(key);
  try { wx.setStorageSync(KEY, list.slice(-MAX)); } catch (e) { /* 存储失败只影响下次复用 */ }
}

module.exports = { fileKey, approved, remember };
