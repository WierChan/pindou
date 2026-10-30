<template>
    <view>
        <view v-if="show" class="overlay share-overlay" @tap="close">
            <view class="modal share" @tap.stop.prevent="noop">
                <image v-if="img" class="share-img" :src="img" mode="widthFix" show-menu-by-longpress />
                <view v-else class="share-loading">卡片生成中…</view>
                <view class="share-tip">可发好友、朋友圈，也能保存到相册</view>
                <view class="modal-btns">
                    <view class="btn-primary" hover-class="pressed" @tap="sendImage">分享卡片</view>
                    <button class="btn-ghost slim2 slim3 c-green" hover-class="pressed" open-type="share">分享小程序</button>
                </view>
                <view class="share-links">
                    <view class="btn-ghost slim2 c-gold" hover-class="pressed" @tap="saveChart">保存图纸</view>
                    <view class="btn-ghost slim2 c-mute" hover-class="pressed" @tap="close">关闭</view>
                </view>
            </view>
        </view>
        <canvas type="2d" id="card" class="card-canvas" :style="'width:' + capW + 'px;height:' + capH + 'px'"></canvas>
    </view>
</template>

<script>
// 分享弹窗：生成品牌分享卡（便利店门头 + 作品图 + 小程序码邀请区），可发好友/朋友圈或转发小程序；
// 「保存图纸」另存纯网格图纸（白底格线版，保存后可再从「导入拼豆图纸」识别还原）
const { store } = require('../../utils/store');
const { buildShareCardTo, buildChartExportTo, loadShareAssets } = require('../../utils/share');
const ui = require('../../utils/ui');
const ads = require('../../utils/ads');
export default {
    data() {
        return {
            img: '',
            capW: 750,
            capH: 1200
        };
    },
    options: {
        styleIsolation: 'apply-shared'
    },
    props: {
        workId: {
            type: String,
            default: ''
        },
        show: {
            type: Boolean,
            default: false
        }
    },
    mounted() {
        // 处理小程序 attached 生命周期
        this.attached();
    },
    methods: {
        // 卡片与图纸共用同一块隐藏 canvas，串行执行避免互相踩画布
        attached() {
            this.uq = ui.serialQueue();
        },

        build() {
            if (this._builtFor === this.workId && this.img) {
                return;
            }
            const work = store.get(this.workId);
            if (!work) {
                return;
            }
            ui.queryNode(this, '#card').then((r) => {
                if (!r || !r.node) {
                    ui.toast('卡片生成失败');
                    return;
                }
                const draw = () => buildShareCardTo(r.node, work, 2);
                // 先预加载小程序码（缺资源时静默，邀请区退化为文字搜索引导）
                this.uq(() => loadShareAssets(r.node).then(() => ui.captureCanvas(this, r.node, draw, '#card')))
                    .then((path) => {
                        this._builtFor = this.workId;
                        this.path = path;
                        this.setData({
                            img: path
                        });
                        this.$emit('built', {
                            detail: {
                                path
                            }
                        });
                    })
                    .catch(() => ui.toast('卡片生成失败'));
            });
        },

        // 分享卡片：调起系统图片分享菜单（发好友/朋友圈/保存图片都在里面）；
        // 老基础库不支持时退回保存到相册
        sendImage() {
            if (!this.path) {
                return;
            }
            ui.shareGeneratedImage(this.path);
        },

        // 保存纯网格图纸到相册（无品牌装饰、平色格 —— 往返闭环的载体）。
        // 流量主接入后（rvChart 位下发）先看一段激励视频；未接入/失败直接放行，
        // 同一作品当天只看一次（记账在 ads.js）
        saveChart() {
            const id = this.workId;
            ads.rewarded('rvChart', {
                workId: id,
                title: '保存高清图纸',
                desc: '看一段短广告，即可把这幅作品的高清图纸保存到相册'
            }).then((ok) => {
                if (ok) {
                    this.doSaveChartFun(id);
                }
            });
        },

        doSaveChartFun(id) {
            if (this._chartFor === id && this._chartPath) {
                ui.saveChart(this._chartPath);
                return;
            }
            const work = store.get(id);
            if (!work) {
                return;
            }
            ui.queryNode(this, '#card').then((r) => {
                if (!r || !r.node) {
                    ui.toast('图纸生成失败');
                    return;
                }
                const draw = () => buildChartExportTo(r.node, work);
                this.uq(() => ui.captureCanvas(this, r.node, draw, '#card'))
                    .then((path) => {
                        this._chartFor = id;
                        this._chartPath = path;
                        ui.saveChart(path);
                    })
                    .catch(() => ui.toast('图纸生成失败'));
            });
        },

        close() {
            this.$emit('close');
        },

        noop() {}
    },
    created: function () {},
    watch: {
        show: {
            handler: function (v) {
                if (v) {
                    this.build();
                }
            },

            immediate: true
        }
    }
};
</script>
<style>
/* 分享弹窗永远盖在页面级弹窗（含 .overlay.hi 的完成弹窗，z-index 200）之上 */
.share-overlay {
    z-index: 300;
}

.modal.share {
    max-width: 380px;
    max-height: 92vh;
    overflow-y: auto;
}
.share-img {
    width: 100%;
    border: 3px solid var(--ink);
    border-radius: 0;
    box-shadow: 4px 4px 0 rgba(14, 13, 29, 0.3);
}
.share-loading {
    padding: 60px 0;
    color: var(--ink2);
    font-size: 14px;
}
.share-tip {
    font-size: 12px;
    color: var(--ink2);
}
/* 保存图纸 / 关闭：从文字链接改成按钮（次级，比上排分享按钮小一号） */
.share-links {
    display: flex;
    gap: 10px;
}
.share-links > view {
    flex: 1;
}
button.share-fwd {
    align-self: auto;
    padding: 9px 16px;
    line-height: 1.45;
    border-radius: 0;
}
.card-canvas {
    position: fixed;
    left: -9999px;
    top: 0;
    width: 750px;
    height: 1200px;
}
</style>
