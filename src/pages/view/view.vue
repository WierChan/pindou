<template>
    <view>
        <view class="playpage">
            <view class="topbar" :style="'padding-top:' + insets.top + 'px;padding-right:' + insets.right + 'px'">
                <view class="tb-back" hover-class="pressed" @tap="goBack">‹</view>
                <view class="tb-title">{{ title }}</view>
                <view class="tb-actions">
                    <view class="icon-btn" hover-class="pressed" @tap="delWork"><image class="pxi-l" src="/static/assets/icons/trash.png" /></view>
                </view>
            </view>

            <view class="board-area">
                <canvas type="2d" id="board" class="board" @touchstart="onTS" @touchmove="onTM" @touchend="onTE" @touchcancel="onTE"></canvas>
            </view>

            <view class="bottom-bar vt-sheet">
                <!-- 未烫成品 / 烫后效果 -->
                <view class="seg vt-toggle">
                    <view :class="'seg-i ' + (fusedOn ? '' : 'on')" hover-class="pressed" data-v="0" @tap="toggleFused">未烫成品</view>
                    <view :class="'seg-i ' + (fusedOn ? 'on' : '')" hover-class="pressed" data-v="1" @tap="toggleFused">✦ 烫后效果</view>
                </view>
                <!-- 选烫法：三类 Tab 切换 + 该类卡片（即时预览） -->
                <view class="fp-label">选择烫法</view>
                <view class="fp-tabs">
                    <view :class="'fp-tab ' + (finishTab === item.cat ? 'on' : '')" :data-cat="item.cat" @tap="switchFinishTab" v-for="(item, index) in cats" :key="index">
                        {{ item.label }}
                    </view>
                </view>
                <scroll-view scroll-x class="fp-scroll" enhanced :show-scrollbar="false">
                    <view class="fp-row">
                        <view
                            :class="'fp-card ' + (item.active ? 'on' : '')"
                            :data-f="item.key"
                            @tap="pickFinish"
                            hover-class="pressed"
                            v-for="(item, index) in cards"
                            :key="index"
                        >
                            <image v-if="item.img" class="fp-pv" :src="item.img" mode="aspectFit" />

                            <view v-else class="fp-pv ph"></view>

                            <view class="fp-nm">{{ item.name }}</view>

                            <view class="fp-sub">{{ item.sub }}</view>
                        </view>
                    </view>
                </scroll-view>
                <!-- 操作：分享 / 导入码 / 代拼 / 保存这个效果 -->
                <view class="vt-mini-row">
                    <view class="btn-ghost vt-mini" hover-class="pressed" @tap="openShare">
                        <image class="pxi-s" src="/static/assets/icons/export.png" />
                        分享
                    </view>
                    <view class="btn-ghost vt-mini" hover-class="pressed" @tap="shareCode">
                        <image class="pxi-s" src="/static/assets/icons/key.png" />
                        导入码
                    </view>
                    <view v-if="orderOn" class="btn-ghost vt-mini c-gold" hover-class="pressed" @tap="goOrder">
                        <image class="pxi-s" src="/static/assets/icons/parcel.png" />
                        代拼
                    </view>
                </view>
                <view v-if="fromCode" class="btn-link" @tap="reportImported">举报导入图纸</view>
                <view class="btn-primary vt-save" hover-class="pressed" @tap="saveFinish">保存这个效果 →</view>
            </view>

            <share-modal :workId="workId" :show="shareShow" @close="closeShare" @built="onCardBuilt" />
            <guide :gid="guideId" :steps="guideSteps" @done="onGuideDone" />
        </view>

        <canvas type="2d" id="util" class="util-canvas" :style="'width:' + capW + 'px;height:' + capH + 'px'"></canvas>

        <!-- 导入码弹窗：放页面顶层 + 提升层级，确保盖住画板 canvas -->
        <view v-if="codeShow" class="overlay hi" @tap="closeCode">
            <view class="modal" @tap.stop.prevent="noop">
                <view class="modal-title">
                    <image class="pxi-l" src="/static/assets/icons/key.png" />
                    图纸导入码
                </view>
                <text class="code-big" :selectable="true">{{ codeText }}</text>
                <view class="modal-sub">
                    <view>长按上方口令选中复制，发给好友</view>
                    <view>好友在「新作品 → 输入导入码」中输入口令</view>
                </view>
                <view class="btn-link" hover-class="pressed" @tap="closeCode">关闭</view>
            </view>
        </view>
    </view>
</template>

<script>
// 作品查看：完成后的展示、换烫法、分享
const { store } = require('../../utils/store');
const { BoardView, workFinish, workHole, finishList, finishInfo, getBeadShape } = require('../../utils/board');
const { ensureFinishSwatches } = require('../../utils/finishswatch');
const { createCode, format, reportFlow } = require('../../utils/importcode');
const { bgm } = require('../../utils/audio');
const ui = require('../../utils/ui');
const { cfg } = require('../../utils/config');
const { buildGuide, guideSeen, markGuideSeen } = require('../../utils/guidance');
export default {
    data() {
        return {
            insets: {
                top: 24,
                h: 44,
                right: 8
            },

            capW: 700,
            capH: 900,
            title: '',
            orderOn: false,

            // 代拼入口默认隐藏
            // 已定型作品：可在「未烫成品 / 烫后效果」间切看，并横滑换烫法、保存
            fusedOn: true,

            // true 烫后效果（融合+烫法） / false 未烫成品（原豆）
            finish: 'smooth',

            finishName: '',
            cats: [],

            // 三类 Tab [{cat,label}]
            finishTab: 'common',

            cards: [],

            // 当前 Tab 的烫法卡片
            shareShow: false,

            workId: '',
            codeShow: false,
            codeText: '',
            guideSteps: [],
            fromCode: '',
            guideId: ''
        };
    },
    onLoad(q) {
        const work = store.get(q.id);
        if (!work) {
            ui.backHome();
            return;
        }
        if (work.completed && !work.ironDone) {
            uni.redirectTo({
                url: '/pages/iron/iron?id=' + work.id
            });
            return;
        }
        this.work = work;
        this.uq = ui.serialQueue();
        this.finishImg = {};
        const finish = workFinish(work);
        this.setData({
            insets: ui.navInsets(),
            title: work.name,
            workId: work.id,
            fromCode: work.fromCode || '',
            orderOn: cfg.ORDER.enabled,
            finish,
            finishName: finishInfo(finish).name,
            finishTab: finishInfo(finish).cat,
            cats: finishList().map((g) => ({
                cat: g.cat,
                label: g.label
            })),
            cards: this.cardsForFun(finishInfo(finish).cat, finish)
        });
    },
    onReady() {
        if (!this.work) {
            return;
        }
        ui.queryNode(this, '#board').then((r) => {
            if (!r || !r.node || !this.work) {
                return;
            }
            const dpr = Math.min(3, ui.navInsets().dpr);
            this.bv = new BoardView(r.node, {
                w: this.work.w,
                h: this.work.h,
                cells: this.work.cells,
                placed: this.work.placed,
                palette: this.work.palette || null,
                mode: 'view',
                fused: true,
                finish: workFinish(this.work),
                // 熨烫时选的质感档位
                hole: workHole(this.work),
                // 熨烫时选的豆孔大小
                chart: false // 默认成品效果（与首页缩略图、分享卡一致）
            });
            this.bv.setViewport(r.width, r.height, dpr, r.left, r.top);
            setTimeout(() => ui.syncBoardRect(this, this.bv), 600);
        });
        ui.queryNode(this, '#util').then((r) => {
            if (r) {
                this.utilCanvas = r.node;
                this.loadSwatchesFun();
            }
        });
        // 首次看成品：讲清这页能做的事；换烫法是后加的，老用户单步补看（view-finish）
        if (!guideSeen('view')) {
            buildGuide(this, 'view', [
                {
                    text: '这里收着你烫好的成品～双指放大能细看每一颗豆子的质感。'
                },
                {
                    sel: '.vt-toggle',
                    text: '「未烫成品 / 烫后效果」随时切看：一边是原豆，一边是熨烫定型后的样子。'
                },
                {
                    sel: '.fp-tabs',
                    text: '底下能换烫法：点「常用 / 特殊工艺 / 闪粉」切类，再选卡片，选中就即时预览，满意点「保存这个效果」。'
                }
            ]);
        } else {
            buildGuide(this, 'view-finish', [
                {
                    sel: '.fp-tabs',
                    text: '新增：成品也能换烫法啦——点「常用 / 特殊工艺 / 闪粉」切类选卡片，即时预览，满意点「保存这个效果」。'
                }
            ]);
        }
    },
    onResize() {
        this.setData({
            insets: ui.navInsets()
        });
        setTimeout(() => ui.syncBoardRect(this, this.bv), 120);
    },
    onShow() {
        bgm.stop();
    },
    // 查看页是安静的展示页：进来就把熨烫带过来的 BGM 停掉
    onUnload() {
        if (this.bv) {
            this.bv.destroy();
        }
    },
    onShareAppMessage() {
        return {
            title: '拼豆便利店 · 把喜欢的图片，一颗一颗拼出来',
            path: '/pages/home/home'
        };
    },
    methods: {
        // 某分类下的卡片（带预览图与选中态）
        cardsForFun(cat, finish) {
            const g = finishList().find((x) => x.cat === cat) || {
                items: []
            };
            return g.items.map((it) => ({
                key: it.key,
                name: it.name,
                sub: it.sub,
                img: (this.finishImg && this.finishImg[it.key]) || '',
                active: it.key === finish
            }));
        },

        // 切换分类 Tab
        switchFinishTab(e) {
            const cat = e.currentTarget.dataset.cat;
            if (!cat || cat === this.finishTab) {
                return;
            }
            this.setData({
                finishTab: cat,
                cards: this.cardsForFun(cat, this.finish)
            });
            this.loadSwatchesFun();
        },

        // 渲染所有烫法卡片的预览图（会话内缓存，渲染完 patch 进对应卡片）
        loadSwatchesFun() {
            const keys = this.cards.filter((c) => c.key).map((c) => c.key);
            ensureFinishSwatches(this, keys, (key, path) => {
                this.finishImg[key] = path;
                const i = this.cards.findIndex((c) => c.key === key);
                if (i >= 0) {
                    this.setData({
                        ['cards[' + i + '].img']: path
                    });
                }
            });
        },

        onGuideDone() {
            if (this.guideId === 'view') {
                markGuideSeen('view-finish');
            } // 完整版已含换烫法讲解，别再补看
            this.setData({
                guideSteps: []
            });
        },

        onTS(e) {
            if (this.bv) {
                this.bv.touchStart(e);
            }
        },

        onTM(e) {
            if (this.bv) {
                this.bv.touchMove(e);
            }
        },

        onTE(e) {
            if (this.bv) {
                this.bv.touchEnd(e);
            }
        },

        goBack() {
            ui.backHome();
        },

        // 未烫成品 ↔ 烫后效果 切换（seg：data-v '1' 烫后 / '0' 未烫）
        toggleFused(e) {
            const on = e.currentTarget.dataset.v === '1';
            if (on === this.fusedOn) {
                return;
            }
            this.setData({
                fusedOn: on
            });
            if (this.bv) {
                this.bv.setChart(false);
                this.bv.setFused(on);
            }
        },

        // 选烫法（底部横滑卡片）：即时预览 + 落盘烫法（分享/导出跟着一致）；封面缩略图留给「保存这个效果」刷新
        pickFinish(e) {
            const f = e.currentTarget.dataset.f;
            if (!f || f === this.finish) {
                return;
            }
            const patch = {
                finish: f,
                finishName: finishInfo(f).name
            };
            this.cards.forEach((c, i) => {
                if (!c.key) {
                    return;
                }
                const on = c.key === f;
                if (c.active !== on) {
                    patch['cards[' + i + '].active'] = on;
                }
            });
            if (!this.fusedOn) {
                patch.fusedOn = true;
            } // 选了就切到烫后效果看
            this.setData(patch);
            this._thumbDirty = true; // 封面还没跟上，提示保存
            if (this.work) {
                this.work.finish = f;
                store.update(this.work.id, {
                    finish: f
                });
            }
            if (this.bv) {
                this.bv.setChart(false);
                this.bv.setFused(true);
                this.bv.setFinish(f);
            }
        },

        // 保存这个效果：重刷封面缩略图（首页/作品册按新烫法显示）——烫法本身在选时已落盘
        saveFinish() {
            const work = this.work;
            if (!work) {
                return;
            }
            if (!this.utilCanvas) {
                ui.toast('已保存 ✨');
                return;
            }
            this.uq(() => ui.makeThumb(this, this.utilCanvas, work, true))
                .then((path) => {
                    store.update(
                        work.id,
                        {
                            thumb: path,
                            thumbV: ui.THUMB_V,
                            thumbShape: getBeadShape()
                        },
                        true
                    );
                    this._thumbDirty = false;
                    ui.toast('已保存这个效果 ✨');
                })
                .catch(() => ui.toast('保存失败，再试一次'));
        },

        openShare() {
            this.setData({
                shareShow: true
            });
        },

        closeShare() {
            this.setData({
                shareShow: false
            });
        },

        // 找商家代拼：把这张图纸交给商家拼好、熨烫定型（下单页选烫法 / 配送 / 支付）
        goOrder() {
            if (this.work) {
                uni.navigateTo({
                    url: '/pages/order/order?id=' + this.work.id
                });
            }
        },

        onCardBuilt(e) {
            this.shareImg = e.detail.path;
        },

        /* ---------- 导入码 ---------- */
        // 生成（或取回）本作品的口令：好友在「新作品 → 输入导入码」里输入即可拼同款。
        // 首次生成前确认分享权利（合规：上传者责任声明）
        shareCode() {
            const work = this.work;
            if (!work) {
                return;
            }
            if (work.shareCode) {
                uni.showLoading({
                    title: '核对审核中',
                    mask: true
                });
                createCode(work)
                    .then((code) => {
                        uni.hideLoading();
                        if (work.shareCode !== code) {
                            work.shareCode = code;
                            store.update(
                                work.id,
                                {
                                    shareCode: code
                                },
                                true
                            );
                        }
                        this.setData({
                            codeShow: true,
                            codeText: format(code)
                        });
                    })
                    .catch((err) => {
                        uni.hideLoading();
                        ui.toast((err && err.message) || '审核未完成');
                    });
                return;
            }
            uni.showModal({
                title: '生成导入码',
                content: '图纸会上传到云端，任何人凭口令都能导入。请确认这是你原创、或已获授权分享的图纸。',
                confirmText: '生成',
                confirmColor: '#C9838F',
                success: (r) => {
                    if (!r.confirm) {
                        return;
                    }
                    uni.showLoading({
                        title: '生成中',
                        mask: true
                    });
                    createCode(work)
                        .then((code) => {
                            uni.hideLoading();
                            if (!code) {
                                ui.toast('生成失败，稍后再试');
                                return;
                            }
                            work.shareCode = code;
                            store.update(
                                work.id,
                                {
                                    shareCode: code
                                },
                                true
                            );
                            this.setData({
                                codeShow: true,
                                codeText: format(code)
                            });
                        })
                        .catch((err) => {
                            uni.hideLoading();
                            ui.toast((err && err.message) || '生成失败，稍后再试');
                        });
                }
            });
        },

        closeCode() {
            this.setData({
                codeShow: false
            });
        },

        noop() {},

        delWork() {
            uni.showModal({
                title: '删除作品',
                content: '确定删除「' + this.work.name + '」吗？删掉就找不回来啦',
                confirmText: '删除',
                confirmColor: '#C9838F',
                success: (r) => {
                    if (r.confirm) {
                        store.remove(this.work.id);
                        ui.toast('已删除');
                        ui.backHome();
                    }
                }
            });
        },

        reportImported() {
            reportFlow(this.fromCode);
        }
    }
};
</script>
<style>
/* 作品查看：主体样式在 app.wxss 的 playpage 骨架里；选烫法横滑器 .fp-* 在 app.wxss 全局 */

/* 底部：未烫/烫后切换 + 选烫法横滑 + 导出/保存（竖向堆叠） */
.vt-sheet {
    display: block;
}
.vt-toggle {
    width: max-content;
    max-width: 100%;
    margin: 2px auto 12px;
}
.vt-toggle .seg-i {
    padding: 9px 22px;
    font-size: 14px;
}
/* 分享 / 导入码 一排，保存这个效果 单独一排（占满宽） */
.vt-mini-row {
    display: flex;
    gap: 10px;
    max-width: 720px;
    margin: 12px auto 0;
    padding: 0 4px;
}
.vt-mini {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 11px 8px;
}
.vt-save {
    display: block;
    text-align: center;
    max-width: 720px;
    margin: 10px auto 2px;
}

/* 导入码弹窗 */
.code-big {
    display: block;
    margin: 6px 0 2px;
    padding: 14px 10px;
    background: #fff7f0;
    border: 3px dashed var(--accent-dark);
    font-size: 26px;
    font-weight: 900;
    letter-spacing: 3px;
    text-align: center;
    color: var(--ink);
}
</style>
