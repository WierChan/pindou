// 指尖拼豆 - 应用主逻辑
import { PALETTE, textColorFor } from './palette.js';
import { loadImageToCanvas, canvasToPattern, colorStats } from './convert.js';
import { TEMPLATES, templatePattern } from './templates.js';
import { store } from './store.js';
import { BoardView, renderPattern } from './board.js';
import { audio } from './audio.js';
import { celebrate } from './confetti.js';
import { showShareModal, buildExportImage } from './share.js';

const app = document.getElementById('app');
const DEBUG = new URLSearchParams(location.search).has('debug');
const FREE_ROW_USES = 3; // 整排工具每幅作品免费次数（付费点示例）

let cleanup = null;

/* ---------- 小工具 ---------- */
function el(tag, cls, html) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (html != null) d.innerHTML = html;
  return d;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let toastEl = null, toastTimer = 0;
function toast(msg) {
  if (!toastEl) { toastEl = el('div', 'toast'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// 应用内确认弹窗（内嵌浏览器会拦截原生 confirm）
function appConfirm(msg, title = '删除作品') {
  return new Promise(resolve => {
    const ov = el('div', 'overlay');
    const m = el('div', 'modal confirm');
    m.appendChild(el('div', 'modal-title small', esc(title)));
    m.appendChild(el('div', 'modal-sub', msg));
    const btns = el('div', 'modal-btns');
    const no = el('button', 'btn-ghost center', '取消');
    const yes = el('button', 'btn-danger', '删除');
    const done = v => { ov.remove(); resolve(v); };
    no.onclick = () => done(false);
    yes.onclick = () => done(true);
    ov.onclick = e => { if (e.target === ov) done(false); };
    btns.append(no, yes);
    m.appendChild(btns);
    ov.appendChild(m);
    document.body.appendChild(ov);
  });
}

function thumbOf(work, fused) {
  const cellPx = Math.max(2, Math.min(10, Math.floor(140 / Math.max(work.w, work.h))));
  return renderPattern(work, { cellPx, fused }).toDataURL('image/png');
}

function exportWork(work, fused) {
  const cv = buildExportImage(work, fused);
  const a = document.createElement('a');
  a.download = `${work.name}-拼豆.png`;
  a.href = cv.toDataURL('image/png');
  a.click();
  toast('图片已导出 ✨');
}

/* ---------- 路由 ---------- */
function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, id] = hash.split('/');
  if (cleanup) { cleanup(); cleanup = null; }
  app.innerHTML = '';
  window.scrollTo(0, 0);
  if (page === 'create') cleanup = createScreen();
  else if (page === 'play' && id) cleanup = playScreen(id);
  else if (page === 'iron' && id) cleanup = ironScreen(id);
  else if (page === 'view' && id) cleanup = viewScreen(id);
  else cleanup = homeScreen();
}
window.addEventListener('hashchange', route);

/* ---------- 首页 / 作品库 ---------- */
function homeScreen() {
  const scr = el('div', 'screen home');
  scr.appendChild(el('header', 'home-header', `
    <div class="logo-dots"><span></span><span></span><span></span></div>
    <h1>指尖拼豆</h1>
    <p>把喜欢的图片，一颗一颗拼出来</p>
  `));

  const cta = el('button', 'cta-new', '＋ 开始新作品');
  cta.onclick = () => { location.hash = '#/create'; };
  scr.appendChild(cta);

  const works = store.list();
  const doing = works.filter(w => !w.completed || !w.ironDone);
  const done = works.filter(w => w.completed && w.ironDone);

  // 进行中 / 已完成 两个分页，按钮在 CTA 下方
  const tabs = el('div', 'tabs home-tabs');
  const tDoing = el('button', 'tab', `🧵 进行中${doing.length ? ` · ${doing.length}` : ''}`);
  const tDone = el('button', 'tab', `🏆 已完成${done.length ? ` · ${done.length}` : ''}`);
  tabs.append(tDoing, tDone);
  scr.appendChild(tabs);
  const listWrap = el('div', 'home-list');
  scr.appendChild(listWrap);

  const buildCard = w => {
    const isDone = w.completed && w.ironDone;
    const needIron = w.completed && !w.ironDone;
    const total = w.cells.filter(t => t >= 0).length;
    const placedN = w.placed.reduce((a, b) => a + b, 0);
    const pct = total ? Math.round(placedN / total * 100) : 0;
    const card = el('div', 'work-card');
    const img = w.thumb ? `<img src="${w.thumb}" alt="">` : '';
    const badge = isDone ? '<span class="wc-badge">已完成</span>'
      : needIron ? '<span class="wc-badge iron">🔥 待熨烫</span>' : '';
    const foot = isDone ? ''
      : needIron ? `<div class="wc-progress"><i style="width:100%"></i></div><div class="wc-meta">豆子拼齐了 · 去熨烫 →</div>`
      : `<div class="wc-progress"><i style="width:${pct}%"></i></div><div class="wc-meta">${pct}%　继续拼 →</div>`;
    card.innerHTML = `
      <div class="wc-thumb">${img}${badge}</div>
      <div class="wc-body">
        <div class="wc-name">${esc(w.name)}</div>
        <div class="wc-meta">${w.w}×${w.h} · ${total} 颗</div>
        ${foot}
      </div>`;
    const del = el('button', 'wc-del', '✕');
    del.onclick = async e => {
      e.stopPropagation();
      if (await appConfirm(`确定删除「${esc(w.name)}」吗？<br>删掉就找不回来啦`)) {
        store.remove(w.id);
        toast('已删除');
        route();
      }
    };
    card.appendChild(del);
    card.onclick = () => {
      location.hash = isDone ? `#/view/${w.id}` : needIron ? `#/iron/${w.id}` : `#/play/${w.id}`;
    };
    return card;
  };

  function renderList() {
    const cur = localStorage.getItem('pindou.homeTab') === 'done' ? 'done' : 'doing';
    tDoing.classList.toggle('active', cur === 'doing');
    tDone.classList.toggle('active', cur === 'done');
    listWrap.innerHTML = '';
    const list = cur === 'done' ? done : doing;
    if (!list.length) {
      listWrap.appendChild(el('div', 'empty-tip', cur === 'done'
        ? '还没有完成的作品～<br>拼完并熨烫定型后，就会收藏在这里 🏆'
        : '没有进行中的作品～<br>上传一张图片，或者从图案库挑一个开始吧 🎨'));
      return;
    }
    const grid = el('div', 'works-grid');
    list.forEach(w => grid.appendChild(buildCard(w)));
    listWrap.appendChild(grid);
  }
  tDoing.onclick = () => { localStorage.setItem('pindou.homeTab', 'doing'); renderList(); };
  tDone.onclick = () => { localStorage.setItem('pindou.homeTab', 'done'); renderList(); };
  renderList();

  app.appendChild(scr);
  return null;
}

/* ---------- 创建作品 ---------- */
// 表情库：每个 emoji 都是现成的拼豆图案（用 Segmenter 按字素切分，避免 ❤️ 这类组合字符被拆散）
const EMOJI_LIB = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(
  '😀😍🥳😎🥺😭🤩😴🤖👻💀🤡' +
  '🐶🐱🐭🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🦆🦉🦄🐝🦋🐢🐍🦖🐙🦀🐠🐬🐳' +
  '🍎🍊🍉🍇🍓🍒🍑🥑🥕🍄🍔🍟🍕🌭🍜🍣🍦🍩🍪🎂🍭🍫🧋' +
  '❤️💖⭐✨⚡🔥🌈☀️🌙☁️❄️⛄🌸🌻🌹🍀' +
  '🎈🎁🎄🎃👑💎⚽🏀🎮🚗🚀⛵🏠'
)].map(s => s.segment);

function emojiToCanvas(ch) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.font = '208px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch, 128, 140);
  return c;
}

function createScreen() {
  const scr = el('div', 'screen create');
  const state = { tab: 'image', src: null, name: '', size: 32, whiteEmpty: false, pattern: null, fromTpl: false };

  scr.appendChild(topbar('新作品', () => { location.hash = '#/'; }));
  const body = el('div', 'create-body');
  scr.appendChild(body);
  app.appendChild(scr);

  function renderPick() {
    body.innerHTML = '';
    const tabs = el('div', 'tabs');
    const t1 = el('button', 'tab' + (state.tab === 'image' ? ' active' : ''), '📷 图片转图纸');
    const t2 = el('button', 'tab' + (state.tab === 'tpl' ? ' active' : ''), '🧸 图案库');
    t1.onclick = () => { state.tab = 'image'; renderPick(); };
    t2.onclick = () => { state.tab = 'tpl'; renderPick(); };
    tabs.append(t1, t2);
    body.appendChild(tabs);

    if (state.tab === 'image') {
      const zone = el('div', 'upload-zone', `
        <div class="uz-icon">🖼️</div>
        <div class="uz-title">选择一张图片</div>
        <div class="uz-sub">照片、表情包、logo 都可以<br>转成拼豆图纸后开拼</div>`);
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return;
        try {
          state.src = await loadImageToCanvas(f);
          state.name = f.name.replace(/\.[^.]+$/, '') || '我的拼豆';
          state.fromTpl = false;
          renderConfig();
        } catch (err) { toast('图片打开失败，换一张试试'); }
      };
      zone.onclick = () => input.click();
      zone.ondragover = e => { e.preventDefault(); zone.classList.add('drag'); };
      zone.ondragleave = () => zone.classList.remove('drag');
      zone.ondrop = async e => {
        e.preventDefault(); zone.classList.remove('drag');
        const f = e.dataTransfer.files[0];
        if (f) { input.files = e.dataTransfer.files; input.onchange(); }
      };
      body.append(zone, input);

      if (DEBUG) {
        const demo = el('button', 'btn-ghost', '🎲 用示例图片试试（调试）');
        demo.onclick = () => {
          const c = document.createElement('canvas');
          c.width = c.height = 256;
          const g = c.getContext('2d');
          const grad = g.createLinearGradient(0, 0, 256, 256);
          grad.addColorStop(0, '#57ACE8'); grad.addColorStop(1, '#E64789');
          g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
          g.fillStyle = '#FFC913';
          g.beginPath(); g.arc(128, 128, 80, 0, 7); g.fill();
          g.fillStyle = '#22252A';
          g.beginPath(); g.arc(100, 108, 12, 0, 7); g.fill();
          g.beginPath(); g.arc(156, 108, 12, 0, 7); g.fill();
          g.strokeStyle = '#22252A'; g.lineWidth = 10; g.lineCap = 'round';
          g.beginPath(); g.arc(128, 138, 36, 0.3, Math.PI - 0.3); g.stroke();
          state.src = c;
          state.name = '示例笑脸';
          state.fromTpl = false;
          renderConfig();
        };
        body.appendChild(demo);
      }
    } else {
      // 新手友好的手工图案：小而必成功，第一幅作品的最佳起点
      body.appendChild(el('div', 'pick-label', '⭐ 新手友好 · 几分钟拼完一幅'));
      const grid = el('div', 'tpl-grid');
      for (const t of TEMPLATES) {
        const p = templatePattern(t);
        const card = el('div', 'tpl-card');
        const cv = renderPattern(p, { cellPx: Math.max(6, Math.min(12, Math.floor(120 / Math.max(p.w, p.h)))) });
        card.appendChild(cv);
        card.appendChild(el('div', 'tpl-name', `${esc(t.name)} · ${p.cells.filter(x => x >= 0).length} 颗`));
        card.onclick = () => {
          state.pattern = p;
          state.name = t.name;
          state.fromTpl = true;
          renderConfig();
        };
        grid.appendChild(card);
      }
      body.appendChild(grid);

      // 表情图案：点一个 emoji，走图片转图纸管线
      body.appendChild(el('div', 'pick-label', '😀 表情图案 · 点一个直接转图纸'));
      const eg = el('div', 'emoji-grid');
      for (const ch of EMOJI_LIB) {
        const b = el('button', 'emoji-btn', ch);
        b.onclick = () => {
          state.src = emojiToCanvas(ch);
          state.name = `${ch} 拼豆`;
          state.fromTpl = false;
          renderConfig();
        };
        eg.appendChild(b);
      }
      body.appendChild(eg);
    }
  }

  function renderConfig() {
    if (!state.fromTpl) {
      state.pattern = canvasToPattern(state.src, state.size, { whiteEmpty: state.whiteEmpty });
    }
    body.innerHTML = '';
    const back = el('button', 'btn-ghost', '‹ 重新选择');
    back.onclick = renderPick;
    body.appendChild(back);

    const panel = el('div', 'panel');
    body.appendChild(panel);

    // 预览
    const wrap = el('div', 'preview-wrap');
    const p = state.pattern;
    const cellPx = Math.max(3, Math.min(14, Math.floor(300 / Math.max(p.w, p.h))));
    wrap.appendChild(renderPattern(p, { cellPx }));
    panel.appendChild(wrap);

    // 统计
    const stats = colorStats(p.cells);
    const total = stats.reduce((a, s) => a + s.count, 0);
    panel.appendChild(el('div', 'stats-line',
      `${p.w} × ${p.h} 板 · <b>${total}</b> 颗豆子 · <b>${stats.length}</b> 种颜色`));

    const chips = el('div', 'color-chips');
    for (const s of [...stats].sort((a, b) => b.count - a.count).slice(0, 12)) {
      chips.appendChild(el('span', 'cchip',
        `<i class="dot" style="background:${PALETTE[s.pal].hex}"></i>${s.count}`));
    }
    panel.appendChild(chips);

    // 图片模式下的选项
    if (!state.fromTpl) {
      const sizes = el('div', 'opt-row');
      sizes.appendChild(el('span', 'opt-label', '画布大小'));
      const sc = el('div', 'size-chips');
      for (const n of [16, 24, 32, 48]) {
        const c = el('button', 'chip' + (state.size === n ? ' active' : ''), `${n} 豆`);
        c.onclick = () => { state.size = n; renderConfig(); };
        sc.appendChild(c);
      }
      sizes.appendChild(sc);
      panel.appendChild(sizes);

      const swr = el('label', 'switch-row', `
        <span>白色背景不拼豆<small>适合白底图片</small></span>`);
      const sw = document.createElement('input');
      sw.type = 'checkbox';
      sw.checked = state.whiteEmpty;
      sw.className = 'switch';
      sw.onchange = () => { state.whiteEmpty = sw.checked; renderConfig(); };
      swr.appendChild(sw);
      panel.appendChild(swr);
    }

    // 名字 + 开始
    const nr = el('div', 'name-row', '<span class="opt-label">作品名</span>');
    const ni = document.createElement('input');
    ni.type = 'text';
    ni.maxLength = 20;
    ni.value = state.name;
    ni.placeholder = '给作品起个名字';
    ni.oninput = () => { state.name = ni.value; };
    nr.appendChild(ni);
    panel.appendChild(nr);

    const go = el('button', 'btn-primary', '开始拼豆！');
    go.onclick = () => {
      const work = store.create({
        name: state.name.trim() || '我的拼豆',
        w: p.w, h: p.h, cells: p.cells,
      });
      store.update(work.id, { thumb: thumbOf(work, false), boostRow: FREE_ROW_USES });
      location.hash = `#/play/${work.id}`;
    };
    body.appendChild(go);
  }

  renderPick();
  return null;
}

/* ---------- 通用顶栏 ---------- */
function topbar(title, onBack, extras = []) {
  const tb = el('div', 'topbar');
  const back = el('button', 'tb-back', '‹');
  back.onclick = onBack;
  tb.appendChild(back);
  tb.appendChild(el('div', 'tb-title', esc(title)));
  const acts = el('div', 'tb-actions');
  extras.forEach(b => acts.appendChild(b));
  tb.appendChild(acts);
  return tb;
}

/* ---------- 拼豆界面 ---------- */
function playScreen(id) {
  const work = store.get(id);
  if (!work) { location.hash = '#/'; return null; }
  if (work.completed) { location.hash = work.ironDone ? `#/view/${id}` : `#/iron/${id}`; return null; }
  if (work.boostRow == null) work.boostRow = FREE_ROW_USES;

  const stats = colorStats(work.cells);
  const colorsUsed = stats.map(s => s.pal);
  const numbers = new Map(colorsUsed.map((pal, i) => [pal, i + 1]));
  const remaining = new Map(stats.map(s => [s.pal, s.count]));
  for (let i = 0; i < work.cells.length; i++) {
    if (work.placed[i]) remaining.set(work.cells[i], remaining.get(work.cells[i]) - 1);
  }
  const total = stats.reduce((a, s) => a + s.count, 0);
  const state = {
    sel: (colorsUsed.find(p => remaining.get(p) > 0) ?? colorsUsed[0]),
    tool: null,
    placedCount: total - [...remaining.values()].reduce((a, b) => a + b, 0),
    finished: false,
  };

  const scr = el('div', 'screen play');

  // 顶栏
  const muteBtn = el('button', 'icon-btn', audio.muted ? '🔇' : '🔊');
  muteBtn.onclick = () => { audio.setMuted(!audio.muted); muteBtn.textContent = audio.muted ? '🔇' : '🔊'; };
  const extras = [muteBtn];
  if (DEBUG) {
    const fill = el('button', 'icon-btn', '⚡');
    fill.title = '一键拼完（调试）';
    fill.onclick = () => {
      const idx = [];
      for (let i = 0; i < work.cells.length; i++) if (work.cells[i] >= 0 && !work.placed[i]) idx.push(i);
      if (idx.length) { bv.placeMany(idx); applyPlacement(idx, 'row'); }
    };
    extras.push(fill);
  }
  scr.appendChild(topbar(work.name, () => { flushSave(); location.hash = '#/'; }, extras));

  const progWrap = el('div', 'prog-wrap', `<div class="prog-bar"><i></i></div><span class="prog-txt"></span>`);
  scr.appendChild(progWrap);
  const progBar = progWrap.querySelector('i');
  const progTxt = progWrap.querySelector('.prog-txt');

  // 画板
  const area = el('div', 'board-area');
  const canvas = document.createElement('canvas');
  canvas.className = 'board';
  area.appendChild(canvas);
  const fabs = el('div', 'zoom-fabs');
  const zi = el('button', null, '＋'), zo = el('button', null, '－'), zf = el('button', null, '⛶');
  fabs.append(zi, zo, zf);
  area.appendChild(fabs);
  scr.appendChild(area);

  // 底部：工具 + 色板
  const bottom = el('div', 'bottom-bar');
  const toolsRow = el('div', 'tools-row');
  const rowTool = el('button', 'tool-chip');
  toolsRow.appendChild(rowTool);
  toolsRow.appendChild(el('span', 'tools-hint', '选颜色，点或划格子上豆'));
  bottom.appendChild(toolsRow);
  const bar = el('div', 'palette-bar');
  bottom.appendChild(bar);
  scr.appendChild(bottom);
  app.appendChild(scr);

  function renderRowTool() {
    rowTool.className = 'tool-chip' + (state.tool === 'row' ? ' active' : '') + (work.boostRow ? '' : ' locked');
    rowTool.innerHTML = work.boostRow
      ? `⚡ 整排拼豆 <b>×${work.boostRow}</b>`
      : `🔒 整排拼豆 <b>×0</b>`;
  }
  rowTool.onclick = () => {
    if (state.finished) return;
    if (!work.boostRow) {
      toast('免费次数用完啦，正式版可解锁更多道具 ✨');
      return;
    }
    state.tool = state.tool === 'row' ? null : 'row';
    if (state.tool) toast('点任意一行，整排自动拼好');
    renderRowTool();
    bv.requestRender();
  };
  renderRowTool();

  // 色板
  const chipEls = new Map();
  for (const pal of colorsUsed) {
    const chip = el('button', 'pchip');
    const hex = PALETTE[pal].hex;
    chip.innerHTML = `
      <span class="pdot" style="background:${hex};color:${textColorFor(hex)}">${numbers.get(pal)}</span>
      <span class="pcount"></span>`;
    chip.title = PALETTE[pal].name;
    chip.onclick = () => { if (!state.finished) setSel(pal); };
    bar.appendChild(chip);
    chipEls.set(pal, chip);
  }

  function refreshChip(pal) {
    const chip = chipEls.get(pal);
    const left = remaining.get(pal);
    chip.querySelector('.pcount').textContent = left > 0 ? left : '✓';
    chip.classList.toggle('done', left === 0);
    chip.classList.toggle('active', state.sel === pal);
  }
  function setSel(pal) {
    const old = state.sel;
    state.sel = pal;
    state.tool = null;
    renderRowTool();
    refreshChip(old); refreshChip(pal);
    chipEls.get(pal).scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    bv.requestRender();
  }
  function updateProgress() {
    const pct = total ? Math.round(state.placedCount / total * 100) : 0;
    progBar.style.width = pct + '%';
    progTxt.textContent = `${pct}%`;
  }
  colorsUsed.forEach(refreshChip);
  updateProgress();

  // 存档（节流）
  let saveTimer = 0;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 600);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    store.update(id, { placed: work.placed, boostRow: work.boostRow, completed: work.completed });
  }
  const onHide = () => flushSave();
  document.addEventListener('visibilitychange', onHide);

  // 上豆后的统一结算
  function applyPlacement(indices, sound) {
    state.placedCount += indices.length;
    const affected = new Set();
    for (const i of indices) {
      const t = work.cells[i];
      remaining.set(t, remaining.get(t) - 1);
      affected.add(t);
    }
    affected.forEach(refreshChip);
    updateProgress();
    scheduleSave();
    if (sound === 'tap') audio.tap();
    if (sound === 'row') audio.rowFill();
    if (state.placedCount >= total) { finish(); return; }
    const doneNow = [...affected].filter(t => remaining.get(t) === 0);
    if (doneNow.length) {
      audio.colorDone();
      toast(`「${PALETTE[doneNow[0]].name}」拼完啦 ✓`);
      if (doneNow.includes(state.sel)) {
        const start = colorsUsed.indexOf(state.sel);
        for (let k = 1; k <= colorsUsed.length; k++) {
          const pal = colorsUsed[(start + k) % colorsUsed.length];
          if (remaining.get(pal) > 0) { setSel(pal); break; }
        }
      }
    }
  }

  const bv = new BoardView(canvas, {
    w: work.w, h: work.h, cells: work.cells, placed: work.placed,
    mode: 'play',
    numbers,
    getSelected: () => state.sel,
    getTool: () => state.tool,
    onPlace: i => applyPlacement([i], 'tap'),
    onWrong: () => { audio.wrong(); navigator.vibrate?.(40); },
    onToolTap: i => {
      if (!work.boostRow) return;
      const row = Math.floor(i / work.w);
      const idx = [];
      for (let x = 0; x < work.w; x++) {
        const j = row * work.w + x;
        if (work.cells[j] >= 0 && !work.placed[j]) idx.push(j);
      }
      if (!idx.length) { toast('这一排已经拼好啦'); return; }
      work.boostRow--;
      state.tool = null;
      renderRowTool();
      bv.placeMany(idx);
      applyPlacement(idx, 'row');
    },
  });
  zi.onclick = () => bv.zoomAt(1.3);
  zo.onclick = () => bv.zoomAt(1 / 1.3);
  zf.onclick = () => bv.fit();

  // 豆子拼齐 → 引导去熨烫
  function finish() {
    state.finished = true;
    state.tool = null;
    work.completed = true;
    if (!work.ironed || work.ironed.length !== work.cells.length) {
      work.ironed = new Array(work.cells.length).fill(0);
    }
    store.update(id, {
      placed: work.placed, completed: true, ironDone: false,
      ironed: work.ironed, boostRow: work.boostRow, thumb: thumbOf(work, false),
    });
    bv.o.mode = 'view';
    setTimeout(() => {
      audio.finish();
      celebrate(colorsUsed.map(p => PALETTE[p].hex));
    }, 350);
    setTimeout(() => {
      const ov = el('div', 'overlay');
      const cellPx = Math.max(4, Math.min(16, Math.floor(240 / Math.max(work.w, work.h))));
      const img = renderPattern(work, { cellPx });
      const modal = el('div', 'modal');
      modal.appendChild(el('div', 'modal-title', '🎉 豆子拼齐啦！'));
      const art = el('div', 'modal-art');
      art.appendChild(img);
      modal.appendChild(art);
      modal.appendChild(el('div', 'modal-sub',
        `「${esc(work.name)}」 · ${total} 颗豆子 · ${colorsUsed.length} 种颜色<br>最后一步：亲手把它熨烫定型！`));
      const btns = el('div', 'modal-btns');
      const b1 = el('button', 'btn-primary', '🔥 去熨烫');
      b1.onclick = () => { location.hash = `#/iron/${id}`; };
      btns.append(b1);
      modal.appendChild(btns);
      const b2 = el('button', 'btn-link', '稍后再烫，先回首页');
      b2.onclick = () => { location.hash = '#/'; };
      modal.appendChild(b2);
      ov.appendChild(modal);
      scr.appendChild(ov);
    }, 1300);
  }

  return () => {
    flushSave();
    document.removeEventListener('visibilitychange', onHide);
    bv.destroy();
  };
}

/* ---------- 熨烫界面 ---------- */
function ironScreen(id) {
  const work = store.get(id);
  if (!work) { location.hash = '#/'; return null; }
  if (!work.completed) { location.hash = `#/play/${id}`; return null; }
  if (work.ironDone) { location.hash = `#/view/${id}`; return null; }
  if (!work.ironed || work.ironed.length !== work.cells.length) {
    work.ironed = new Array(work.cells.length).fill(0);
  }

  const totalPlaced = work.cells.filter(t => t >= 0).length;
  let ironedCount = work.ironed.reduce((a, b) => a + b, 0);
  let finished = false;

  const scr = el('div', 'screen play');

  const muteBtn = el('button', 'icon-btn', audio.muted ? '🔇' : '🔊');
  muteBtn.onclick = () => { audio.setMuted(!audio.muted); muteBtn.textContent = audio.muted ? '🔇' : '🔊'; };
  const extras = [muteBtn];
  if (DEBUG) {
    const fill = el('button', 'icon-btn', '⚡');
    fill.title = '一键烫完（调试）';
    fill.onclick = () => { const n = bv.ironAll(); if (n) applyIron(n); };
    extras.push(fill);
  }
  scr.appendChild(topbar(`熨烫 · ${work.name}`, () => { flushSave(); location.hash = '#/'; }, extras));

  const progWrap = el('div', 'prog-wrap', `<div class="prog-bar"><i></i></div><span class="prog-txt"></span>`);
  scr.appendChild(progWrap);
  const progBar = progWrap.querySelector('i');
  const progTxt = progWrap.querySelector('.prog-txt');

  const area = el('div', 'board-area');
  const canvas = document.createElement('canvas');
  canvas.className = 'board';
  area.appendChild(canvas);
  const fabs = el('div', 'zoom-fabs');
  const zi = el('button', null, '＋'), zo = el('button', null, '－'), zf = el('button', null, '⛶');
  fabs.append(zi, zo, zf);
  area.appendChild(fabs);
  scr.appendChild(area);

  const bottom = el('div', 'bottom-bar view-bottom');
  bottom.appendChild(el('span', 'tools-hint', '🔥 按住熨斗，慢慢划过每一颗豆子，把它们烫平定型'));
  scr.appendChild(bottom);
  app.appendChild(scr);

  function updateProg() {
    const pct = totalPlaced ? Math.round(ironedCount / totalPlaced * 100) : 0;
    progBar.style.width = pct + '%';
    progTxt.textContent = pct + '%';
  }
  updateProg();

  let saveTimer = 0;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 600);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    store.update(id, { ironed: work.ironed, ironDone: work.ironDone || false });
  }
  const onHide = () => flushSave();
  document.addEventListener('visibilitychange', onHide);

  function applyIron(n) {
    if (finished) return;
    ironedCount += n;
    audio.sizzle();
    updateProg();
    scheduleSave();
    if (ironedCount >= totalPlaced) finishIron();
  }

  const bv = new BoardView(canvas, {
    w: work.w, h: work.h, cells: work.cells, placed: work.placed,
    mode: 'iron', ironed: work.ironed,
    onIron: n => applyIron(n),
  });
  zi.onclick = () => bv.zoomAt(1.3);
  zo.onclick = () => bv.zoomAt(1 / 1.3);
  zf.onclick = () => bv.fit();

  function finishIron() {
    if (finished) return;
    finished = true;
    work.ironDone = true;
    store.update(id, {
      ironed: work.ironed, ironDone: true,
      completedAt: Date.now(), thumb: thumbOf(work, true),
    });
    const hexes = colorStats(work.cells).map(s => PALETTE[s.pal].hex);
    setTimeout(() => { audio.finish(); celebrate(hexes); }, 300);
    setTimeout(() => {
      const ov = el('div', 'overlay');
      const cellPx = Math.max(4, Math.min(16, Math.floor(240 / Math.max(work.w, work.h))));
      const img = renderPattern(work, { cellPx, fused: true });
      const modal = el('div', 'modal');
      modal.appendChild(el('div', 'modal-title', '✨ 大功告成！'));
      const art = el('div', 'modal-art');
      art.appendChild(img);
      modal.appendChild(art);
      modal.appendChild(el('div', 'modal-sub',
        `「${esc(work.name)}」熨烫定型完毕<br>这就是你亲手拼出来的作品！`));
      const btns = el('div', 'modal-btns');
      const b1 = el('button', 'btn-primary', '分享卡片');
      b1.onclick = () => showShareModal(work);
      const b2 = el('button', 'btn-ghost', '导出图片');
      b2.onclick = () => exportWork(work, true);
      btns.append(b1, b2);
      modal.appendChild(btns);
      const b3 = el('button', 'btn-link', '回到首页');
      b3.onclick = () => { location.hash = '#/'; };
      modal.appendChild(b3);
      ov.appendChild(modal);
      scr.appendChild(ov);
    }, 1200);
  }

  return () => {
    flushSave();
    document.removeEventListener('visibilitychange', onHide);
    bv.destroy();
  };
}

/* ---------- 作品查看 ---------- */
function viewScreen(id) {
  const work = store.get(id);
  if (!work) { location.hash = '#/'; return null; }
  if (work.completed && !work.ironDone) { location.hash = `#/iron/${id}`; return null; }

  const scr = el('div', 'screen play');
  const delBtn = el('button', 'icon-btn', '🗑');
  delBtn.onclick = async () => {
    if (await appConfirm(`确定删除「${esc(work.name)}」吗？<br>删掉就找不回来啦`)) {
      store.remove(id);
      toast('已删除');
      location.hash = '#/';
    }
  };
  scr.appendChild(topbar(work.name, () => { location.hash = '#/'; }, [delBtn]));

  const area = el('div', 'board-area');
  const canvas = document.createElement('canvas');
  canvas.className = 'board';
  area.appendChild(canvas);
  scr.appendChild(area);

  const bottom = el('div', 'bottom-bar view-bottom');
  const ironChip = el('button', 'tool-chip active', '🔥 熨烫效果');
  const shareBtn = el('button', 'btn-primary slim', '分享卡片');
  const expBtn = el('button', 'btn-ghost slim2', '导出图片');
  bottom.append(ironChip, shareBtn, expBtn);
  scr.appendChild(bottom);
  app.appendChild(scr);

  const bv = new BoardView(canvas, {
    w: work.w, h: work.h, cells: work.cells, placed: work.placed,
    mode: 'view', fused: true,
  });
  ironChip.onclick = () => {
    bv.setFused(!bv.fused);
    ironChip.classList.toggle('active', bv.fused);
  };
  shareBtn.onclick = () => showShareModal(work);
  expBtn.onclick = () => exportWork(work, bv.fused);

  return () => bv.destroy();
}

route();
