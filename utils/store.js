// 作品存取：wx storage 持久化，云同步在写入口挂钩
// 索引（摘要列表）与每幅作品分 key 存放，避免单 key 1MB 上限
const INDEX_KEY = 'pindou.works.index.v1';
const WORK_KEY = id => 'pindou.work.' + id;

function readIndex() {
  try {
    const v = wx.getStorageSync(INDEX_KEY);
    if (Array.isArray(v)) return v;
  } catch (e) { console.warn('读取存档索引失败', e); }
  return [];
}

function writeIndex(list) {
  try { wx.setStorageSync(INDEX_KEY, list); }
  catch (e) { console.warn('保存索引失败', e); }
}

function summarize(work) {
  let total = 0, placedN = 0;
  if (work.free && !work.completed && Array.isArray(work.freeBeads)) {
    // 进行中的自由画布只存稀疏豆表，数量直接取表长
    total = placedN = work.freeBeads.length;
  } else {
    for (const t of work.cells) if (t >= 0) total++;
    for (const p of work.placed) if (p) placedN++;
  }
  return {
    id: work.id, name: work.name, w: work.w, h: work.h,
    total, placedN,
    free: !!work.free,
    completed: !!work.completed, ironDone: !!work.ironDone,
    thumb: work.thumb || '',
    thumbV: work.thumbV || 0,
    thumbShape: work.thumbShape || '',
    thumbBeads: work.thumbBeads || 0, // 自由画布：生成缩略图时的豆子数（过期判断用）
    createdAt: work.createdAt, updatedAt: work.updatedAt,
    completedAt: work.completedAt || 0,
  };
}

function syncIndex(work) {
  const list = readIndex();
  const i = list.findIndex(x => x.id === work.id);
  const s = summarize(work);
  if (i >= 0) list[i] = s; else list.push(s);
  writeIndex(list);
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// 云同步钩子：store 是所有作品写入的必经之路，在这里挂推送/删除。
// 惰性 require 避免 store ↔ sync 循环依赖；云端失败不影响本地。
function cloud() {
  try { return require('./sync'); } catch (e) { return null; }
}

const store = {
  // 摘要列表（首页用），按更新时间倒序
  list() {
    return readIndex().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  },
  get(id) {
    try {
      const w = wx.getStorageSync(WORK_KEY(id));
      if (w && w.id) return w;
    } catch (e) { console.warn('读取作品失败', e); }
    return null;
  },
  create(o) {
    const work = {
      id: genId(), name: o.name, w: o.w, h: o.h, cells: o.cells,
      placed: new Array(o.cells.length).fill(0),
      free: !!o.free, // 自由画布模式：cells 即用户作品本身，可随意增改
      completed: false, ironDone: false, thumb: '',
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    // 作品自带色板（图纸导入的真实颜色，hex 数组）；没有则各处回退全局色板
    if (o.palette) work.palette = o.palette;
    try { wx.setStorageSync(WORK_KEY(work.id), work); }
    catch (e) { console.warn('保存失败（可能空间不足）', e); }
    syncIndex(work);
    const c = cloud();
    if (c) c.queuePush(work);
    return work;
  },
  // quiet=true：静默更新（如缩略图重生成），不刷新 updatedAt，
  // 避免把没有真实活跃的作品顶到首页"进行中"最前面；
  // 缩略图等本地字段的静默更新也不触发云同步
  update(id, patch, quiet) {
    const work = this.get(id);
    if (!work) return null;
    Object.assign(work, patch);
    if (!quiet) work.updatedAt = Date.now();
    try { wx.setStorageSync(WORK_KEY(id), work); }
    catch (e) { console.warn('保存失败（可能空间不足）', e); }
    syncIndex(work);
    if (!quiet) {
      const c = cloud();
      if (c) c.queuePush(work);
    }
    return work;
  },
  remove(id) {
    this.removeLocal(id);
    const c = cloud();
    if (c) c.queueDelete(id);
  },
  // 仅删本地（云端下发删除墓碑时用，不回环触发云删除）
  removeLocal(id) {
    const work = this.get(id);
    // 顺手清掉持久化的缩略图文件
    if (work && work.thumb && wx.env && work.thumb.indexOf(wx.env.USER_DATA_PATH) === 0) {
      try { wx.getFileSystemManager().unlinkSync(work.thumb); } catch (e) { /* 忽略 */ }
    }
    try { wx.removeStorageSync(WORK_KEY(id)); } catch (e) { /* 忽略 */ }
    writeIndex(readIndex().filter(x => x.id !== id));
  },
  // 云端版本落地（服务端胜出时覆盖本地；不触发推送回环）
  putRemote(work) {
    if (!work || !work.id) return;
    try { wx.setStorageSync(WORK_KEY(work.id), work); }
    catch (e) { console.warn('保存失败（可能空间不足）', e); }
    syncIndex(work);
  },
};

module.exports = { store, summarize };
