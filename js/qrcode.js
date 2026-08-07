// 极简二维码生成器：Byte 模式，纠错等级 M，版本 1-3（放短链接足够），掩码固定 0
// 无任何外部依赖，返回 {size, m}，m[y][x] ∈ 0/1

const EC_PARAMS = { 1: { total: 26, data: 16 }, 2: { total: 44, data: 28 }, 3: { total: 70, data: 44 } };

export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  let ver = 0;
  for (const v of [1, 2, 3]) {
    if (bytes.length <= EC_PARAMS[v].data - 2) { ver = v; break; }
  }
  if (!ver) throw new Error('二维码内容过长');
  const { total, data } = EC_PARAMS[ver];
  const ecLen = total - data;

  /* ---- 数据比特流 ---- */
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);            // Byte 模式
  push(bytes.length, 8);      // 长度（版本1-9为8位）
  for (const b of bytes) push(b, 8);
  const cap = data * 8;
  push(0, Math.min(4, cap - bits.length)); // 终止符
  while (bits.length % 8) bits.push(0);
  let pi = 0;
  while (bits.length < cap) { push([0xEC, 0x11][pi % 2], 8); pi++; }
  const dataCw = [];
  for (let i = 0; i < cap; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataCw.push(b);
  }

  /* ---- GF(256) Reed-Solomon 纠错 ---- */
  const EXP = new Array(512), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const gmul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const c = EXP[i], ng = [];
    for (let k = 0; k <= gen.length; k++) {
      ng[k] = (k < gen.length ? gen[k] : 0) ^ (k > 0 ? gmul(gen[k - 1], c) : 0);
    }
    gen = ng;
  }
  const msg = dataCw.concat(new Array(ecLen).fill(0));
  for (let i = 0; i < dataCw.length; i++) {
    const f = msg[i];
    if (!f) continue;
    for (let j = 1; j < gen.length; j++) msg[i + j] ^= gmul(gen[j], f);
  }
  const all = dataCw.concat(msg.slice(dataCw.length));

  /* ---- 铺矩阵 ---- */
  const size = 17 + 4 * ver;
  const m = Array.from({ length: size }, () => new Array(size).fill(0));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setF = (x, y, v) => { m[y][x] = v; fn[y][x] = true; };

  const finder = (fx, fy) => {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const x = fx + dx, y = fy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const inC = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const on = inC && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setF(x, y, on ? 1 : 0);
    }
  };
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
  for (let i = 8; i < size - 8; i++) {
    if (!fn[6][i]) setF(i, 6, i % 2 === 0 ? 1 : 0);
    if (!fn[i][6]) setF(6, i, i % 2 === 0 ? 1 : 0);
  }
  if (ver >= 2) { // 对齐图案
    const c = ver === 2 ? 18 : 22;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      setF(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? 1 : 0);
    }
  }
  setF(8, size - 8, 1); // 暗模块

  // 格式信息位置（两份），fmtCells[idx] 放第 14-idx 位
  const fmtCells = [];
  for (let i = 0; i <= 5; i++) fmtCells.push([i, 8]);
  fmtCells.push([7, 8], [8, 8], [8, 7]);
  for (let i = 5; i >= 0; i--) fmtCells.push([8, i]);
  const fmtCells2 = [];
  for (let i = 0; i < 7; i++) fmtCells2.push([8, size - 1 - i]);
  for (let i = 0; i < 8; i++) fmtCells2.push([size - 8 + i, 8]);
  for (const [x, y] of fmtCells.concat(fmtCells2)) fn[y][x] = true;

  // 之字形铺数据，掩码0：(y+x)%2==0 翻转
  const totalBits = all.length * 8;
  const bitAt = k => k < totalBits ? (all[k >> 3] >> (7 - (k & 7))) & 1 : 0;
  let bi = 0, up = true;
  for (let x = size - 1; x > 0; x -= 2) {
    if (x === 6) x--;
    for (let k = 0; k < size; k++) {
      const y = up ? size - 1 - k : k;
      for (const xx of [x, x - 1]) {
        if (fn[y][xx]) continue;
        let b = bitAt(bi++);
        if ((y + xx) % 2 === 0) b ^= 1;
        m[y][xx] = b;
      }
    }
    up = !up;
  }

  // 格式信息：纠错M(00) + 掩码0(000) → BCH + 固定异或
  const data5 = 0;
  let f = data5 << 10;
  for (let i = 14; i >= 10; i--) if ((f >> i) & 1) f ^= 0x537 << (i - 10);
  const fmt = ((data5 << 10) | f) ^ 0x5412;
  fmtCells.forEach(([x, y], idx) => { m[y][x] = (fmt >> (14 - idx)) & 1; });
  fmtCells2.forEach(([x, y], idx) => { m[y][x] = (fmt >> (14 - idx)) & 1; });

  return { size, m };
}

// 把二维码画到 ctx，(x,y) 为左上角，px 为单模块像素
export function drawQR(ctx, mat, x, y, px, dark = '#3D3630') {
  ctx.fillStyle = dark;
  for (let r = 0; r < mat.size; r++) {
    for (let c = 0; c < mat.size; c++) {
      if (mat.m[r][c]) ctx.fillRect(x + c * px, y + r * px, px, px);
    }
  }
}
