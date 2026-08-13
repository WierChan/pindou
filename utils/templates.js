// 图案库:数据(名称/字符画/配色)来自后端 /api/templates,本地只负责编译成图纸
const api = require('./api');
const { nearestPalette } = require('./convert');
const { hexToRgb } = require('./palette');

let cache = null; // 会话级缓存

function fetchTemplates() {
  if (cache) return Promise.resolve(cache);
  return api.get('/api/templates').then(list => {
    cache = Array.isArray(list) ? list : [];
    return cache;
  });
}

// 把字符画编译成图纸 {w, h, cells},'.' 为留空;colors 为该图案的 字符→颜色 映射
function templatePattern(t) {
  const h = t.rows.length, w = t.rows[0].length;
  const palOf = {};
  const cells = [];
  for (const row of t.rows) {
    for (const ch of row) {
      if (ch === '.') { cells.push(-1); continue; }
      if (palOf[ch] == null) {
        const rgb = hexToRgb((t.colors && t.colors[ch]) || '#000000');
        palOf[ch] = nearestPalette(rgb[0], rgb[1], rgb[2]);
      }
      cells.push(palOf[ch]);
    }
  }
  return { w, h, cells };
}

module.exports = { fetchTemplates, templatePattern };
