<template>
    <view>
        <view class="ironflow">
            <view class="topbar" :style="'padding-top:' + insets.top + 'px;padding-right:' + insets.right + 'px'">
                <view class="tb-back" hover-class="pressed" @tap="goBack">‹</view>
                <view class="tb-title">{{ phase === 'pick' ? title : method === 'manual' ? '手动熨斗' : '自动熨烫机' }}</view>
                <view class="tb-actions">
                    <view class="fin-tag" v-if="phase !== 'pick'">{{ finishName }}</view>
                    <view class="icon-btn" hover-class="pressed" @tap="toggleBgm">
                        <image class="pxi-l" :src="bgmOn ? '/assets/icons/musicon.png' : '/assets/icons/musicoff.png'" />
                    </view>
                    <view class="icon-btn" hover-class="pressed" @tap="toggleMute">
                        <image class="pxi-l" :src="muted ? '/assets/icons/sndoff.png' : '/assets/icons/sndon.png'" />
                    </view>
                </view>
            </view>

            <!-- 步骤标题 -->
            <view class="fhead">
                <block v-if="phase === 'pick'">
                    <view class="fkick">READY TO IRON</view>
                    <view class="ftitle">选好方式，开始熨烫</view>
                    <view class="fsub">自动熨烫机全自动，手动熨斗自己划——都行。</view>
                </block>
                <block v-else-if="phase === 'manual'">
                    <view class="fkick">HAND IRON</view>
                    <view class="ftitle">手动熨烫 · {{ pct }}%</view>
                    <view class="mprog"><view class="mprog-fill" :style="'width:' + pct + '%'"></view></view>
                </block>
                <block v-else>
                    <view class="fkick">PERLER WORKSHOP</view>
                    <view class="ftitle">{{ stepT }}</view>
                    <view class="fsub">{{ stepS }}</view>
                </block>
            </view>

            <view class="stage">
                <!-- 机器（盖布起就在场，和托盘一起出现，避免"先只有托盘、机器晚几秒才来") -->
                <view class="machine" v-if="phase === 'cover' || phase === 'insert' || phase === 'press'">
                    <view class="mled">
                        <view class="mdot"></view>
                        <text class="mtext">{{ ledText }}</text>
                        <text class="mlab">PERLER LAB</text>
                    </view>
                    <view class="mdots">
                        <view :class="phase === 'insert' ? 'on' : ''"></view>
                        <view :class="phase === 'press' ? 'on' : ''"></view>
                        <view></view>
                    </view>
                    <view class="mbody">
                        <view class="mvent"></view>
                        <view class="mvent"></view>
                        <view class="mvent"></view>
                    </view>
                    <view class="mmouth"></view>
                </view>
                <!-- 箭头：盖布起就占位（cover 时隐形），机器和托盘的间距从一开始就是最终间距，不再"先贴紧再弹开" -->
                <view :class="'marrow ' + (phase === 'insert' ? 'on' : '')" v-if="phase === 'cover' || phase === 'insert'">↑</view>

                <!-- 压合进度 -->
                <view class="pressbox" v-if="phase === 'press'">
                    <view class="pbadge">{{ ledText === 'HEAT' ? '正在受热融合…' : '豆豆正在就位…' }}</view>
                    <view class="pbar"><view class="pfill" :style="'width:' + pressPct + '%'"></view></view>
                </view>

                <!-- 托盘：选烫法 / 盖布 / 推入 / 压合 时在场（压合时上移出视野被机器吞掉）；掀开、手动阶段退场 -->
                <view
                    v-if="phase !== 'peel' && phase !== 'manual'"
                    :class="'tray ' + phase + ' ' + (trayDrag ? 'dragging' : '')"
                    :style="'transform:translateY(-' + trayLift + 'px) scale(' + trayScale + ');opacity:' + trayOp"
                    @touchstart="onTrayTS"
                    @touchmove="onTrayTM"
                    @touchend="onTrayTE"
                    @touchcancel="onTrayTE"
                >
                    <view class="pan">
                        <canvas type="2d" id="tray" class="traycv" :style="'width:' + trayW + 'px;height:' + trayH + 'px'"></canvas>
                        <view :class="'cloth ' + (phase === 'cover' || phase === 'insert' ? 'covered' : '')">
                            <view class="cloth-frame"></view>
                            <text class="cloth-label">BAKING CLOTH</text>
                        </view>
                    </view>
                    <view class="handle"></view>
                </view>

                <!-- 掀开揭晓：整张拼板 + 成品，盖一整张烘焙布，从右下角捏起、往左上掀，布会翻出折角露背面 -->
                <view v-if="phase === 'peel'" class="peelboard" @touchstart="onClothTS" @touchmove="onClothTM" @touchend="onClothTE" @touchcancel="onClothTE">
                    <canvas type="2d" id="peelcv" class="peelcv" :style="'width:' + peelW + 'px;height:' + peelH + 'px'"></canvas>
                    <!-- 布正面（平铺部分）：沿对角线裁掉右下三角 → 露出成品；完成时整张淡出，露全貌 -->
                    <view
                        :class="'pcloth-face ' + (revealed ? 'off' : '')"
                        :style="'clip-path:polygon(0 0,100% 0,100% ' + (100 - peelPct) + '%,' + (100 - peelPct) + '% 100%,0 100%)'"
                    >
                        <view class="pcloth-frame"></view>
                        <text class="pcloth-label">BAKING CLOTH</text>
                    </view>
                    <!-- 折起来的布角（露背面，较浅、带折痕阴影）：贴着对角线的反射三角 -->
                    <view
                        :class="'pcloth-flap ' + (revealed ? 'off' : '')"
                        :style="'clip-path:polygon(100% ' + (100 - peelPct) + '%,' + (100 - peelPct) + '% 100%,' + (100 - peelPct) + '% ' + (100 - peelPct) + '%)'"
                    ></view>
                    <view class="peelgrip" :style="'opacity:' + (peelPct >= 80 || revealed ? 0 : 1)">↖</view>
                </view>

                <!-- 手动熨斗：画板（BoardView），手指按住划过豆子熔合 -->
                <view v-if="phase === 'manual'" class="board-area">
                    <canvas type="2d" id="board" class="board" @touchstart="onTS" @touchmove="onTM" @touchend="onTE" @touchcancel="onTE"></canvas>
                </view>
            </view>

            <!-- 底部 -->
            <view class="fbottom">
                <block v-if="phase === 'pick'">
                    <view class="tex-row tex-method">
                        <view class="tex-label">方式</view>
                        <view class="seg">
                            <view :class="'seg-i ' + (method === 'machine' ? 'on' : '')" hover-class="pressed" data-m="machine" @tap="pickMethod">自动熨烫机</view>
                            <view :class="'seg-i ' + (method === 'manual' ? 'on' : '')" hover-class="pressed" data-m="manual" @tap="pickMethod">手动熨斗</view>
                        </view>
                    </view>
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
                    <view class="tex-row tex-hole">
                        <view class="tex-label">豆孔</view>
                        <view class="seg">
                            <view :class="'seg-i ' + (hole === 'none' ? 'on' : '')" hover-class="pressed" data-h="none" @tap="pickHole">无孔</view>
                            <view :class="'seg-i ' + (hole === 'small' ? 'on' : '')" hover-class="pressed" data-h="small" @tap="pickHole">小孔</view>
                            <view :class="'seg-i ' + (hole === 'large' ? 'on' : '')" hover-class="pressed" data-h="large" @tap="pickHole">大孔</view>
                        </view>
                    </view>
                    <view class="start-btn" hover-class="pressed" @tap="startIron">开始熨烫 →</view>
                </block>
                <view v-else-if="phase === 'insert'" class="insert-tip" hover-class="pressed" @tap="doInsert">↑ 手指上滑推入托盘（或点这里）</view>
                <view v-else-if="phase === 'peel'" class="peel-tip">按住右下角布角，往左上拖，掀开揭晓 ✨</view>
                <view v-else-if="phase === 'manual'" class="manual-tip">
                    <text class="mt-txt">🔥 按住熨斗，慢慢划过每颗豆子，全部烫完就完成</text>
                    <view class="mt-fit" hover-class="pressed" @tap="zoomFit">⛶ 复位</view>
                </view>
            </view>

            <canvas v-if="celebrating" type="2d" id="confetti" class="confetti"></canvas>
            <guide :gid="guideId" :steps="guideSteps" @done="onGuideDone" />
        </view>

        <canvas type="2d" id="util" class="util-canvas" :style="'width:' + capW + 'px;height:' + capH + 'px'"></canvas>
    </view>
</template>

<script>
// 熨烫界面：自动熨烫机流程（选烫法 → 盖烘焙布 → 上滑推托盘进机器 → 自动压合 → 拖动掀布揭晓 → 完成进查看页）
const { store } = require('../../utils/store');
const { PALETTE } = require('../../utils/palette');
const { colorStats } = require('../../utils/convert');
const { BoardView, renderPatternTo, getBeadShape, workFinish, workHole, finishList, finishInfo } = require('../../utils/board');
const { ensureFinishSwatches } = require('../../utils/finishswatch');
const { audio, bgm } = require('../../utils/audio');
const { celebrate } = require('../../utils/confetti');
const ui = require('../../utils/ui');
const { cfg } = require('../../utils/config');
const ads = require('../../utils/ads');
const { buildGuide, guideSeen, markGuideSeen } = require('../../utils/guidance');
const HOLE_LABEL = {
    none: '无孔',
    small: '小孔',
    large: '大孔'
};
// 每个流程步骤的标题/副标
const STEP = {
    cover: {
        t: '盖上烘焙布',
        s: '先给豆子盖一层烘焙布，保护表面、受热更均匀。'
    },
    insert: {
        t: '把托盘推进去',
        s: '烘焙布已盖好，手指上滑，把托盘推进机器。'
    },
    press: {
        t: '正在自动压合',
        s: '压板缓慢下降，把豆豆稳稳压住、均匀加热。'
    },
    peel: {
        t: '从右下角轻轻掀开',
        s: '按住布角，向左上方拖，慢慢掀开烘焙布。'
    }
};
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
            workName: '',
            workId: '',
            muted: false,
            bgmOn: false,
            debug: cfg.DEBUG,

            // 熨烫方式：machine 自动熨烫机（默认）/ manual 手动熨斗（手指划过豆子熔合）
            method: 'machine',

            pct: 0,

            // 手动熨斗的进度
            // 选烫法
            finish: 'smooth',

            hole: 'none',
            holeLabel: '无孔',
            finishName: '',
            cats: [],
            finishTab: 'common',
            cards: [],

            // 机器流程
            phase: 'pick',

            // pick / cover / insert / press / peel（自动机器）/ manual（手动熨斗）
            stepT: '',

            stepS: '',
            ledText: 'READY',
            pressPct: 0,
            peelPct: 0,
            revealed: false,

            // 掀完：整张布淡出露成品全貌
            trayLift: 0,

            // 托盘上移像素（上滑推入）
            trayDrag: false,

            // 拖动中：关掉过渡，让托盘跟手（松手/推入才用过渡）
            trayOp: 1,

            // 托盘透明度（推入机器时淡出=被吞进去）
            trayScale: 1,

            // 托盘缩放（推入时略缩，进机器口）
            peelW: 240,

            // 揭晓大板上成品图的显示尺寸
            peelH: 300,

            trayW: 200,
            trayH: 200,
            celebrating: false,
            guideSteps: [],
            guideId: ''
        };
    },
    onLoad(q) {
        const work = store.get(q.id);
        if (!work) {
            ui.backHome();
            return;
        }
        if (!work.completed) {
            uni.redirectTo({
                url: '/pages/play/play?id=' + work.id
            });
            return;
        }
        if (work.ironDone) {
            uni.redirectTo({
                url: '/pages/view/view?id=' + work.id
            });
            return;
        }
        if (!work.ironed || work.ironed.length !== work.cells.length) {
            work.ironed = new Array(work.cells.length).fill(0);
        }
        this.work = work;
        this.uq = ui.serialQueue();
        // 插屏预建（完成后回首页时弹）
        this._itAd = ads.prepareInterstitial('interstitialDone');
        this.finishImg = {};
        // 手动熨斗进度：总豆数 / 已烫数（支持中途离开再回来接着烫）
        this.totalPlaced = work.cells.filter((t) => t >= 0).length;
        this.ironedCount = work.ironed.reduce((a, b) => a + b, 0);
        const finish = workFinish(work);
        const hole = workHole(work);
        this.setData({
            pct: this.pctFun(),
            insets: ui.navInsets(),
            title: '熨烫 · ' + work.name,
            workName: work.name,
            workId: work.id,
            muted: audio.muted,
            bgmOn: bgm.enabled,
            finish,
            hole,
            holeLabel: HOLE_LABEL[hole],
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
        ui.queryNode(this, '#tray').then((r) => {
            if (r && r.node) {
                this.trayCanvas = r.node;
                this.renderTray(false);
            }
        });
        // 预览小图延后渲染（captureCanvas 生成临时图较重，避免卡住刚进页面的首屏）
        ui.queryNode(this, '#util').then((r) => {
            if (r) {
                this.utilCanvas = r.node;
                setTimeout(() => this.loadSwatchesFun(), 450);
            }
        });
        // 首次熨烫引导：① 选方式（新增，最重要的分叉）② 挑烫法/豆孔 → 开始。
        // 流程里的手势（上滑推入 / 掀布 / 按住划豆）由常驻的行内提示负责，不塞进这个一次性蒙层。
        const methodStep = {
            sel: '.tex-method',
            text: '两种熨烫方式：「自动熨烫机」全自动（盖布→推入→压合→掀开揭晓），「手动熨斗」自己拿熨斗划过豆子——挑你喜欢的。'
        };
        const goStep = {
            sel: '.start-btn',
            text: '再挑烫法（常用 / 特殊工艺 / 闪粉）和豆孔，点「开始熨烫」——自动机器跟着提示走，手动就按住熨斗慢慢划过每颗豆子。'
        };
        if (!guideSeen('iron')) buildGuide(this, 'iron', [methodStep, goStep]);
        else if (!guideSeen('iron-method')) {
            buildGuide(this, 'iron-method', [methodStep]);
        } // 老用户补看「方式」这个新选项
    },
    onResize() {
        this.setData({
            insets: ui.navInsets()
        });
        if (this.bv) {
            setTimeout(() => ui.syncBoardRect(this, this.bv), 120);
        } // 手动画板转屏校准
    },
    onShow() {
        if (this.work && bgm.enabled) {
            bgm.start();
        }
    },
    // 接着拼豆页的 BGM 播下去
    onHide() {
        this.flushSaveFun();
        bgm.stop();
    },
    onUnload() {
        this._gone = true;
        clearInterval(this._peelTimer);
        clearTimeout(this._saveTimer);
        clearTimeout(this._pctTimer);
        this.flushSaveFun();
        if (this.bv) {
            this.bv.destroy();
        }
        bgm.stop();
        if (this._itAd) {
            this._itAd.destroy();
        }
    },
    methods: {
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

        // 渲染托盘里的图：fused=false 原豆 / true 融合成品。
        // 画幅是固定内框 FITW×FITH——图案按比例缩放后居中放进去，高矮宽窄的作品框都一样大。
        renderTray(fused) {
            if (!this.trayCanvas || !this.work) {
                return;
            }
            const work = this.work;
            const FITW = 264;
            const FITH = 122; // 画幅内框（扁一点，跟 .pan 固定高 144 对齐；机器/托盘等高）
            const cellPx = ui.clamp(Math.floor(Math.min(FITW / work.w, FITH / work.h)), 3, 16); // 渲染分辨率≈框大小，缩放后清晰
            const size = renderPatternTo(this.trayCanvas, work, {
                cellPx,
                pad: 4,
                fused,
                finish: this.finish,
                hole: fused ? this.hole : 'none',
                scale: 2
            });
            const k = Math.min(1, FITW / size.width, FITH / size.height);
            this.setData({
                trayW: Math.round(size.width * k),
                trayH: Math.round(size.height * k)
            });
        },

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
            if (this.guideId === 'iron') {
                markGuideSeen('iron-method');
            } // 看过完整版就别再补看方式那步
            this.setData({
                guideSteps: []
            });
        },

        toggleBgm() {
            this.setData({
                bgmOn: bgm.toggle()
            });
        },

        flushSaveFun() {
            if (!this.work) {
                return;
            }
            store.update(this.work.id, {
                ironed: this.work.ironed,
                ironDone: this.work.ironDone || false
            });
        },

        toggleMute() {
            audio.setMuted(!audio.muted);
            this.setData({
                muted: audio.muted
            });
        },

        goBack() {
            ui.backHome();
        },

        /* ---------- 选烫法 / 豆孔 ---------- */
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
                const on = c.key === f;
                if (c.active !== on) {
                    patch['cards[' + i + '].active'] = on;
                }
            });
            this.setData(patch);
            if (this.work) {
                this.work.finish = f;
                store.update(this.work.id, {
                    finish: f
                });
            }
        },

        pickHole(e) {
            const h = e.currentTarget.dataset.h;
            if (!h || h === this.hole) {
                return;
            }
            this.setData({
                hole: h,
                holeLabel: HOLE_LABEL[h]
            });
            if (this.work) {
                this.work.hole = h;
                store.update(this.work.id, {
                    hole: h
                });
            }
        },

        // 熨烫方式：自动熨烫机 / 手动熨斗
        pickMethod(e) {
            const m = e.currentTarget.dataset.m;
            if (!m || m === this.method) {
                return;
            }
            this.setData({
                method: m
            });
        },

        /* ---------- 机器流程 ---------- */
        stepFun(p) {
            this.setData({
                phase: p,
                stepT: STEP[p] ? STEP[p].t : '',
                stepS: STEP[p] ? STEP[p].s : ''
            });
        },

        // 开始熨烫：手动 → 画板熨斗；自动 → 盖布进机器
        startIron() {
            this._noSwatch = true; // 开始熨烫后不再渲染预览图，别跟流程抢线程
            if (this.method === 'manual') {
                this.startManualFun();
                return;
            }
            this._inserting = false;
            this.stepFun('cover');
            setTimeout(() => {
                if (!this._gone && this.phase === 'cover') {
                    this.stepFun('insert');
                }
            }, 700);
        },

        /* ---------- 手动熨斗（BoardView iron 模式：手指=熨斗，划过豆子熔合） ---------- */
        startManualFun() {
            const work = this.work;
            // 等 phase=manual 渲染出 #board 再查节点建 BoardView（setData 回调=视图已更新）
            this.setData(
                {
                    phase: 'manual',
                    pct: this.pctFun()
                },
                () => {
                    ui.queryNode(this, '#board').then((r) => {
                        if (!r || !r.node || !work || this._gone) {
                            return;
                        }
                        const dpr = Math.min(3, ui.navInsets().dpr);
                        this.bv = new BoardView(r.node, {
                            w: work.w,
                            h: work.h,
                            cells: work.cells,
                            placed: work.placed,
                            palette: work.palette || null,
                            mode: 'iron',
                            ironed: work.ironed,
                            finish: this.finish,
                            hole: this.hole,
                            onIron: (n) => this.applyIronFun(n)
                        });
                        this.bv.setViewport(r.width, r.height, dpr, r.left, r.top);
                        setTimeout(() => {
                            if (!this._gone) {
                                ui.syncBoardRect(this, this.bv);
                            }
                        }, 600);
                    });
                }
            );
        },

        onTS(e) {
            if (this.bv && !this._done) {
                this.bv.touchStart(e);
            }
        },

        onTM(e) {
            if (this.bv && !this._done) {
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

        pctFun() {
            return this.totalPlaced ? Math.round((this.ironedCount / this.totalPlaced) * 100) : 0;
        },

        // 熨到一批豆子：累计 + 刷进度（节流）+ 存档；全烫完就结算
        applyIronFun(n) {
            if (this._done || this._gone) {
                return;
            }
            this.ironedCount += n;
            audio.sizzle();
            if (!this._pctTimer) {
                this._pctTimer = setTimeout(() => {
                    this._pctTimer = 0;
                    this.setData({
                        pct: this.pctFun()
                    });
                }, 100);
            }
            this.scheduleSaveFun();
            if (this.ironedCount >= this.totalPlaced) {
                this.finishIronFun();
            }
        },

        scheduleSaveFun() {
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this.flushSaveFun(), 600);
        },

        // 推托盘：上滑手势（跟手，无过渡）。要推到顶(或大半)才推进去——避免轻轻一碰就自动压合
        onTrayTS(e) {
            if (this.phase !== 'insert' || this._inserting) {
                return;
            }
            const t = e.touches && e.touches[0];
            if (!t) {
                return;
            }
            this._sy = t.clientY;
            this._lastLift = null;
        },

        onTrayTM(e) {
            if (this.phase !== 'insert' || this._inserting || this._sy == null) {
                return;
            }
            const t = e.touches && e.touches[0];
            if (!t) {
                return;
            }
            const lift = Math.max(0, Math.min(150, this._sy - t.clientY));
            if (this._lastLift != null && Math.abs(lift - this._lastLift) < 3) {
                return;
            } // 节流
            this._lastLift = lift;
            this.setData({
                trayLift: lift,
                trayDrag: true
            });
            if (lift >= 142) {
                this._sy = null;
                this.doInsert();
            } // 推到顶=推进去
        },

        onTrayTE() {
            if (this.phase !== 'insert' || this._inserting) {
                return;
            }
            if (this.trayLift >= 96) {
                this.doInsert(); // 推了大半，松手也算推进去
            } else {
                this.setData({
                    trayLift: 0,
                    trayDrag: false
                });
            } // 没推够，弹回
            this._sy = null;
            this._lastLift = null;
        },

        doInsert() {
            if (this.phase !== 'insert' || this._inserting) {
                return;
            }
            this._inserting = true;
            // 上移进机器口 + 淡出 + 略缩 → 被机器"吞进去"（机器 z-index 更高，会遮住托盘）
            this.setData({
                trayLift: 210,
                trayOp: 0,
                trayScale: 0.82,
                trayDrag: false
            });
            try {
                uni.vibrateShort({
                    type: 'light'
                });
            } catch (e) {
            } /* 忽略 */
            setTimeout(() => this.startPress(), 520);
        },

        // 自动压合
        startPress() {
            this.stepFun('press');
            this.setData({
                ledText: 'PRESS',
                pressPct: 0
            });
            setTimeout(() => {
                if (!this._gone) {
                    this.setData({
                        pressPct: 100
                    });
                }
            }, 60);
            audio.sizzle();
            setTimeout(() => {
                if (!this._gone) {
                    this.setData({
                        ledText: 'HEAT'
                    });
                    audio.sizzle();
                }
            }, 1300);
            setTimeout(() => {
                if (this._gone) {
                    return;
                }
                // 压合完 → 揭晓大板（拼板 + 成品 + 一整张烘焙布，掀开有纸张折角）。托盘/机器退场
                this._peeling = false;
                this.setData({
                    peelPct: 0,
                    revealed: false
                });
                this.stepFun('peel');
                // #peelcv 是 wx:if peel 才进 DOM，等它渲染出来再查节点、把成品渲进去
                setTimeout(
                    () =>
                        ui.queryNode(this, '#peelcv').then((r) => {
                            if (r && r.node && !this._gone) {
                                this.peelCanvas = r.node;
                                this.renderPeel();
                            }
                        }),
                    60
                );
            }, 2600);
        },

        // 揭晓大板上的成品图：竖幅大板，图案按比例缩放居中；周围露拼板孔洞（像真实拼板）
        renderPeel() {
            if (!this.peelCanvas || !this.work) {
                return;
            }
            const work = this.work;
            const FITW = 300;
            const FITH = 372;
            const cellPx = ui.clamp(Math.floor(Math.min(FITW / work.w, FITH / work.h)), 3, 18);
            const size = renderPatternTo(this.peelCanvas, work, {
                cellPx,
                pad: 4,
                fused: true,
                finish: this.finish,
                hole: this.hole,
                scale: 2
            });
            const k = Math.min(1, FITW / size.width, FITH / size.height);
            this.setData({
                peelW: Math.round(size.width * k),
                peelH: Math.round(size.height * k)
            });
        },

        // 掀布：拖动手势（handler 挂在整个 .peelboard 上，点哪都算）。
        // 要拖得慢一点、更长一点才掀开（除数放大 = 跟手更"沉"）；松手后缓缓自动掀到底，不是"啪"一下。
        onClothTS(e) {
            if (this.phase !== 'peel' || this._peeling) {
                return;
            }
            const t = e.touches && e.touches[0];
            if (!t) {
                return;
            }
            clearInterval(this._peelTimer); // 打断"合回去"的动画，接着这次拖
            this._px = t.clientX;
            this._py = t.clientY;
        },

        onClothTM(e) {
            if (this.phase !== 'peel' || this._px == null || this._peeling) {
                return;
            }
            const t = e.touches && e.touches[0];
            if (!t) {
                return;
            }
            const dx = this._px - t.clientX;
            const dy = this._py - t.clientY;
            const p = Math.max(0, Math.min(100, (dx + dy) / 3.6)); // 往左上拖，要拖更长才掀完，慢慢来
            this.setData({
                peelPct: p
            });
            if (p >= 100) {
                this._px = null;
                this.revealPeelFun();
            }
        },

        onClothTE() {
            if (this.phase !== 'peel' || this._peeling) {
                return;
            }
            this._px = null;
            if (this.peelPct >= 28) {
                this.revealPeelFun(); // 掀过约 3 成，缓缓自动掀到底
            } else {
                this.animatePeelFun(0);
            } // 没掀够，缓缓合回去
        },

        // 缓动把 peelPct 推到目标值（easeOutCubic），营造"慢慢掀开"的手感
        animatePeelFun(to, done) {
            const from = this.peelPct;
            clearInterval(this._peelTimer);
            if (Math.abs(to - from) < 0.5) {
                this.setData({
                    peelPct: to
                });
                if (done) {
                    done();
                }
                return;
            }
            const dur = Math.max(300, Math.abs(to - from) * 11); // 掀得越多动画越长，最慢约 1.1s
            const t0 = Date.now();
            this._peelTimer = setInterval(() => {
                if (this._gone) {
                    clearInterval(this._peelTimer);
                    return;
                }
                const k = Math.min(1, (Date.now() - t0) / dur);
                const e = 1 - Math.pow(1 - k, 3);
                this.setData({
                    peelPct: from + (to - from) * e
                });
                if (k >= 1) {
                    clearInterval(this._peelTimer);
                    if (done) {
                        done();
                    }
                }
            }, 30);
        },

        revealPeelFun() {
            if (this._peeling) {
                return;
            }
            this._peeling = true;
            this.animatePeelFun(100, () => this.finishIronFun());
        },

        /* ---------- 完成 → 查看页 ---------- */
        finishIronFun() {
            if (this._done) {
                return;
            }
            this._done = true;
            if (this.method === 'machine') {
                this.setData({
                    peelPct: 100,
                    revealed: true
                });
            } // 整张布淡出，露成品全貌，再撒花
            const work = this.work;
            for (let i = 0; i < work.ironed.length; i++) {
                if (work.cells[i] >= 0 && work.placed[i]) {
                    work.ironed[i] = 1;
                }
            }
            work.ironDone = true;
            store.update(work.id, {
                ironed: work.ironed,
                ironDone: true,
                finish: this.finish,
                hole: this.hole,
                completedAt: Date.now()
            });
            if (this.utilCanvas) {
                this.uq(() => ui.makeThumb(this, this.utilCanvas, work, true))
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
                        /* 缩略图失败不影响 */
                    });
            }
            audio.finish();
            try {
                uni.vibrateShort({
                    type: 'medium'
                });
            } catch (e) {
            } /* 忽略 */
            this.celebrateFun();
            setTimeout(() => {
                if (!this._gone) {
                    uni.redirectTo({
                        url: '/pages/view/view?id=' + work.id
                    });
                }
            }, 1500);
        },

        celebrateFun() {
            this.setData(
                {
                    celebrating: true
                },
                () => {
                    ui.queryNode(this, '#confetti').then((r) => {
                        if (!r || !r.node) {
                            return;
                        }
                        const dpr = Math.min(2, ui.navInsets().dpr);
                        const w = this.work;
                        const hexes = colorStats(w.cells).map((s) => (w.palette ? w.palette[s.pal] : PALETTE[s.pal].hex));
                        celebrate(r.node, r.width, r.height, dpr, hexes, () => {
                            /* 完成即将跳转 */
                        });
                    });
                }
            );
        }
    }
};
</script>
<style>
/* 熨烫界面：自动熨烫机流程。选烫法横滑器 .fp-* / 分段 .seg 在 app.wxss 全局 */
.ironflow {
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.ironflow .topbar {
    padding-left: 16px;
    padding-right: 16px;
    position: relative;
    background: none;
}
.fin-tag {
    padding: 7px 13px;
    background: var(--card);
    border: 2px solid var(--ink);
    box-shadow: 2px 2px 0 #e2dad3;
    font-size: 12px;
    font-weight: 800;
    color: var(--ink);
    display: flex;
    align-items: center;
}

/* 步骤标题 */
.fhead {
    text-align: center;
    padding: 4px 22px 2px;
}
.fkick {
    font-size: 11px;
    letter-spacing: 3px;
    color: var(--ink2);
    font-weight: 800;
}
.ftitle {
    font-size: 24px;
    font-weight: 900;
    color: var(--ink);
    margin: 4px 0 3px;
}
.fsub {
    font-size: 13px;
    color: var(--ink2);
    line-height: 1.5;
    min-height: 20px;
}

/* 舞台 */
.stage {
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
}

/* 机器（宽一点更大气；固定高度 = 托盘高度，两块等高；z-index 高于托盘，托盘上滑被机器遮住=吞进去） */
.machine {
    width: 340px;
    max-width: 92vw;
    height: 172px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background: linear-gradient(#fff, #f3efe9);
    border-radius: 24px;
    padding: 14px 18px 0;
    box-shadow: 0 12px 30px rgba(120, 100, 80, 0.18);
    position: relative;
    z-index: 3;
}
.mled {
    flex-shrink: 0;
    background: #1b1b1d;
    border-radius: 16px;
    padding: 14px 18px;
    display: flex;
    align-items: center;
}
.mdot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #39d98a;
    box-shadow: 0 0 8px #39d98a;
    margin-right: 10px;
    flex-shrink: 0;
}
.mtext {
    font-size: 21px;
    font-weight: 900;
    letter-spacing: 1px;
    color: #eafff4;
    flex: 1;
}
.mlab {
    font-size: 10px;
    letter-spacing: 2px;
    color: #7d7d82;
    font-weight: 700;
}
.mdots {
    flex-shrink: 0;
    display: flex;
    gap: 6px;
    justify-content: center;
    margin-top: 8px;
}
.mdots view {
    width: 22px;
    height: 5px;
    border-radius: 3px;
    background: #e0d8cd;
}
.mdots view.on {
    background: #b8ab9b;
}
/* 机身：撑满剩余高度，凹槽面板 + 散热格栅 */
.mbody {
    flex: 1;
    margin: 7px 2px;
    border-radius: 12px;
    background: rgba(120, 100, 80, 0.04);
    box-shadow: inset 0 1px 4px rgba(120, 100, 80, 0.1);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
}
.mvent {
    width: 52%;
    height: 4px;
    border-radius: 3px;
    background: rgba(120, 100, 80, 0.12);
}
.mmouth {
    flex-shrink: 0;
    height: 22px;
    background: #1b1b1d;
    border-radius: 0 0 14px 14px;
    margin: 0 -18px 0;
}

.marrow {
    font-size: 30px;
    color: var(--ink);
    margin: 12px 0;
    opacity: 0;
} /* cover 时隐形但占住间距 */
.marrow.on {
    opacity: 1;
    animation: bob 1.1s ease-in-out infinite;
}
@keyframes bob {
    0%,
    100% {
        transform: translateY(0);
    }
    50% {
        transform: translateY(-7px);
    }
}

/* 压合进度 */
.pressbox {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 16px;
}
.pbadge {
    padding: 6px 14px;
    background: #fff;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
}
.pbar {
    width: 220px;
    height: 8px;
    background: #e6ded2;
    border-radius: 5px;
    overflow: hidden;
    margin-top: 14px;
}
.pfill {
    display: block;
    height: 100%;
    width: 0;
    background: linear-gradient(90deg, #f0a24d, #e86a7a);
    border-radius: 5px;
    transition: width 2.3s linear;
}

/* 托盘 */
.tray {
    width: 340px;
    max-width: 92vw;
    background: #2b2b2d;
    border-radius: 20px;
    padding: 14px;
    box-shadow: 0 12px 26px rgba(80, 60, 50, 0.2);
    position: relative;
    z-index: 1;
    transition: transform 0.45s cubic-bezier(0.5, 0, 0.2, 1), opacity 0.45s ease;
}
.tray.dragging {
    transition: none;
} /* 拖动中跟手，别用过渡 */
.pan {
    background: #fbf6ec;
    border-radius: 8px;
    padding: 10px;
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 144px;
    box-sizing: border-box;
}
/* 托盘底部把手（像抽屉拉手，跟着托盘一起进机器） */
.handle {
    position: absolute;
    left: 50%;
    margin-left: -46px;
    bottom: -13px;
    width: 92px;
    height: 18px;
    background: #2b2b2d;
    border-radius: 0 0 13px 13px;
    box-shadow: 0 5px 8px rgba(80, 60, 50, 0.18);
}
.traycv {
    display: block;
}
/* 烘焙布：光滑半透明烘焙纸（奶白 + 内嵌高光/柔影做出纸的厚度与光泽），底下豆子隐约可见（仿视频） */
.cloth {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    border-radius: 6px;
    background: rgba(247, 241, 231, 0.9); /* 实底奶白，稳稳遮住豆子（渐变在部分渲染器会发虚） */
    box-shadow: inset 0 0 22px rgba(198, 180, 150, 0.32), inset 0 4px 6px rgba(255, 255, 255, 0.65), inset 0 -12px 18px rgba(255, 255, 255, 0.22),
        0 1px 3px rgba(120, 100, 80, 0.12);
    opacity: 0;
    transition: opacity 0.6s;
}
.cloth.covered {
    opacity: 1;
}
/* 烘焙布上的点线边 + 标签（仿参考图，跟布一起掀走） */
.cloth-frame {
    position: absolute;
    left: 6px;
    top: 6px;
    right: 6px;
    bottom: 6px;
    border: 1.5px dotted rgba(150, 130, 110, 0.4);
    border-radius: 4px;
}
.cloth-label {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 7px;
    text-align: center;
    font-size: 10px;
    letter-spacing: 3px;
    color: rgba(120, 100, 80, 0.3);
    font-weight: 700;
}

/* ========= 掀开揭晓大板 ========= */
.peelboard {
    position: relative;
    width: 322px;
    max-width: 90vw;
    height: 402px;
    max-height: 60vh;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 16px;
    overflow: hidden;
    background-color: #e7e0d1;
    background-image: radial-gradient(rgba(120, 100, 80, 0.17) 22%, transparent 25%);
    background-size: 13px 13px;
    background-position: 5px 5px;
    box-shadow: 0 14px 30px rgba(120, 100, 80, 0.18), inset 0 0 0 7px #efe9dd, inset 0 0 0 8px rgba(120, 100, 80, 0.12);
    animation: boardin 0.4s ease both;
}
@keyframes boardin {
    from {
        opacity: 0;
        transform: scale(0.95);
    }
    to {
        opacity: 1;
        transform: scale(1);
    }
}
.peelcv {
    display: block;
    position: relative;
    z-index: 1;
    border-radius: 2px;
    box-shadow: 0 1px 4px rgba(120, 100, 80, 0.14);
}
/* 烘焙布正面（平铺部分）：沿对角线裁掉右下三角 → 露出成品 */
.pcloth-face {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 2;
    background: rgba(247, 241, 231, 0.95);
    box-shadow: inset 0 0 28px rgba(198, 180, 150, 0.3), inset 0 5px 8px rgba(255, 255, 255, 0.6), inset 0 -14px 20px rgba(255, 255, 255, 0.2);
    transition: opacity 0.5s ease;
}
.pcloth-frame {
    position: absolute;
    left: 10px;
    top: 10px;
    right: 10px;
    bottom: 10px;
    border: 1.5px dotted rgba(150, 130, 110, 0.4);
    border-radius: 5px;
}
.pcloth-label {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 12px;
    text-align: center;
    font-size: 11px;
    letter-spacing: 4px;
    color: rgba(120, 100, 80, 0.3);
    font-weight: 700;
}
/* 折起来的布角：露布背面（较浅、细密斜纹），drop-shadow 做折痕立体感 */
.pcloth-flap {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 3;
    background-color: #f4f0e7;
    background-image: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.75) 0, rgba(255, 255, 255, 0.75) 2px, rgba(206, 196, 180, 0.55) 2px, rgba(206, 196, 180, 0.55) 4px);
    filter: drop-shadow(-2px -2px 4px rgba(90, 70, 50, 0.22));
    transition: opacity 0.5s ease;
}
.pcloth-face.off,
.pcloth-flap.off {
    opacity: 0;
} /* 掀完整张布淡出，露成品全貌 */
.peelgrip {
    position: absolute;
    right: 12px;
    bottom: 12px;
    z-index: 4;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #e86a7a;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    box-shadow: 0 2px 7px rgba(0, 0, 0, 0.22);
    transition: opacity 0.2s;
    animation: grippulse 1.1s ease-in-out infinite;
}
@keyframes grippulse {
    0%,
    100% {
        transform: scale(1);
    }
    50% {
        transform: scale(1.14);
    }
}

/* ========= 手动熨斗 ========= */
.board-area {
    width: 100%;
} /* 全局 .board-area 在居中 stage 里要撑满宽度 */
.mprog {
    width: 62%;
    max-width: 260px;
    height: 8px;
    margin: 8px auto 0;
    background: #e6ded2;
    border-radius: 5px;
    overflow: hidden;
}
.mprog-fill {
    display: block;
    height: 100%;
    width: 0;
    background: linear-gradient(90deg, #f0a24d, #e86a7a);
    border-radius: 5px;
    transition: width 0.25s;
}
.manual-tip {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 10px 16px;
    flex-wrap: wrap;
}
.mt-txt {
    font-size: 13px;
    color: var(--ink2);
}
.mt-fit {
    flex-shrink: 0;
    padding: 7px 14px;
    font-size: 13px;
    font-weight: 800;
    color: var(--ink);
    background: var(--card);
    border: 2px solid var(--ink);
    box-shadow: 2px 2px 0 #e2dad3;
}

/* 底部 */
.fbottom {
    padding: 6px 12px calc(10px + env(safe-area-inset-bottom));
    flex-shrink: 0;
}
.start-btn {
    margin: 10px 4px 2px;
    padding: 15px;
    background: var(--accent);
    color: #7a4a55;
    font-size: 17px;
    font-weight: 900;
    letter-spacing: 2px;
    border: 3px solid var(--ink);
    box-shadow: 4px 4px 0 var(--accent-dark);
    text-align: center;
}
.insert-tip {
    margin: 8px auto;
    padding: 14px;
    max-width: 320px;
    text-align: center;
    font-size: 15px;
    font-weight: 800;
    color: #fff;
    background: #1b1b1d;
    border-radius: 16px;
}
.peel-tip {
    text-align: center;
    font-size: 13px;
    color: var(--ink2);
    padding: 12px 20px;
}

/* 豆孔行 */
.tex-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
    max-width: 720px;
    margin: 8px auto 0;
}
.tex-label {
    font-size: 12px;
    color: var(--ink2);
    flex-shrink: 0;
}
</style>
