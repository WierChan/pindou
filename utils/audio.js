// 音效：WebAudio 合成，无需素材文件（wx.createWebAudioContext，基础库 2.19+）
let actx = null;
let muted = false;
try { muted = wx.getStorageSync('pindou.muted') === '1'; } catch (e) { /* 忽略 */ }

function ensure() {
  if (!actx) {
    try {
      if (wx.createWebAudioContext) actx = wx.createWebAudioContext();
    } catch (e) { actx = null; }
  }
  if (actx && actx.state === 'suspended' && actx.resume) {
    try { actx.resume(); } catch (e) { /* 忽略 */ }
  }
  return actx;
}

function beep(o) {
  const c = ensure();
  if (!c || muted) return;
  try {
    const freq = o.freq || 660, to = o.to || null, dur = o.dur || 0.08;
    const type = o.type || 'triangle', gain = o.gain || 0.12, at = o.at || 0;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch (e) { /* 平台不支持就静默 */ }
}

let noiseBuf = null;
let lastSizzle = 0;
function noise(c) {
  if (!noiseBuf) {
    const len = Math.floor(c.sampleRate * 0.25);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

const audio = {
  get muted() { return muted; },
  setMuted(v) {
    muted = v;
    try { wx.setStorageSync('pindou.muted', v ? '1' : '0'); } catch (e) { /* 忽略 */ }
  },
  // 熨烫的"呲——"蒸汽声
  sizzle() {
    const c = ensure();
    if (!c || muted) return;
    const now = Date.now();
    if (now - lastSizzle < 110) return;
    lastSizzle = now;
    try {
      const src = c.createBufferSource();
      src.buffer = noise(c);
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 3000 + Math.random() * 900;
      f.Q.value = 0.8;
      const g = c.createGain();
      const t0 = c.currentTime;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
      src.connect(f); f.connect(g); g.connect(c.destination);
      src.start(t0); src.stop(t0 + 0.22);
    } catch (e) { /* 忽略 */ }
  },
  tap() {
    const f = 620 + Math.random() * 120;
    beep({ freq: f, to: f * 0.82, dur: 0.07, type: 'triangle', gain: 0.1 });
  },
  wrong() {
    beep({ freq: 170, dur: 0.09, type: 'square', gain: 0.06 });
    beep({ freq: 130, dur: 0.1, type: 'square', gain: 0.05, at: 0.07 });
  },
  colorDone() {
    beep({ freq: 784, dur: 0.09, gain: 0.12 });
    beep({ freq: 1046, dur: 0.14, gain: 0.12, at: 0.09 });
  },
  rowFill() {
    beep({ freq: 320, to: 980, dur: 0.22, type: 'sine', gain: 0.1 });
  },
  finish() {
    [523, 659, 784, 1046].forEach((f, i) =>
      beep({ freq: f, dur: 0.16, type: 'triangle', gain: 0.14, at: i * 0.1 }));
    beep({ freq: 1318, dur: 0.4, type: 'sine', gain: 0.1, at: 0.42 });
  },
};

module.exports = { audio };
