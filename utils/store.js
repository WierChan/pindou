// 作品存取：wx storage 持久化
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
  let total = 0;
  for (const t of work.cells) if (t >= 0) total++;
  let placedN = 0;
  for (const p of work.placed) if (p) placedN++;
  return {
    id: work.id, name: work.name, w: work.w, h: work.h,
    total, placedN,
    completed: !!work.completed, ironDone: !!work.ironDone,
    thumb: work.thumb || '',
    thumbV: work.thumbV || 0,
    thumbShape: work.thumbShape || '',
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
      completed: false, ironDone: false, thumb: '',
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    try { wx.setStorageSync(WORK_KEY(work.id), work); }
    catch (e) { console.warn('保存失败（可能空间不足）', e); }
    syncIndex(work);
    return work;
  },
  // quiet=true：静默更新（如缩略图重生成），不刷新 updatedAt，
  // 避免把没有真实活跃的作品顶到首页"进行中"最前面
  update(id, patch, quiet) {
    const work = this.get(id);
    if (!work) return null;
    Object.assign(work, patch);
    if (!quiet) work.updatedAt = Date.now();
    try { wx.setStorageSync(WORK_KEY(id), work); }
    catch (e) { console.warn('保存失败（可能空间不足）', e); }
    syncIndex(work);
    return work;
  },
  remove(id) {
    const work = this.get(id);
    // 顺手清掉持久化的缩略图文件
    if (work && work.thumb && wx.env && work.thumb.indexOf(wx.env.USER_DATA_PATH) === 0) {
      try { wx.getFileSystemManager().unlinkSync(work.thumb); } catch (e) { /* 忽略 */ }
    }
    try { wx.removeStorageSync(WORK_KEY(id)); } catch (e) { /* 忽略 */ }
    writeIndex(readIndex().filter(x => x.id !== id));
  },
};

module.exports = { store };
