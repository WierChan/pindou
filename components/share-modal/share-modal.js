// 分享弹窗：生成品牌分享卡（便利店门头 + 作品图 + 小程序码邀请区），可发好友/朋友圈或转发小程序；
// 「保存图纸」另存纯网格图纸（白底格线版，保存后可再从「导入拼豆图纸」识别还原）
const { store } = require('../../utils/store');
const { buildShareCardTo, buildChartExportTo, loadShareAssets } = require('../../utils/share');
const ui = require('../../utils/ui');
const ads = require('../../utils/ads');

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    workId: { type: String, value: '' },
    show: {
      type: Boolean,
      value: false,
      observer(v) { if (v) this.build(); },
    },
  },
  data: { img: '', capW: 750, capH: 1200 },
  lifetimes: {
    // 卡片与图纸共用同一块隐藏 canvas，串行执行避免互相踩画布
    attached() { this.uq = ui.serialQueue(); },
  },
  methods: {
    build() {
      if (this._builtFor === this.properties.workId && this.data.img) return;
      const work = store.get(this.properties.workId);
      if (!work) return;
      ui.queryNode(this, '#card').then(r => {
        if (!r || !r.node) { ui.toast('卡片生成失败'); return; }
        const draw = () => buildShareCardTo(r.node, work, 2);
        // 先预加载小程序码（缺资源时静默，邀请区退化为文字搜索引导）
        this.uq(() => loadShareAssets(r.node)
          .then(() => ui.captureCanvas(this, r.node, draw, '#card')))
          .then(path => {
            this._builtFor = this.properties.workId;
            this.path = path;
            this.setData({ img: path });
            this.triggerEvent('built', { path });
          }).catch(() => ui.toast('卡片生成失败'));
      });
    },
    // 分享卡片：调起系统图片分享菜单（发好友/朋友圈/保存图片都在里面）；
    // 老基础库不支持时退回保存到相册
    sendImage() {
      if (!this.path) return;
      if (!wx.showShareImageMenu) { ui.saveToAlbum(this.path); return; }
      wx.showShareImageMenu({
        path: this.path,
        fail: err => {
          const msg = (err && err.errMsg) || '';
          if (msg.indexOf('cancel') >= 0) return; // 用户取消不提示
          ui.saveToAlbum(this.path);              // 调起失败就直接保存
        },
      });
    },
    // 保存纯网格图纸到相册（无品牌装饰、平色格 —— 往返闭环的载体）。
    // 流量主接入后（rvChart 位下发）先看一段激励视频；未接入/失败直接放行，
    // 同一作品当天只看一次（记账在 ads.js）
    saveChart() {
      const id = this.properties.workId;
      ads.rewarded('rvChart', {
        workId: id,
        title: '保存高清图纸',
        desc: '看一段短广告，即可把这幅作品的高清图纸保存到相册',
      }).then(ok => { if (ok) this._doSaveChart(id); });
    },
    _doSaveChart(id) {
      if (this._chartFor === id && this._chartPath) { ui.saveToAlbum(this._chartPath); return; }
      const work = store.get(id);
      if (!work) return;
      ui.queryNode(this, '#card').then(r => {
        if (!r || !r.node) { ui.toast('图纸生成失败'); return; }
        const draw = () => buildChartExportTo(r.node, work);
        this.uq(() => ui.captureCanvas(this, r.node, draw, '#card')).then(path => {
          this._chartFor = id;
          this._chartPath = path;
          ui.saveToAlbum(path);
        }).catch(() => ui.toast('图纸生成失败'));
      });
    },
    close() { this.triggerEvent('close'); },
    noop() {},
  },
});
