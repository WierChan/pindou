// 分享卡片弹窗：生成长图，可保存到相册或转发给朋友
const { store } = require('../../utils/store');
const { buildShareCardTo } = require('../../utils/share');
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
  data: { img: '' },
  methods: {
    build() {
      if (this._builtFor === this.properties.workId && this.data.img) return;
      const work = store.get(this.properties.workId);
      if (!work) return;
      ui.queryNode(this, '#card').then(r => {
        if (!r || !r.node) { ui.toast('卡片生成失败'); return; }
        try {
          buildShareCardTo(r.node, work, 2);
        } catch (e) {
          ui.toast('卡片生成失败');
          return;
        }
        ui.captureCanvas(this, r.node).then(path => {
          this._builtFor = this.properties.workId;
          this.path = path;
          this.setData({ img: path });
          this.triggerEvent('built', { path });
        }).catch(() => ui.toast('卡片生成失败'));
      });
    },
    save() { if (this.path) ui.saveToAlbum(this.path); },
    close() { this.triggerEvent('close'); },
    noop() {},
  },
});
