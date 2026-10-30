<template>
    <view>
        <view class="screen create">
            <view class="topbar" :style="'padding-top:' + insets.top + 'px;padding-right:' + insets.right + 'px'">
                <view class="tb-back" hover-class="pressed" @tap="goBack">‹</view>
                <view class="tb-title">新作品</view>
            </view>

            <!-- 选择阶段 -->
            <view v-if="mode === 'pick'" class="create-body">
                <view class="tabs">
                    <view :class="'tab ' + (tab === 'image' ? 'active' : '')" @tap="switchTab" data-tab="image">
                        <image class="pxi" src="/static/assets/icons/camera.png" />
                        图片
                    </view>
                    <view :class="'tab ' + (tab === 'tpl' ? 'active' : '')" @tap="switchTab" data-tab="tpl">
                        <image class="pxi" src="/static/assets/icons/bear.png" />
                        图案库
                    </view>
                    <view :class="'tab ' + (tab === 'free' ? 'active' : '')" @tap="switchTab" data-tab="free">
                        <image class="pxi" src="/static/assets/icons/pencil.png" />
                        自由画布
                    </view>
                </view>

                <block v-if="tab === 'image'">
                    <view v-if="reviewWaiting" class="review-status">
                        <view class="review-status-text">{{ reviewError ? '网络连接失败，审核状态暂时无法获取' : '图片审核中，通过后将自动继续' }}</view>
                        <view v-if="!reviewError" class="review-progress" aria-label="图片审核进行中"><view class="review-progress-fill"></view></view>
                        <view class="review-status-actions">
                            <view v-if="reviewError" class="review-status-btn" @tap="retryImageReview">重试</view>
                            <view class="review-status-btn" @tap="cancelImageReview">取消等待</view>
                        </view>
                    </view>
                    <view class="upload-zone" hover-class="uz-hover" @tap="chooseImage">
                        <view class="uz-icon"><image class="pxi-xl" src="/static/assets/icons/picture.png" /></view>
                        <view class="uz-title">选择一张图片</view>
                        <view class="uz-sub">照片、表情包、logo 都可以</view>
                        <view class="uz-sub">转成拼豆图纸后开拼</view>
                    </view>
                    <view class="upload-zone uz-chart" hover-class="uz-hover" @tap="chooseChart">
                        <view class="uz-icon"><image class="pxi-xl" src="/static/assets/icons/chart.png" /></view>
                        <view class="uz-title">导入拼豆图纸</view>
                        <view class="uz-sub">小红书图纸工坊等生成的图纸截图</view>
                        <view class="uz-sub">框出网格 → 自动识别 → 按图纸 1:1 开拼</view>
                    </view>
                    <view class="code-entry" hover-class="pressed" @tap="openCodeInput">
                        <image class="pxi" src="/static/assets/icons/key.png" />
                        有导入码？
                        <text class="ce-b">输入口令拼同款</text>
                    </view>
                </block>

                <block v-else-if="tab === 'free'">
                    <view class="upload-zone" hover-class="uz-hover" @tap="startFree">
                        <view class="uz-icon"><image class="pxi-xl" src="/static/assets/icons/pencil.png" /></view>
                        <view class="uz-title">开始自由创作</view>
                        <view class="uz-sub">无边拼豆板 · 全色板不限量，画到哪算哪</view>
                        <view class="uz-sub">完成时自动裁剪成作品，可熨烫、分享、导出</view>
                    </view>
                </block>

                <block v-else>
                    <view class="pick-label">
                        <image class="pxi-s" src="/static/assets/icons/star.png" />
                        新手友好 · 几分钟拼完一幅
                    </view>
                    <view v-if="tplError" class="pick-label" @tap="retryTemplates">⚠ {{ tplError }} · 点这里重试</view>
                    <view class="tpl-grid">
                        <view class="tpl-card" hover-class="pressed" @tap="pickTpl" :data-i="index" v-for="(item, index) in templates" :key="index">
                            <image v-if="item.img" class="tpl-img" :src="item.img" mode="aspectFit" />

                            <view v-else class="tpl-img" />

                            <view class="tpl-name">{{ item.name }} · {{ item.count }} 颗</view>
                        </view>
                    </view>

                    <view class="pick-label">😀 表情图案 · 点一个直接转图纸</view>
                    <view class="emoji-grid">
                        <view class="emoji-btn" hover-class="pressed" @tap="pickEmoji" :data-ch="item" v-for="(item, index) in emojis" :key="index">{{ item }}</view>
                    </view>
                </block>

                <!-- 流量主 banner（位 key: bannerTpl，沿用旧名）：选择阶段整体底部，三个 tab 通吃
         （配置阶段不出现）。位 ID 未下发或用户还没有任何作品（首次创建的第一印象）
         不渲染；报错即隐藏 -->
                <view v-if="adCreate" class="ad-slot">
                    <ad :unit-id="adCreate" @error="onAdCreateError"></ad>
                </view>
            </view>

            <!-- 配置阶段 -->
            <view v-else class="create-body">
                <view class="btn-ghost" hover-class="pressed" @tap="backToPick">‹ 重新选择</view>

                <view class="panel">
                    <view class="preview-wrap">
                        <canvas type="2d" id="preview" :style="'width:' + pvW + 'px;height:' + pvH + 'px'"></canvas>
                    </view>
                    <view class="stats-line">
                        {{ dimText }} ·
                        <text class="b">{{ total }}</text>
                        颗豆子 ·
                        <text class="b">{{ colorN }}</text>
                        种颜色
                    </view>
                    <view v-if="fromChart" class="chart-hint">
                        <image class="pxi-s" src="/static/assets/icons/chart.png" />
                        图纸 1:1 还原，颜色与原图纸一致
                    </view>
                    <view v-if="importedCode" class="code-report" @tap="reportCode">对这幅图纸有疑问？举报</view>
                    <!-- 照片图纸可改色：点色块换单色 / 一键换整套近似配色 -->
                    <view v-if="canEdit" class="recolor-bar">
                        <view class="recolor-tip">
                            <image class="pxi-s" src="/static/assets/icons/pencil.png" />
                            点色块可换色
                        </view>
                        <view class="recolor-btns">
                            <view class="recolor-btn" hover-class="pressed" @tap="oneKeyRecolor">
                                <image class="pxi-s" src="/static/assets/icons/sparkle.png" />
                                一键换色
                            </view>
                            <view class="recolor-btn ghost" hover-class="pressed" @tap="restoreColor">还原配色</view>
                        </view>
                    </view>
                    <view class="color-chips">
                        <view
                            :class="'cchip ' + (canEdit ? 'edit' : '') + ' ' + (item.swapped ? 'swapped' : '')"
                            @tap="tapEditColor"
                            :data-pal="item.pal"
                            v-for="(item, index) in chips"
                            :key="index"
                        >
                            <view class="dot" :style="'background:' + item.hex" />

                            {{ item.count }}
                        </view>
                    </view>
                    <view v-if="chipsCollapsible" class="chips-toggle" hover-class="pressed" @tap="toggleChips">
                        {{ chipsOpen ? '收起 ▲' : '展开全部 · 共 ' + chipsTotal + ' 种 ▼' }}
                    </view>

                    <block v-if="!fixed">
                        <view class="opt-col sz-opt">
                            <view class="opt-row">
                                <view class="opt-label">画布大小</view>
                                <view class="opt-val">
                                    <image class="opt-edit" src="/static/assets/icons/pencil.png" />
                                    <input class="opt-input" type="number" :value="size" @blur="onSizeInput" @confirm="onSizeInput" />
                                    豆
                                </view>
                            </view>
                            <view class="size-chips" v-if="sizesShown.length">
                                <view :class="'chip ' + (size === item ? 'active' : '')" @tap="setSize" :data-n="item" v-for="(item, index) in sizesShown" :key="index">
                                    {{ item }} 豆
                                </view>
                            </view>
                            <slider
                                class="opt-slider"
                                :min="sizeMin"
                                :max="sizeMax"
                                :value="size"
                                step="1"
                                activeColor="#EABFC3"
                                backgroundColor="#F0E4E0"
                                block-size="20"
                                @changing="onSizeChanging"
                                @change="onSizeSlider"
                            />
                            <view class="opt-hint">{{ sizeHint }}</view>
                        </view>
                        <view class="opt-col cl-opt" v-if="showColor">
                            <view class="opt-row">
                                <view class="opt-label">颜色数量</view>
                                <view class="opt-val">
                                    <image class="opt-edit" src="/static/assets/icons/pencil.png" />
                                    <input class="opt-input" type="number" :value="colorVal" @blur="onColorInput" @confirm="onColorInput" />
                                    色
                                </view>
                            </view>
                            <slider
                                class="opt-slider"
                                min="2"
                                :max="colorMax"
                                :value="colorVal"
                                step="1"
                                activeColor="#EABFC3"
                                backgroundColor="#F0E4E0"
                                block-size="20"
                                @changing="onColorChanging"
                                @change="onColorSlider"
                            />
                        </view>
                        <view class="switch-row">
                            <view class="sw-label">
                                白色背景不拼豆
                                <text class="sw-small">适合白底图片</text>
                            </view>
                            <switch :checked="whiteEmpty" color="#EABFC3" @change="onWhiteChange" />
                        </view>
                        <view class="switch-row" v-if="removeBgShow">
                            <view class="sw-label">
                                去掉背景
                                <text class="sw-small">只留人物/主体·纯色简单背景最好</text>
                            </view>
                            <switch :checked="removeBg" color="#EABFC3" @change="onRemoveBgChange" />
                        </view>
                    </block>

                    <view class="name-row">
                        <view class="opt-label">作品名</view>
                        <input :value="name" maxlength="20" placeholder="给作品起个名字" @input="onName" />
                    </view>
                </view>

                <view class="btn-primary" hover-class="pressed" @tap="start">开始拼豆！</view>
            </view>
        </view>

        <canvas type="2d" id="util" class="util-canvas" :style="'width:' + capW + 'px;height:' + capH + 'px'"></canvas>
        <!-- 图片解码专用画布：与模板缩略图的导出队列分离，选图后立即可用 -->
        <canvas type="2d" id="util2" class="util-canvas"></canvas>

        <crop-modal :show="cropShow" :src="cropSrc" :grid="cropGrid" :init-rect="cropInit" :title="cropTitle" :hint="cropHint" @confirm="onCropConfirm" @cancel="onCropCancel" />

        <guide :gid="guideId" :steps="guideSteps" @done="onGuideDone" />

        <!-- 单个换色取色器：全色板按色系排列，点一个即换 -->
        <view v-if="swapShow" class="overlay hi" @tap="closeSwap">
            <view class="modal swap-modal no-anim" @tap.stop.prevent="noop">
                <view class="swap-head">
                    <view class="swap-cur">
                        <view class="swap-cur-dot" :style="'background:' + swapHex" />
                        <text>把「{{ swapName }}」换成…</text>
                    </view>
                    <view class="swap-x" hover-class="pressed" @tap.stop.prevent="closeSwap">✕</view>
                </view>
                <scroll-view scroll-y class="swap-scroll">
                    <view class="swap-grid">
                        <view
                            class="swap-sw"
                            :style="'background:' + item.hex + ';color:' + item.tcol"
                            hover-class="pressed"
                            :data-pal="item.pal"
                            @tap.stop.prevent="pickSwapColor"
                            v-for="(item, index) in swapChips"
                            :key="index"
                        >
                            {{ item.code }}
                        </view>
                    </view>
                </scroll-view>
                <view class="modal-btns">
                    <view class="btn-ghost slim2" hover-class="pressed" @tap.stop.prevent="resetSwapColor">还原此色</view>
                    <view class="btn-ghost slim2" hover-class="pressed" @tap.stop.prevent="closeSwap">取消</view>
                </view>
            </view>
        </view>

        <!-- 导入码输入弹窗 -->
        <view v-if="codeShow" class="overlay hi" @tap="closeCodeInput">
            <!-- no-anim：原生 input 在带 transform 动画的容器里真机会焦点错位 -->
            <view class="modal no-anim" @tap.stop.prevent="noop">
                <view class="modal-title">
                    <image class="pxi-l" src="/static/assets/icons/key.png" />
                    输入导入码
                </view>
                <view class="modal-sub">
                    <view>输入导入码，或长按输入框粘贴（形如 PD-3K7F-9QWW）</view>
                </view>
                <view class="code-input-row">
                    <input
                        class="code-input"
                        :value="codeInput"
                        maxlength="256"
                        confirm-type="done"
                        :focus="codeFocus"
                        adjust-position
                        cursor-spacing="24"
                        placeholder="PD-XXXX-XXXX"
                        @input="onCodeInput"
                        @confirm="confirmCode"
                    />
                </view>
                <view class="modal-btns">
                    <view class="btn-primary" hover-class="pressed" @tap="confirmCode">导入图纸</view>
                </view>
                <view class="btn-link" hover-class="pressed" @tap="closeCodeInput">取消</view>
            </view>
        </view>
    </view>
</template>

<script>
import cropModal from '@/components/crop-modal/crop-modal';
// 创建作品：图片转图纸 / 图案库 / 表情图案
const { store } = require('../../utils/store');
const { PALETTE, textColorFor } = require('../../utils/palette');
const { loadImageToData, emojiToData, imageToPattern, bgMask, colorStats, reduceColors, variantPal } = require('../../utils/convert');
const { analyzeChart } = require('../../utils/chart');
const { fetchTemplates, templatePattern } = require('../../utils/templates');
const { renderPatternTo, patternSize, getBeadShape } = require('../../utils/board');
const ui = require('../../utils/ui');
const ads = require('../../utils/ads');
const { buildGuide, guideSeen, markGuideSeen } = require('../../utils/guidance');
const { normalize, extractCode, format, fetchByCode, reportFlow } = require('../../utils/importcode');
const api = require('../../utils/api');
const imageReviewCache = require('../../utils/image-review-cache');
const PENDING_IMAGE = 'pindou.pendingImageReview';

// 表情库：每个 emoji 都是现成的拼豆图案（预先按字素拆好，❤️ 这类组合字符不被拆散）
const EMOJIS = [
    '😀',
    '😍',
    '🥳',
    '😎',
    '🥺',
    '😭',
    '🤩',
    '😴',
    '🤖',
    '👻',
    '💀',
    '🤡',
    '🐶',
    '🐱',
    '🐭',
    '🐰',
    '🦊',
    '🐻',
    '🐼',
    '🐨',
    '🐯',
    '🦁',
    '🐮',
    '🐷',
    '🐸',
    '🐵',
    '🐔',
    '🐧',
    '🦆',
    '🦉',
    '🦄',
    '🐝',
    '🦋',
    '🐢',
    '🐍',
    '🦖',
    '🐙',
    '🦀',
    '🐠',
    '🐬',
    '🐳',
    '🍎',
    '🍊',
    '🍉',
    '🍇',
    '🍓',
    '🍒',
    '🍑',
    '🥑',
    '🥕',
    '🍄',
    '🍔',
    '🍟',
    '🍕',
    '🌭',
    '🍜',
    '🍣',
    '🍦',
    '🍩',
    '🍪',
    '🎂',
    '🍭',
    '🍫',
    '🧋',
    '❤️',
    '💖',
    '⭐',
    '✨',
    '⚡',
    '🔥',
    '🌈',
    '☀️',
    '🌙',
    '☁️',
    '❄️',
    '⛄',
    '🌸',
    '🌻',
    '🌹',
    '🍀',
    '🎈',
    '🎁',
    '🎄',
    '🎃',
    '👑',
    '💎',
    '⚽',
    '🏀',
    '🎮',
    '🚗',
    '🚀',
    '⛵',
    '🏠'
];

// 模板缩略图会话级缓存（临时文件在小程序运行期内有效）
let TPL_THUMBS = null;

// 画布长边上限：受 wx storage 单 key 1MB 与画板渲染性能约束
const SIZE_CAP = 256;
const CHIP_N = 12; // 色块默认折叠时显示前几个（按用量降序，覆盖主色），其余「展开」再看

export default {
    components: {
        cropModal
    },
    data() {
        return {
            insets: {
                top: 24,
                h: 44,
                right: 8
            },

            capW: 700,
            capH: 900,
            tab: 'image',
            mode: 'pick',
            templates: [],
            tplError: '',
            emojis: EMOJIS,
            size: 52,
            sizeMin: 8,
            sizeMax: 104,
            sizeHint: '',
            sizesShown: [52, 78, 104],
            showColor: false,
            colorMax: 48,
            colorVal: 48,
            whiteEmpty: false,
            removeBg: false,

            // 去背景：只对真实照片开放（emoji 本就透明底）
            removeBgShow: false,

            fixed: false,
            fromChart: false,
            cropShow: false,
            cropSrc: '',
            cropGrid: null,
            cropInit: null,
            cropTitle: '裁剪图片',
            cropHint: '',
            reviewWaiting: false,
            reviewError: false,
            codeShow: false,
            codeInput: '',
            importedCode: '',
            adCreate: '',

            // 流量主 banner 位 ID（选择阶段底部；空 = 不渲染）
            guideSteps: [],

            name: '',
            dimText: '',
            total: 0,
            colorN: 0,
            chips: [],
            chipsOpen: false,

            // 色块折叠：默认只显示前 CHIP_N 个
            chipsTotal: 0,

            chipsCollapsible: false,
            canEdit: false,

            // 照片转的图纸可改色（模板/图纸导入不可）
            swapShow: false,

            // 单个换色的取色器
            swapPal: null,

            swapName: '',
            swapHex: '',
            swapChips: [],

            // 全色板（按色系排序），取色器用
            pvW: 0,

            pvH: 0,
            codeFocus: false,
            guideId: ''
        };
    },
    onLoad(q) {
        // {data, w, h} 图片像素。解码时就缩到 ≤512：解码/读回/重采样都快，
        // 且 ≤256 豆的画布每格仍有 ≥2×2 采样，观感与全尺寸一致（小图不缩放，1:1 还原不受影响）
        this.srcData = null;
        this.pattern = null; // {w, h, cells} 最终图纸
        this.fromChart = false; // 图纸导入模式：pattern 按图纸 1:1 还原，不可调大小/颜色
        this.colorLimit = null; // 用户设定的颜色数量（null = 不限制）
        this.colorSwap = new Map(); // 手动单个换色：原色下标 → 换成的色下标
        this.variantIdx = 0; // 一键换色：0 原样，1..N 各套变体
        this._base = null; // 未做颜色缩减的基础图纸缓存
        this._baseKey = '';
        this._pvNode = null; // 预览 canvas 节点缓存（退出配置页时失效）
        this.name = '';
        this.uq = ui.serialQueue(); // 工具画布串行队列
        this.tpls = null; // 图案库数据(来自后端)
        this.setData({
            insets: ui.navInsets()
        });
        this.loadTemplatesFun();
        // 分享链接带 code 参数时，直接取图纸进配置页。
        const auto = q && normalize(q.code);
        if (auto) {
            this._autoCode = true; // 本次直奔配置页，选择页引导这轮不弹（未标记看过，下次正常进入再出）
            this.importByCodeFun(auto);
        }
    },
    // banner 位 ID 可能在启动配置拉到后才有值（口令直达冷启动时尤其），回到页面补一次。
    // 零作品的新用户不展示：第一次「开始新作品」不该见到广告（与首页空状态同一原则）
    onShow() {
        this._visible = true;
        // 位 key 仍叫 bannerTpl（沿用最初挂图案库 tab 时的接口字段名，不动后端契约）
        const id = store.list().length ? ads.unit('bannerTpl') : '';
        if (id !== this.adCreate) {
            this.setData({
                adCreate: id
            });
        }
        if (!this._pendingImage) {
            let saved;
            try {
                saved = uni.getStorageSync(PENDING_IMAGE);
            } catch (e) {
            } /* 忽略 */
            if (saved && saved.path && saved.reviewId) {
                this._pendingImage = {
                    path: saved.path,
                    reviewId: saved.reviewId,
                    fileKey: saved.fileKey || '',
                    onPath: saved.mode === 'chart' ? (path) => this.openReviewedChartFun(path) : (path) => this.openCropFun(path, 'image', {})
                };
            }
        }
        if (this._pendingImage) {
            this.showReviewLoadingFun();
            setTimeout(() => this.pollImageReviewFun(), 500);
        }
    },
    onHide() {
        this._visible = false;
        clearTimeout(this._reviewTimer);
    },
    onUnload() {
        this._visible = false;
        clearTimeout(this._reviewTimer);
    },
    onReady() {
        ui.queryNode(this, '#util').then((r) => {
            if (!r || !r.node) {
                return;
            }
            this.utilCanvas = r.node;
            this.buildTplThumbsFun();
        });
        ui.queryNode(this, '#util2').then((r) => {
            if (r && r.node) {
                this.decodeCanvas = r.node;
            }
        });
        // 首次进入：介绍三种创建方式 + 导入码入口；口令直达（马上跳配置页）这轮不弹。
        // 看过老两步版 create 引导的用户，只补看导入码这一步（记在 create-code 上）
        if (this._autoCode) {
            return;
        }
        const codeStep = {
            sel: '.code-entry',
            text: '收到好友的拼豆口令？点这里输入，或长按输入框粘贴，拼个同款～'
        };
        if (guideSeen('create')) {
            buildGuide(this, 'create-code', [codeStep]);
        } else {
            buildGuide(this, 'create', [
                {
                    sel: '.tabs',
                    text: '三种玩法任选：照片表情包转图纸、临摹图案库，或者自由画布随手画～'
                },
                {
                    sel: '.uz-chart',
                    text: '小红书图纸工坊的图纸截图从这里导入！框住网格就能 1:1 还原，颜色和图纸一模一样'
                },
                codeStep
            ]);
        }
    },
    onResize() {
        this.setData({
            insets: ui.navInsets()
        });
        if (this.mode === 'config') {
            this.renderConfigFun();
        }
    },
    onShareAppMessage() {
        return {
            title: '拼豆便利店 · 把喜欢的图片，一颗一颗拼出来',
            path: '/pages/home/home'
        };
    },
    methods: {
        // 图案库来自后端;失败给出提示,可点击重试(不回退本地数据)
        loadTemplatesFun() {
            this.setData({
                tplError: ''
            });
            fetchTemplates()
                .then((list) => {
                    this.tpls = list;
                    this.setData({
                        templates: list.map((t) => {
                            const p = templatePattern(t);
                            return {
                                name: t.name,
                                count: p.cells.filter((x) => x >= 0).length,
                                img: ''
                            };
                        })
                    });
                    this.buildTplThumbsFun();
                })
                .catch((e) => {
                    this.setData({
                        tplError: (e && e.message) || '图案库加载失败'
                    });
                });
        },

        retryTemplates() {
            this.loadTemplatesFun();
        },

        onAdCreateError(e) {
            console.warn('创建页 banner 加载失败', e && e.detail);
            this.setData({
                adCreate: ''
            });
        },

        onGuideDone() {
            // 完整版 create 引导已包含导入码一步，不用再补看单步版
            if (this.guideId === 'create') {
                markGuideSeen('create-code');
            }
            this.setData({
                guideSteps: []
            });
        },

        // 图片/表情解码：优先用独立画布直接执行；
        // 拿不到独立画布时退回 util 队列（会排在模板缩略图生成后面）
        loadSrcFun(job) {
            if (this.decodeCanvas) {
                return Promise.resolve().then(() => job(this.decodeCanvas));
            }
            return this.uq(() => job(this.utilCanvas));
        },

        goBack() {
            ui.backHome();
        },

        /* ---------- 选择阶段 ---------- */

        switchTab(e) {
            this.setData({
                tab: e.currentTarget.dataset.tab
            });
        },

        // 自由画布：起始 80×80，画到边上自动扩容（视觉无边），完成时在自由页裁剪成作品
        startFree() {
            const n = 80;
            const work = store.create({
                name: '自由创作',
                w: n,
                h: n,
                cells: new Array(n * n).fill(-1),
                free: true
            });
            uni.redirectTo({
                url: '/pages/free/free?id=' + work.id
            });
        },

        buildTplThumbsFun() {
            // 需要图案数据(后端)与工具画布(onReady)都就绪,两个入口各调一次,后到者执行
            if (!this.tpls || !this.utilCanvas) {
                return;
            }
            if (TPL_THUMBS) {
                this.setData({
                    templates: this.templates.map((t, i) => ({
                        ...t,
                        img: TPL_THUMBS[i]
                    }))
                });
                return;
            }
            const paths = [];
            let chain = Promise.resolve();
            this.tpls.forEach((t, i) => {
                chain = chain.then(() =>
                    this.uq(() => {
                        const p = templatePattern(t);
                        const cellPx = ui.clamp(Math.floor(120 / Math.max(p.w, p.h)), 6, 12);
                        const draw = () =>
                            renderPatternTo(this.utilCanvas, p, {
                                cellPx,
                                scale: 2
                            });
                        return ui.captureCanvas(this, this.utilCanvas, draw).then((path) => {
                            paths[i] = path;
                            this.setData({
                                ['templates[' + i + '].img']: path
                            });
                        });
                    })
                );
            });
            chain
                .then(() => {
                    TPL_THUMBS = paths;
                })
                .catch(() => {
                    /* 缩略图失败不影响功能 */
                });
        },

        pickImageFun(onPath, mode) {
            const pick = uni.chooseMedia || uni.chooseImage;
            const opts = {
                count: 1,
                success: (res) => {
                    const path = res.tempFiles ? res.tempFiles[0].tempFilePath : res.tempFilePaths[0];
                    this.reviewPickedImageFun(path, onPath, mode);
                }
            };
            if (uni.chooseMedia) {
                opts.mediaType = ['image'];
            }
            pick(opts);
        },

        reviewPickedImageFun(path, onPath, mode) {
            uni.showLoading({
                title: '核对图片',
                mask: true
            });
            imageReviewCache
                .fileKey(path)
                .then((fileKey) => {
                    if (imageReviewCache.approved(fileKey)) {
                        uni.hideLoading();
                        onPath(path);
                        return;
                    }
                    return api.upload('/api/content/images', path).then((result) => {
                        uni.hideLoading();
                        if (result.status === 'pass') {
                            imageReviewCache.remember(fileKey);
                            onPath(path);
                            return;
                        }
                        if (!result.reviewId) {
                            throw {
                                message: '图片审核未能提交'
                            };
                        }
                        this._pendingImage = {
                            path,
                            reviewId: result.reviewId,
                            fileKey,
                            onPath
                        };
                        this._reviewPollCount = 0;
                        // 临时图片持久化，用户离开页面后也能在下次进入时继续。
                        uni.saveFile({
                            tempFilePath: path,
                            success: (saved) => {
                                if (!this._pendingImage || this._pendingImage.reviewId !== result.reviewId) {
                                    return;
                                }
                                this._pendingImage.path = saved.savedFilePath;
                                try {
                                    uni.setStorageSync(PENDING_IMAGE, {
                                        path: saved.savedFilePath,
                                        reviewId: result.reviewId,
                                        fileKey,
                                        mode
                                    });
                                } catch (e) {
                                } /* 本次仍可轮询 */
                            }
                        });
                        this.showReviewLoadingFun();
                        this.pollImageReviewFun();
                    });
                })
                .catch((err) => {
                    uni.hideLoading();
                    ui.toast((err && err.message) || '图片审核失败，请重试');
                });
        },

        showReviewLoadingFun() {
            this.setData({
                reviewWaiting: true,
                reviewError: false
            });
        },

        hideReviewLoadingFun() {
            this.setData({
                reviewWaiting: false,
                reviewError: false
            });
        },

        cancelImageReview() {
            clearTimeout(this._reviewTimer);
            this._pendingImage = null;
            this._reviewPolling = null;
            this._reviewPollCount = 0;
            try {
                uni.removeStorageSync(PENDING_IMAGE);
            } catch (e) {
            } /* 忽略 */
            this.hideReviewLoadingFun();
        },

        retryImageReview() {
            if (!this._pendingImage) {
                return;
            }
            clearTimeout(this._reviewTimer);
            this.showReviewLoadingFun();
            this.pollImageReviewFun();
        },

        pollImageReviewFun() {
            const pending = this._pendingImage;
            if (!pending || !this._visible || this._reviewPolling === pending.reviewId) {
                return;
            }
            this._reviewPolling = pending.reviewId;
            api.get('/api/content/images/' + pending.reviewId)
                .then((r) => {
                    if (this._reviewPolling === pending.reviewId) {
                        this._reviewPolling = null;
                    }
                    if (!this._pendingImage || this._pendingImage.reviewId !== pending.reviewId) {
                        return;
                    }
                    if (!this._visible) {
                        return;
                    } // 返回新作品页时再接续，避免在后台打开裁剪弹窗
                    if (r.status === 'pending') {
                        // 前 30 秒每 2 秒查询，之后每 5 秒查询，减少通过后的空等。
                        this._reviewPollCount = (this._reviewPollCount || 0) + 1;
                        const delay = this._reviewPollCount <= 15 ? 2000 : 5000;
                        this._reviewTimer = setTimeout(() => this.pollImageReviewFun(), delay);
                        return;
                    }
                    this._pendingImage = null;
                    try {
                        uni.removeStorageSync(PENDING_IMAGE);
                    } catch (e) {
                    } /* 忽略 */
                    this.hideReviewLoadingFun();
                    if (r.status === 'pass') {
                        imageReviewCache.remember(pending.fileKey);
                        pending.onPath(pending.path);
                    } else {
                        ui.toast('图片未通过审核，请更换图片');
                    }
                })
                .catch(() => {
                    if (this._reviewPolling === pending.reviewId) {
                        this._reviewPolling = null;
                    }
                    if (this._pendingImage && this._pendingImage.reviewId === pending.reviewId && this._visible) {
                        this.setData({
                            reviewError: true
                        });
                    }
                });
        },

        // 两个入口都先进裁剪弹窗：框哪里拼哪里（不裁直接「使用图片」= 整张）
        chooseImage() {
            if (this._pendingImage) {
                ui.toast('上一张图片仍在审核中');
                return;
            }
            this.pickImageFun((path) => this.openCropFun(path, 'image', {}), 'image');
        },

        // 图纸先预识别一遍网格：裁剪框自动吸附到图纸格线、开门就框在图案上；
        // 识别不出（拍照太歪等）就退化成普通裁剪，框完再由正式识别兜底
        chooseChart() {
            if (this._pendingImage) {
                ui.toast('上一张图片仍在审核中');
                return;
            }
            this.pickImageFun((path) => this.openReviewedChartFun(path), 'chart');
        },

        openReviewedChartFun(path) {
            uni.showLoading({
                title: '识别网格中',
                mask: true
            });
            // 预识别只为「裁剪框吸附格线」：gridOnly 跳过最贵的逐格取色/聚色，
            // 把开弹窗前的等待压到 1/4。不降分辨率 —— 实测降采样的重采样模糊会让
            // 压缩过的淡格线更难测（1024/1600 都会失败），原生尺寸反而又快又稳
            this.loadSrcFun((cv) => loadImageToData(cv, path, 2048))
                .then((d) =>
                    this.yieldFun().then(() => {
                        const r = analyzeChart(d.data, d.w, d.h, {
                            gridOnly: true
                        });
                        const extra = {};
                        if (r.ok && r.grid) {
                            extra.cropGrid = {
                                px: r.grid.px / d.w,
                                py: r.grid.py / d.h,
                                ox: r.grid.offX / d.w,
                                oy: r.grid.offY / d.h
                            };
                            extra.cropInit = r.rectPx
                                ? {
                                      x: r.rectPx.x / d.w,
                                      y: r.rectPx.y / d.h,
                                      w: r.rectPx.w / d.w,
                                      h: r.rectPx.h / d.h
                                  }
                                : null;
                        }
                        uni.hideLoading();
                        this.openCropFun(path, 'chart', extra);
                    })
                )
                .catch(() => {
                    uni.hideLoading();
                    this.openCropFun(path, 'chart', {});
                });
        },

        // 让出一帧：showLoading 之后必须先渲染，才能开始跑同步的重活，
        // 否则加载框要么不显示、要么一闪而过，用户看到的是「页面卡死」
        yieldFun() {
            return new Promise((resolve) => setTimeout(resolve, 40));
        },

        /* ---------- 导入码 ---------- */
        noop() {},

        openCodeInput() {
            this.setData({
                codeShow: true,
                codeInput: '',
                codeFocus: false
            });
            // 弹窗布局稳定后再拉键盘：开门即可打字
            setTimeout(() => {
                if (this.codeShow) {
                    this.setData({
                        codeFocus: true
                    });
                }
            }, 260);
        },

        closeCodeInput() {
            this.setData({
                codeShow: false,
                codeFocus: false
            });
        },

        onCodeInput(e) {
            this.setData({
                codeInput: e.detail.value
            });
        },

        confirmCode() {
            const code = extractCode(this.codeInput) || normalize(this.codeInput);
            if (!code) {
                ui.toast('口令不对哦，应是 8 位字符');
                return;
            }
            this.setData({
                codeShow: false
            });
            this.importByCodeFun(code);
        },

        // 凭码取图纸进配置页：手动输入和分享链接（onLoad ?code=）共用。
        importByCodeFun(code) {
            uni.showLoading({
                title: '取图纸中',
                mask: true
            });
            fetchByCode(code)
                .then((p) => {
                    uni.hideLoading();
                    // 接力口令（带进度）：直接建档、进拼豆页从好友的进度接着拼，跳过配置
                    if (p.placed) {
                        const work = store.create({
                            name: p.name,
                            w: p.w,
                            h: p.h,
                            cells: p.cells,
                            palette: p.palette,
                            placed: p.placed,
                            fromCode: code
                        });
                        const go = () =>
                            uni.redirectTo({
                                url: '/pages/play/play?id=' + work.id
                            });
                        if (this.utilCanvas) {
                            this.uq(() => ui.makeThumb(this, this.utilCanvas, work, false))
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
                                    go();
                                })
                                .catch(go);
                        } else {
                            go();
                        }
                        return;
                    }
                    // 复用「外来固定图纸」配置路径：1:1 还原、自带色板
                    this.pattern = {
                        w: p.w,
                        h: p.h,
                        cells: p.cells,
                        palette: p.palette
                    };
                    this.fromChart = true;
                    this.fromTpl = false;
                    this._importedCode = code;
                    this._importedOrder = p.order; // 代拼派单码：建档时记来源、预选客户的烫法
                    this.name = p.name;
                    this.renderConfigFun();
                })
                .catch((err) => {
                    uni.hideLoading();
                    const msg = err && (err.code === 404 || err.code === 410) ? '没找到这个口令对应的图纸，检查一下有没有抄错' : (err && err.message) || '获取失败，稍后再试';
                    uni.showModal({
                        title: '导入失败',
                        content: msg,
                        showCancel: false,
                        confirmText: '知道了',
                        confirmColor: '#C9838F'
                    });
                });
        },

        // 举报口令图纸（侵权/违规 → 服务端核实后作废）
        reportCode() {
            reportFlow(this.importedCode);
        },

        openCropFun(path, mode, extra) {
            this._cropMode = mode;
            this._importedCode = '';
            const snapped = !!(extra && extra.cropGrid);
            this.setData({
                cropShow: true,
                cropSrc: path,
                cropGrid: (extra && extra.cropGrid) || null,
                cropInit: (extra && extra.cropInit) || null,
                cropTitle: mode === 'chart' ? '框出图纸网格' : '裁剪图片',
                cropHint:
                    mode === 'chart'
                        ? snapped
                            ? '已识别到网格：框会自动吸附格线、按图案预先框好，微调四角即可'
                            : '双指缩放看细节，把网格框出来（标题、色号表留在框外）；识别会自动对齐格子，框得大概齐就行'
                        : '拖四角框选想拼的部分，双指缩放；不裁剪就直接点「使用图片」'
            });
        },

        onCropCancel() {
            this.setData({
                cropShow: false
            });
        },

        onCropConfirm(e) {
            const rect = e.detail.rect;
            this.setData({
                cropShow: false
            });
            if (this._cropMode === 'chart') {
                this.importChartFun(this.cropSrc, rect);
            } else {
                this.importImageFun(this.cropSrc, rect);
            }
        },

        importImageFun(path, rect) {
            uni.showLoading({
                title: '生成图纸中',
                mask: true
            });
            this.loadSrcFun((cv) => loadImageToData(cv, path, 512, rect))
                .then((d) => {
                    this.srcData = d;
                    this.fromTpl = false;
                    this.fromChart = false;
                    this.name = '我的拼豆';
                    this._base = null;
                    this.colorLimit = null;
                    this._srcAlpha0 = null; // 换了图 → 清掉去背景的原始 alpha 备份
                    this.setData({
                        removeBg: false,
                        removeBgShow: true
                    }); // 真实照片才给「去背景」开关
                    this.resetColorEditsFun();
                    this.renderConfigFun();
                    uni.hideLoading();
                })
                .catch(() => {
                    uni.hideLoading();
                    ui.toast('图片打开失败，换一张试试');
                });
        },

        // 导入拼豆图纸截图（小红书图纸工坊等生成的规整图纸图）：
        // 识别网格逐格取色，1:1 还原成可拼的作品
        importChartFun(path, rect) {
            uni.showLoading({
                title: '识别图纸中',
                mask: true
            });
            // 图纸必须高分辨率解码：上百格的图纸每格才有足够像素可采。
            // _yield 先让加载框渲染出来，再开始跑同步的识别（否则真机上是「无反馈卡顿」）
            this.loadSrcFun((cv) => loadImageToData(cv, path, 2048, rect))
                .then((d) =>
                    this.yieldFun().then(() => {
                        const r = analyzeChart(d.data, d.w, d.h);
                        uni.hideLoading();
                        if (!r.ok) {
                            // 真机排查：中间量（格距/置信度/格线支撑率/主体范围）直接放进弹窗，
                            // 不依赖 vConsole；console 里也留一份完整的
                            console.warn('[图纸导入] 识别失败:', r.reason, r.debug || '', '图片', d.w + 'x' + d.h);
                            const dg = r.debug || {};
                            const dbgLine = [
                                d.w + '×' + d.h,
                                dg.body ? '体' + (dg.body.x1 - dg.body.x0) + '×' + (dg.body.y1 - dg.body.y0) : '',
                                dg.px != null ? '距' + dg.px + '/' + dg.py : '',
                                dg.confX != null ? '信' + dg.confX + '/' + dg.confY : '',
                                dg.lineX != null ? '线' + dg.lineX + '/' + dg.lineY : ''
                            ]
                                .filter(Boolean)
                                .join(' ');
                            uni.showModal({
                                title: '没认出这张图纸',
                                content: (r.reason || '识别失败') + '。试试发原图（别经过聊天/朋友圈压缩），或把网格部分框得再准一点' + '\n（调试 ' + dbgLine + '）',
                                showCancel: false,
                                confirmText: '知道了',
                                confirmColor: '#C9838F'
                            });
                            return;
                        }
                        // 识别参数留档：结果不对时（比如格距锁错谐波）对照排查
                        console.log('[图纸导入] ok', r.w + '×' + r.h, 'pitch', r.pitch, 'conf', r.conf, '色', r.colorN, '豆', r.total, '图片', d.w + 'x' + d.h);
                        // palette = 图纸真实取样色（作品自带色板），预览/开拼颜色与原图纸一致
                        this.pattern = {
                            w: r.w,
                            h: r.h,
                            cells: r.cells,
                            palette: r.palette
                        };
                        this.fromChart = true;
                        this.fromTpl = false;
                        this.name = '图纸拼豆';
                        this.renderConfigFun();
                    })
                )
                .catch(() => {
                    uni.hideLoading();
                    ui.toast('图片打开失败，换一张试试');
                });
        },

        pickTpl(e) {
            const t = this.tpls && this.tpls[e.currentTarget.dataset.i];
            if (!t) {
                return;
            }
            this.pattern = templatePattern(t);
            this.fromTpl = true;
            this.fromChart = false;
            this._importedCode = '';
            this.name = t.name;
            this.renderConfigFun();
        },

        pickEmoji(e) {
            const ch = e.currentTarget.dataset.ch;
            this.loadSrcFun((cv) => emojiToData(cv, ch))
                .then((d) => {
                    this.srcData = d;
                    this.fromTpl = false;
                    this.fromChart = false;
                    this._importedCode = '';
                    this.name = ch + ' 拼豆';
                    this._base = null;
                    this.colorLimit = null;
                    this._srcAlpha0 = null;
                    this.setData({
                        removeBg: false,
                        removeBgShow: false
                    }); // emoji 本就透明底，不给去背景
                    this.resetColorEditsFun();
                    this.renderConfigFun();
                })
                .catch(() => ui.toast('生成失败，换一个试试'));
        },

        /* ---------- 配置阶段 ---------- */

        backToPick() {
            this._pvNode = null; // 配置页销毁，预览节点随之失效
            this.setData({
                mode: 'pick'
            });
        },

        setSize(e) {
            const n = +e.currentTarget.dataset.n;
            if (n === this.size) {
                return;
            }
            this.resetColorEditsFun(); // 换尺寸会重采样、原色全变，改色重置
            this.setData({
                size: n
            });
            this.renderConfigFun();
        },

        // 松手（bindchange）：这时才重算图纸、重画预览/色块（imageToPattern 重，只在松手跑一次）
        onSizeSlider(e) {
            const v = +e.detail.value;
            this.resetColorEditsFun();
            this.setData({
                size: v
            });
            this.renderConfigFun();
        },

        // 拖动中（bindchanging）：只把数字跟手更新，不重画——拖着重算会卡
        onSizeChanging(e) {
            const v = +e.detail.value;
            if (v !== this.size) {
                this.setData({
                    size: v
                });
            }
        },

        onColorSlider(e) {
            this.colorLimit = +e.detail.value;
            this.setData({
                colorVal: +e.detail.value
            });
            this.renderConfigFun();
        },

        onColorChanging(e) {
            const v = +e.detail.value;
            if (v !== this.colorVal) {
                this.setData({
                    colorVal: v
                });
            }
        },

        // 色块折叠：展开看全部 / 收起只留前 CHIP_N 个
        toggleChips() {
            const open = !this.chipsOpen;
            const all = this._chipsAll || [];
            this.setData({
                chipsOpen: open,
                chips: open ? all : all.slice(0, CHIP_N)
            });
        },

        // 手动输入画布大小：右侧数字可直接打字（超范围自动收进 sizeMin~sizeMax）
        onSizeInput(e) {
            let v = parseInt(e.detail.value, 10);
            if (!(v > 0)) {
                v = this.size;
            } // 空/非法：保持原值
            v = ui.clamp(v, this.sizeMin, this.sizeMax);
            this.resetColorEditsFun();
            this.setData({
                size: v
            }); // 回写（越界输入会被纠正显示）
            this.renderConfigFun();
        },

        // 手动输入颜色数量（2 ~ 自然色数）
        onColorInput(e) {
            let v = parseInt(e.detail.value, 10);
            if (!(v > 0)) {
                v = this.colorVal;
            }
            v = ui.clamp(v, 2, this.colorMax);
            this.colorLimit = v;
            this.renderConfigFun();
        },

        // 白色背景不拼豆：开时首次要对源图做一遍「连通白」漫水（convert.whiteMask，之后按源图缓存），
        // 真机几十到几百毫秒，先把加载框渲染出来再算（同去背景的 _yield 思路）；关掉是纯重采样，直接渲染
        onWhiteChange(e) {
            const on = e.detail.value;
            this.resetColorEditsFun();
            this.setData({
                whiteEmpty: on
            });
            if (!on || !this.srcData) {
                this.renderConfigFun();
                return;
            }
            uni.showLoading({
                title: '处理中',
                mask: true
            });
            this.yieldFun().then(() => {
                this.renderConfigFun();
                uni.hideLoading();
            });
        },

        // 去背景：漫水填充圈出边缘背景 → 把这些像素的 alpha 抹成 0（imageToPattern 会当空格留白）；
        // 关掉时从备份的原始 alpha 还原。改的是源像素的 alpha，改色/缓存都要重来
        onRemoveBgChange(e) {
            const on = e.detail.value;
            const sd = this.srcData;
            if (!sd) {
                this.setData({
                    removeBg: on
                });
                return;
            }
            this.resetColorEditsFun();
            if (!this._srcAlpha0) {
                // 首次备份原始 alpha，供关掉时还原
                this._srcAlpha0 = new Uint8Array(sd.w * sd.h);
                for (let i = 0; i < this._srcAlpha0.length; i++) {
                    this._srcAlpha0[i] = sd.data[i * 4 + 3];
                }
            }
            this._base = null;
            if (!on) {
                for (let i = 0; i < this._srcAlpha0.length; i++) {
                    sd.data[i * 4 + 3] = this._srcAlpha0[i];
                }
                this.setData({
                    removeBg: false
                });
                this.renderConfigFun();
                return;
            }
            // 漫水可能几十毫秒：先让加载框渲染出来再跑（同 _importChart 的 _yield 思路）
            uni.showLoading({
                title: '去背景中',
                mask: true
            });
            this.yieldFun().then(() => {
                const mask = bgMask(sd.data, sd.w, sd.h);
                for (let i = 0; i < mask.length; i++) {
                    sd.data[i * 4 + 3] = mask[i] ? 0 : this._srcAlpha0[i];
                }
                this.setData({
                    removeBg: true
                });
                this.renderConfigFun();
                uni.hideLoading();
                // 主体贴满四边等情形会一颗都去不掉，给个反馈别让用户以为没生效
                let bgN = 0;
                for (let i = 0; i < mask.length; i++) {
                    bgN += mask[i];
                }
                if (bgN === 0) {
                    ui.toast('这张背景不够干净，没能自动去掉');
                }
            });
        },

        /* ---------- 改色（照片转的图纸）---------- */
        resetColorEditsFun() {
            this.colorSwap.clear();
            this.variantIdx = 0;
        },

        // 点色块 → 打开取色器，把这个颜色换成别的
        tapEditColor(e) {
            if (!this.canEdit) {
                return;
            }
            const pal = +e.currentTarget.dataset.pal;
            if (!this.swapChips.length) {
                this.buildSwapChipsFun();
            }
            const cur = this.colorSwap.has(pal) ? this.colorSwap.get(pal) : this.variantIdx ? variantPal(pal, this.variantIdx) : pal;
            this.setData({
                swapShow: true,
                swapPal: pal,
                swapName: PALETTE[cur].name,
                swapHex: PALETTE[cur].hex
            });
        },

        // 取色器：全色板按色系排序（白灰黑→红→粉→橙棕→黄→绿→蓝青→紫→莫兰迪）
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
            this.colorSwap.set(this.swapPal, +e.currentTarget.dataset.pal);
            this.setData({
                swapShow: false
            });
            this.renderConfigFun();
        },

        resetSwapColor() {
            // 取色器里「还原此色」
            this.colorSwap.delete(this.swapPal);
            this.setData({
                swapShow: false
            });
            this.renderConfigFun();
        },

        closeSwap() {
            this.setData({
                swapShow: false
            });
        },

        // 一键换色：换成一套不一样但近似的配色（手动单换过的色块保持不变）
        oneKeyRecolor() {
            this.variantIdx = 1;
            this.renderConfigFun();
            ui.toast('已换成另一套配色');
        },

        // 还原配色：回到系统最初选的那套（连手动单换也一并还原）
        restoreColor() {
            this.resetColorEditsFun();
            this.renderConfigFun();
            ui.toast('已还原原来的配色');
        },

        onName(e) {
            this.name = e.detail.value;
        },

        renderConfigFun() {
            const extra = {};
            const fixed = this.fromTpl || this.fromChart; // 图纸/模板：尺寸颜色都定死，1:1 还原
            let p;
            if (fixed) {
                p = this.pattern;
                this._qcells = null; // 模板/图纸不改色
            } else {
                if (!this.srcData) {
                    return;
                }
                // 画布大小：上限 = 图片像素长边（1:1 还原），再受 SIZE_CAP 保护
                const imgSide = Math.max(this.srcData.w, this.srcData.h);
                const sizeMax = Math.min(SIZE_CAP, imgSide);
                const sizeMin = Math.min(8, sizeMax);
                const size = ui.clamp(this.size, sizeMin, sizeMax);
                // 基础图纸缓存：只在大小 / 白底选项变化时重新采样，拖颜色滑杆不重算。
                // 源图已在解码时缩到 ≤512，重采样只有 ~26 万像素，切换尺寸不卡
                const key = size + '|' + this.whiteEmpty + '|' + this.removeBg;
                if (!this._base || this._baseKey !== key) {
                    this._base = imageToPattern(this.srcData.data, this.srcData.w, this.srcData.h, size, {
                        whiteEmpty: this.whiteEmpty
                    });
                    this._baseKey = key;
                }
                const base = this._base;
                // 颜色数量：2 ~ 自然色数。默认封在 48（与图纸导入的聚色上限一致）——
                // 全色板 221 色后照片自然色轻松上百，默认全开会把人吓退；滑杆上限仍到自然色数
                const natural = colorStats(base.cells).length;
                const colorMax = Math.max(2, natural);
                const colorVal = this.colorLimit == null ? Math.min(colorMax, 48) : ui.clamp(this.colorLimit, 2, colorMax);
                let cells = base.cells;
                if (colorVal < natural) {
                    cells = reduceColors(base.cells, colorVal);
                }
                // 改色：单换（colorSwap）优先，否则一键换色变体（variantIdx）——都作用在缩减后的原色上
                this._qcells = cells;
                this._finalOf = (op) => (this.colorSwap.has(op) ? this.colorSwap.get(op) : this.variantIdx ? variantPal(op, this.variantIdx) : op);
                if (this.colorSwap.size || this.variantIdx) {
                    cells = cells.map((c) => (c >= 0 ? this._finalOf(c) : -1));
                }
                p = this.pattern = {
                    w: base.w,
                    h: base.h,
                    cells
                };
                extra.size = size;
                extra.sizeMin = sizeMin;
                extra.sizeMax = sizeMax;
                extra.sizeHint = sizeMax < imgSide ? '最大 ' + sizeMax + ' 豆' : '最大 ' + sizeMax + ' 豆 · 1:1 还原图片像素';
                extra.sizesShown = [52, 78, 104].filter((n) => n >= sizeMin && n <= sizeMax);
                extra.showColor = natural > 2;
                extra.colorMax = colorMax;
                extra.colorVal = colorVal;
            }
            if (!p) {
                return;
            }
            // 首次进入"图片转图纸"的配置页 → 豆豆讲解三个调节项（拖滑杆重渲染不再触发）
            const firstConfig = this.mode !== 'config';
            const stats = colorStats(p.cells);
            const total = stats.reduce((a, s) => a + s.count, 0);
            // 照片可改色：色块按「改色前的原色」建（点它走 tapEditColor(原色下标)），显示的是改后颜色
            let chips;
            if (!fixed && this._qcells) {
                chips = colorStats(this._qcells)
                    .slice()
                    .sort((a, b) => b.count - a.count)
                    .map((s) => {
                        const hex = PALETTE[this._finalOf(s.pal)].hex;
                        return {
                            pal: s.pal,
                            hex,
                            tcol: textColorFor(hex),
                            count: s.count,
                            swapped: this.colorSwap.has(s.pal)
                        };
                    });
            } else {
                chips = stats
                    .slice()
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 12)
                    .map((s) => ({
                        pal: s.pal,
                        hex: p.palette ? p.palette[s.pal] : PALETTE[s.pal].hex,
                        count: s.count
                    }));
            }
            this._chipsAll = chips; // 全量色块留存，折叠时只发前 CHIP_N 个给视图

            const ins = ui.navInsets();
            const maxPx = Math.min(340, ins.winW - 72);
            const cellPx = ui.clamp(Math.floor(maxPx / Math.max(p.w, p.h)), 1, 14);
            const size = patternSize(p, {
                cellPx
            });
            this.setData(
                Object.assign(extra, {
                    mode: 'config',
                    fixed,
                    canEdit: !fixed,
                    fromChart: !!this.fromChart,
                    importedCode: this._importedCode || '',
                    name: this.name,
                    dimText: p.w + ' × ' + p.h + ' 板',
                    total,
                    colorN: stats.length,
                    chips: this.chipsOpen ? chips : chips.slice(0, CHIP_N),
                    chipsTotal: chips.length,
                    chipsCollapsible: chips.length > CHIP_N,
                    pvW: size.width,
                    pvH: size.height
                }),
                () => {
                    const scale = Math.min(2, ins.dpr);
                    if (this._pvNode) {
                        renderPatternTo(this._pvNode, p, {
                            cellPx,
                            scale
                        });
                        return;
                    }
                    ui.queryNode(this, '#preview').then((r) => {
                        if (!r || !r.node) {
                            return;
                        }
                        this._pvNode = r.node;
                        renderPatternTo(r.node, p, {
                            cellPx,
                            scale
                        });
                    });
                }
            );

            // 图片/表情转图纸的配置页引导（模板/图纸导入没有滑杆，不需要）
            if (firstConfig && !fixed) {
                buildGuide(
                    this,
                    'create-config',
                    [
                        {
                            sel: '.preview-wrap',
                            text: '图片变成拼豆图纸啦！上面是预览，下面标着一共要多少颗豆子、用几种颜色'
                        },
                        {
                            sel: '.sz-opt',
                            text: '「画布大小」= 长边的豆子数：常规板 52 / 78 / 104，点右边数字还能直接手动输入。越大细节越多、拼得越久，新手从 52 起步就好～'
                        },
                        {
                            sel: '.cl-opt',
                            text: '颜色太多拼起来累！往小调会自动合并相近色，更好拼也更耐看；白底图片记得开下面的「白色背景不拼豆」'
                        }
                    ],
                    600
                );
            }
        },

        start() {
            if (this._starting) {
                return;
            }
            const p = this.pattern;
            if (!p) {
                return;
            }
            const name = (this.name || '').trim() || '我的拼豆';
            this._starting = true;
            uni.showLoading({
                title: '检查作品名称',
                mask: true
            });
            api.post('/api/content/text', {
                value: name
            })
                .then(() => {
                    uni.hideLoading();
                    this._starting = false;
                    this.createWorkFun(name, p);
                })
                .catch((err) => {
                    uni.hideLoading();
                    this._starting = false;
                    ui.toast((err && err.message) || '名称检查失败，请重试');
                });
        },

        createWorkFun(name, p) {
            // 作品自带色板（图纸导入）随建档持久化；口令导入的记来源（代拼派单码另记订单标记）
            const ord = this._importedCode ? this._importedOrder : null;
            const work = store.create({
                name,
                w: p.w,
                h: p.h,
                cells: p.cells,
                palette: p.palette,
                fromCode: this._importedCode || undefined,
                fromOrder: ord
                    ? {
                          no: ord.no,
                          idx: ord.idx,
                          n: ord.n
                      }
                    : undefined,
                finish: ord ? ord.finish : undefined
            });
            // 照片/表情作品：把量化源存下来，拼阶段可高质量重调大小/颜色（图纸/模板不存——本就 1:1、不可调）
            const editable = this.srcData && !this.fromChart && !this.fromTpl;
            const go = () =>
                uni.redirectTo({
                    url: '/pages/play/play?id=' + work.id
                });
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
                .then(() => (editable ? this.saveSourceFun(work.id) : null))
                .then(go)
                .catch(go);
        },

        // 把 srcData（≤512 的量化源像素）存成 PNG，随作品留档；拼阶段据此高质量重调大小/颜色
        saveSourceFun(workId) {
            const sd = this.srcData;
            if (!sd || !this.utilCanvas) {
                return Promise.resolve();
            }
            const draw = () => {
                const cv = this.utilCanvas;
                cv.width = sd.w;
                cv.height = sd.h;
                const ctx = cv.getContext('2d');
                const img = ctx.createImageData(sd.w, sd.h);
                img.data.set(sd.data);
                ctx.putImageData(img, 0, 0);
            };
            return ui
                .captureCanvas(this, this.utilCanvas, draw)
                .then((tmp) => {
                    store.update(
                        workId,
                        {
                            src: ui.persistFile(tmp, 'src-' + workId + '.png'),
                            whiteEmpty: !!this.whiteEmpty
                        },
                        true
                    );
                })
                .catch(() => {
                    /* 存原图失败不影响创建 */
                });
        }
    }
};
</script>
<style>
.create-body {
    padding: 16px 0 40px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.upload-zone {
    border: 3px dashed var(--accent);
    border-radius: 0;
    background: rgba(255, 255, 255, 0.75);
    text-align: center;
    padding: 44px 20px;
    transition: background 0.15s;
}
.uz-hover {
    background: #fdeceb;
}
.uz-icon {
    font-size: 40px;
}
.uz-title {
    font-size: 17px;
    font-weight: 800;
    letter-spacing: 1px;
    margin-top: 10px;
}
.uz-sub {
    color: var(--ink2);
    font-size: 13px;
    margin-top: 6px;
    line-height: 1.5;
}

/* 图纸导入入口：更矮一点，与主入口区分 */
.uz-chart {
    margin-top: 14px;
    padding: 26px 20px;
}
.uz-chart .uz-icon {
    font-size: 32px;
}

.chart-hint {
    text-align: center;
    color: var(--ink2);
    font-size: 12.5px;
    margin-top: 6px;
}

.pick-label {
    font-size: 14px;
    font-weight: 700;
    color: var(--ink2);
    margin: 4px 4px -4px;
}

.emoji-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
    gap: 10px;
}
.emoji-btn {
    font-size: 30px;
    line-height: 1;
    padding: 11px 0;
    text-align: center;
    background: var(--card);
    border: 3px solid var(--ink);
    border-radius: 0;
    box-shadow: 3px 3px 0 #e2dad3;
    transition: transform 0.1s;
}

.tpl-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
}
@media (min-width: 560px) {
    .tpl-grid {
        grid-template-columns: repeat(3, 1fr);
    }
}
@media (min-width: 900px) {
    .tpl-grid {
        grid-template-columns: repeat(4, 1fr);
    }
}
.tpl-card {
    background: var(--card);
    border: 3px solid var(--ink);
    border-radius: 0;
    box-shadow: var(--shadow);
    padding: 16px 12px;
    text-align: center;
    transition: transform 0.12s;
}
.tpl-img {
    width: 100%;
    height: 96px;
}
.tpl-name {
    font-size: 13px;
    font-weight: 600;
    margin-top: 8px;
    color: var(--ink);
}

.panel {
    background: var(--card);
    border: 3px solid var(--ink);
    border-radius: 0;
    box-shadow: var(--shadow);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.preview-wrap {
    display: flex;
    justify-content: center;
}
.stats-line {
    text-align: center;
    color: var(--ink2);
    font-size: 14px;
}

.color-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
}
.cchip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--chipbg);
    border: 1.5px solid var(--line);
    padding: 4px 10px 4px 5px;
    border-radius: 0;
    font-size: 12px;
    color: var(--ink2);
}
.cchip .dot {
    width: 16px;
    height: 16px;
    border-radius: 0;
    border: 1.5px solid rgba(95, 74, 78, 0.35);
}
/* —— 改色 —— */
.recolor-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
}
.recolor-tip {
    font-size: 12px;
    color: var(--ink2);
    display: flex;
    align-items: center;
}
.recolor-btns {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
}
.recolor-btn {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink);
    background: var(--coin);
    border: 2px solid var(--ink);
    box-shadow: 2px 2px 0 var(--coin-dark);
}
.recolor-btn.ghost {
    background: var(--card);
    box-shadow: 2px 2px 0 #e2dad3;
}
.cchip.edit {
    border-color: var(--accent-dark);
}
.cchip.swapped .dot {
    border: 2px solid var(--accent-dark);
    box-shadow: 0 0 0 1.5px #fff inset;
}
/* 色块折叠开关 */
.chips-toggle {
    display: block;
    width: fit-content;
    margin: 10px auto 2px;
    padding: 5px 16px;
    text-align: center;
    font-size: 12px;
    font-weight: 700;
    color: var(--accent-dark);
    background: var(--chipbg);
    border: 1.5px solid var(--line);
    border-radius: 14px;
}

/* 换色取色器 */
.swap-modal {
    max-width: 400px;
    text-align: left;
}
.swap-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}
.swap-cur {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 700;
    min-width: 0;
}
.swap-cur-dot {
    width: 22px;
    height: 22px;
    border: 2px solid var(--ink);
    flex-shrink: 0;
}
.swap-x {
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    border: 2px solid var(--ink);
    box-shadow: 2px 2px 0 #e2dad3;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
}
/* scroll-view 上直接 flex-wrap 真机不认（会竖排）→ 里面包一层普通 view 做换行 */
.swap-scroll {
    max-height: 46vh;
}
.swap-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 2px;
}
.swap-sw {
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border: 2px solid rgba(95, 74, 78, 0.28);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
}

.opt-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
}
.opt-label {
    font-size: 14px;
    font-weight: 600;
    flex-shrink: 0;
}
.opt-col {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.opt-val {
    font-size: 13px;
    font-weight: 700;
    color: var(--accent-dark);
    display: flex;
    align-items: center;
    gap: 3px;
}
/* 可手动输入的数字框（画布大小 / 颜色数量）：浅底 + 樱粉描边，示意可点按输入 */
.opt-edit {
    width: 14px;
    height: 14px;
    vertical-align: -2px;
}
.opt-input {
    width: 52px;
    min-height: 30px;
    padding: 3px 6px;
    text-align: center;
    font-size: 15px;
    font-weight: 800;
    color: var(--accent-dark);
    background: #fbfaf3;
    border: 2px solid var(--accent);
    border-radius: 0;
}
.opt-hint {
    font-size: 11px;
    color: var(--ink2);
}
.opt-slider {
    margin: 2px 4px;
}
.size-chips {
    display: flex;
    gap: 7px;
}
.chip {
    padding: 7px 12px;
    border-radius: 0;
    font-size: 13px;
    font-weight: 600;
    background: var(--chipbg);
    border: 2px solid var(--ink);
    color: var(--ink2);
}
.chip.active {
    background: var(--blue);
    color: #fff;
    box-shadow: 2px 2px 0 var(--blue-dark);
}

.switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.sw-label {
    font-size: 14px;
    font-weight: 600;
    display: flex;
    flex-direction: column;
}
.sw-small {
    color: var(--ink2);
    font-weight: 400;
    font-size: 12px;
    margin-top: 2px;
}

.name-row {
    display: flex;
    align-items: center;
    gap: 12px;
}
.name-row input {
    flex: 1;
    border: 2px solid var(--ink);
    border-radius: 0;
    padding: 10px 12px;
    height: 42px;
    background: #fbfaf3;
}

/* 导入码入口（图片 tab 下方的细条） */
.code-entry {
    text-align: center;
    padding: 12px;
    font-size: 13.5px;
    color: var(--ink2);
    border: 2px dashed rgba(95, 74, 78, 0.35);
    background: rgba(255, 255, 255, 0.5);
    transition: transform 0.12s;
}
.code-entry .ce-b {
    color: #c9838f;
    font-weight: 800;
}

/* 配置页的举报小链接（口令导入的图纸才显示） */
.code-report {
    text-align: center;
    font-size: 11.5px;
    color: #b7a8a4;
    text-decoration: underline;
    margin-top: -2px;
}

/* 导入码输入弹窗 */
.code-input-row {
    display: flex;
    gap: 10px;
    margin: 10px 0 4px;
}
.code-input {
    flex: 1;
    min-width: 0;
    height: 46px;
    min-height: 46px;
    line-height: 46px;
    padding: 0 12px;
    box-sizing: border-box;
    background: #fff7f0;
    border: 3px solid var(--ink);
    font-size: 17px;
    font-weight: 800;
    letter-spacing: 2px;
    text-align: center;
}
.uz-chart .pxi-xl {
    width: 32px;
    height: 32px;
}

.review-status {
    padding: 12px;
    border: 2px solid var(--ink);
    background: #fff7f0;
    color: var(--ink);
    font-size: 13px;
}
.review-status-text {
    font-weight: 700;
}
.review-progress {
    height: 10px;
    margin-top: 12px;
    overflow: hidden;
    border: 2px solid var(--ink);
    background: #fff;
}
.review-progress-fill {
    width: 35%;
    height: 100%;
    background: var(--accent);
    animation: review-progress-move 1.6s ease-in-out infinite alternate;
}
@keyframes review-progress-move {
    from {
        transform: translateX(0);
    }
    to {
        transform: translateX(186%);
    }
}
.review-status-actions {
    display: flex;
    gap: 10px;
    margin-top: 10px;
}
.review-status-btn {
    padding: 6px 12px;
    border: 2px solid var(--ink);
    background: #fff;
    font-weight: 700;
}
</style>
