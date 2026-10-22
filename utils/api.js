// 后端 API 封装:wx.request Promise 化 + 微信登录与令牌管理
// 统一响应 {code, message, data}:code 0 成功;401 自动重新登录并重试一次
const { API_BASE } = require('./env');

const TOKEN_KEY = 'pindou.token.v1';

let token = '';
try { token = wx.getStorageSync(TOKEN_KEY) || ''; } catch (e) { /* 忽略 */ }

let loginPromise = null; // 并发去重:同一时刻只发一次登录

function rawRequest(method, path, data, withAuth) {
  return new Promise((resolve, reject) => {
    const header = { 'Content-Type': 'application/json' };
    if (withAuth && token) header.Authorization = 'Bearer ' + token;
    wx.request({
      url: API_BASE + path,
      method,
      data,
      header,
      success: res => {
        const body = res.data;
        if (body && body.code === 0) { resolve(body.data); return; }
        reject({
          code: body && typeof body.code === 'number' ? body.code : res.statusCode,
          message: (body && body.message) || ('服务异常 HTTP ' + res.statusCode),
        });
      },
      fail: () => reject({ code: -1, message: '无法连接拼豆服务器' }),
    });
  });
}

// wx.login → code → 换后端令牌(自动注册)
function login() {
  if (loginPromise) return loginPromise;
  loginPromise = new Promise((resolve, reject) => {
    wx.login({
      success: r => {
        if (!r.code) { reject({ code: -1, message: '微信登录失败' }); return; }
        rawRequest('POST', '/api/auth/login', { code: r.code }, false)
          .then(d => {
            token = d.token;
            try { wx.setStorageSync(TOKEN_KEY, token); } catch (e) { /* 忽略 */ }
            resolve(d);
          })
          .catch(reject);
      },
      fail: () => reject({ code: -1, message: '微信登录失败' }),
    });
  });
  const clear = () => { loginPromise = null; };
  loginPromise.then(clear, clear);
  return loginPromise;
}

// 带鉴权请求:未登录先登录;令牌过期(401)自动重登并重试一次
function request(method, path, data) {
  const doIt = () => rawRequest(method, path, data, true);
  const first = token ? doIt() : login().then(doIt);
  return first.catch(err => {
    if (err && err.code === 401) {
      token = '';
      return login().then(doIt);
    }
    throw err;
  });
}

function upload(path, filePath) {
  const send = () => new Promise((resolve, reject) => {
    wx.uploadFile({
      url: API_BASE + path, filePath, name: 'file',
      header: { Authorization: 'Bearer ' + token },
      success: res => {
        let body;
        try { body = JSON.parse(res.data); } catch (e) { /* 非 JSON 错误页 */ }
        if (body && body.code === 0) resolve(body.data);
        else {
          // uploadFile 在 HTTP 200 时也可能返回业务错误；开发者工具的 Network
          // 面板不一定展示上传响应体，记录非敏感字段便于定位服务端失败。
          console.warn('图片审核上传失败', {
            path, httpStatus: res.statusCode,
            code: body && body.code,
            message: body && body.message,
          });
          reject({ code: body && body.code || res.statusCode,
            message: body && body.message || '图片上传失败' });
        }
      },
      fail: () => reject({ code: -1, message: '无法连接拼豆服务器' }),
    });
  });
  return (token ? send() : login().then(send)).catch(err => {
    if (err && err.code === 401) { token = ''; return login().then(send); }
    throw err;
  });
}

module.exports = {
  ensureLogin: () => (token ? Promise.resolve() : login()),
  get: path => request('GET', path),
  post: (path, data) => request('POST', path, data),
  put: (path, data) => request('PUT', path, data),
  del: path => request('DELETE', path),
  upload,
};
