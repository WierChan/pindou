<template>
    <view class="olpage">
        <view class="topbar" :style="'padding-top:' + insets.top + 'px;padding-right:' + insets.right + 'px'">
            <view class="tb-back" hover-class="pressed" @tap="goBack">‹</view>
            <view class="tb-title">我的订单</view>
            <view class="tb-actions"></view>
        </view>

        <scroll-view scroll-y class="ol-scroll" enhanced :show-scrollbar="false">
            <view v-if="cartN" class="ol-cart" hover-class="pressed" @tap="goCart">
                <image class="pxi-s" src="/static/assets/icons/parcel.png" />
                代拼篮里还有 {{ cartN }} 张作品没下单
                <text class="ol-cart-go">去下单 ›</text>
            </view>
            <view v-if="loading" class="ol-empty">加载中…</view>
            <view v-else-if="!list.length" class="ol-empty">
                <view>还没有代拼订单～</view>
                <view>
                    在作品页点「代拼」，把图纸交给商家拼好寄给你
                    <image class="pxi-s" src="/static/assets/icons/parcel.png" />
                </view>
            </view>
            <view v-else class="ol-list">
                <view class="ol-card" hover-class="pressed" @tap="openDetail" :data-id="item.id" v-for="(item, index) in list" :key="index">
                    <view class="ol-top">
                        <view class="ol-name">{{ item.name }}</view>
                        <view :class="'ol-st ' + item.stCls">{{ item.stText }}</view>
                    </view>

                    <view class="ol-meta">{{ item.dims }} · {{ item.deliveryText }}</view>

                    <view class="ol-bot">
                        <view class="ol-time">{{ item.timeText }}</view>
                        <view class="ol-total">¥{{ item.totalYuan }}</view>
                    </view>

                    <view v-if="item.canPay" class="ol-act">
                        <view class="btn-primary slim" hover-class="pressed" @tap.stop.prevent="payAgain" :data-id="item.id">继续支付</view>
                    </view>
                </view>
            </view>
            <view v-if="offline && list.length" class="ol-hint">网络不通，显示的是本机记录的订单</view>
            <view class="ol-pad"></view>
        </scroll-view>

        <!-- 订单详情（底部弹层） -->
        <view v-if="detail" class="ol-mask" @tap="closeDetail">
            <view class="ol-sheet" @tap.stop.prevent="noop">
                <view class="ol-sheet-head">
                    <text class="ol-sheet-title">订单详情</text>
                    <text class="ol-sheet-x" @tap.stop.prevent="closeDetail">✕</text>
                </view>
                <scroll-view scroll-y class="ol-sheet-body" enhanced :show-scrollbar="false">
                    <view :class="'ol-status ' + detail.stCls">
                        <view class="ol-status-t">{{ detail.stText }}</view>
                        <view class="ol-status-d">{{ detail.stDesc }}</view>
                    </view>

                    <view class="ol-sec-t">作品{{ detail.works ? ' · ' + detail.works.length + ' 件' : '' }}</view>
                    <block v-if="detail.works">
                        <view class="ol-kv" v-for="(item, index) in detail.works" :key="index">
                            <text class="k">{{ index + 1 }}</text>

                            <view class="v">
                                <view>{{ item.name }} · ¥{{ item.yuan }}</view>
                                <view class="ol-kv-sub">{{ item.dims }} · {{ item.finishText }}</view>
                                <image v-if="previews[index]" class="ol-pattern" :src="previews[index]" mode="aspectFit" @tap="previewPattern" :data-index="index" />
                                <view v-if="previews[index]" class="ol-kv-sub">点图放大</view>
                            </view>
                        </view>
                    </block>
                    <block v-else>
                        <view class="ol-kv">
                            <text class="k">名称</text>
                            <text class="v">{{ detail.name }}</text>
                        </view>
                        <view class="ol-kv">
                            <text class="k">规格</text>
                            <text class="v">{{ detail.dims }}</text>
                        </view>
                        <view v-if="detail.finishText" class="ol-kv">
                            <text class="k">烫法</text>
                            <text class="v">{{ detail.finishText }}{{ detail.holeText ? ' · ' + detail.holeText : '' }}</text>
                        </view>
                        <image v-if="previews[0]" class="ol-pattern ol-pattern-single" :src="previews[0]" mode="aspectFit" @tap="previewPattern" data-index="0" />
                        <view v-if="previews[0]" class="ol-kv-sub">点图放大</view>
                    </block>
                    <view v-if="detail.note" class="ol-kv">
                        <text class="k">备注</text>
                        <text class="v">{{ detail.note }}</text>
                    </view>

                    <view class="ol-sec-t">配送</view>
                    <view class="ol-kv">
                        <text class="k">方式</text>
                        <text class="v">{{ detail.deliveryText }}</text>
                    </view>
                    <block v-if="detail.delivery === 'express'">
                        <view v-if="detail.address" class="ol-kv">
                            <text class="k">收货</text>
                            <view class="v">
                                <view>{{ detail.address.name }} {{ detail.address.tel }}</view>
                                <view>{{ detail.address.full }}</view>
                            </view>
                        </view>
                        <view v-if="detail.trackingNo" class="ol-kv">
                            <text class="k">快递</text>
                            <view class="v">
                                {{ detail.carrier || '' }}
                                <text :selectable="true">{{ detail.trackingNo }}</text>
                            </view>
                        </view>
                        <!-- 物流（后端接了快递查询才有）：当前状态 + 轨迹时间线，默认最近 3 条 -->
                        <view v-if="detail.logi" class="ol-logi">
                            <view class="ol-logi-head">
                                <text :class="'ol-logi-st ' + detail.logi.cls">{{ detail.logi.text }}</text>
                                <text v-if="detail.logi.lastTime" class="ol-logi-time">{{ detail.logi.lastTime }} 更新</text>
                            </view>
                            <block v-if="traces.length">
                                <view
                                    v-if="traceAll || index < 3"
                                    :class="'ol-tr ' + (index === 0 ? 'now' : '') + ' ' + (index === traces.length - 1 || (!traceAll && index === 2) ? 'end' : '')"
                                    v-for="(item, index) in traces"
                                    :key="index"
                                >
                                    <view class="ol-tr-dot"></view>

                                    <view class="ol-tr-body">
                                        <view class="ol-tr-text">{{ item.text }}</view>
                                        <view class="ol-tr-time">{{ item.time }}</view>
                                    </view>
                                </view>
                                <view v-if="traces.length > 3" class="ol-tr-more" @tap="toggleTraces">{{ traceAll ? '收起' : '查看全部 ' + traces.length + ' 条物流 ›' }}</view>
                            </block>
                            <view v-else-if="detail.logi.last" class="ol-tr now end">
                                <view class="ol-tr-dot"></view>
                                <view class="ol-tr-body">
                                    <view class="ol-tr-text">{{ detail.logi.last }}</view>
                                </view>
                            </view>
                            <view v-else class="ol-tr-empty">快递公司还没有返回轨迹，一般揽收后几小时内会更新</view>
                        </view>
                    </block>
                    <block v-else>
                        <view v-if="detail.pickupAddress" class="ol-kv">
                            <text class="k">地址</text>
                            <text class="v" :selectable="true">{{ detail.pickupAddress }}</text>
                        </view>
                        <view v-else class="ol-kv">
                            <text class="k">地址</text>
                            <text class="v">{{ pickupArea }}，派单后在这里显示具体地址</text>
                        </view>
                        <view v-if="detail.phone" class="ol-kv">
                            <text class="k">手机</text>
                            <text class="v">{{ detail.phone }}</text>
                        </view>
                    </block>

                    <view class="ol-sec-t">费用</view>
                    <view class="ol-kv" v-for="(item, index) in detail.items" :key="index">
                        <text class="k">{{ item.label }}</text>

                        <text class="v">¥{{ item.yuan }}</text>
                    </view>
                    <view class="ol-kv total">
                        <text class="k">合计</text>
                        <text class="v">¥{{ detail.totalYuan }}</text>
                    </view>
                    <view v-if="detail.refundedFen" class="ol-kv">
                        <text class="k">已退款</text>
                        <text class="v">¥{{ detail.refundedYuan }}</text>
                    </view>
                    <view class="ol-kv dim" v-for="(item, index) in detail.refunds" :key="index">
                        <text class="k">退款</text>

                        <text class="v">¥{{ item.yuan }} · {{ item.timeText }}{{ item.reason ? ' · ' + item.reason : '' }}</text>
                    </view>

                    <view class="ol-kv dim">
                        <text class="k">订单号</text>
                        <text class="v" :selectable="true">{{ detail.id }}</text>
                    </view>
                    <view class="ol-kv dim">
                        <text class="k">下单</text>
                        <text class="v">{{ detail.timeText }}</text>
                    </view>
                    <view v-if="detail.paidText" class="ol-kv dim">
                        <text class="k">支付</text>
                        <text class="v">{{ detail.paidText }}</text>
                    </view>

                    <view class="ol-btns">
                        <view v-if="detail.canPay" class="btn-primary ol-btn" hover-class="pressed" @tap="payAgain">继续支付</view>
                        <view v-if="detail.canConfirm" class="btn-primary ol-btn" hover-class="pressed" @tap="confirmReceipt">确认收货</view>
                        <button v-if="detail.canContact" class="btn-ghost slim2 c-green ol-btn" hover-class="pressed" open-type="contact" :session-from="'order:' + detail.id">
                            联系客服
                        </button>
                        <view v-if="detail.canCancel" class="btn-ghost slim2 c-mute ol-btn" hover-class="pressed" @tap="cancelOrder">取消订单</view>
                    </view>
                </scroll-view>
            </view>
        </view>
        <canvas type="2d" id="order-preview-canvas" class="ol-preview-canvas" :style="'width:' + capW + 'px;height:' + capH + 'px'" />
    </view>
</template>

<script>
// 我的代拼订单：列表（服务端权威，离线退回本地索引）+ 详情弹层
// （继续支付 / 取消未付订单 / 确认收货 / 联系客服）。刚支付完回来时轮询几次等支付回调落地。
const order = require('../../utils/order');
const { store } = require('../../utils/store');
const { cfg } = require('../../utils/config');
const ui = require('../../utils/ui');
const { renderPatternTo } = require('../../utils/board');
const { PALETTE } = require('../../utils/palette');
function parsePattern(payload) {
    try {
        const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
        if (!p || !Number.isInteger(p.w) || !Number.isInteger(p.h) || p.w < 1 || p.h < 1 || p.w > 256 || p.h > 256 || !Array.isArray(p.cells) || p.cells.length !== p.w * p.h) {
            return null;
        }
        const palette = Array.isArray(p.palette) && p.palette.length ? p.palette : null;
        if (palette && !palette.every((hex) => typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex))) {
            return null;
        }
        if (!p.cells.every((v) => Number.isInteger(v) && v >= -1 && v < (palette ? palette.length : PALETTE.length))) {
            return null;
        }
        return {
            w: p.w,
            h: p.h,
            cells: p.cells,
            palette: palette || undefined
        };
    } catch (e) {
        return null;
    }
}
export default {
    data() {
        return {
            insets: {
                top: 24,
                h: 44,
                right: 8
            },

            list: [],
            loading: true,
            offline: false,
            detail: null,

            // 当前展开的订单视图模型
            pickupArea: '',

            // 自取范围文案（派单前详情里没有具体地址时显示）
            cartN: 0,

            // 代拼篮里没下单的作品数（多图订单开了才有）
            traces: [],

            // 详情里的物流轨迹（新的在前），后端接了快递查询才有
            traceAll: false,

            // 轨迹默认只显示最近 3 条
            previews: [],

            capW: 1,
            capH: 1,
            name: '',
            tel: '',
            full: '',
            cls: '',
            text: '',
            lastTime: '',
            last: ''
        };
    },
    onLoad(q) {
        this.focusId = (q && q.id) || '';
        this.justPaid = !!(q && q.paid === '1');
        this.setData({
            insets: ui.navInsets(),
            pickupArea: cfg.ORDER.pickupArea
        });
    },
    onShow() {
        // 篮子里的作品可能已被删：只数还在的
        this.cart = cfg.ORDER.multi ? order.cartRead().filter((c) => store.get(c.id)) : [];
        this.setData({
            cartN: this.cart.length
        });
        this.refresh();
    },
    onUnload() {
        this._polling = false;
        this._previewToken = null;
    },
    methods: {
        goCart() {
            if (this.cart && this.cart.length) {
                uni.navigateTo({
                    url: '/pages/order/order?id=' + this.cart[this.cart.length - 1].id
                });
            }
        },

        goBack() {
            uni.navigateBack({
                fail: () => ui.backHome()
            });
        },

        noop() {},

        refresh() {
            order
                .list()
                .then((list) => {
                    const vms = list.map(order.toVM);
                    this.setData({
                        list: vms,
                        loading: false,
                        offline: false
                    });
                    this.afterLoadFun(vms);
                })
                .catch((err) => {
                    const vms = order.localList().map(order.toVM);
                    this.setData({
                        list: vms,
                        loading: false,
                        offline: true
                    });
                    if (err && err.code === 404) {
                        ui.toast(order.errText(err));
                    }
                    this.afterLoadFun(vms);
                });
        },

        // 从下单页带 id 进来：自动展开该单；刚支付完但回调可能还没到 → 轮询
        afterLoadFun(vms) {
            const id = this.focusId;
            if (!id) {
                return;
            }
            this.focusId = '';
            const o = vms.find((x) => x.id === id);
            if (o) {
                this.showDetailFun(o);
            }
            if (this.justPaid && o && o.status === 'unpaid') {
                this.pollFun(id, 6);
            }
            this.justPaid = false;
        },

        pollFun(id, left) {
            if (left <= 0) {
                return;
            }
            this._polling = true;
            setTimeout(() => {
                if (!this._polling) {
                    return;
                }
                order
                    .get(id)
                    .then((o) => {
                        if (o.status !== 'unpaid') {
                            this.patchFun(order.toVM(o));
                            return;
                        }
                        this.pollFun(id, left - 1);
                    })
                    .catch(() => this.pollFun(id, left - 1));
            }, 1500);
        },

        patchFun(vm) {
            const list = this.list.map((x) => (x.id === vm.id ? vm : x));
            const patch = {
                list
            };
            if (this.detail && this.detail.id === vm.id) {
                patch.detail = vm;
            }
            this.setData(patch);
        },

        openDetail(e) {
            const id = e.currentTarget.dataset.id;
            const o = this.list.find((x) => x.id === id);
            if (o) {
                this.showDetailFun(o);
            }
            order
                .get(id)
                .then((x) => {
                    const vm = order.toVM(x);
                    this.patchFun(vm);
                    if (this.detail && this.detail.id === id) {
                        this.renderPreviewsFun(x);
                    }
                    if (!o) {
                        this.loadTrackFun(vm);
                    } // 列表里没有（离线索引）时，拿到详情再拉轨迹
                })
                .catch(() => {
                    /* 用列表里的 */
                });
        },

        showDetailFun(vm) {
            this._previewToken = {};
            this.setData({
                detail: vm,
                traces: [],
                traceAll: false,
                previews: []
            });
            this.loadTrackFun(vm);
        },

        renderPreviewsFun(raw) {
            const token = (this._previewToken = {});
            const entries = Array.isArray(raw.works) && raw.works.length ? raw.works : [raw];
            const patterns = entries.map((x) => {
                const p = parsePattern(x.payload);
                if (p) {
                    p.name = x.name || '拼豆作品';
                }
                return p;
            });
            if (!patterns.some(Boolean)) {
                return;
            }
            ui.queryNode(this, '#order-preview-canvas')
                .then((info) => {
                    if (!info || !info.node || this._previewToken !== token) {
                        return;
                    }
                    const previews = patterns.map(() => '');
                    return patterns.reduce(
                        (chain, p, i) =>
                            chain.then(() => {
                                if (!p || this._previewToken !== token) {
                                    return;
                                }
                                const cellPx = Math.max(5, Math.min(12, Math.floor(560 / Math.max(p.w, p.h))));
                                const drawPreview = () =>
                                    renderPatternTo(info.node, p, {
                                        cellPx,
                                        matte: true,
                                        scale: 1
                                    });
                                return ui.captureCanvas(this, info.node, drawPreview, '#order-preview-canvas').then((path) => {
                                    if (this._previewToken !== token) {
                                        return;
                                    }
                                    previews[i] = path;
                                    this.setData({
                                        previews: previews.slice()
                                    });
                                });
                            }),
                        Promise.resolve()
                    );
                })
                .catch(() => {
                    /* 图纸缺失或绘制失败时，订单文字仍可查看 */
                });
        },

        previewPattern(e) {
            const index = Number(e.currentTarget.dataset.index);
            const urls = this.previews.filter(Boolean);
            const current = this.previews[index];
            if (current) {
                uni.previewImage({
                    current,
                    urls
                });
            }
        },

        // 物流轨迹：只有快递单、且后端返回了 logistics（接了快递查询）才拉；失败就不显示轨迹，单号仍可查看
        loadTrackFun(vm) {
            if (!vm || !vm.logi) {
                return;
            }
            const id = vm.id;
            order
                .track(id)
                .then((t) => {
                    const d = this.detail;
                    if (!d || d.id !== id) {
                        return;
                    }
                    const patch = {
                        traces: t.traces
                    };
                    if (t.logi) {
                        patch['detail.logi'] = t.logi;
                    }
                    this.setData(patch);
                })
                .catch(() => {
                    /* 忽略 */
                });
        },

        toggleTraces() {
            this.setData({
                traceAll: !this.traceAll
            });
        },

        closeDetail() {
            this._previewToken = null;
            this.setData({
                detail: null,
                traces: [],
                previews: []
            });
        },

        /* ---------- 操作 ---------- */
        payAgain(e) {
            const id = (e && e.currentTarget && e.currentTarget.dataset.id) || (this.detail && this.detail.id);
            if (!id || this._busy) {
                return;
            }
            this._busy = true;
            uni.showLoading({
                title: '拉起支付',
                mask: true
            });
            order
                .payParams(id)
                .then((p) => {
                    uni.hideLoading();
                    return order.requestPay(p);
                })
                .then((r) => {
                    this._busy = false;
                    if (r === 'ok') {
                        ui.toast('支付成功 ✨');
                        this.justPaid = true;
                    } else {
                        ui.toast('还没支付');
                    }
                    this.focusId = id;
                    this.refresh();
                })
                .catch((err) => {
                    uni.hideLoading();
                    this._busy = false;
                    ui.toast(order.errText(err));
                });
        },

        cancelOrder() {
            const d = this.detail;
            if (!d || !d.canCancel) {
                return;
            }
            uni.showModal({
                title: '取消订单',
                content: '确定取消「' + d.name + '」的代拼订单吗？',
                confirmText: '取消订单',
                cancelText: '再想想',
                confirmColor: '#C9838F',
                success: (r) => {
                    if (!r.confirm) {
                        return;
                    }
                    order
                        .cancel(d.id)
                        .then(() => {
                            ui.toast('已取消');
                            this.focusId = d.id;
                            this.refresh();
                        })
                        .catch((err) => ui.toast(order.errText(err)));
                }
            });
        },

        confirmReceipt() {
            const d = this.detail;
            if (!d || !d.canConfirm) {
                return;
            }
            uni.showModal({
                title: '确认收货',
                content: '收到成品了吗？确认后订单完成、款项结算给商家，之后不能再申请退款。有问题请先联系客服。',
                confirmText: '已收到',
                cancelText: '还没有',
                confirmColor: '#C9838F',
                success: (r) => {
                    if (!r.confirm) {
                        return;
                    }
                    order
                        .confirm(d.id)
                        .then(() => {
                            ui.toast('已完成，感谢支持 ✨');
                            this.focusId = d.id;
                            this.refresh();
                        })
                        .catch((err) => ui.toast(order.errText(err)));
                }
            });
        }
    }
};
</script>
<style>
/* 我的订单：列表卡片 + 详情底部弹层 */
.olpage {
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
}
.olpage .topbar {
    padding-left: 16px;
    background: var(--bg);
    position: relative;
}
.ol-scroll {
    flex: 1;
    min-height: 0;
}
.ol-pad {
    height: 30px;
}

.ol-empty {
    max-width: 560px;
    margin: 8px auto;
    padding: 48px 20px;
    text-align: center;
    color: var(--ink2);
    line-height: 1.9;
    font-size: 15px;
    border: 3px dashed rgba(95, 74, 78, 0.3);
}
.ol-hint {
    text-align: center;
    font-size: 12px;
    color: var(--ink2);
    padding: 10px;
}
/* 代拼篮还有没下单的作品 */
.ol-cart {
    max-width: 528px;
    margin: 4px auto 10px;
    padding: 10px 14px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 700;
    background: var(--coin);
    border: 3px solid var(--ink);
    box-shadow: 3px 3px 0 var(--coin-dark);
}
.olpage .ol-cart {
    width: calc(100% - 32px);
}
.ol-cart-go {
    margin-left: auto;
    color: var(--accent-dark);
    font-weight: 900;
    flex-shrink: 0;
}
.ol-kv-sub {
    font-size: 12px;
    color: var(--ink2);
}
.ol-pattern {
    display: block;
    width: 112px;
    height: 84px;
    margin-top: 3px;
    background: #fff;
    box-sizing: border-box;
}
.ol-pattern-single {
    width: 120px;
    height: 90px;
    margin: 2px 0 0 54px;
}
.ol-preview-canvas {
    position: fixed;
    left: -10000px;
    top: 0;
    opacity: 0;
    pointer-events: none;
}

/* 物流：状态徽标 + 时间线（最新一条高亮） */
.ol-logi {
    margin: 4px 2px 6px;
    padding: 10px 12px;
    background: var(--chipbg);
    border: 2px solid var(--ink);
}
.ol-logi-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
}
.ol-logi-st {
    font-size: 12px;
    font-weight: 900;
    padding: 2px 8px;
    border: 2px solid var(--ink);
    background: #cde3f2;
    color: #3d5a78;
}
.ol-logi-st.wait {
    background: #ffe39a;
    color: #7a5a2e;
}
.ol-logi-st.ok {
    background: #b7e6a6;
    color: #2f6b2a;
}
.ol-logi-st.bad {
    background: #ffe3e3;
    color: #a32c2c;
}
.ol-logi-time {
    font-size: 11px;
    color: var(--ink2);
}
.ol-tr {
    position: relative;
    display: flex;
    gap: 10px;
    padding-bottom: 10px;
}
.ol-tr::before {
    content: '';
    position: absolute;
    left: 4px;
    top: 12px;
    bottom: 0;
    width: 2px;
    background: #e2dad3;
}
.ol-tr.end::before {
    display: none;
}
.ol-tr-dot {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    margin-top: 4px;
    background: #d8cfc8;
    border: 2px solid var(--card);
    box-sizing: border-box;
}
.ol-tr.now .ol-tr-dot {
    background: var(--accent-dark);
}
.ol-tr-body {
    flex: 1;
    min-width: 0;
}
.ol-tr-text {
    font-size: 12px;
    line-height: 1.55;
    color: var(--ink2);
    word-break: break-all;
}
.ol-tr.now .ol-tr-text {
    color: var(--ink);
    font-weight: 700;
}
.ol-tr-time {
    font-size: 11px;
    color: #b9ada9;
    margin-top: 2px;
}
.ol-tr-more {
    font-size: 12px;
    font-weight: 800;
    color: var(--accent-dark);
    text-align: center;
    padding-top: 2px;
}
.ol-tr-empty {
    font-size: 12px;
    color: var(--ink2);
    line-height: 1.5;
}

.ol-list {
    max-width: 560px;
    margin: 0 auto;
    padding: 4px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.ol-card {
    background: var(--card);
    border: 3px solid var(--ink);
    box-shadow: 4px 4px 0 #e2dad3;
    padding: 12px 14px;
    transition: transform 0.12s;
}
.ol-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}
.ol-name {
    flex: 1;
    min-width: 0;
    font-size: 15px;
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ol-meta {
    font-size: 12px;
    color: var(--ink2);
    margin-top: 4px;
}
.ol-bot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
}
.ol-time {
    font-size: 12px;
    color: var(--ink2);
}
.ol-total {
    font-size: 16px;
    font-weight: 900;
    color: var(--accent-dark);
}
.ol-act {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
}

/* 状态徽标 */
.ol-st {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 800;
    padding: 3px 8px;
    border: 2px solid var(--ink);
    background: var(--chipbg);
    color: var(--ink);
}
.ol-st.unpaid {
    background: #ffe39a;
    color: #7a5a2e;
}
.ol-st.paid {
    background: #cde3f2;
    color: #3d5a78;
}
.ol-st.making {
    background: var(--coin);
    color: var(--ink);
}
.ol-st.ship {
    background: #b7e6a6;
    color: #2f6b2a;
}
.ol-st.done {
    background: #9eb995;
    color: #fff;
}
.ol-st.off {
    background: #ece4dc;
    color: var(--ink2);
}

/* 详情弹层 */
.ol-mask {
    position: fixed;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    background: rgba(30, 20, 15, 0.42);
    z-index: 200;
    display: flex;
    align-items: flex-end;
}
.ol-sheet {
    width: 100%;
    box-sizing: border-box;
    background: var(--card);
    border-top: 3px solid var(--ink);
    box-shadow: 0 -4px 0 #f0e5de;
    padding: 14px 16px calc(14px + env(safe-area-inset-bottom));
    max-height: 84vh;
    display: flex;
    flex-direction: column;
}
.ol-sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    flex-shrink: 0;
}
.ol-sheet-title {
    font-size: 16px;
    font-weight: 800;
}
.ol-sheet-x {
    font-size: 16px;
    color: var(--ink2);
    padding: 4px 10px;
}
.ol-sheet-body {
    height: 66vh;
} /* scroll-view 要有确定高度才能滚（flex 派生高度真机不滚） */

.ol-status {
    padding: 12px 14px;
    border: 3px solid var(--ink);
    background: var(--chipbg);
    margin-bottom: 12px;
}
.ol-status.unpaid {
    background: #fff3d0;
}
.ol-status.paid {
    background: #e4f0f9;
}
.ol-status.making {
    background: #fbeaed;
}
.ol-status.ship {
    background: #e6f5e0;
}
.ol-status.done {
    background: #e6f0e4;
}
.ol-status-t {
    font-size: 17px;
    font-weight: 900;
}
.ol-status-d {
    font-size: 12px;
    color: var(--ink2);
    margin-top: 4px;
    line-height: 1.6;
    white-space: pre-line;
}

.ol-sec-t {
    font-size: 12px;
    font-weight: 800;
    color: var(--accent-dark);
    letter-spacing: 1px;
    margin: 12px 2px 4px;
}
.ol-kv {
    display: flex;
    gap: 12px;
    padding: 6px 2px;
    font-size: 13px;
    line-height: 1.5;
}
.ol-kv .k {
    flex-shrink: 0;
    width: 44px;
    color: var(--ink2);
    font-weight: 700;
}
.ol-kv .v {
    flex: 1;
    min-width: 0;
    color: var(--ink);
    word-break: break-all;
    white-space: pre-line;
}
.ol-kv.total .v {
    font-weight: 900;
    color: var(--accent-dark);
    font-size: 15px;
}
.ol-kv.dim .v {
    color: var(--ink2);
    font-size: 12px;
}
.ol-copy {
    color: var(--accent-dark);
    font-weight: 800;
    font-size: 12px;
    margin-left: 6px;
}

.ol-btns {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 16px 0 6px;
}
.ol-btn {
    width: 100%;
    text-align: center;
    align-self: auto;
    box-sizing: border-box;
}
button.ol-btn {
    padding: 11px 16px;
    line-height: 1.45;
    border-radius: 0;
}
</style>
