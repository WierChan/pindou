// 像素 UI 图标生成器：node tools/gen-icons.js
// 12×12 手绘网格 → 10 倍放大 → assets/icons/*.png（RGBA，透明底）。
// 动机：UI 里的系统 emoji 在 iOS/安卓渲染成两套完全不同的苹果/厂商图标，
// 与全站像素风（CSS 像素画吉祥物/遮阳棚/分享卡）不搭 —— 全部换成自绘像素图标。
// 改图标：改下面的网格字符画重跑本脚本即可；tools/ 目录已排除出小程序包。
// 网格约定：每行必须恰好 12 字符（脚本会校验），'.' = 透明，其余字符查 COLORS。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- 最小 PNG 写入器（RGBA8 + zlib，无外部依赖） ---------- */
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function writePng(file, w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

/* ---------- 调色（与 app.wxss / 分享卡同源的 UI 色） ---------- */
const COLORS = {
  K: '5F4A4E', // 靛墨描边（全站描边色）
  W: 'FFFFFF', // 白 / 高光点
  // 金黄系（亮/基/暗）：奖杯、钥匙、铅笔、导出、篮子编织
  g: 'FFDD7A', G: 'FFB938', b: 'D98F2B',
  // 明黄系（亮/基）：星星、闪电、星光、火焰内芯、太阳
  y: 'FFED8F', Y: 'FFD03A',
  // 粉系（亮/基/暗）：相机、橡皮、腮红、声波
  p: 'FFD1DE', P: 'FF9CB8', d: 'E06084',
  // 天蓝系（亮/基/暗）：喇叭、镜头、天空、图纸豆
  s: 'AEDCFF', S: '57B1F5', c: '2F7FD1',
  // 绿系（亮/基/暗）：对勾、山丘、图纸豆
  e: '9FE08A', E: '5CC454', f: '3E9142',
  O: 'FF7A2E', // 橙（火焰外层）
  // 肤色（亮/暗）：手
  N: 'F7DFC2', n: 'DDB78E',
  // 棕系（亮/基/暗）：小熊、篮子
  h: 'D9A869', B: 'A8713C', m: '82552B',
  // 灰（亮/暗）：垃圾桶、图纸格线、瓷面阴影
  R: 'CDD3D8', r: '9BA3AB',
};

const SCALE = 10; // 12×12 → 120×120，页面上按 13-20px 显示

/* ---------- 图标网格（12×12 字符画，三调着色：亮面/基色/暗面 + 高光点） ---------- */
const ICONS = {
  // 首页 tab：进行中（粉格布盖着的编织篮）
  basket: [
    '....KKKK....',
    '...K....K...',
    '..K......K..',
    '.KKKKKKKKKK.',
    '.KpPpPpPpPK.',
    '.KhGhGhGhGK.',
    '.KGhGhGhGhK.',
    '..KhGhGhGK..',
    '..KmmmmmmK..',
    '...KKKKKK...',
    '............',
    '............',
  ],
  // 首页 tab：已完成（金奖杯 + 高光）
  trophy: [
    '............',
    '.KKKKKKKKKK.',
    '.KgGGGGGGbK.',
    '.KgWGGGGGbK.',
    'KKgGGGGGGbKK',
    'K.KgGGGGbK.K',
    'KK.KgGGbK.KK',
    '....KGbK....',
    '.....KK.....',
    '....KGbK....',
    '...KgGGbK...',
    '..KKKKKKKK..',
  ],
  // 熨烫（火焰）
  flame: [
    '.....K......',
    '....KOK.....',
    '....KOK.....',
    '...KOOOK....',
    '...KOYOK....',
    '..KOYYOOK...',
    '.KOYYYYOOK..',
    '.KOYWWYYOK..',
    'KOYYWWYYOOK.',
    'KOYYYYYYOOK.',
    '.KOYYYYOOK..',
    '..KKKKKKK...',
  ],
  // 自由画布（粉头铅笔）
  pencil: [
    '........KK..',
    '.......KppK.',
    '......KgGbK.',
    '.....KgGbK..',
    '....KgGbK...',
    '...KgGbK....',
    '..KgGbK.....',
    '.KNngK......',
    '.KNnK.......',
    'KKNK........',
    'KKK.........',
    '............',
  ],
  // 导入码（金钥匙 + 高光）
  key: [
    '............',
    '..KKKK......',
    '.KgWGbK.....',
    '.KgKKbK.....',
    '.KgKKbK.....',
    '.KgGGbK.....',
    '..KGbK......',
    '...KGbK.....',
    '...KGbKKK...',
    '...KGbK.K...',
    '...KGbKKK...',
    '...KKKK.....',
  ],
  // 创建 tab：图片（粉机身 + 天蓝镜头）
  camera: [
    '............',
    '...KKK......',
    '.KKKKKKKKKK.',
    '.KpppppppdK.',
    '.KpPKKKKPdK.',
    '.KpKWssSKdK.',
    '.KpKsSScKdK.',
    '.KpKSSccKdK.',
    '.KpPKKKKPdK.',
    '.KpdddddddK.',
    '.KKKKKKKKKK.',
    '............',
  ],
  // 创建 tab：图案库（小熊：粉耳心 + 亮额头 + 腮红）
  bear: [
    '............',
    '.KKK....KKK.',
    'KBpBK..KBpBK',
    'KBBBKKKKBBBK',
    '.KhhhhhhhhK.',
    'KBhhhhhhhhBK',
    'KBBKBBBBKBBK',
    'KBpBWWWWBpBK',
    '.KBBWKKWBBK.',
    '..KBWWWWBK..',
    '...KBBBBK...',
    '....KKKK....',
  ],
  // 选择图片卡（金相框晴天风景：太阳/云/山丘）
  picture: [
    '............',
    'KKKKKKKKKKKK',
    'KgggggggggbK',
    'KgssssssYYbK',
    'KgsWWsssYYbK',
    'KgssssssssbK',
    'KgsseEesssbK',
    'KgeEEEEEesbK',
    'KgEEfEEfEEbK',
    'KbbbbbbbbbbK',
    'KKKKKKKKKKKK',
    '............',
  ],
  // 导入图纸卡（白图纸 + 彩色豆块 + 浅灰格线）
  chart: [
    '............',
    '.KKKKKKKKKK.',
    '.KPPrWWrSSK.',
    '.KPPrWWrSSK.',
    '.KrrrrrrrrK.',
    '.KWWrEErWWK.',
    '.KWWrEErWWK.',
    '.KrrrrrrrrK.',
    '.KYYrWWrPPK.',
    '.KYYrWWrPPK.',
    '.KKKKKKKKKK.',
    '............',
  ],
  // 新手友好（星星 + 高光）
  star: [
    '.....KK.....',
    '....KyYK....',
    '....KyYK....',
    '.KKKKyYKKKK.',
    'KyyyyWYYYYbK',
    '.KyyyYYYYbK.',
    '..KyYYYYbK..',
    '..KyYYYYbK..',
    '.KyYYKKYYbK.',
    '.KyYK..KYbK.',
    '.KKK....KKK.',
    '............',
  ],
  // 音效开（天蓝喇叭 + 粉声波）
  sndon: [
    '............',
    '....KK......',
    '....KsK.....',
    '.KKKKsK..d..',
    '.KsSScK.d.d.',
    '.KsSScK.d.d.',
    '.KsSScK.d.d.',
    '.KsSScK.d.d.',
    '.KKKKsK..d..',
    '....KsK.....',
    '....KK......',
    '............',
  ],
  // 音效关（天蓝喇叭 + 粉 ×）
  sndoff: [
    '............',
    '....KK......',
    '....KsK.....',
    '.KKKKsK.....',
    '.KsSScK.d.d.',
    '.KsSScK..d..',
    '.KsSScK..d..',
    '.KsSScK.d.d.',
    '.KKKKsK.....',
    '....KsK.....',
    '....KK......',
    '............',
  ],
  // BGM 开（粉色八分音符：右侧带旗，左下圆头）
  musicon: [
    '......KPK...',
    '......KpPK..',
    '......KPPPK.',
    '......KPPK..',
    '......KPK...',
    '......KPK...',
    '......KPK...',
    '....KKKPK...',
    '..KpPPPPK...',
    '.KpPPPPPK...',
    '.KPPPPdK....',
    '..KKKKK.....',
  ],
  // BGM 关（灰掉的八分音符）
  musicoff: [
    '......KRK...',
    '......KrRK..',
    '......KRRRK.',
    '......KRRK..',
    '......KRK...',
    '......KRK...',
    '......KRK...',
    '....KKKRK...',
    '..KrRRRRK...',
    '.KrRRRRRK...',
    '.KRRRRrK....',
    '..KKKKK.....',
  ],
  // 设置（白齿轮，8 齿 + 中心镂空的纯色剪影；配深玫瑰按钮底，透出底色即孔）
  gear: [
    '............',
    '.....WW.....',
    '..W..WW..W..',
    '...WWWWWW...',
    '...WW..WW...',
    '.WWW....WWW.',
    '.WWW....WWW.',
    '...WW..WW...',
    '...WWWWWW...',
    '..W..WW..W..',
    '.....WW.....',
    '............',
  ],
  // 整排拼豆 / 调试（闪电）
  bolt: [
    '............',
    '.....KKKK...',
    '....KyYYK...',
    '...KyYYK....',
    '..KyYYK.....',
    '.KyYYYKKKK..',
    '.KKYYYYYbK..',
    '...KKYYbK...',
    '.....KYbK...',
    '....KYbK....',
    '....KbK.....',
    '....KK......',
  ],
  // 连续上豆（手掌）
  hand: [
    '............',
    '...KK.KK....',
    '..KNNKNNK...',
    '..KNNKNNKKK.',
    '..KNNNNNKNK.',
    '.KKNNNNNNnK.',
    'KNKNNNNNNnK.',
    'KNNNNNNNnK..',
    '.KNNNNNnnK..',
    '..KnnnnnK...',
    '...KKKKK....',
    '............',
  ],
  // 细腻纹理 / 大功告成（四角星光）
  sparkle: [
    '.....K......',
    '....KyK.....',
    '....KyK.....',
    '...KyYYK....',
    '.KKyYYYYKK..',
    'KyyYYWYYYYK.',
    '.KKYYYYbKK..',
    '...KYYbK....',
    '....KbK.....',
    '....KbK.....',
    '.....K......',
    '............',
  ],
  // 光滑平面（白瓷面 + 天蓝斜高光 + 右下阴影）
  smooth: [
    '............',
    '.KKKKKKKKKK.',
    '.KWWWWWWsWK.',
    '.KWWWWWsWWK.',
    '.KWWWWsWWWK.',
    '.KWWWsWWWWK.',
    '.KWWsWWWWWK.',
    '.KWsWWWWWRK.',
    '.KWWWWWWRRK.',
    '.KKKKKKKKKK.',
    '............',
    '............',
  ],
  // 橡皮（粉白两段）
  eraser: [
    '............',
    '..KKKKKKKK..',
    '.KpPPPPPPdK.',
    '.KPPPPPPPdK.',
    '.KPPPPPPPdK.',
    '.KWWWWWWWRK.',
    '.KWWWWWWWRK.',
    '..KKKKKKKK..',
    '............',
    '............',
    '............',
    '............',
  ],
  // 导出（金箭头 + 托盘）
  export: [
    '.....KK.....',
    '....KgGK....',
    '...KgGGbK...',
    '..KgGGGGbK..',
    '..KKKgbKKK..',
    '....KgbK....',
    '....KgbK....',
    '....KKKK....',
    '.KK......KK.',
    '.K........K.',
    '.KKKKKKKKKK.',
    '............',
  ],
  // 完成创作（绿对勾）
  check: [
    '............',
    '..........K.',
    '.........KeK',
    '........KeEK',
    '.K......KEEK',
    '.KeK...KEEK.',
    '.KeEK.KEEK..',
    '..KEEKEEK...',
    '...KEEEK....',
    '....KEfK....',
    '.....K......',
    '............',
  ],
  // 删除（灰垃圾桶）
  trash: [
    '....KKKK....',
    '.KKKKKKKKKK.',
    '..KRRRRRRK..',
    '..KRrRRrRK..',
    '..KRrRRrRK..',
    '..KRrRRrRK..',
    '..KRrRRrRK..',
    '..KRrRRrRK..',
    '..KrrrrrrK..',
    '...KKKKKK...',
    '............',
    '............',
  ],
};

/* ---------- 渲染 ---------- */
const outDir = path.join(__dirname, '..', 'assets', 'icons');
fs.mkdirSync(outDir, { recursive: true });
let total = 0;
for (const [name, rows] of Object.entries(ICONS)) {
  if (rows.length !== 12) throw new Error(name + ': 需要 12 行，实际 ' + rows.length);
  rows.forEach((r, i) => {
    if (r.length !== 12) throw new Error(name + ' 第 ' + i + ' 行长度 ' + r.length + '（应为 12）：' + r);
  });
  const S = 12 * SCALE;
  const rgba = Buffer.alloc(S * S * 4);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      const hex = COLORS[ch];
      if (!hex) throw new Error(name + ': 未知颜色字符 ' + ch);
      const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const o = ((y * SCALE + dy) * S + x * SCALE + dx) * 4;
          rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
        }
      }
    }
  }
  const file = path.join(outDir, name + '.png');
  writePng(file, S, S, rgba);
  total += fs.statSync(file).size;
  console.log(name + '.png', fs.statSync(file).size + 'B');
}
console.log('共 ' + Object.keys(ICONS).length + ' 个图标, ' + (total / 1024).toFixed(1) + 'KB');
