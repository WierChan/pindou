<template>
    <view class="setpage">
        <view class="topbar" :style="'padding-top:' + insets.top + 'px;padding-right:' + insets.right + 'px'">
            <view class="tb-back" hover-class="pressed" @tap="goBack">‹</view>
            <view class="tb-title">设置</view>
            <view class="tb-actions"></view>
        </view>

        <view class="set-scroll">
            <!-- 声音 -->
            <view class="set-sec">
                <view class="set-sec-t">声音</view>
                <view class="set-card">
                    <view class="set-row">
                        <view class="set-lb">音效</view>
                        <view class="seg">
                            <view :class="'seg-i ' + (sfxOn ? 'on' : '')" hover-class="pressed" data-v="1" @tap="setSfx">开</view>
                            <view :class="'seg-i ' + (!sfxOn ? 'on' : '')" hover-class="pressed" data-v="0" @tap="setSfx">关</view>
                        </view>
                    </view>
                    <view class="set-row">
                        <view class="set-lb">
                            背景音乐
                            <text class="set-sub">（拼豆页）</text>
                        </view>
                        <view class="seg">
                            <view :class="'seg-i ' + (bgmOn ? 'on' : '')" hover-class="pressed" data-v="1" @tap="setBgm">开</view>
                            <view :class="'seg-i ' + (!bgmOn ? 'on' : '')" hover-class="pressed" data-v="0" @tap="setBgm">关</view>
                        </view>
                    </view>
                </view>
            </view>

            <!-- 拼豆偏好 -->
            <view class="set-sec">
                <view class="set-sec-t">拼豆偏好</view>
                <view class="set-card">
                    <view class="set-row">
                        <view class="set-lb">豆子形状</view>
                        <view class="seg">
                            <view :class="'seg-i ' + (beadShape === 'square' ? 'on' : '')" hover-class="pressed" data-v="square" @tap="setShape">方形</view>
                            <view :class="'seg-i ' + (beadShape === 'round' ? 'on' : '')" hover-class="pressed" data-v="round" @tap="setShape">圆形</view>
                        </view>
                    </view>
                    <view class="set-row">
                        <view class="set-lb">划动方式</view>
                        <view class="seg">
                            <view :class="'seg-i ' + (!paintOn ? 'on' : '')" hover-class="pressed" data-v="0" @tap="setPaint">拖动画布</view>
                            <view :class="'seg-i ' + (paintOn ? 'on' : '')" hover-class="pressed" data-v="1" @tap="setPaint">连续上豆</view>
                        </view>
                    </view>
                    <view class="set-row">
                        <view class="set-lb">定位高亮</view>
                        <view class="seg">
                            <view :class="'seg-i ' + (!locateOn ? 'on' : '')" hover-class="pressed" data-v="0" @tap="setLocate">关</view>
                            <view :class="'seg-i ' + (locateOn ? 'on' : '')" hover-class="pressed" data-v="1" @tap="setLocate">开</view>
                        </view>
                    </view>
                </view>
                <view class="set-hint">划动方式、定位高亮是拼豆页每次打开的默认值，拼的时候仍可随时切换。</view>
            </view>

            <!-- 熨烫成品默认 -->
            <view class="set-sec">
                <view class="set-sec-t">熨烫成品默认</view>
                <view class="set-card">
                    <view class="set-row col">
                        <view class="set-lb">烫法</view>
                        <view class="fin-groups">
                            <view class="fin-group" v-for="(item, index) in finishGroups" :key="index">
                                <view class="fin-cat">{{ item.label }}</view>

                                <view class="fin-chips">
                                    <view
                                        :class="'fin-chip ' + (finish === it.key ? 'on' : '')"
                                        hover-class="pressed"
                                        :data-v="it.key"
                                        @tap="setFinish"
                                        v-for="(it, index1) in item.items"
                                        :key="index1"
                                    >
                                        {{ it.name }}
                                    </view>
                                </view>
                            </view>
                        </view>
                    </view>
                    <view class="set-row">
                        <view class="set-lb">豆孔</view>
                        <view class="seg">
                            <view :class="'seg-i ' + (hole === 'none' ? 'on' : '')" hover-class="pressed" data-v="none" @tap="setHole">无孔</view>
                            <view :class="'seg-i ' + (hole === 'small' ? 'on' : '')" hover-class="pressed" data-v="small" @tap="setHole">小孔</view>
                            <view :class="'seg-i ' + (hole === 'large' ? 'on' : '')" hover-class="pressed" data-v="large" @tap="setHole">大孔</view>
                        </view>
                    </view>
                </view>
                <view class="set-hint">新作品熨烫时的默认烫法与豆孔；每幅作品在熨烫页仍可单独调整。</view>
            </view>

            <!-- 代拼服务 -->
            <view v-if="orderOn" class="set-sec">
                <view class="set-sec-t">代拼服务</view>
                <view class="set-card">
                    <view class="set-row" hover-class="pressed" @tap="goOrders">
                        <view class="set-lb">
                            <image class="pxi" src="/static/assets/icons/parcel.png" />
                            我的订单
                        </view>
                        <view class="set-arrow">›</view>
                    </view>
                </view>
                <view class="set-hint">在作品页点「代拼」，把图纸交给商家拼好、熨烫定型，快递到家或到店自取。</view>
            </view>
        </view>
    </view>
</template>

<script>
// 设置：集中项目里的各项偏好——音效 / 背景音乐 / 豆子形状 / 划动方式 / 定位高亮，
// 以及新作品熨烫时的默认质感、默认豆孔。都各自持久化，页面/组件读同样的 storage key。
const { audio, bgm } = require('../../utils/audio');
const { getBeadShape, setBeadShape, finishList, normFinish } = require('../../utils/board');
const ui = require('../../utils/ui');
const { cfg } = require('../../utils/config');
const K_PAINT = 'pindou.paintMode.v1'; // 划动默认：1 连续上豆 / 其余 拖动画布
const K_LOCATE = 'pindou.locate.v1'; // 定位高亮默认：1 开
const K_FINISH = 'pindou.defaultFinish'; // 默认烫法：10 选 1（见 board.FINISHES）
const K_HOLE = 'pindou.defaultHole'; // 默认豆孔：none / small / large

function rd(k, def) {
    try {
        const v = uni.getStorageSync(k);
        return v === '' || v == null ? def : v;
    } catch (e) {
        return def;
    }
}
function wr(k, v) {
    try {
        uni.setStorageSync(k, v);
    } catch (e) {
    } /* 忽略 */
}
export default {
    data() {
        return {
            insets: {
                top: 24,
                h: 44,
                right: 8
            },

            sfxOn: true,
            bgmOn: true,
            beadShape: 'square',
            paintOn: false,
            locateOn: false,
            finish: 'towel',
            finishGroups: [],
            hole: 'none',
            orderOn: '',

            it: {
                key: '',
                name: ''
            }
        };
    },
    onLoad() {
        this.setData({
            insets: ui.navInsets(),
            sfxOn: !audio.muted,
            bgmOn: bgm.enabled,
            beadShape: getBeadShape(),
            paintOn: rd(K_PAINT, 0) === 1,
            locateOn: rd(K_LOCATE, 0) === 1,
            finish: normFinish(rd(K_FINISH, 'towel')) || 'towel',
            finishGroups: finishList(),
            hole: rd(K_HOLE, 'none'),
            orderOn: cfg.ORDER.enabled
        });
    },
    methods: {
        goBack() {
            uni.navigateBack({
                fail: () => ui.backHome()
            });
        },

        goOrders() {
            uni.navigateTo({
                url: '/pages/orders/orders'
            });
        },

        /* ---- 声音 ---- */
        setSfx(e) {
            const on = e.currentTarget.dataset.v === '1';
            audio.setMuted(!on);
            this.setData({
                sfxOn: on
            });
            if (on) {
                audio.note(880);
            } // 打开时给个"叮"确认
        },

        setBgm(e) {
            const on = e.currentTarget.dataset.v === '1';
            bgm.setEnabled(on); // 只存偏好，不在设置页起播；关掉立即停
            this.setData({
                bgmOn: on
            });
        },

        /* ---- 拼豆偏好 ---- */
        setShape(e) {
            setBeadShape(e.currentTarget.dataset.v);
            this.setData({
                beadShape: getBeadShape()
            });
        },

        setPaint(e) {
            const v = +e.currentTarget.dataset.v;
            wr(K_PAINT, v);
            this.setData({
                paintOn: v === 1
            });
        },

        setLocate(e) {
            const v = +e.currentTarget.dataset.v;
            wr(K_LOCATE, v);
            this.setData({
                locateOn: v === 1
            });
        },

        /* ---- 熨烫成品默认 ---- */
        setFinish(e) {
            const v = e.currentTarget.dataset.v;
            wr(K_FINISH, v);
            this.setData({
                finish: v
            });
        },

        setHole(e) {
            const v = e.currentTarget.dataset.v;
            wr(K_HOLE, v);
            this.setData({
                hole: v
            });
        }
    }
};
</script>
<style>
.setpage {
    min-height: 100vh;
    background: var(--bg);
}
.setpage .topbar {
    padding-left: 16px;
    background: var(--bg);
    z-index: 10;
}

.set-scroll {
    padding: 6px 0 40px;
}

.set-sec {
    max-width: 560px;
    margin: 0 auto 20px;
    padding: 0 16px;
}
.set-sec-t {
    font-size: 13px;
    font-weight: 800;
    color: var(--accent-dark);
    letter-spacing: 1px;
    margin: 0 0 8px 2px;
}
.set-card {
    background: var(--card);
    border: 3px solid var(--ink);
    box-shadow: 4px 4px 0 #e2dad3;
}
.set-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    padding: 12px 14px;
}
.set-row + .set-row {
    border-top: 2px solid #f0e5de;
}
.set-lb {
    font-size: 15px;
    font-weight: 700;
    color: var(--ink);
}
.set-sub {
    font-size: 11px;
    font-weight: 400;
    color: var(--ink2);
}

/* 分段控件 .seg/.seg-i 已提到 app.wxss 全局共用（设置 + 熨烫豆孔） */

.set-hint {
    font-size: 12px;
    color: var(--ink2);
    line-height: 1.6;
    margin: 8px 2px 0;
}

/* 烫法多选：整行竖排（标签在上，分组 chip 在下） */
.set-row.col {
    flex-direction: column;
    align-items: stretch;
}
.set-row.col .set-lb {
    margin-bottom: 2px;
}
.fin-groups {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.fin-cat {
    font-size: 11px;
    font-weight: 700;
    color: var(--accent-dark);
    letter-spacing: 1px;
    margin-bottom: 6px;
}
.fin-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.fin-chip {
    padding: 7px 12px;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink2);
    background: var(--chipbg);
    border: 2px solid var(--ink);
}
.fin-chip.on {
    background: var(--coin);
    color: var(--ink);
    box-shadow: 2px 2px 0 var(--coin-dark);
}

/* 跳转行（我的订单）右侧箭头 */
.set-arrow {
    font-size: 20px;
    font-weight: 800;
    color: var(--ink2);
    line-height: 1;
}
</style>
