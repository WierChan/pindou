// 作品存取：localStorage 持久化
const KEY = 'pindou.works.v1';

function loadAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn('读取存档失败', e); }
  return { works: [] };
}

let db = loadAll();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    console.warn('保存失败（可能空间不足）', e);
  }
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export const store = {
  list() { return db.works.slice().sort((a, b) => b.updatedAt - a.updatedAt); },
  get(id) { return db.works.find(x => x.id === id) || null; },
  create({ name, w, h, cells }) {
    const work = {
      id: genId(), name, w, h, cells,
      placed: new Array(cells.length).fill(0),
      completed: false, thumb: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    db.works.push(work);
    persist();
    return work;
  },
  update(id, patch) {
    const work = this.get(id);
    if (!work) return null;
    Object.assign(work, patch, { updatedAt: Date.now() });
    persist();
    return work;
  },
  remove(id) {
    db.works = db.works.filter(x => x.id !== id);
    persist();
  },
};
