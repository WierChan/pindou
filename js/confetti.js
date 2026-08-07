// 完成时的撒花庆祝
export function celebrate(colors = ['#FF7D66', '#FFC913', '#4CAF50', '#57ACE8', '#E64789', '#8455C8']) {
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:999;';
  document.body.appendChild(cv);
  const dpr = window.devicePixelRatio || 1;
  const W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);

  const parts = [];
  const mk = (x, y, vx, vy) => ({
    x, y, vx, vy,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.3,
    w: 5 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    color: colors[(Math.random() * colors.length) | 0],
    round: Math.random() < 0.35,
  });
  // 两侧礼炮
  for (let i = 0; i < 60; i++) {
    const a = -Math.PI / 3 + (Math.random() - 0.5) * 0.9;
    const sp = 7 + Math.random() * 8;
    parts.push(mk(W * 0.05, H * 0.75, Math.cos(a) * sp, Math.sin(a) * sp));
    parts.push(mk(W * 0.95, H * 0.75, -Math.cos(a) * sp, Math.sin(a) * sp));
  }
  // 顶部飘落
  for (let i = 0; i < 50; i++) {
    parts.push(mk(Math.random() * W, -20 - Math.random() * H * 0.4, (Math.random() - 0.5) * 2, 2 + Math.random() * 3));
  }

  const t0 = performance.now();
  function frame(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.18; p.vx *= 0.99;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, 3.2 - t));
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 7); ctx.fill(); }
      else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.4 + 0.6 * Math.abs(Math.sin(p.rot * 2))));
      ctx.restore();
    }
    if (t < 3.4) requestAnimationFrame(frame);
    else cv.remove();
  }
  requestAnimationFrame(frame);
}
