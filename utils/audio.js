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
  /* ---- 首页小互动音效（同样走静音开关） ---- */
  // 单音（点豆子 / 标题音阶）
  note(freq) {
    beep({ freq: freq || 660, dur: 0.1, type: 'square', gain: 0.07 });
  },
  // 豆豆跳一下：两声上行
  hop() {
    beep({ freq: 392, dur: 0.07, gain: 0.08 });
    beep({ freq: 523, dur: 0.09, gain: 0.08, at: 0.07 });
  },
  // 彩蛋小号角
  fanfare() {
    [659, 784, 880, 1046].forEach((f, i) =>
      beep({ freq: f, dur: 0.1, gain: 0.09, at: i * 0.09 }));
  },

  /* ---- 开屏（同样走静音开关） ---- */
  // 开店小曲：C 大调五声音阶的轻快旋律 + 简单低音，约 2.5s，一次性调度完
  splashTune() {
    const melody = [523, 659, 784, 880, 784, 659, 784, 1046, 880, 784, 659, 523];
    melody.forEach((f, i) =>
      beep({ freq: f, dur: 0.15, type: 'triangle', gain: 0.055, at: i * 0.21 }));
    [261, 329, 392, 329].forEach((f, i) =>
      beep({ freq: f, dur: 0.32, type: 'sine', gain: 0.045, at: i * 0.63 }));
  },
  // 豆豆落地"啵嘤"：短促下滑 + 回弹上滑（打击感，和旋律错开频段）
  bounce() {
    beep({ freq: 340, to: 180, dur: 0.07, type: 'sine', gain: 0.09 });
    beep({ freq: 230, to: 430, dur: 0.09, type: 'sine', gain: 0.055, at: 0.07 });
  },
};

/* ---- 拼豆界面循环 BGM（WebAudio 合成，前瞻调度） ---------------------------
 * 轻柔耐听：C 大调五声音阶，八小节循环（前句 A 饱满 + 后句 B 稀疏应答，≈12s 不易腻），
 * 低通滤波暖化 + 钟琴式柔包络（抗听觉疲劳）。音量见 BGM_MEL_GAIN / BGM_BASS_GAIN，只在拼豆页开着。
 * 开关走独立的 pindou.bgm（默认开），和音效静音 pindou.muted 各管各的——
 * 所以 BGM 发声「不」查 muted，纯靠 bgm.start/stop 控制。                    */
let bgmOn = true;
try { bgmOn = wx.getStorageSync('pindou.bgm') !== '0'; } catch (e) { /* 读不到就默认开 */ }
let bgmBus = null;   // BGM 独立总线（GainNode），便于整体淡入淡出、不碰音效
let bgmTimer = 0;    // 前瞻调度定时器
let bgmNext = 0;     // 下一个八分音符的调度时刻
let bgmStep = 0;     // 当前八分音符序号（循环取模）

const BEAT = 0.185;  // 八分音符时值（比原来慢一点更松弛）：一小节 8 个，八小节循环 ≈ 11.8s
// 旋律：每小节 8 个八分音符 × 8 小节，0 = 休止。全用五声音阶（C D E G A），落在各和弦都协和。
// 分「前句 A」（0–3 小节，饱满）+「后句 B」（4–7 小节，更稀更低更轻的应答）→ 循环变长、有起伏，
// 不像原来 5 秒一模一样地转圈，耐听不烦。留大量休止是刻意的：密度低才不聒噪。
const _C4 = 261.63, _D4 = 293.66, _E4 = 329.63, _G4 = 392.00, _A4 = 440.00, _C5 = 523.25, _D5 = 587.33;
const BGM_MELODY = [
  // ── 前句 A：主题，切分 + 句尾留白 ──
  _C5, 0, _A4, _G4, 0, _E4, _G4, 0,     // 1 · C  (I)
  _D5, 0, _C5, _A4, 0, _G4, _A4, 0,     // 2 · G  (V)
  _C5, 0, _A4, _G4, 0, _E4, _D4, 0,     // 3 · Am (vi)
  _A4, 0, _G4, _A4, 0, _G4, 0,   0,     // 4 · F  (IV)，句尾多留白
  // ── 后句 B：低八度应答，音更疏、更安静 ──
  _G4, 0, 0,   _E4, 0, _G4, 0,   0,     // 5 · C
  _A4, 0, 0,   _G4, 0, _D4, 0,   0,     // 6 · G
  _A4, 0, _C5, 0,   _A4, 0, _G4, 0,     // 7 · F
  _E4, 0, _D4, 0,   _C4, 0, 0,   0,     // 8 · C，落回主音收束
];
// 八小节根音 C–G–A–F–C–G–F–C（低音心跳）
const BGM_BASS = [130.81, 98.00, 110.00, 87.31, 130.81, 98.00, 87.31, 130.81];
const BGM_MEL_GAIN = 0.17;   // 旋律音量（暖化滤波 + 柔包络下已够清楚；嫌吵/嫌小改这个）
const BGM_BASS_GAIN = 0.12;  // 低音音量

// 单个音符：柔和的钟琴式包络（快起音 → 缓降到延音 → 释音），不再是一路满响的死延音。
function bgmVoice(c, freq, t0, dur, type, peak) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  const rel = Math.min(0.06, dur * 0.35);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);         // 起音
  g.gain.exponentialRampToValueAtTime(peak * 0.55, t0 + dur - rel); // 缓降到延音（有呼吸、不发死）
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);          // 释音，防咔哒
  osc.connect(g); g.connect(bgmBus);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function bgmTick() {
  const c = ensure();
  if (!c || !bgmOn || !bgmBus) return;
  if (c.state !== 'running') return;            // 未解锁自动播放先静默等（拼豆页有触摸会解锁）
  if (bgmNext < c.currentTime) bgmNext = c.currentTime + 0.05; // 刚解锁/掉队时重锚，防补发一串
  try {
    while (bgmNext < c.currentTime + 0.2) {      // 前瞻 0.2s 排下一批音符
      const step = bgmStep % BGM_MELODY.length;
      const bar = (step / 8) | 0;
      const beat = step % 8;
      const inB = bar >= 4;                       // 后句：旋律更轻、低音更稀
      const mf = BGM_MELODY[step];
      if (mf) bgmVoice(c, mf, bgmNext, BEAT * 0.92, 'triangle', inB ? BGM_MEL_GAIN * 0.8 : BGM_MEL_GAIN);
      const bassHit = inB ? (beat === 0) : (beat === 0 || beat === 4); // A 句拍 1、3；B 句只拍 1
      if (bassHit) bgmVoice(c, BGM_BASS[bar], bgmNext, BEAT * 1.6, 'sine', BGM_BASS_GAIN);
      bgmNext += BEAT;
      bgmStep++;
    }
  } catch (e) { /* 平台不支持就静默 */ }
}

const bgm = {
  get enabled() { return bgmOn; },
  // 开始播放（幂等：已在放就跳过）。仅拼豆页 onShow 调。
  start() {
    const c = ensure();
    if (!c || bgmTimer) return;
    try {
      if (!bgmBus) {
        bgmBus = c.createGain();
        // 低通滤波暖化：滤掉振荡器刺耳的高频泛音 → 圆润、耐听，是"不烦"的关键一环
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2200;
        lp.Q.value = 0.4;
        bgmBus.connect(lp); lp.connect(c.destination);
      }
      const t = c.currentTime;
      bgmBus.gain.cancelScheduledValues(t);
      bgmBus.gain.setValueAtTime(0.0001, t);
      bgmBus.gain.exponentialRampToValueAtTime(1, t + 0.6); // 0.6s 淡入
      bgmStep = 0;
      bgmNext = t + 0.1;
    } catch (e) { return; /* 平台不支持：不启定时器，按钮开关照常翻转 */ }
    bgmTick();
    bgmTimer = setInterval(bgmTick, 60);
  },
  // 停止（离开拼豆页 / 切后台 / 关开关）。淡出 0.25s 防爆音，已排队的音符也被总线压下去。
  stop() {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = 0; }
    if (bgmBus && actx) {
      try {
        const t = actx.currentTime;
        bgmBus.gain.cancelScheduledValues(t);
        bgmBus.gain.setValueAtTime(Math.max(0.0001, bgmBus.gain.value), t);
        bgmBus.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      } catch (e) { /* 忽略 */ }
    }
  },
  // 🎵 按钮：翻转开关并持久化，返回切换后的状态给页面刷新图标
  toggle() {
    bgmOn = !bgmOn;
    try { wx.setStorageSync('pindou.bgm', bgmOn ? '1' : '0'); } catch (e) { /* 忽略 */ }
    if (bgmOn) this.start(); else this.stop();
    return bgmOn;
  },
  // 设置页用：只存偏好、不在当前页起播（回到拼豆页 onShow 才播）；关掉则立即停
  setEnabled(v) {
    bgmOn = !!v;
    try { wx.setStorageSync('pindou.bgm', bgmOn ? '1' : '0'); } catch (e) { /* 忽略 */ }
    if (!bgmOn) this.stop();
  },
};

module.exports = { audio, bgm };
