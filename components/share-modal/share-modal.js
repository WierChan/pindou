// 分享图纸弹窗：生成纯网格拼豆图纸（无品牌装饰），可直发好友/朋友圈或转发小程序
const { store } = require('../../utils/store');
const { buildChartExportTo } = require('../../utils/share');
const ui = require('../../utils/ui');

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
  methods: {
    build() {
      if (this._builtFor === this.properties.workId && this.data.img) return;
      const work = store.get(this.properties.workId);
      if (!work) return;
      ui.queryNode(this, '#card').then(r => {
        if (!r || !r.node) { ui.toast('图纸生成失败'); return; }
        // 统一的网格拼豆图纸（白底 + 格线 + 平色格，保存后可再从「导入拼豆图纸」识别）
        const draw = () => buildChartExportTo(r.node, work);
        ui.captureCanvas(this, r.node, draw, '#card').then(path => {
          this._builtFor = this.properties.workId;
          this.path = path;
          this.setData({ img: path });
          this.triggerEvent('built', { path });
        }).catch(() => ui.toast('图纸生成失败'));
      });
    },
    // 分享图纸：调起系统图片分享菜单（发好友/朋友圈/保存图片都在里面）；
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
    close() { this.triggerEvent('close'); },
    noop() {},
  },
});
