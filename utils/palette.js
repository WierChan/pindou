// 拼豆色板：38 色，参考常见品牌豆子配色
const PALETTE = [
  { name: '纯白', hex: '#FFFFFF' },
  { name: '米白', hex: '#F2E8D8' },
  { name: '浅灰', hex: '#C8CDD2' },
  { name: '灰', hex: '#8A9097' },
  { name: '深灰', hex: '#4E555E' },
  { name: '黑', hex: '#22252A' },
  { name: '深棕', hex: '#54382A' },
  { name: '棕', hex: '#7C5236' },
  { name: '浅棕', hex: '#B9835A' },
  { name: '沙色', hex: '#E2C298' },
  { name: '肤色', hex: '#FFD9B5' },
  { name: '奶黄', hex: '#FFEBA8' },
  { name: '柠檬黄', hex: '#FFE14D' },
  { name: '明黄', hex: '#FFC913' },
  { name: '橘黄', hex: '#FFA028' },
  { name: '橙', hex: '#FF7F2A' },
  { name: '珊瑚', hex: '#FF7D66' },
  { name: '西瓜红', hex: '#FF4D45' },
  { name: '大红', hex: '#E02B26' },
  { name: '深红', hex: '#9E1B22' },
  { name: '酒红', hex: '#6E1F2E' },
  { name: '玫红', hex: '#E64789' },
  { name: '粉', hex: '#FF9EC2' },
  { name: '樱花粉', hex: '#FFC9DC' },
  { name: '紫红', hex: '#A93A8C' },
  { name: '紫', hex: '#8455C8' },
  { name: '薰衣草', hex: '#C3A2E6' },
  { name: '深紫', hex: '#563585' },
  { name: '藏青', hex: '#2B3A66' },
  { name: '蓝', hex: '#2F6BD0' },
  { name: '天蓝', hex: '#57ACE8' },
  { name: '浅蓝', hex: '#A9D4F0' },
  { name: '青', hex: '#2FB5B0' },
  { name: '薄荷', hex: '#8EE0BE' },
  { name: '浅绿', hex: '#A5D86E' },
  { name: '草绿', hex: '#4CAF50' },
  { name: '深绿', hex: '#1E7A44' },
  { name: '橄榄', hex: '#8A8F3C' },
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const PALETTE_RGB = PALETTE.map(p => hexToRgb(p.hex));

function relLum(rgb) {
  const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

// 在某个色块上放文字时该用深字还是浅字
function textColorFor(hex) {
  return relLum(hexToRgb(hex)) > 0.45 ? 'rgba(45,35,28,.85)' : 'rgba(255,255,255,.95)';
}

module.exports = { PALETTE, PALETTE_RGB, hexToRgb, relLum, textColorFor };
