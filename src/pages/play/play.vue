<template>
    <view>
        <view class="playpage">
            <view class="topbar" :style="'padding-top:' + insets.top + 'px;padding-right:' + insets.right + 'px'">
                <view class="tb-back" hover-class="pressed" @tap="goBack">‹</view>
                <view class="tb-title">{{ title }}</view>
                <view class="tb-actions">
                    <view class="icon-btn" hover-class="pressed" @tap="toggleShape">{{ beadShape === 'round' ? '●' : '■' }}</view>
                    <view class="icon-btn" hover-class="pressed" @tap="toggleBgm">
                        <image class="pxi-l" :src="bgmOn ? '/assets/icons/musicon.png' : '/assets/icons/musicoff.png'" />
                    </view>
                    <view class="icon-btn" hover-class="pressed" @tap="toggleMute">
                        <image class="pxi-l" :src="muted ? '/assets/icons/sndoff.png' : '/assets/icons/sndon.png'" />
                    </view>
                    <view v-if="debug" class="icon-btn" @tap="debugFill"><image class="pxi-l" src="/static/assets/icons/bolt.png" /></view>
                </view>
            </view>

            <view class="prog-wrap">
                <view class="prog-bar"><view class="fill" :style="'width:' + pct + '%'" /></view>
                <view class="prog-txt">
                    <text class="prog-pct">{{ pct }}%</text>
                    <text class="prog-left">{{ left > 0 ? '还差 ' + left + ' 颗' : '拼齐啦' }}</text>
                </view>
            </view>

            <!-- 代拼入口：画板上方通栏（工具栏里的小 chip 不够醒目，用户要求放到显眼处） -->
            <view v-if="orderOn" class="order-banner" hover-class="pressed" @tap="goOrder">
                <image class="pxi-l ob-ic" src="/static/assets/icons/parcel.png" />
                <view class="ob-txt">
                    <text class="ob-t">不想自己拼？找商家代拼</text>
                    <text class="ob-sub">含豆子和熨烫定型，寄到家或到店自取</text>
                </view>
                <text class="ob-arrow">›</text>
            </view>

            <view class="board-area">
                <canvas type="2d" id="board" class="board" @touchstart="onTS" @touchmove="onTM" @touchend="onTE" @touchcancel="onTE"></canvas>
            </view>

            <view class="bottom-bar">
                <view class="bb-inner">
                    <view class="tools-row">
                        <view v-if="!previewOn" :class="'tool-chip ' + (paintOn ? 'active' : '')" @tap="togglePaint">
                            <image class="pxi-s" src="/static/assets/icons/hand.png" />
                            连续上豆
                        </view>
                        <view
                            v-if="!previewOn"
                            :class="'tool-chip fill-chip ' + (fillArmed ? 'armed' : '') + ' ' + (fillLeft <= 0 ? 'off' : '')"
                            hover-class="pressed"
                            @tap="oneKeyFill"
                        >
                            <image class="pxi-s" src="/static/assets/icons/bolt.png" />
                            一键拼豆 {{ fillLeft }}
                        </view>
                        <view v-if="!previewOn" :class="'tool-chip fillc-chip ' + (fillColorLeft <= 0 ? 'off' : '')" hover-class="pressed" @tap="fillColor">
                            <image class="pxi-s" src="/static/assets/icons/star.png" />
                            拼满此色 {{ fillColorLeft }}
                        </view>
                        <view :class="'tool-chip mode-chip ' + (previewOn ? 'active' : '')" hover-class="pressed" @tap="togglePreview">
                            {{ previewOn ? '返回拼豆' : '查看图纸' }}
                        </view>
                        <view class="tr-btns">
                            <view v-if="!previewOn" :class="'tr-btn loc ' + (locateOn ? 'active' : '')" hover-class="pressed" @tap="toggleLocate">◎</view>
                            <view class="tr-btn" hover-class="pressed" @tap="openSwap">🎨</view>
                            <view class="tr-btn" hover-class="pressed" @tap="openResize">📐</view>
                            <view class="tr-btn" hover-class="pressed" @tap="shareMenu"><image class="pxi-l" src="/static/assets/icons/export.png" /></view>
                            <view class="tr-btn" hover-class="pressed" @tap="zoomFit">⛶</view>
                        </view>
                    </view>
                    <view class="tools-hint row2">
                        {{
                            previewOn
                                ? '点击下方色号，查看图纸中对应的色块'
                                : fillArmed
                                ? '点画板上想拼的位置 → 周围一块向外扩散铺上～'
                                : paintOn
                                ? '划过格子连续上豆！'
                                : '选颜色点格子上豆 ·「一键拼豆」点哪、哪周围一块都铺上'
                        }}
                    </view>
                    <view v-if="fromCode" class="btn-link" @tap="reportImported">举报导入图纸</view>
                    <scroll-view class="palette-bar" scroll-x :scroll-into-view="scrollInto" scroll-with-animation enhanced :show-scrollbar="false">
                        <view
                            :class="'pchip ' + (item.active ? 'active' : '') + ' ' + (item.done ? 'done' : '')"
                            :id="'c' + item.pal"
                            @tap="tapChip"
                            :data-pal="item.pal"
                            v-for="(item, index) in chips"
                            :key="index"
                        >
                            <view class="pdot" :style="'background:' + item.hex + ';color:' + item.tcol">{{ item.code }}</view>

                            <view class="pcount">{{ item.left }}</view>
                        </view>
                    </scroll-view>
                </view>
            </view>

            <canvas v-if="celebrating" type="2d" id="confetti" class="confetti"></canvas>

            <!-- 换色取色器 -->
            <view v-if="swapShow" class="swap-mask" @tap="closeSwap">
                <view class="swap-sheet" @tap.stop.prevent="noop">
                    <view class="swap-head">
                        <text class="swap-title">把「{{ swapFromName }}」换成…</text>
                        <text class="swap-x" @tap.stop.prevent="closeSwap">✕</text>
                    </view>
                    <scroll-view scroll-y class="swap-grid" enhanced :show-scrollbar="false">
                        <view class="swap-wrap">
                            <view
                                class="swap-c"
                                :style="'background:' + item.hex + ';color:' + item.tcol"
                                :data-pal="item.pal"
                                @tap.stop.prevent="pickSwapColor"
                                hover-class="pressed"
                                v-for="(item, index) in swapChips"
                                :key="index"
                            >
                                {{ item.code }}
                            </view>
                        </view>
                    </scroll-view>
                    <view class="swap-tip">选一个颜色，整幅图里这个色都会换过去（已拼的豆也跟着变，进度不丢）</view>
                </view>
            </view>

            <!-- 改大小 / 颜色数（从留档原图高质量重生成） -->
            <view v-if="sizeShow" class="rz-mask" @tap="closeResize">
                <view class="rz-sheet" @tap.stop.prevent="noop">
                    <view class="swap-head">
                        <text class="swap-title">{{ rzHasColor ? '改图纸大小 / 颜色数' : '改图纸大小' }}</text>
                        <text class="swap-x" @tap.stop.prevent="closeResize">✕</text>
                    </view>
                    <view class="rz-pv-wrap"><canvas type="2d" id="rzpv" class="rz-pv" :style="'width:' + rzPvW + 'px;height:' + rzPvH + 'px'"></canvas></view>
                    <view class="rz-info">{{ rzW }} × {{ rzH }} 板 · {{ rzTotal }} 颗 · {{ rzColorN }} 色</view>
                    <view class="rz-row">
                        <text class="rz-lab">大小</text>
                        <slider class="rz-slider" :min="rzSizeMin" :max="rzSizeMax" :value="rzSize" block-size="20" activeColor="#E86A7A" @changing="onRzSize" @change="onRzSize" />
                        <input class="rz-input" type="number" :value="rzSize" @blur="onRzSizeInput" @confirm="onRzSizeInput" />
                    </view>
                    <view v-if="rzHasColor" class="rz-row">
                        <text class="rz-lab">颜色</text>
                        <slider class="rz-slider" min="2" :max="rzColorMax" :value="rzColor" block-size="20" activeColor="#E86A7A" @changing="onRzColor" @change="onRzColor" />
                        <input class="rz-input" type="number" :value="rzColor" @blur="onRzColorInput" @confirm="onRzColorInput" />
                    </view>
                    <view class="rz-warn">⚠ 应用后按新图纸重拼，当前进度会清空{{ rzHasColor ? '' : '；这个作品没原图，放大会变糊' }}</view>
                    <view class="rz-btns">
                        <view class="rz-cancel" hover-class="pressed" @tap="closeResize">取消</view>
                        <view class="rz-apply" hover-class="pressed" @tap="confirmResize">应用</view>
                    </view>
                </view>
            </view>
        </view>

        <canvas type="2d" id="util" class="util-canvas" :style="'width:' + capW + 'px;height:' + capH + 'px'"></canvas>

        <!-- 完成弹窗：页面顶层 + 提升层级，确保盖住画板 canvas -->
        <view v-if="modal.show" class="overlay hi">
            <view class="modal">
                <view class="modal-title">
                    <image class="pxi-l" src="/static/assets/icons/sparkle.png" />
                    豆子拼齐啦！
                </view>
                <view class="modal-art" v-if="modal.img">
                    <image :src="modal.img" :style="'width:' + modal.imgW + 'px;height:' + modal.imgH + 'px'" />
                </view>
                <view class="modal-sub">
                    <view>「{{ title }}」 · {{ total }} 颗豆子 · {{ colorN }} 种颜色</view>
                    <view>最后一步：亲手把它熨烫定型！</view>
                </view>
                <view class="modal-btns">
                    <view class="btn-primary" hover-class="pressed" @tap="goIron">
                        <image class="pxi" src="/static/assets/icons/flame.png" />
                        去熨烫
                    </view>
                </view>
                <view class="btn-link" hover-class="pressed" @tap="goHomeLater">稍后再烫，先回首页</view>
            </view>
        </view>

        <guide :gid="guideId" :steps="guideSteps" @done="onGuideDone" />

        <view v-if="relayCodeShow" class="overlay hi" @tap="closeRelayCode">
            <view class="modal" @tap.stop.prevent="noop">
                <view class="modal-title">接力导入码</view>
                <text class="relay-code" :selectable="true">{{ relayCodeText }}</text>
                <view class="modal-sub">长按口令选中复制并发给好友；好友在「新作品 → 输入导入码」中输入，即可接着拼。</view>
                <view class="btn-link" @tap="closeRelayCode">关闭</view>
            </view>
        </view>
    </view>
</template>

<script>
// 拼豆界面
const { store } = require('../../utils/store');
const { PALETTE, textColorFor, hexToRgb } = require('../../utils/palette');
const { colorStats, nearestPalette, loadImageToData, imageToPattern, reduceColors, resampleCells } = require('../../utils/convert');
const { BoardView, renderPatternTo, patternSize, getBeadShape, setBeadShape } = require('../../utils/board');
const { audio, bgm } = require('../../utils/audio');
const { celebrate } = require('../../utils/confetti');
const ui = require('../../utils/ui');
const { cfg } = require('../../utils/config');
const { buildGuide, guideSeen, markGuideSeen } = require('../../utils/guidance');
const ads = require('../../utils/ads');
const { buildChartExportTo } = require('../../utils/share');
const { createCode, format, reportFlow } = require('../../utils/importcode');
const SIZE_CAP = 256; // 画布长边上限（同 create 页），改大小时的最大豆数
const PAINT_KEY = 'pindou.paintMode.v1'; // 划动模式:1 = 连续上豆 / 其余 = 拖动平移（跨作品记忆）
const LOCATE_KEY = 'pindou.locate.v1'; // 定位高亮:1 = 开（当前色未拼格标红、其余变淡，跨作品记忆）

// 一键拼豆 / 拼满此色：各每天 3 次（全局跨作品，隔天自动重置；不接激励视频补次数——避免被当小游戏审）。
// 两个功能各用一套 day/n 存储键、额度互相独立。
const FILL_PER_DAY = 3;
const FILL_DAY_KEY = 'pindou.fillDay'; // 一键拼豆（点一片圆盘扩散，各色一起）
const FILL_N_KEY = 'pindou.fillLeft';
const FILLC_DAY_KEY = 'pindou.fillColorDay'; // 拼满此色（当前选中色号整幅铺满）
const FILLC_N_KEY = 'pindou.fillColorLeft';
function _fillToday() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function readFillLeft(dayKey, nKey) {
    try {
        if (uni.getStorageSync(dayKey) !== _fillToday()) {
            return FILL_PER_DAY;
        } // 新的一天：满额
        const n = uni.getStorageSync(nKey);
        return n === '' || n == null ? FILL_PER_DAY : n;
    } catch (e) {
        return FILL_PER_DAY;
    }
}
function useFill(dayKey, nKey) {
    const left = Math.max(0, readFillLeft(dayKey, nKey) - 1);
    try {
        uni.setStorageSync(dayKey, _fillToday());
        uni.setStorageSync(nKey, left);
    } catch (e) {
    } /* 忽略 */
    return left;
}
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
            pct: 0,
            chips: [],
            paintOn: false,
            locateOn: false,
            previewOn: false,
            fillLeft: 3,

            // 一键拼豆今日剩余次数
            fillColorLeft: 3,

            // 拼满此色今日剩余次数（独立额度）
            fillArmed: false,

            // 一键拼豆武装中：等用户点画板选一整片同色
            beadShape: 'square',

            muted: false,
            bgmOn: false,
            debug: cfg.DEBUG,
            total: 0,
            left: 0,
            colorN: 0,
            scrollInto: '',
            celebrating: false,

            modal: {
                show: false,
                img: '',
                imgW: 0,
                imgH: 0
            },

            guideSteps: [],
            relayCodeShow: false,
            relayCodeText: '',

            // 换色：把选中的颜色整幅换成另一个（已拼的豆也跟着变，不丢进度）
            swapShow: false,

            swapChips: [],
            swapFromName: '',

            // 改大小/颜色数（会清空进度）。有原图(work.src)=高质量重量化(size+颜色数)；没原图=重采样现图(仅 size)
            sizeShow: false,

            rzMode: 'source',

            // source 照片/表情高质量 / resample 模板·图纸重采样
            rzHasColor: true,

            // 是否显示颜色数滑杆（仅 source 模式）
            rzSize: 52,

            rzSizeMin: 8,
            rzSizeMax: 104,
            rzColor: 12,
            rzColorMax: 48,
            rzW: 0,
            rzH: 0,
            rzTotal: 0,
            rzColorN: 0,
            rzPvW: 0,
            rzPvH: 0,
            fromCode: '',
            orderOn: '',
            guideId: ''
        };
    },
    onLoad(q) {
        const work = store.get(q.id);
        if (!work) {
            ui.backHome();
            return;
        }
        if (work.completed) {
            uni.redirectTo({
                url: (work.ironDone ? '/pages/view/view?id=' : '/pages/iron/iron?id=') + work.id
            });
            return;
        }
        if (work.free) {
            // 自由画布作品走专属页面
            uni.redirectTo({
                url: '/pages/free/free?id=' + work.id
            });
            return;
        }
        this.work = work;
        this.uq = ui.serialQueue();
        // 作品自带色板（图纸导入）：渲染与 UI 用图纸真实颜色，色名借最近的全局色名
        this.palHex = (pal) => (work.palette ? work.palette[pal] : PALETTE[pal].hex);
        this.palName = (pal) => {
            if (!work.palette) {
                return PALETTE[pal].name;
            }
            const c = hexToRgb(work.palette[pal]);
            return PALETTE[nearestPalette(c[0], c[1], c[2])].name;
        };
        // MARD 色号只对全局色板作品展示（自带色板的颜色不是实体豆色，标了会误导买豆）
        this.palCode = (pal) => (work.palette ? '' : PALETTE[pal].code + ' ');
        this.displayCode = (pal) => {
            if (!work.palette) {
                return PALETTE[pal].code;
            }
            const c = hexToRgb(work.palette[pal]);
            return PALETTE[nearestPalette(c[0], c[1], c[2])].code;
        };
        this.chartCodes = () => (work.palette || PALETTE).map((_, pal) => this.displayCode(pal));
        const stats = colorStats(work.cells);
        this.colorsUsed = stats.map((s) => s.pal);
        this.numbers = new Map(this.colorsUsed.map((p, i) => [p, i + 1]));
        this.chipIdx = new Map(this.colorsUsed.map((p, i) => [p, i]));
        this.remaining = new Map(stats.map((s) => [s.pal, s.count]));
        for (let i = 0; i < work.cells.length; i++) {
            if (work.placed[i]) {
                this.remaining.set(work.cells[i], this.remaining.get(work.cells[i]) - 1);
            }
        }
        this.total = stats.reduce((a, s) => a + s.count, 0);
        let left = 0;
        this.remaining.forEach((v) => {
            left += v;
        });
        this.placedCount = this.total - left;
        this.sel = this.colorsUsed.find((p) => this.remaining.get(p) > 0);
        if (this.sel == null) {
            this.sel = this.colorsUsed[0];
        }
        this.previewSel = null;
        this.finished = false;
        this.pending = [];
        this.flushTimer = 0;
        this.saveTimer = 0;
        // 划动模式：关 = 单指拖动平移画布（默认，方便看图找色），开 = 划过格子连续上豆
        this.paintOn = false;
        try {
            this.paintOn = uni.getStorageSync(PAINT_KEY) === 1;
        } catch (e) {
        } /* 忽略 */
        // 定位高亮：关 = 普通淡图纸，开 = 当前色未拼格标红、其余变淡（跨作品记忆）
        this.locateOn = false;
        try {
            this.locateOn = uni.getStorageSync(LOCATE_KEY) === 1;
        } catch (e) {
        } /* 忽略 */
        this.fillArmed = false; // 一键拼豆武装态（不持久化：进页面永远是未武装）

        const chips = this.colorsUsed.map((pal, i) => {
            const n = this.remaining.get(pal);
            return {
                pal,
                num: i + 1,
                code: this.displayCode(pal),
                hex: this.palHex(pal),
                tcol: textColorFor(this.palHex(pal)),
                left: n > 0 ? n : '✓',
                done: n === 0,
                active: pal === this.sel
            };
        });
        this.setData({
            insets: ui.navInsets(),
            title: work.name,
            fromCode: work.fromCode || '',
            chips,
            paintOn: this.paintOn,
            locateOn: this.locateOn,
            fillLeft: readFillLeft(FILL_DAY_KEY, FILL_N_KEY),
            fillColorLeft: readFillLeft(FILLC_DAY_KEY, FILLC_N_KEY),
            beadShape: getBeadShape(),
            muted: audio.muted,
            bgmOn: bgm.enabled,
            total: this.total,
            left: this.total - this.placedCount,
            colorN: this.colorsUsed.length,
            pct: this.pctFun(),
            orderOn: cfg.ORDER.enabled // 代拼入口（后端 order.enabled=false 可收起）
        });
    },
    onReady() {
        if (!this.work) {
            return;
        }
        this.initBoardFun();
        ui.queryNode(this, '#util').then((r) => {
            if (r) {
                this.utilCanvas = r.node;
            }
        });
        // 首次拼豆：讲核心几件事（选色 → 点格子 → 工具 → 右下按钮）。
        // 分层补看：新用户看完整 play；看过 play 的补 play-tools（右下这排按钮后加的）；
        // 都看过的老用户补 play-edit（🎨换色 / 📐改大小 是更晚加的编辑工具，否则老用户发现不了）
        const toolsStep = {
            sel: '.tr-btns',
            text: '右下这排小工具：「◎」定位当前颜色没拼的格子；「🎨」把某个颜色整幅换掉（已拼的也跟着变）；「📐」改图纸大小/颜色数；另外两个是分享、复位视角。'
        };
        const editStep = {
            sel: '.tr-btns',
            text: '右下角两个编辑工具：「🎨」把某个颜色整幅换成别的（已拼的豆也跟着变）、「📐」改图纸大小和颜色数～'
        };
        // 代拼是更晚加的：新用户在完整引导里顺带看，老用户单步补看（play-order）
        const orderOn = this.orderOn;
        const orderStep = {
            sel: '.order-banner',
            text: '不想自己拼？点这条「找商家代拼」，把这张图纸交给商家拼好、熨烫定型，快递到家或到店自取～'
        };
        if (!guideSeen('play')) {
            buildGuide(
                this,
                'play',
                [
                    {
                        sel: '.palette-bar',
                        text: '先在这里选颜色！每种颜色有编号，下面的数字是还差几颗'
                    },
                    {
                        text: '板上淡淡的格子就是图纸。点亮所有跟选中颜色一样的格子吧！点错了我会晃一晃提醒你。双指可以缩放看细节～'
                    },
                    {
                        sel: '.tools-row',
                        text: '开「连续上豆」手指划过就能连着拼；「一键拼豆」点一下再点画板，把落点周围一块（各色）都铺上；「拼满此色」一下把当前选中颜色整幅拼满——后两个都每天有限次～'
                    },
                    toolsStep
                ].concat(orderOn ? [orderStep] : [])
            );
        } else if (!guideSeen('play-tools')) {
            buildGuide(this, 'play-tools', [toolsStep]);
        } else if (!guideSeen('play-edit')) {
            buildGuide(this, 'play-edit', [editStep]);
        } else if (orderOn && !guideSeen('play-order')) {
            buildGuide(this, 'play-order', [orderStep]);
        }
    },
    onResize() {
        this.setData({
            insets: ui.navInsets()
        });
        this.refitBoardFun();
    },
    onShow() {
        if (!this.work) {
            return;
        }
        if (bgm.enabled) {
            bgm.start();
        } // 回到拼豆页续上背景音乐
        // 一键拼豆 / 拼满此色都是每天全局额度，回来各刷新一下
        this.setData({
            fillLeft: readFillLeft(FILL_DAY_KEY, FILL_N_KEY),
            fillColorLeft: readFillLeft(FILLC_DAY_KEY, FILLC_N_KEY)
        });
        if (this.fillArmed) {
            this.setFillArmedFun(false);
        } // 回到页面清掉武装态，避免误触
    },
    onHide() {
        this.flushSaveFun();
        bgm.stop();
        if (this.fillArmed) {
            this.setFillArmedFun(false);
        }
    },
    onUnload() {
        this._gone = true;
        clearTimeout(this.flushTimer);
        clearTimeout(this._rzTimer);
        clearTimeout(this._thumbTimer);
        this.flushSaveFun();
        if (this.bv) {
            this.bv.destroy();
        }
        bgm.stop();
    },
    onShareAppMessage() {
        return {
            title: '拼豆便利店 · 把喜欢的图片，一颗一颗拼出来',
            path: '/pages/home/home'
        };
    },
    methods: {
        // 找商家代拼：把这张图纸交给商家拼好、熨烫定型（下单页选烫法 / 配送 / 支付）
        goOrder() {
            if (this.work) {
                uni.navigateTo({
                    url: '/pages/order/order?id=' + this.work.id
                });
            }
        },

        onGuideDone() {
            // 上层引导已含下层内容，别再让这些用户重复补看
            const id = this.guideId;
            if (id === 'play') {
                markGuideSeen('play-tools');
                markGuideSeen('play-edit');
                if (this.orderOn) {
                    markGuideSeen('play-order');
                }
            } else if (id === 'play-tools') {
                markGuideSeen('play-edit');
            }
            this.setData({
                guideSteps: []
            });
        },

        pctFun() {
            return this.total ? Math.round((this.placedCount / this.total) * 100) : 0;
        },

        initBoardFun() {
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
                    chartCodes: this.chartCodes(),
                    mode: 'play',
                    locate: this.locateOn,
                    preview: this.previewOn,
                    numbers: this.numbers,
                    getSelected: () => (this.previewOn ? this.previewSel : this.sel),
                    canSwipe: () => this.paintOn,
                    onPlace: (i) => this.onPlaceFun(i),
                    onWrong: () => {
                        audio.wrong();
                        try {
                            uni.vibrateShort({
                                type: 'medium'
                            });
                        } catch (e) {
                        } /* 忽略 */
                    },
                    onFill: (filled, cell) => this.onFillFun(filled, cell) // 一键拼豆：铺满点到的那一整片同色
                });
                this.bv.setViewport(r.width, r.height, dpr, r.left, r.top);
                // 布局稳定后复测画布位置，防止部分机型触点参照系偏移
                setTimeout(() => ui.syncBoardRect(this, this.bv), 600);
                // 极端情况：存档已拼满但没标记完成
                if (this.total > 0 && this.placedCount >= this.total && !this.finished) {
                    this.finishFun();
                }
            });
        },

        refitBoardFun() {
            setTimeout(() => ui.syncBoardRect(this, this.bv), 120);
        },

        /* ---------- 画板事件 ---------- */
        onTS(e) {
            if (this.bv && !this.finished) {
                this.bv.touchStart(e);
            }
        },

        onTM(e) {
            if (this.bv && !this.finished) {
                this.bv.touchMove(e);
            }
        },

        onTE(e) {
            if (this.bv) {
                this.bv.touchEnd(e);
            }
        },

        zoomFit() {
            if (this.bv) {
                this.bv.fit();
            }
        },

        // 导出图纸：把这幅图纸（网格 + 色号）保存/分享，拼到一半也能导——对着拼、打印，
        // 或发给好友「导入拼豆图纸」拼同款。跟分享弹窗「保存图纸」同款，走同一激励视频位
        exportChart() {
            const work = this.work;
            if (!work || !this.utilCanvas) {
                return;
            }
            ads.rewarded('rvChart', {
                workId: work.id,
                title: '导出高清图纸',
                desc: '看一段短广告，即可把这幅图纸保存或分享'
            }).then((ok) => {
                if (!ok) {
                    return;
                }
                uni.showLoading({
                    title: '生成中',
                    mask: true
                });
                this.uq(() => ui.captureCanvas(this, this.utilCanvas, () => buildChartExportTo(this.utilCanvas, work)))
                    .then((path) => {
                        uni.hideLoading();
                        ui.shareGeneratedImage(path);
                    })
                    .catch(() => {
                        uni.hideLoading();
                        ui.toast('导出失败，再试一次');
                    });
            });
        },

        // 右下「分享」：导出图纸让好友拼同款，或邀请好友从当前进度接着拼
        shareMenu() {
            uni.showActionSheet({
                itemList: ['导出图纸 · 好友拼同款', '邀请好友接着拼 · 带进度'],
                success: (r) => {
                    if (r.tapIndex === 0) this.exportChart();
                    else if (r.tapIndex === 1) {
                        this.relayShare();
                    }
                },
                fail: () => {
                    /* 取消 */
                }
            });
        },

        // 接力分享：把当前图纸和进度上传成口令，好友在新作品页输入口令接着拼。
        relayShare() {
            const work = this.work;
            if (!work) {
                return;
            }
            const pct = this.pctFun();
            uni.showModal({
                title: '邀请好友接力',
                content: '会把这幅图纸和你「拼到 ' + pct + '%」的进度上传，好友凭口令就能接着拼。请确认这是你原创或已获授权分享的图纸。',
                confirmText: '生成口令',
                cancelText: '先不了',
                confirmColor: '#C9838F',
                success: (r) => {
                    if (!r.confirm) {
                        return;
                    }
                    uni.showLoading({
                        title: '生成中',
                        mask: true
                    });
                    createCode(work, {
                        placed: work.placed
                    })
                        .then((code) => {
                            uni.hideLoading();
                            if (!code) {
                                ui.toast('生成失败，稍后再试');
                                return;
                            }
                            this.setData({
                                relayCodeShow: true,
                                relayCodeText: format(code)
                            });
                        })
                        .catch((err) => {
                            uni.hideLoading();
                            ui.toast((err && err.message) || '生成失败，稍后再试');
                        });
                }
            });
        },

        closeRelayCode() {
            this.setData({
                relayCodeShow: false
            });
        },

        /* ---------- 顶栏 ---------- */
        goBack() {
            this.flushSaveFun();
            ui.backHome();
        },

        toggleMute() {
            audio.setMuted(!audio.muted);
            this.setData({
                muted: audio.muted
            });
        },

        // 🎵 背景音乐开关：与音效静音各自独立，只管拼豆页的循环 BGM
        toggleBgm() {
            this.setData({
                bgmOn: bgm.toggle()
            });
        },

        // 豆子形状切换：全局生效（画板/预览/缩略图/分享图同一套绘制）
        toggleShape() {
            const s = getBeadShape() === 'round' ? 'square' : 'round';
            setBeadShape(s);
            this.setData({
                beadShape: s
            });
            if (this.bv) {
                this.bv.requestRender();
            }
            ui.toast(s === 'round' ? '已切换为圆形豆子 ●' : '已切换为方形豆子 ■');
        },

        debugFill() {
            if (this.finished || !this.bv) {
                return;
            }
            const idx = [];
            for (let i = 0; i < this.work.cells.length; i++) {
                if (this.work.cells[i] >= 0 && !this.work.placed[i]) {
                    idx.push(i);
                }
            }
            if (idx.length) {
                this.bv.placeMany(idx);
                this.applyPlacementFun(idx, 'row');
            }
        },

        /* ---------- 色板 / 工具 ---------- */
        tapChip(e) {
            if (this.finished) {
                return;
            }
            const pal = +e.currentTarget.dataset.pal;
            if (this.previewOn) {
                const old = this.previewSel;
                this.previewSel = old === pal ? null : pal;
                const patch = {};
                if (old != null && this.chipIdx.has(old)) {
                    patch['chips[' + this.chipIdx.get(old) + '].active'] = false;
                }
                if (this.previewSel != null && this.chipIdx.has(this.previewSel)) {
                    patch['chips[' + this.chipIdx.get(this.previewSel) + '].active'] = true;
                }
                this.setData(patch);
                if (this.bv) {
                    this.bv.requestRender();
                }
                return;
            }
            this.setSelFun(pal);
        },

        togglePreview() {
            if (this.finished) {
                return;
            }
            const previewOn = !this.previewOn;
            if (previewOn && this.fillArmed) {
                this.setFillArmedFun(false);
            }
            this.previewSel = null;
            this.setData({
                previewOn,
                chips: this.chips.map((item) =>
                    Object.assign({}, item, {
                        active: !previewOn && item.pal === this.sel
                    })
                )
            });
            if (this.bv) {
                this.bv.setPreview(previewOn);
            }
        },

        setSelFun(pal) {
            const old = this.sel;
            this.sel = pal;
            const patch = {
                scrollInto: 'c' + pal
            };
            if (old != null && this.chipIdx.has(old)) {
                patch['chips[' + this.chipIdx.get(old) + '].active'] = false;
            }
            if (this.chipIdx.has(pal)) {
                patch['chips[' + this.chipIdx.get(pal) + '].active'] = true;
            }
            this.setData(patch);
            if (this.bv) {
                this.bv.requestRender();
            }
        },

        /* ---------- 换色：把当前选中的颜色，整幅换成另一个（已拼的豆跟着变，进度不丢） ---------- */
        noop() {
            /* 挡住蒙层点击穿透 */
        },

        openSwap() {
            if (this.finished) {
                return;
            }
            if (this.sel == null) {
                ui.toast('先在下面选一个要换的颜色');
                return;
            }
            if (!this.swapChips.length) {
                this.buildSwapChipsFun();
            }
            this.setData({
                swapShow: true,
                swapFromName: this.palName(this.sel)
            });
        },

        closeSwap() {
            this.setData({
                swapShow: false
            });
        },

        // 取色器：全色板按色系排序（白灰黑→红→粉→橙棕→黄→绿→蓝青→紫→莫兰迪），同 create 页
        buildSwapChipsFun() {
            const chips = PALETTE.map((c, i) => ({
                pal: i,
                hex: c.hex,
                code: c.code,
                tcol: textColorFor(c.hex),
                k: 'HFEGABCDM'.indexOf(c.code[0]) * 1000 + parseInt(c.code.slice(1), 10)
            })).sort((a, b) => a.k - b.k);
            this.setData({
                swapChips: chips
            });
        },

        pickSwapColor(e) {
            const to = +e.currentTarget.dataset.pal;
            const from = this.sel;
            this.setData({
                swapShow: false
            });
            this.applySwapFun(from, to);
        },

        // fromPal：当前选中色；toGlobalIdx：选的 MARD 全局色号
        applySwapFun(fromPal, toGlobalIdx) {
            const work = this.work;
            if (work.palette) {
                // 图纸作品：cells 里是自带色板的下标，改这个下标的实际颜色即可（下标不变、不合并）
                const newHex = PALETTE[toGlobalIdx].hex;
                if (work.palette[fromPal] === newHex) {
                    return;
                }
                work.palette[fromPal] = newHex;
                // 下标没动 → 沿用原色块顺序，选中还是它、位置不跳
                this.rebuildColorsFun(fromPal, this.colorsUsed.slice());
            } else {
                // 照片作品：cells 里是全局色号，把 fromPal 全部改成 toGlobalIdx（可能与已有色合并）
                if (toGlobalIdx === fromPal) {
                    return;
                }
                const cells = work.cells;
                for (let i = 0; i < cells.length; i++) {
                    if (cells[i] === fromPal) {
                        cells[i] = toGlobalIdx;
                    }
                }
                // 保序：换成的色顶替原色原本的位置（整套不重排），换的这块色块不跳位；
                // 若换成的色本就在用则并入它原本的位置
                const order = [];
                const seen = new Set();
                for (const p of this.colorsUsed) {
                    const q = p === fromPal ? toGlobalIdx : p;
                    if (!seen.has(q)) {
                        seen.add(q);
                        order.push(q);
                    }
                }
                this.rebuildColorsFun(toGlobalIdx, order); // 选中切到换成的新色
            }
            if (this.bv) {
                this.bv.setColors(work.palette || null, this.numbers);
                this.bv.o.chartCodes = this.chartCodes();
                this.bv.requestRender();
            }
            this.savePatternFun();
            this.refreshThumbFun();
            ui.toast('换好啦 ✨');
        },

        // 换色后整套重算颜色相关状态（同 onLoad 里那段），preferSel 为换完后想选中的色；
        // order 为想保持的色块排列（换色前的顺序）——传了就不重排，选中色不跳位；
        // 其中已消失的色剔除、新冒出的色补到末尾。不传则按色号从小到大（同 colorStats）
        rebuildColorsFun(preferSel, order) {
            const work = this.work;
            const counts = new Map();
            for (const t of work.cells) {
                if (t >= 0) {
                    counts.set(t, (counts.get(t) || 0) + 1);
                }
            }
            let used;
            if (order) {
                used = order.filter((p) => counts.has(p));
                for (const p of counts.keys()) {
                    if (used.indexOf(p) < 0) {
                        used.push(p);
                    }
                }
            } else {
                used = [...counts.keys()].sort((a, b) => a - b);
            }
            this.colorsUsed = used;
            this.numbers = new Map(used.map((p, i) => [p, i + 1]));
            this.chipIdx = new Map(used.map((p, i) => [p, i]));
            this.remaining = new Map(used.map((p) => [p, counts.get(p)]));
            for (let i = 0; i < work.cells.length; i++) {
                if (work.placed[i] && work.cells[i] >= 0) {
                    this.remaining.set(work.cells[i], this.remaining.get(work.cells[i]) - 1);
                }
            }
            this.total = used.reduce((a, p) => a + counts.get(p), 0);
            let left = 0;
            this.remaining.forEach((v) => {
                left += v;
            });
            this.placedCount = this.total - left;
            if (preferSel != null && this.chipIdx.has(preferSel)) {
                this.sel = preferSel;
            } else {
                this.sel = used.find((p) => this.remaining.get(p) > 0);
                if (this.sel == null) {
                    this.sel = used[0];
                }
            }
            const chips = used.map((pal, i) => {
                const n = this.remaining.get(pal);
                return {
                    pal,
                    num: i + 1,
                    code: this.displayCode(pal),
                    hex: this.palHex(pal),
                    tcol: textColorFor(this.palHex(pal)),
                    left: n > 0 ? n : '✓',
                    done: n === 0,
                    active: pal === this.sel
                };
            });
            this.setData({
                chips,
                total: this.total,
                left: this.total - this.placedCount,
                colorN: this.colorsUsed.length,
                pct: this.pctFun()
            });
            if (this.total > 0 && this.placedCount >= this.total && !this.finished) {
                this.finishFun();
            }
        },

        savePatternFun() {
            if (!this.work) {
                return;
            }
            const patch = {
                cells: this.work.cells
            };
            if (this.work.palette) {
                patch.palette = this.work.palette;
            }
            store.update(this.work.id, patch);
        },

        // 改了颜色/尺寸后刷新首页缩略图（缩略图是本地按当前 cells/palette 生成的文件，无需后端）；
        // debounce 防连续换色反复重画
        refreshThumbFun() {
            if (!this.utilCanvas || !this.work) {
                return;
            }
            clearTimeout(this._thumbTimer);
            this._thumbTimer = setTimeout(() => {
                if (this._gone || !this.work) {
                    return;
                }
                this.uq(() => ui.makeThumb(this, this.utilCanvas, this.work, false))
                    .then((path) =>
                        store.update(
                            this.work.id,
                            {
                                thumb: path,
                                thumbV: ui.THUMB_V,
                                thumbShape: getBeadShape()
                            },
                            true
                        )
                    )
                    .catch(() => {
                        /* 缩略图刷新失败不影响 */
                    });
            }, 450);
        },

        /* ---------- 改大小 / 颜色数：从留档的原图高质量重新生成（换网格 → 清空进度） ---------- */
        openResize() {
            const work = this.work;
            if (!work) {
                return;
            }
            if (work.src) {
                // 照片/表情：有留档原图 → 高质量重量化（size + 颜色数）
                this._rzMode = 'source';
                if (this._srcData) {
                    this.openResizeSheetFun();
                    return;
                }
                uni.showLoading({
                    title: '读取原图',
                    mask: true
                });
                (this.utilCanvas ? Promise.resolve(this.utilCanvas) : ui.queryNode(this, '#util').then((r) => (this.utilCanvas = r && r.node)))
                    .then((cv) => this.uq(() => loadImageToData(cv, work.src, 512))) // 串到 util canvas 队列，避开缩略图重画
                    .then((d) => {
                        uni.hideLoading();
                        this._srcData = d;
                        this.openResizeSheetFun();
                    })
                    .catch(() => {
                        uni.hideLoading();
                        ui.toast('原图读取失败，换不了大小');
                    });
                return;
            }
            // 模板 / 图纸导入（没原图）：重采样现有豆子图，仅调大小、保留原色板
            this._rzMode = 'resample';
            this.openResizeSheetFun();
        },

        openResizeSheetFun() {
            const work = this.work;
            const source = this._rzMode === 'source';
            // 有原图：上限=原图长边；重采样：可放大到 SIZE_CAP（放大会糊）
            const max = source ? Math.min(SIZE_CAP, Math.max(this._srcData.w, this._srcData.h)) : SIZE_CAP;
            this._rzBase = null;
            this._rzBaseSize = 0;
            this._rzPv = null;
            this.setData(
                {
                    sizeShow: true,
                    rzMode: this._rzMode,
                    rzHasColor: source,
                    rzSize: ui.clamp(Math.max(work.w, work.h), 8, max),
                    rzSizeMin: 8,
                    rzSizeMax: max,
                    rzColor: this.colorsUsed.length,
                    rzColorMax: 48
                },
                () => this.rzRenderFun()
            );
        },

        closeResize() {
            this._rzPv = null;
            this.setData({
                sizeShow: false
            });
        },

        // 生成给定大小/颜色数的图纸。source：imageToPattern 重量化（按 size 缓存 base、只改色数时复用）；
        // resample：直接重采样现有 cells（保留原色板，忽略颜色数）
        rzGenFun(size, colorVal) {
            if (this._rzMode === 'resample') {
                const work = this.work;
                const r = resampleCells(work.cells, work.w, work.h, size);
                return {
                    w: r.w,
                    h: r.h,
                    cells: r.cells,
                    palette: work.palette || null,
                    total: r.cells.filter((c) => c >= 0).length,
                    colorN: colorStats(r.cells).length
                };
            }
            const sd = this._srcData;
            if (!this._rzBase || this._rzBaseSize !== size) {
                this._rzBase = imageToPattern(sd.data, sd.w, sd.h, size, {
                    whiteEmpty: !!this.work.whiteEmpty
                });
                this._rzBaseSize = size;
            }
            const base = this._rzBase;
            let cells = base.cells;
            const natural = colorStats(cells).length;
            const cn = Math.min(colorVal, natural);
            if (cn < natural) {
                cells = reduceColors(cells, cn);
            }
            return {
                w: base.w,
                h: base.h,
                cells,
                palette: null,
                total: cells.filter((c) => c >= 0).length,
                colorN: colorStats(cells).length
            };
        },

        rzRenderFun() {
            const g = this.rzGenFun(this.rzSize, this.rzColor);
            this._rzPattern = {
                w: g.w,
                h: g.h,
                cells: g.cells,
                palette: g.palette || undefined
            };
            const ins = ui.navInsets();
            const maxPx = Math.min(300, ins.winW - 96);
            const cellPx = ui.clamp(Math.floor(maxPx / Math.max(g.w, g.h)), 1, 12);
            const size = patternSize(this._rzPattern, {
                cellPx
            });
            this.setData(
                {
                    rzW: g.w,
                    rzH: g.h,
                    rzTotal: g.total,
                    rzColorN: g.colorN,
                    rzPvW: size.width,
                    rzPvH: size.height
                },
                () => {
                    const paint = (node) =>
                        renderPatternTo(node, this._rzPattern, {
                            cellPx,
                            scale: Math.min(2, ins.dpr)
                        });
                    if (this._rzPv) {
                        paint(this._rzPv);
                        return;
                    }
                    ui.queryNode(this, '#rzpv').then((r) => {
                        if (r && r.node) {
                            this._rzPv = r.node;
                            paint(r.node);
                        }
                    });
                }
            );
        },

        onRzSize(e) {
            const v = e.detail.value;
            if (v === this.rzSize) {
                return;
            }
            this.setData({
                rzSize: v
            });
            this.rzDebounceFun();
        },

        onRzColor(e) {
            const v = e.detail.value;
            if (v === this.rzColor) {
                return;
            }
            this.setData({
                rzColor: v
            });
            this.rzDebounceFun();
        },

        // 手动输入大小/颜色数（超范围自动收进 min~max，回写纠正显示；失焦/回车触发）
        onRzSizeInput(e) {
            let v = parseInt(e.detail.value, 10);
            if (!(v > 0)) {
                v = this.rzSize;
            }
            v = ui.clamp(v, this.rzSizeMin, this.rzSizeMax);
            const changed = v !== this.rzSize;
            this.setData({
                rzSize: v
            });
            if (changed) {
                this.rzRenderFun();
            }
        },

        onRzColorInput(e) {
            let v = parseInt(e.detail.value, 10);
            if (!(v > 0)) {
                v = this.rzColor;
            }
            v = ui.clamp(v, 2, this.rzColorMax);
            const changed = v !== this.rzColor;
            this.setData({
                rzColor: v
            });
            if (changed) {
                this.rzRenderFun();
            }
        },

        rzDebounceFun() {
            clearTimeout(this._rzTimer);
            this._rzTimer = setTimeout(() => {
                if (!this._gone) {
                    this.rzRenderFun();
                }
            }, 130);
        },

        confirmResize() {
            uni.showModal({
                title: '按新图纸重拼？',
                content: '会把图纸改成 ' + this.rzW + '×' + this.rzH + ' 板、' + this.rzColorN + ' 色。当前拼豆进度会清空、从头开始。',
                confirmText: '确定改',
                cancelText: '再想想',
                confirmColor: '#E86A7A',
                success: (r) => {
                    if (r.confirm) {
                        this.applyResizeFun();
                    }
                }
            });
        },

        applyResizeFun() {
            clearTimeout(this._rzTimer);
            const g = this.rzGenFun(this.rzSize, this.rzColor);
            const work = this.work;
            work.w = g.w;
            work.h = g.h;
            work.cells = g.cells;
            work.placed = new Array(g.cells.length).fill(0); // 换网格 → 进度全清
            work.ironed = new Array(g.cells.length).fill(0);
            work.completed = false;
            work.ironDone = false;
            store.update(work.id, {
                w: work.w,
                h: work.h,
                cells: work.cells,
                placed: work.placed,
                ironed: work.ironed,
                completed: false,
                ironDone: false
            });
            this.finished = false;
            this._rzPv = null;
            this.setData({
                sizeShow: false
            });
            this.rebuildColorsFun(); // 重算颜色/进度（全部未拼）
            if (this.bv) {
                this.bv.destroy();
                this.bv = null;
            }
            this.initBoardFun(); // 按新网格重建画板
            this.refreshThumbFun(); // 刷新首页缩略图
            ui.toast('图纸已更新，重新拼吧 ✨');
        },

        /* ---------- 划动模式：拖动平移 ↔ 连续上豆 ---------- */
        // 单指划动二选一（常驻开关，跨作品记忆）：关 = 平移画布，开 = 划过格子连续上豆
        togglePaint() {
            if (this.finished) {
                return;
            }
            this.paintOn = !this.paintOn;
            try {
                uni.setStorageSync(PAINT_KEY, this.paintOn ? 1 : 0);
            } catch (e) {
            } /* 忽略 */
            this.setData({
                paintOn: this.paintOn
            });
            ui.toast(this.paintOn ? '连续上豆：手指划过格子连着拼 ✨' : '已切回拖动画布');
        },

        // 定位高亮：把当前色还没拼的格子标红、其余变淡，一眼看清现在要拼哪（跨作品记忆）
        toggleLocate() {
            if (this.finished) {
                return;
            }
            this.locateOn = !this.locateOn;
            try {
                uni.setStorageSync(LOCATE_KEY, this.locateOn ? 1 : 0);
            } catch (e) {
            } /* 忽略 */
            this.setData({
                locateOn: this.locateOn
            });
            if (this.bv) {
                this.bv.setLocate(this.locateOn);
            }
            ui.toast(this.locateOn ? '定位开：红色就是现在要拼的地方' : '定位已关');
        },

        // 一键拼豆：点一下「武装」，再点画板上想拼的位置 → 以落点为中心，周围一块（各色）向外扩散铺满。每天有限次。
        // 做成两步（先武装再点画板）是因为要让用户指到「哪个位置」——点哪，哪的周围一块就拼上。
        oneKeyFill() {
            if (this.finished || !this.bv) {
                return;
            }
            if (this.fillArmed) {
                this.setFillArmedFun(false);
                return;
            } // 再点一下 = 取消武装
            if (readFillLeft(FILL_DAY_KEY, FILL_N_KEY) <= 0) {
                ui.toast('今天的一键拼豆用完啦，明天再来～');
                return;
            }
            this.setFillArmedFun(true);
            ui.toast('点画板上想拼的位置，周围一块都拼上 ✨');
        },

        // 拼满此色：把整幅里「当前选中色号」的所有未拼豆一次拼上（每天独立 3 次，无需选位置）
        fillColor() {
            if (this.finished || !this.bv) {
                return;
            }
            if (this.fillArmed) {
                this.setFillArmedFun(false);
            } // 顺手收掉一键拼豆的武装态，避免误会
            if (this.sel == null) {
                ui.toast('先在下面选一个颜色');
                return;
            }
            if ((this.remaining.get(this.sel) || 0) <= 0) {
                ui.toast('这个颜色已经拼完啦，换一个色试试～');
                return;
            }
            if (readFillLeft(FILLC_DAY_KEY, FILLC_N_KEY) <= 0) {
                ui.toast('今天的「拼满此色」用完啦，明天再来～');
                return;
            }
            const filled = this.bv.fillColorAll(this.sel);
            if (!filled || !filled.length) {
                ui.toast('这个颜色已经拼完啦～');
                return;
            }
            this.setData({
                fillColorLeft: useFill(FILLC_DAY_KEY, FILLC_N_KEY)
            });
            try {
                uni.vibrateShort({
                    type: 'light'
                });
            } catch (e) {
            } /* 忽略 */
            this.applyPlacementFun(filled, 'fill');
        },

        setFillArmedFun(v) {
            this.fillArmed = v;
            this.setData({
                fillArmed: v
            });
            if (this.bv) {
                this.bv.setFillArmed(v);
            }
        },

        // 画板回调：用户在武装态轻点了画板，filled 是刚铺下的那一块格子（各色）
        onFillFun(filled, cell) {
            if (!filled || !filled.length) {
                // 这块没有可拼的豆（全空 / 已拼完）：不扣次数，保持武装让用户再点
                ui.toast('点画板上还没拼的地方试试～');
                return;
            }
            this.setFillArmedFun(false); // 用掉一次，收起武装
            this.setData({
                fillLeft: useFill(FILL_DAY_KEY, FILL_N_KEY)
            });
            // 顺手把选中色切到点到的那颗，色板高亮跟上
            const tc = this.work.cells[cell];
            if (tc >= 0 && tc !== this.sel && this.chipIdx.has(tc)) {
                this.setSelFun(tc);
            }
            try {
                uni.vibrateShort({
                    type: 'light'
                });
            } catch (e) {
            } /* 忽略 */
            this.applyPlacementFun(filled, 'fill');
        },

        /* ---------- 上豆结算 ---------- */
        onPlaceFun(i) {
            this.pending.push(i);
            if (!this.flushTimer) {
                this.flushTimer = setTimeout(() => {
                    this.flushTimer = 0;
                    const idx = this.pending;
                    this.pending = [];
                    if (idx.length) {
                        this.applyPlacementFun(idx, 'tap');
                    }
                }, 50);
            }
        },

        applyPlacementFun(indices, sound) {
            if (this._gone) {
                return;
            }
            this.placedCount += indices.length;
            const affected = new Set();
            for (const i of indices) {
                const t = this.work.cells[i];
                this.remaining.set(t, this.remaining.get(t) - 1);
                affected.add(t);
            }
            const patch = {
                pct: this.pctFun(),
                left: this.total - this.placedCount
            };
            for (const t of affected) {
                const ci = this.chipIdx.get(t);
                const n = this.remaining.get(t);
                patch['chips[' + ci + '].left'] = n > 0 ? n : '✓';
                patch['chips[' + ci + '].done'] = n === 0;
            }
            this.setData(patch);
            this.scheduleSaveFun();
            if (sound === 'tap') {
                audio.tap();
            }
            if (sound === 'row') {
                audio.rowFill();
            } // 'row' 音效仅剩调试一键完成（debugFill）在用
            if (sound === 'fill') {
                audio.rowFill();
            } // 一键拼豆：一声上扫，配扩散动画
            if (this.placedCount >= this.total) {
                this.finishFun();
                return;
            }
            const doneNow = [...affected].filter((t) => this.remaining.get(t) === 0);
            if (doneNow.length) {
                audio.colorDone();
                // 里程碑轻震：拼完一种颜色（普通上豆不震，震动语义留给错误与里程碑）
                try {
                    uni.vibrateShort({
                        type: 'light'
                    });
                } catch (e) {
                } /* 忽略 */
                ui.toast('「' + this.palCode(doneNow[0]) + this.palName(doneNow[0]) + '」拼完啦 ✓');
                if (doneNow.indexOf(this.sel) >= 0) {
                    const start = this.colorsUsed.indexOf(this.sel);
                    for (let k = 1; k <= this.colorsUsed.length; k++) {
                        const pal = this.colorsUsed[(start + k) % this.colorsUsed.length];
                        if (this.remaining.get(pal) > 0) {
                            this.setSelFun(pal);
                            break;
                        }
                    }
                }
            }
        },

        /* ---------- 存档 ---------- */
        scheduleSaveFun() {
            clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(() => this.flushSaveFun(), 600);
        },

        flushSaveFun() {
            clearTimeout(this.saveTimer);
            if (!this.work) {
                return;
            }
            store.update(this.work.id, {
                placed: this.work.placed,
                completed: this.work.completed || false
            });
        },

        /* ---------- 豆子拼齐 → 引导去熨烫 ---------- */
        finishFun() {
            if (this.finished) {
                return;
            }
            this.finished = true;
            const work = this.work;
            work.completed = true;
            if (!work.ironed || work.ironed.length !== work.cells.length) {
                work.ironed = new Array(work.cells.length).fill(0);
            }
            store.update(work.id, {
                placed: work.placed,
                completed: true,
                ironDone: false,
                ironed: work.ironed
            });
            if (this.utilCanvas) {
                this.uq(() => ui.makeThumb(this, this.utilCanvas, work, false))
                    .then((path) =>
                        store.update(
                            work.id,
                            {
                                thumb: path,
                                thumbV: ui.THUMB_V,
                                thumbShape: getBeadShape()
                            },
                            true
                        )
                    )
                    .catch(() => {
                        /* 缩略图失败不影响流程 */
                    });
            }
            if (this.bv) {
                this.bv.o.mode = 'view';
            }
            setTimeout(() => {
                audio.finish();
                // 里程碑中震：整幅豆子拼齐
                try {
                    uni.vibrateShort({
                        type: 'medium'
                    });
                } catch (e) {
                } /* 忽略 */
                this.celebrateFun();
            }, 350);
            setTimeout(() => this.showDoneModalFun(), 1300);
        },

        celebrateFun() {
            this.setData(
                {
                    celebrating: true
                },
                () => {
                    ui.queryNode(this, '#confetti').then((r) => {
                        if (!r || !r.node) {
                            this.setData({
                                celebrating: false
                            });
                            return;
                        }
                        const dpr = Math.min(2, ui.navInsets().dpr);
                        const hexes = this.colorsUsed.map((p) => this.palHex(p));
                        celebrate(r.node, r.width, r.height, dpr, hexes, () =>
                            this.setData({
                                celebrating: false
                            })
                        );
                    });
                }
            );
        },

        showDoneModalFun() {
            const work = this.work;
            const show = (img, w, h) => {
                const k = Math.min(1, 240 / (h || 240), 250 / (w || 250));
                this.setData({
                    modal: {
                        show: true,
                        img: img || '',
                        imgW: Math.round((w || 0) * k),
                        imgH: Math.round((h || 0) * k)
                    }
                });
            };
            if (!this.utilCanvas) {
                show('', 0, 0);
                return;
            }
            this.uq(() => {
                const cellPx = ui.clamp(Math.floor(240 / Math.max(work.w, work.h)), 4, 16);
                let size = null; // captureCanvas 内部会先调 draw() 再导出
                const draw = () =>
                    (size = renderPatternTo(this.utilCanvas, work, {
                        cellPx,
                        scale: 2
                    }));
                return ui.captureCanvas(this, this.utilCanvas, draw).then((path) => show(path, size.width, size.height));
            }).catch(() => show('', 0, 0));
        },

        goIron() {
            uni.redirectTo({
                url: '/pages/iron/iron?id=' + this.work.id
            });
        },

        goHomeLater() {
            ui.backHome();
        },

        reportImported() {
            if (this.work) {
                reportFlow(this.work.fromCode);
            }
        }
    }
};
</script>
<style>
/* 拼豆界面：主体样式在 app.wxss 的 playpage 骨架里 */
.tools-hint.row2 {
    padding: 0 6px 8px;
}
.palette-bar .pdot {
    min-width: 34px;
    width: auto;
    padding: 0 3px;
    box-sizing: border-box;
    font-size: 10px;
}
.mode-chip {
    width: 96px;
    box-sizing: border-box;
    padding: 8px 4px;
    text-align: center;
    background: #dceef7;
    box-shadow: 3px 3px 0 #a9cbdd;
}
.mode-chip.active {
    background: #b8dbef;
    box-shadow: 3px 3px 0 #82b4d0;
}

/* 换色取色器（底部弹层 + 全色板网格） */
.swap-mask {
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
.swap-sheet {
    width: 100%;
    box-sizing: border-box;
    background: var(--card);
    border-radius: 20px 20px 0 0;
    padding: 16px 14px calc(14px + env(safe-area-inset-bottom));
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 -6px 22px rgba(0, 0, 0, 0.18);
}
.swap-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
    flex-shrink: 0;
}
.swap-title {
    font-size: 15px;
    font-weight: 800;
    color: var(--ink);
}
.swap-x {
    font-size: 16px;
    color: var(--ink2);
    padding: 4px 10px;
}
.swap-grid {
    height: 46vh;
    flex-shrink: 0;
} /* scroll-view 需要确定高度才能滚动（flex 高度在真机上不滚） */
.swap-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 2px;
}
.swap-c {
    width: 42px;
    height: 42px;
    border-radius: 9px;
    border: 1.5px solid rgba(0, 0, 0, 0.1);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.3px;
}
.swap-tip {
    flex-shrink: 0;
    margin-top: 12px;
    font-size: 12px;
    color: var(--ink2);
    text-align: center;
    line-height: 1.5;
}

/* 改大小 / 颜色数弹层 */
.rz-mask {
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
.rz-sheet {
    width: 100%;
    box-sizing: border-box;
    background: var(--card);
    border-radius: 20px 20px 0 0;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
    box-shadow: 0 -6px 22px rgba(0, 0, 0, 0.18);
}
.rz-pv-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 130px;
    padding: 6px 0 2px;
}
.rz-pv {
    display: block;
}
.rz-info {
    text-align: center;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink);
    margin: 4px 0 6px;
}
.rz-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 3px 2px;
}
.rz-lab {
    flex-shrink: 0;
    width: 34px;
    font-size: 13px;
    color: var(--ink2);
}
.rz-slider {
    flex: 1;
    margin: 0;
}
.rz-input {
    flex-shrink: 0;
    width: 50px;
    min-height: 30px;
    text-align: center;
    font-size: 14px;
    font-weight: 800;
    color: var(--accent-dark);
    border: 2px solid var(--ink);
    border-radius: 7px;
    padding: 3px 0;
    background: #fff;
    box-sizing: border-box;
}
.rz-warn {
    text-align: center;
    font-size: 12px;
    color: #c9838f;
    margin: 8px 0 12px;
}
.relay-code {
    display: block;
    margin: 12px 0;
    padding: 14px 10px;
    background: #fff7f0;
    border: 3px dashed var(--accent-dark);
    color: var(--ink);
    font-size: 26px;
    font-weight: 900;
    letter-spacing: 3px;
    text-align: center;
}
.rz-btns {
    display: flex;
    gap: 12px;
}
.rz-cancel,
.rz-apply {
    flex: 1;
    text-align: center;
    padding: 12px;
    font-size: 15px;
    font-weight: 800;
    border: 2px solid var(--ink);
    box-sizing: border-box;
}
.rz-cancel {
    background: var(--card);
    color: var(--ink);
}
.rz-apply {
    background: var(--accent);
    color: #7a4a55;
    box-shadow: 3px 3px 0 var(--accent-dark);
}

/* 代拼入口通栏：画板上方，曦黄底 + 粗描边 + 硬投影，比工具栏 chip 醒目；不盖豆子 */
.order-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 16px 8px;
    padding: 8px 12px;
    background: var(--blue);
    border: 3px solid var(--ink);
    box-shadow: 4px 4px 0 var(--blue-dark);
    color: #7a5a2e;
    transition: transform 0.12s;
}
.order-banner .ob-ic {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    margin: 0;
}
.ob-txt {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.ob-t {
    font-size: 15px;
    font-weight: 900;
    letter-spacing: 1px;
    line-height: 1.2;
}
.ob-sub {
    font-size: 11px;
    font-weight: 700;
    color: #9a7a3e;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ob-arrow {
    flex-shrink: 0;
    font-size: 26px;
    font-weight: 900;
    line-height: 1;
    animation: obnudge 1.4s ease-in-out infinite;
}
@keyframes obnudge {
    0%,
    100% {
        transform: translateX(0);
    }
    50% {
        transform: translateX(4px);
    }
}
</style>
