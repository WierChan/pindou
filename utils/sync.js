// 作品云同步:上行防抖推送 + 下行拉取合并(按 updatedAt 最后写入胜)
// + 删除墓碑传播 + 失败重试队列(下次 syncAll 时补发)
// 缩略图(thumb/thumbV/thumbShape/thumbBeads)是设备本地文件,不参与同步,
// 拉下来的作品由首页 _healThumbs 自动重建缩略图。
const api = require('./api');

const PENDING_KEY = 'pindou.sync.pending.v1'; // { push: {id:1}, del: {id:1} }
const LOCAL_FIELDS = ['thumb', 'thumbV', 'thumbShape', 'thumbBeads'];
const PUSH_DEBOUNCE = 1500;

const timers = {};
let failToastShown = false; // 每次会话只提示一次,避免刷屏

/* ---------- 失败重试队列(storage 持久化,离线也不丢) ---------- */

function readPending() {
  try {
    const v = wx.getStorageSync(PENDING_KEY);
    if (v && typeof v === 'object') return { push: v.push || {}, del: v.del || {} };
  } catch (e) { /* 忽略 */ }
  return { push: {}, del: {} };
}

function writePending(p) {
  try { wx.setStorageSync(PENDING_KEY, p); } catch (e) { /* 忽略 */ }
}

function mark(kind, id) {
  const p = readPending();
  p[kind][id] = 1;
  if (kind === 'del') delete p.push[id];
  writePending(p);
}

function unmark(kind, id) {
  const p = readPending();
  delete p[kind][id];
  writePending(p);
}

function onSyncFail(err) {
  if (failToastShown) return;
  failToastShown = true;
  const ui = require('./ui');
  ui.toast('云同步暂不可用,作品已存在本地');
  console.warn('云同步失败', err);
}

/* ---------- 上行 ---------- */

function buildBody(work, summarize) {
  const s = summarize(work);
  const payload = {};
  for (const k in work) {
    if (LOCAL_FIELDS.indexOf(k) < 0) payload[k] = work[k];
  }
  return {
    name: work.name,
    w: work.w,
    h: work.h,
    total: s.total,
    placedN: s.placedN,
    completed: !!work.completed,
    ironDone: !!work.ironDone,
    free: !!work.free,
    completedAt: work.completedAt || 0,
    clientCreatedAt: work.createdAt,
    clientUpdatedAt: work.updatedAt,
    payload: JSON.stringify(payload),
  };
}

function pushNow(id) {
  const { store, summarize } = require('./store');
  const work = store.get(id);
  if (!work) { unmark('push', id); return Promise.resolve(); }
  return api.put('/api/works/' + id, buildBody(work, summarize)).then(r => {
    unmark('push', id);
    // 服务端已有更新版本(其他设备写入)→ 服务端胜出,覆盖本地
    if (r && r.stale && r.work && r.work.payload) applyRemote(r.work);
  });
}

// store 每次非静默写入都会调用:防抖合并连续操作(拼豆中约 600ms 存一次档)
function queuePush(work) {
  mark('push', work.id);
  clearTimeout(timers[work.id]);
  timers[work.id] = setTimeout(() => {
    delete timers[work.id];
    pushNow(work.id).catch(onSyncFail);
  }, PUSH_DEBOUNCE);
}

function queueDelete(id) {
  clearTimeout(timers[id]);
  delete timers[id];
  mark('del', id);
  api.del('/api/works/' + id)
    .then(() => unmark('del', id))
    .catch(onSyncFail);
}

/* ---------- 下行 ---------- */

// 云端完整作品落地本地(payload 即完整作品 JSON;不回环触发推送)
function applyRemote(remoteVO) {
  const { store } = require('./store');
  try {
    const work = JSON.parse(remoteVO.payload);
    if (work && work.id) store.putRemote(work);
  } catch (e) {
    console.warn('云端作品解析失败', remoteVO && remoteVO.clientId, e);
  }
}

// 逐个拉取(串行,避免超出 wx.request 并发上限)
function pullChain(ids, onEach) {
  let chain = Promise.resolve();
  ids.forEach(id => {
    chain = chain.then(() =>
      api.get('/api/works/' + id).then(onEach).catch(() => { /* 单个失败不阻塞其余 */ }));
  });
  return chain;
}

/* ---------- 全量同步(首页 onShow 调用) ---------- */

// 返回 Promise<boolean>:本地作品是否发生变化(供首页决定是否刷新)
function syncAll() {
  const { store } = require('./store');
  let changed = false;

  return api.ensureLogin()
    .then(() => {
      // 先补发上次失败的挂起操作
      const p = readPending();
      const jobs = [];
      Object.keys(p.del).forEach(id => {
        jobs.push(api.del('/api/works/' + id).then(() => unmark('del', id)).catch(() => { /* 留待下次 */ }));
      });
      Object.keys(p.push).forEach(id => {
        jobs.push(pushNow(id).catch(() => { /* 留待下次 */ }));
      });
      return Promise.all(jobs);
    })
    .then(() => api.get('/api/works'))
    .then(r => {
      const remoteWorks = (r && r.works) || [];
      const deletedIds = (r && r.deletedIds) || [];
      const local = store.list();
      const localById = {};
      local.forEach(s => { localById[s.id] = s; });
      const remoteById = {};
      remoteWorks.forEach(w => { remoteById[w.clientId] = w; });
      const pending = readPending();

      // 1. 云端删除墓碑 → 删本地(本地还有未推送修改的除外,交由重推复活)
      deletedIds.forEach(id => {
        if (localById[id] && !pending.push[id]) {
          store.removeLocal(id);
          delete localById[id];
          changed = true;
        }
      });

      // 2. 云端更新 / 本地缺失 → 拉取
      const toPull = remoteWorks
        .filter(w => {
          const loc = localById[w.clientId];
          return !loc || (w.clientUpdatedAt || 0) > (loc.updatedAt || 0);
        })
        .map(w => w.clientId);

      // 3. 本地更新 / 云端缺失 → 推送
      const toPush = local
        .filter(s => {
          if (deletedIds.indexOf(s.id) >= 0) return false;
          const rem = remoteById[s.id];
          return !rem || (s.updatedAt || 0) > (rem.clientUpdatedAt || 0);
        })
        .map(s => s.id);

      return pullChain(toPull, vo => { applyRemote(vo); changed = true; })
        .then(() => {
          let chain = Promise.resolve();
          toPush.forEach(id => {
            chain = chain.then(() => pushNow(id).catch(() => { mark('push', id); }));
          });
          return chain;
        });
    })
    .then(() => changed);
}

module.exports = { queuePush, queueDelete, syncAll };
