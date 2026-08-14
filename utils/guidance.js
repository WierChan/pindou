// 新手引导：豆豆吉祥物在页面首次进入时讲解玩法（聚光灯 + 打字气泡）。
// 页面负责定义步骤（文案 + 目标选择器），这里测好矩形交给 guide 组件；
// 看过或跳过后写入 storage，不再出现
const KEY = id => 'pindou.guide.' + id;

function guideSeen(id) {
  try { return !!wx.getStorageSync(KEY(id)); } catch (e) { return true; }
}

function markGuideSeen(id) {
  try { wx.setStorageSync(KEY(id), 1); } catch (e) { /* 忽略 */ }
}

function measure(page, sel) {
  return new Promise(resolve => {
    const q = page.createSelectorQuery();
    q.select(sel).boundingClientRect();
    q.exec(r => resolve(r && r[0] ? r[0] : null));
  });
}

// defs: [{ sel?, text }]；sel 测不到（元素不存在/宽为 0）时该步退化为纯气泡。
// delay 等页面布局与入场动画稳定后再测矩形、弹引导。
// guideId 一并写入 data：同一页面可以有多段引导（如 create 的选择阶段/配置阶段），
// 页面的 <guide gid="{{guideId}}"> 据此把"看过"记到正确的 key 上
function buildGuide(page, id, defs, delay) {
  if (guideSeen(id)) return;
  setTimeout(() => {
    Promise.all(defs.map(d => (d.sel ? measure(page, d.sel) : Promise.resolve(null))))
      .then(rects => {
        const steps = defs.map((d, i) => ({
          text: d.text,
          rect: rects[i] && rects[i].width > 2 ? {
            left: rects[i].left, top: rects[i].top,
            width: rects[i].width, height: rects[i].height,
          } : null,
        }));
        page.setData({ guideSteps: steps, guideId: id });
      });
  }, delay == null ? 700 : delay);
}

module.exports = { buildGuide, guideSeen, markGuideSeen };
