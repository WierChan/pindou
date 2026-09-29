// 烫法纹理 LOD 小样（tests 不进包）：把 palette.js + board.js 打进一个 HTML，在「豆很小」的缩放下渲染全部烫法，
// 每种取一块放大 3 倍（物理像素直出）并排比较。用法：node tests/finish-lod.js → 用任意静态服务打开 tests/finish-lod.html
// （file:// 直开也行）。改 board.js 的贴片/闪粉/LOD 后跑一遍，看 10 种烫法在 100 格图上是否仍能一眼区分。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2] || path.join(__dirname, 'finish-lod.html');
const label = process.argv[3] || '烫法纹理 LOD 小样 · 每块为 3 倍放大的物理像素';
const pal = fs.readFileSync(path.join(root, 'utils/palette.js'), 'utf8');
const board = fs.readFileSync(path.join(root, 'utils/board.js'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><title>finish LOD ${label}</title>
<style>body{margin:0;padding:12px;background:#faf6ef;font:12px system-ui}h1{font-size:14px;margin:0 0 8px}.row{display:flex;gap:10px;flex-wrap:wrap}.c{display:flex;flex-direction:column;align-items:center;gap:4px}canvas{image-rendering:auto;border:1px solid #ccc}</style></head><body>
<h1>${label}</h1><div id="rows"></div>
<script>
const wx = { getStorageSync(){ return ''; }, setStorageSync(){} };
const modules = {};
function define(name, src){ const module = { exports: {} }; const require = n => modules[n.replace('./','')]; new Function('module','exports','require','wx', src)(module, module.exports, require, wx); modules[name] = module.exports; }
define('palette', ${JSON.stringify(pal)});
define('board', ${JSON.stringify(board)});
const B = modules.board;
// 造一张 100×100 的“照片感”图纸：柔和渐变 + 噪声，取色板里的多色
const W = 100, H = 100;
const PAL = modules.palette.PALETTE;
const cells = new Array(W*H);
let s = 7;
const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
for (let y=0;y<H;y++) for (let x=0;x<W;x++){
  const cx = x-50, cy = y-50, r = Math.hypot(cx,cy);
  let idx;
  if (r < 30) idx = 10 + ((x*3+y*5)%6);            // 中间一块“脸”
  else if (r < 42) idx = 40 + ((x+y)%4);           // 一圈“衣服”
  else idx = (x%7===0||y%7===0) ? 1 : 60 + ((x*y)%9); // 背景
  if (rnd() < 0.08) idx = (idx + 17) % PAL.length;
  cells[y*W+x] = idx % PAL.length;
}
const pat = { w: W, h: H, cells };
const finishes = Object.keys(B.FINISHES);
const rows = document.getElementById('rows');
function row(cellPx, scale, title, crop){
  const h = document.createElement('div'); h.textContent = title; h.style.margin='10px 0 4px'; h.style.fontWeight='700'; rows.appendChild(h);
  const r = document.createElement('div'); r.className='row'; rows.appendChild(r);
  const MAG = 3, R = crop || 40; // 取 R×R 逻辑px 区域放大 MAG 倍（物理像素直出）
  finishes.forEach(f => {
    const c = document.createElement('div'); c.className='c';
    const full = document.createElement('canvas');
    const t0 = performance.now();
    B.renderPatternTo(full, pat, { cellPx, pad: 4, fused: true, finish: f, hole: 'none', scale });
    const ms = (performance.now() - t0).toFixed(1);
    const cv = document.createElement('canvas'); cv.width = R*scale*MAG; cv.height = R*scale*MAG;
    const c2 = cv.getContext('2d'); c2.imageSmoothingEnabled = false;
    // 取图中偏左上一块：横跨背景格、蓝环、脸三种区域（约 (18..58) 格）
    const sx = (4 + 18*cellPx)*scale, sy = (4 + 18*cellPx)*scale;
    c2.drawImage(full, sx, sy, R*scale, R*scale, 0, 0, cv.width, cv.height);
    cv.style.width = '180px'; cv.style.height = '180px'; cv.style.imageRendering = 'pixelated';
    const l = document.createElement('div'); l.textContent = B.FINISHES[f].name + ' (' + f + ') ' + ms + 'ms';
    c.appendChild(cv); c.appendChild(l); r.appendChild(c);
  });
}
// 交互画板（查看页 pages/view 用的就是这条路径）：380×380 逻辑视口、dpr2，fit 后每格 ≈3.28 逻辑px
function bvRow(title){
  const h = document.createElement('div'); h.textContent = title; h.style.margin='10px 0 4px'; h.style.fontWeight='700'; rows.appendChild(h);
  const r = document.createElement('div'); r.className='row'; rows.appendChild(r);
  const MAG = 3, R = 40, dpr = 2;
  finishes.forEach(f => {
    const c = document.createElement('div'); c.className='c';
    const full = document.createElement('canvas');
    const bv = new B.BoardView(full, { w: W, h: H, cells, placed: new Array(W*H).fill(1), mode: 'view', fused: true, finish: f, hole: 'none', chart: false });
    bv.setViewport(380, 380, dpr, 0, 0);
    const cv = document.createElement('canvas'); cv.width = R*dpr*MAG; cv.height = R*dpr*MAG;
    cv.style.width = '180px'; cv.style.height = '180px'; cv.style.imageRendering = 'pixelated';
    const l = document.createElement('div'); l.textContent = B.FINISHES[f].name + ' (' + f + ') BoardView s=' + bv.scale.toFixed(2);
    c.appendChild(cv); c.appendChild(l); r.appendChild(c);
    setTimeout(() => { // 等渲染循环画过一帧再取块
      const c2 = cv.getContext('2d'); c2.imageSmoothingEnabled = false;
      const s = bv.scale, sx = (bv.ox + 18*s)*dpr, sy = (bv.oy + 18*s)*dpr;
      c2.drawImage(full, sx, sy, R*dpr, R*dpr, 0, 0, cv.width, cv.height);
      bv.destroy();
    }, 400);
  });
}
bvRow('BoardView（查看页路径）· 100 格 · fit 到 380 逻辑px 视口 · dpr2');
row(3.8, 2, '100 格 · 每格 3.8 逻辑px · dpr2（用户截图的情形）→ LOD m=2', 40);
row(1.5, 3, '100 格 · 每格 1.5 逻辑px · dpr3（256 格上限的格子大小）→ LOD m=2', 30);
row(8, 2, '每格 8 逻辑px · dpr2（原本就铺，m=1，应与改前一致）', 40);
</script></body></html>`;
fs.writeFileSync(out, html);
console.log('wrote', out);
