// 内置图案库：字符画定义，'.' 为留空
const { nearestPalette } = require('./convert');
const { hexToRgb } = require('./palette');

const C = {
  R: '#E02B26', // 大红
  P: '#FF9EC2', // 粉
  W: '#FFFFFF', // 白
  Y: '#FFC913', // 明黄
  G: '#4CAF50', // 草绿
  N: '#E2C298', // 沙色
  K: '#22252A', // 黑
};

const TEMPLATES = [
  {
    name: '爱心',
    rows: [
      '..RR...RR..',
      '.RRRR.RRRR.',
      'RRPRRRRRRRR',
      'RRRRRRRRRRR',
      '.RRRRRRRRR.',
      '..RRRRRRR..',
      '...RRRRR...',
      '....RRR....',
      '.....R.....',
    ],
  },
  {
    name: '小星星',
    rows: [
      '.....Y.....',
      '....YYY....',
      '....YYY....',
      'YYYYYYYYYYY',
      '.YYYYYYYYY.',
      '..YYYYYYY..',
      '..YYYYYYY..',
      '.YYYY.YYYY.',
      '.YY.....YY.',
    ],
  },
  {
    name: '樱桃',
    rows: [
      '.....GG....',
      '....G..G...',
      '...G....G..',
      '...G....G..',
      '.RRR...RRR.',
      'RRRRR.RRRRR',
      'RWRRR.RWRRR',
      'RRRRR.RRRRR',
      '.RRR...RRR.',
    ],
  },
  {
    name: '小蘑菇',
    rows: [
      '...RRRRRR...',
      '..RRRWWRRR..',
      '.RRRRWWRRRR.',
      'RRWWRRRRWWRR',
      'RRWWRRRRWWRR',
      'RRRRRRRRRRRR',
      '..NNNNNNNN..',
      '...NNNNNN...',
      '...NNNNNN...',
      '...NNNNNN...',
      '..NNNNNNNN..',
    ],
  },
  {
    name: '笑脸',
    rows: [
      '...YYYY...',
      '.YYYYYYYY.',
      '.YYYYYYYY.',
      'YYKYYYYKYY',
      'YPYYYYYYPY',
      'YYKYYYYKYY',
      'YYYKKKKYYY',
      '.YYYYYYYY.',
      '.YYYYYYYY.',
      '...YYYY...',
    ],
  },
];

// 把字符画编译成图纸 {w, h, cells}
function templatePattern(t) {
  const h = t.rows.length, w = t.rows[0].length;
  const cache = {};
  const cells = [];
  for (const row of t.rows) {
    for (const ch of row) {
      if (ch === '.') { cells.push(-1); continue; }
      if (cache[ch] == null) {
        const rgb = hexToRgb(C[ch]);
        cache[ch] = nearestPalette(rgb[0], rgb[1], rgb[2]);
      }
      cells.push(cache[ch]);
    }
  }
  return { w, h, cells };
}

module.exports = { TEMPLATES, templatePattern };
