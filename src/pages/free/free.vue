<template>
    <view>
        <view class="playpage">
            <view class="topbar" :style="'padding-top:' + insets.top + 'px;padding-right:' + insets.right + 'px'">
                <view class="tb-back" hover-class="pressed" @tap="goBack">‹</view>
                <view class="tb-title">{{ title }}</view>
                <view class="tb-actions">
                    <view class="icon-btn" hover-class="pressed" @tap="toggleShape">{{ beadShape === 'round' ? '●' : '■' }}</view>
                    <view class="icon-btn" hover-class="pressed" @tap="toggleMute">
                        <image class="pxi-l" :src="muted ? '/assets/icons/sndoff.png' : '/assets/icons/sndon.png'" />
                    </view>
                </view>
            </view>

            <view class="free-info">
                <view class="fi-count">
                    已拼
                    <text class="b">{{ count }}</text>
                    颗
                </view>
                <view class="fi-hint">无边拼豆板：画到哪算哪，完成时自动裁剪</view>
            </view>

            <view class="board-area">
                <canvas type="2d" id="board" class="board" @touchstart="onTS" @touchmove="onTM" @touchend="onTE" @touchcancel="onTE"></canvas>
                <view class="zoom-fabs">
                    <view hover-class="pressed" @tap="zoomFit">⛶</view>
                </view>
            </view>

            <view class="bottom-bar">
                <view class="bb-inner">
                    <view class="tools-row">
                        <view :class="'tool-chip ' + (eraser ? 'active' : '')" @tap="tapEraser">
                            <image class="pxi-s" src="/static/assets/icons/eraser.png" />
                            橡皮
                        </view>
                        <view class="tool-chip" @tap="exportRegion">
                            <image class="pxi-s" src="/static/assets/icons/export.png" />
                            导出
                        </view>
                        <view class="tool-chip done-chip" @tap="finishWork">
                            <image class="pxi-s" src="/static/assets/icons/check.png" />
                            完成创作
                        </view>
                        <view class="tools-hint">{{ eraser ? '点或划格子擦掉豆子' : '选颜色，点或划格子上豆' }}</view>
                    </view>
                    <scroll-view class="palette-bar" scroll-x :scroll-into-view="scrollInto" scroll-with-animation enhanced :show-scrollbar="false">
                        <view
                            :class="'pchip ' + (item.active ? 'active' : '')"
                            :id="'c' + item.pal"
                            @tap="tapChip"
                            :data-pal="item.pal"
                            v-for="(item, index) in chips"
                            :key="index"
                        >
                            <view class="pdot" :style="'background:' + item.hex + ';color:' + item.tcol"></view>
                        </view>
                    </scroll-view>
                </view>
            </view>
        </view>

        <canvas type="2d" id="util" class="util-canvas" :style="'width:' + capW + 'px;height:' + capH + 'px'"></canvas>

        <crop-modal
            :show="exportShow"
            :src="exportSrc"
            :grid="exportGrid"
            title="框选导出区域"
            hint="框会自动吸附到格线，框到哪格是哪格；双指放大更精准，不框 = 整幅导出"
            @confirm="onExportConfirm"
            @cancel="onExportCancel"
        />

        <guide :gid="guideId" :steps="guideSteps" @done="onGuideDone" />
    </view>
</template>

<script>
import cropModal from '@/components/crop-modal/crop-modal';
// 自由画布：真·无边——豆子按世界坐标稀疏存储（Map），
// 画板上的密集数组只是一个 240×240 的"渲染窗口"，随平移/绘画自动跟随；
// 离开窗口的豆子保留在稀疏表里，回来时重新出现。完成后裁剪进熨烫→查看流水线。
const { store } = require('../../utils/store');
const { PALETTE, textColorFor } = require('../../utils/palette');
const { BoardView, renderPatternTo, getBeadShape, setBeadShape } = require('../../utils/board');
const { audio } = require('../../utils/audio');
const ui = require('../../utils/ui');
const ads = require('../../utils/ads');
const { buildGuide } = require('../../utils/guidance');
const WIN = 240; // 渲染窗口边长（格）
const CH = 40; // 窗口位移对齐步长（10 的倍数，保证参考线不错位）
const MARGIN = 20; // 视野距窗口边缘的最小余量，低于则滑动窗口
const MAX_SPAN = 240; // 完成定型时单幅作品的最大跨度（熨烫/分享按密集图处理）
const FIN_MARGIN = 2; // 完成定型时四周补的空白格：板不贴豆边，熨烫/查看/分享有留白（240+4 仍在画布上限 256 内）

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
            title: '',
            count: 0,
            chips: [],
            eraser: false,
            beadShape: 'square',
            muted: false,
            scrollInto: '',
            exportShow: false,
            exportSrc: '',
            guideSteps: [],
            exportGrid: '',
            guideId: ''
        };
    },
    onLoad(q) {
        const work = store.get(q.id);
        if (!work || !work.free) {
            ui.backHome();
            return;
        }
        if (work.completed) {
            uni.redirectTo({
                url: (work.ironDone ? '/pages/view/view?id=' : '/pages/iron/iron?id=') + work.id
            });
            return;
        }
        this.work = work;
        this.uq = ui.serialQueue();
        this.sel = 17; // 默认西瓜红，顺手就能画
        this.tool = null;
        this.saveTimer = 0;
        this.sndTimer = 0;

        // 世界坐标稀疏表：'x,y' -> 色号
        this.sparse = new Map();
        this.win = {
            x0: 0,
            y0: 0
        }; // 窗口原点的世界坐标
        if (Array.isArray(work.freeBeads)) {
            for (const b of work.freeBeads) {
                this.sparse.set(b[0] + ',' + b[1], b[2]);
            }
        } else if (Array.isArray(work.cells) && work.cells.length === work.w * work.h) {
            // 兼容旧存档（密集窗口）：旧窗口原点视为世界 (0,0)
            for (let y = 0; y < work.h; y++) {
                for (let x = 0; x < work.w; x++) {
                    const v = work.cells[y * work.w + x];
                    if (v >= 0) {
                        this.sparse.set(x + ',' + y, v);
                    }
                }
            }
        }
        this.count = this.sparse.size;
        // 初始窗口：盖住已有作品（或世界原点附近）
        const bb = this.bboxWorldFun();
        this.rebuildWindowFun(bb ? (bb.x0 + bb.x1) / 2 : WIN / 2, bb ? (bb.y0 + bb.y1) / 2 : WIN / 2);
        this.setData({
            insets: ui.navInsets(),
            title: work.name,
            count: this.count,
            beadShape: getBeadShape(),
            muted: audio.muted,
            scrollInto: 'c' + this.sel,
            // 全色板选色条按 MARD 色系排（白灰黑→红→粉→橙棕→黄→绿→蓝青→紫→莫兰迪），
            // 同系按系内序号 —— 存储顺序是「45 老色 + 176 追加」，直接摆会东一块西一块
            chips: this.buildChipsFun()
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
                mode: 'free',
                getSelected: () => this.sel,
                getTool: () => this.tool,
                onPlace: (i, isNew) => this.onPlaceFreeFun(i, isNew),
                onErase: (i) => this.onEraseFreeFun(i),
                onExpand: (cx, cy) => this.expandForFun(cx, cy)
            });
            this.bv.setViewport(r.width, r.height, dpr, r.left, r.top);
            // 有作品就定位到作品范围，否则停在窗口中央、舒适缩放
            const bb = this.bboxWorldFun();
            if (bb) {
                this.fitBBoxWorldFun(bb);
            } else {
                const s0 = 20;
                this.bv.scale = s0;
                this.bv.ox = r.width / 2 - (this.work.w * s0) / 2;
                this.bv.oy = r.height / 2 - (this.work.h * s0) / 2;
                this.bv.dirty = true;
            }
            setTimeout(() => ui.syncBoardRect(this, this.bv), 600);
        });
        ui.queryNode(this, '#util').then((r) => {
            if (r) {
                this.utilCanvas = r.node;
            }
        });
        // 首次自由创作：无边画布的玩法不讲不容易发现
        buildGuide(this, 'free', [
            {
                sel: '.palette-bar',
                text: '先挑个颜色，然后点板子上豆；按住划过去能连着画一串～'
            },
            {
                text: '这是块无边的板子：画到边上它会自己跟着延展，想画多大画多大。双指缩放看细节，点右下角 ⛶ 一键回到作品范围。'
            },
            {
                sel: '.tools-row',
                text: '画错了用「橡皮」擦掉；「导出」可以框一块存成图片；画完点「完成创作」，会自动裁掉多余空白去熨烫定型。'
            }
        ]);
    },
    onResize() {
        this.setData({
            insets: ui.navInsets()
        });
        setTimeout(() => ui.syncBoardRect(this, this.bv), 120);
    },
    onHide() {
        clearTimeout(this._thumbT);
        this._thumbT = 0;
        this.flushSaveFun();
        this.refreshThumbFun();
    },
    onUnload() {
        this._gone = true;
        clearTimeout(this._thumbT);
        this._thumbT = 0;
        this.flushSaveFun(); // 存档是同步写，页面销毁前能完成；缩略图靠停笔时的低频刷新 + 首页 heal 兜底
        if (this.bv) {
            this.bv.destroy();
        }
    },
    onShareAppMessage() {
        return {
            title: '拼豆便利店 · 自由画布，想拼什么拼什么',
            path: '/pages/home/home'
        };
    },
    methods: {
        onGuideDone() {
            this.setData({
                guideSteps: []
            });
        },

        // 全色板选色条：按 MARD 色系排（白灰黑→红→粉→橙棕→黄→绿→蓝青→紫→莫兰迪），
        // 同系按系内序号 —— 存储顺序是「45 老色 + 176 追加」，直接摆会东一块西一块。
        // 排序后数组下标 ≠ 色板下标，tapChip 改 active 要走 chipIdx 映射
        buildChipsFun() {
            const chips = PALETTE.map((c, i) => ({
                pal: i,
                hex: c.hex,
                tcol: textColorFor(c.hex),
                active: i === this.sel,
                k: 'HFEGABCDM'.indexOf(c.code[0]) * 1000 + parseInt(c.code.slice(1), 10)
            })).sort((a, b) => a.k - b.k);
            this.chipIdx = new Map(chips.map((c, i) => [c.pal, i]));
            return chips;
        },

        /* ---------- 渲染窗口管理 ---------- */

        // 以世界坐标 (cwx, cwy) 为中心重建窗口（原点按 CH 对齐）；画面上的豆子位置不变
        rebuildWindowFun(cwx, cwy) {
            const work = this.work;
            const nx0 = Math.round((cwx - WIN / 2) / CH) * CH;
            const ny0 = Math.round((cwy - WIN / 2) / CH) * CH;
            if (nx0 === this.win.x0 && ny0 === this.win.y0 && work.w === WIN && work.h === WIN && work.cells.length === WIN * WIN) {
                return;
            }
            const dx = nx0 - this.win.x0;
            const dy = ny0 - this.win.y0;
            this.win.x0 = nx0;
            this.win.y0 = ny0;
            const cells = new Array(WIN * WIN).fill(-1);
            const placed = new Array(WIN * WIN).fill(0);
            for (const [k, v] of this.sparse) {
                const c = k.indexOf(',');
                const x = +k.slice(0, c) - nx0;
                const y = +k.slice(c + 1) - ny0;
                if (x >= 0 && y >= 0 && x < WIN && y < WIN) {
                    const i = y * WIN + x;
                    cells[i] = v;
                    placed[i] = 1;
                }
            }
            work.w = WIN;
            work.h = WIN;
            work.cells = cells;
            work.placed = placed;
            const bv = this.bv;
            if (bv) {
                bv.o.w = WIN;
                bv.o.h = WIN;
                bv.o.cells = cells;
                bv.o.placed = placed;
                bv.ox += dx * bv.scale;
                bv.oy += dy * bv.scale;
                bv.anims.clear(); // 索引整体位移，放弃进行中的入场动画
                bv.dirty = true;
            }
        },

        // 画到窗口外：把窗口滑过去（世界无边，永不失败）
        expandForFun(cx, cy) {
            this.rebuildWindowFun(this.win.x0 + cx, this.win.y0 + cy);
            return true;
        },

        // 平移/缩放后视野贴近窗口边缘时，把窗口滑到视野中心（捏合中不动，避免跳变）
        maybeSlideFun() {
            const bv = this.bv;
            if (!bv || bv.pinch || bv.pointers.size >= 2) {
                return;
            }
            const t = Date.now();
            if (t - (this._slideT || 0) < 120) {
                return;
            }
            this._slideT = t;
            const s = bv.scale;
            const vx0 = -bv.ox / s;
            const vx1 = (bv.vw - bv.ox) / s;
            const vy0 = -bv.oy / s;
            const vy1 = (bv.vh - bv.oy) / s;
            if (vx0 < MARGIN || vy0 < MARGIN || vx1 > this.work.w - MARGIN || vy1 > this.work.h - MARGIN) {
                this.rebuildWindowFun(this.win.x0 + (vx0 + vx1) / 2, this.win.y0 + (vy0 + vy1) / 2);
            }
        },

        /* ---------- 作品范围（世界坐标） ---------- */
        bboxWorldFun() {
            if (!this.sparse.size) {
                return null;
            }
            let x0 = Infinity;
            let y0 = Infinity;
            let x1 = -Infinity;
            let y1 = -Infinity;
            for (const k of this.sparse.keys()) {
                const c = k.indexOf(',');
                const x = +k.slice(0, c);
                const y = +k.slice(c + 1);
                if (x < x0) {
                    x0 = x;
                }
                if (x > x1) {
                    x1 = x;
                }
                if (y < y0) {
                    y0 = y;
                }
                if (y > y1) {
                    y1 = y;
                }
            }
            return {
                x0,
                y0,
                x1,
                y1
            };
        },

        // 从稀疏表裁出作品实际范围的密集图纸（熨烫 / 缩略图用）
        croppedPatternFun() {
            const bb = this.bboxWorldFun();
            if (!bb) {
                return null;
            }
            const cw = bb.x1 - bb.x0 + 1;
            const ch = bb.y1 - bb.y0 + 1;
            const cells = new Array(cw * ch).fill(-1);
            const placed = new Array(cw * ch).fill(0);
            for (const [k, v] of this.sparse) {
                const c = k.indexOf(',');
                const i = (+k.slice(c + 1) - bb.y0) * cw + (+k.slice(0, c) - bb.x0);
                cells[i] = v;
                placed[i] = 1;
            }
            return {
                w: cw,
                h: ch,
                cells,
                placed
            };
        },

        fitBBoxWorldFun(bb) {
            // 先把窗口挪到作品中心，再取景
            this.rebuildWindowFun((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2);
            const bv = this.bv;
            const bw = bb.x1 - bb.x0 + 1;
            const bh = bb.y1 - bb.y0 + 1;
            const m = 44;
            const s = ui.clamp(Math.min((bv.vw - m * 2) / bw, (bv.vh - m * 2) / bh), 2.5, 40);
            bv.scale = s;
            bv.ox = bv.vw / 2 - (bb.x0 - this.win.x0 + bw / 2) * s;
            bv.oy = bv.vh / 2 - (bb.y0 - this.win.y0 + bh / 2) * s;
            bv.dirty = true;
        },

        /* ---------- 画板事件 ---------- */
        onTS(e) {
            if (this.bv) {
                this.bv.touchStart(e);
            }
        },

        onTM(e) {
            if (!this.bv) {
                return;
            }
            this.bv.touchMove(e);
            this.maybeSlideFun();
        },

        onTE(e) {
            if (!this.bv) {
                return;
            }
            this.bv.touchEnd(e);
            this.maybeSlideFun();
        },

        zoomFit() {
            if (!this.bv) {
                return;
            }
            // ⛶ 定位到作品范围；空画布则回到窗口全览
            const bb = this.bboxWorldFun();
            if (bb) {
                this.fitBBoxWorldFun(bb);
            } else {
                this.bv.fit();
            }
        },

        /* ---------- 上豆 / 擦除结算 ---------- */
        worldKeyFun(i) {
            return (i % this.work.w) + this.win.x0 + ',' + (Math.floor(i / this.work.w) + this.win.y0);
        },

        onPlaceFreeFun(i, isNew) {
            this.sparse.set(this.worldKeyFun(i), this.work.cells[i]);
            this.onChangeFun(isNew ? 1 : 0);
        },

        onEraseFreeFun(i) {
            this.sparse.delete(this.worldKeyFun(i));
            this.onChangeFun(-1);
        },

        // 计数 + 节流音效 + 延迟存档 + 停笔后自动更新缩略图
        onChangeFun(delta) {
            this.count += delta;
            if (this.count < 0) {
                this.count = 0;
            }
            if (!this.sndTimer) {
                this.sndTimer = setTimeout(() => {
                    this.sndTimer = 0;
                    if (this.tool === 'erase') {
                        audio.note(300);
                    } else {
                        audio.tap();
                    }
                    this.setData({
                        count: this.count
                    });
                }, 50);
            }
            this.scheduleSaveFun();
            // 页面存活期间低频刷缩略图（onUnload 时页面已销毁、导出会失败，不能只靠退出时生成）
            clearTimeout(this._thumbT);
            this._thumbT = setTimeout(() => {
                this._thumbT = 0;
                this.refreshThumbFun();
            }, 3000);
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

        /* ---------- 色板 / 工具 ---------- */
        tapChip(e) {
            const pal = +e.currentTarget.dataset.pal;
            const old = this.sel;
            this.sel = pal;
            this.tool = null;
            const patch = {
                eraser: false,
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

        tapEraser() {
            this.tool = this.tool === 'erase' ? null : 'erase';
            this.setData({
                eraser: !!this.tool
            });
            if (this.tool) {
                ui.toast('橡皮：点或划格子擦掉豆子');
            }
        },

        /* ---------- 区域导出 ---------- */
        // 「导出」：整幅渲染成预览图 → 裁剪弹窗框选区域 → 框到的格子高清重渲 → 存相册。
        // 预览 pad=0：图片边缘与格子矩阵严格对齐，框选矩形可直接按比例换算成格子范围
        exportRegion() {
            if (!this.count) {
                ui.toast('先拼几颗豆子呀 ✨');
                return;
            }
            if (!this.utilCanvas) {
                ui.toast('画布还没就绪，再试一次');
                return;
            }
            // 流量主接入后（rvExport 位下发）先看激励视频；未接入/失败直接放行，
            // 同一作品当天只看一次
            ads.rewarded('rvExport', {
                workId: this.work.id,
                title: '导出为图片',
                desc: '看一段短广告，即可框选区域导出高清图片到相册'
            }).then((ok) => {
                if (ok && !this._gone) {
                    this.doExportRegionFun();
                }
            });
        },

        doExportRegionFun() {
            const cp = this.croppedPatternFun();
            if (!cp) {
                return;
            }
            this._exportCp = cp;
            uni.showLoading({
                title: '生成预览',
                mask: true
            });
            const cellPx = ui.clamp(Math.floor(1400 / Math.max(cp.w, cp.h)), 2, 20);
            const draw = () =>
                renderPatternTo(this.utilCanvas, cp, {
                    cellPx,
                    pad: 0,
                    scale: 1
                });
            this.uq(() => ui.captureCanvas(this, this.utilCanvas, draw))
                .then((path) => {
                    uni.hideLoading();
                    // 传网格 → 裁剪弹窗按格磁吸，框到哪格是哪格
                    this.setData({
                        exportShow: true,
                        exportSrc: path,
                        exportGrid: {
                            cols: cp.w,
                            rows: cp.h
                        }
                    });
                })
                .catch(() => {
                    uni.hideLoading();
                    ui.toast('预览生成失败，再试一次');
                });
        },

        onExportCancel() {
            this.setData({
                exportShow: false
            });
        },

        onExportConfirm(e) {
            this.setData({
                exportShow: false
            });
            const cp = this._exportCp;
            if (!cp) {
                return;
            }
            const r = e.detail.rect;
            // 弹窗已按格磁吸，矩形恰好落在格线上：四舍五入消掉浮点毛刺即得格子范围
            const x0 = ui.clamp(Math.round(r.x * cp.w), 0, cp.w - 1);
            const y0 = ui.clamp(Math.round(r.y * cp.h), 0, cp.h - 1);
            const x1 = ui.clamp(Math.round((r.x + r.w) * cp.w) - 1, x0, cp.w - 1);
            const y1 = ui.clamp(Math.round((r.y + r.h) * cp.h) - 1, y0, cp.h - 1);
            const w = x1 - x0 + 1;
            const h = y1 - y0 + 1;
            const cells = new Array(w * h).fill(-1);
            let n = 0;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const v = cp.cells[(y0 + y) * cp.w + (x0 + x)];
                    if (v >= 0) {
                        cells[y * w + x] = v;
                        n++;
                    }
                }
            }
            if (!n) {
                ui.toast('框里没有豆子哦');
                return;
            }
            uni.showLoading({
                title: '导出中',
                mask: true
            });
            const sub = {
                w,
                h,
                cells
            };
            const cellPx = ui.clamp(Math.floor(1600 / Math.max(w, h)), 3, 24);
            const draw = () =>
                renderPatternTo(this.utilCanvas, sub, {
                    cellPx,
                    scale: 2
                });
            this.uq(() => ui.captureCanvas(this, this.utilCanvas, draw))
                .then((path) => {
                    uni.hideLoading();
                    return ui.saveToAlbum(path); // 内部有成功 toast 与权限引导
                })
                .catch(() => {
                    uni.hideLoading();
                    ui.toast('导出失败，再试一次');
                });
        },

        /* ---------- 完成 ---------- */
        finishWork() {
            if (!this.count) {
                ui.toast('先拼几颗豆子呀 ✨');
                return;
            }
            const bb = this.bboxWorldFun();
            if (bb.x1 - bb.x0 + 1 > MAX_SPAN || bb.y1 - bb.y0 + 1 > MAX_SPAN) {
                ui.toast('作品跨度超过 ' + MAX_SPAN + ' 格，缩小一点范围再完成吧');
                return;
            }
            uni.showModal({
                title: '完成创作',
                content: '完成后进入熨烫定型，定型好的作品可以分享和导出。确定完成吗？',
                confirmText: '完成',
                confirmColor: '#C9838F',
                success: (r) => {
                    if (!r.confirm || this._gone) {
                        return;
                    }
                    const cp = this.croppedPatternFun();
                    if (!cp) {
                        return;
                    }
                    // 裁到作品实际范围后四周再补一圈空白格定型（真实拼豆板也有余量，展示不贴边）
                    const m = FIN_MARGIN;
                    const w = cp.w + m * 2;
                    const h = cp.h + m * 2;
                    const cells = new Array(w * h).fill(-1);
                    const placed = new Array(w * h).fill(0);
                    for (let y = 0; y < cp.h; y++) {
                        for (let x = 0; x < cp.w; x++) {
                            const v = cp.cells[y * cp.w + x];
                            if (v < 0) {
                                continue;
                            }
                            const i = (y + m) * w + (x + m);
                            cells[i] = v;
                            placed[i] = 1;
                        }
                    }
                    const work = this.work;
                    work.w = w;
                    work.h = h;
                    work.cells = cells;
                    work.placed = placed;
                    work.completed = true;
                    work.ironed = new Array(cells.length).fill(0);
                    clearTimeout(this.saveTimer);
                    this.saveTimer = 0;
                    store.update(work.id, {
                        w: w,
                        h: h,
                        cells: cells,
                        placed: placed,
                        completed: true,
                        ironDone: false,
                        ironed: work.ironed,
                        freeBeads: null,
                        freeX0: 0,
                        freeY0: 0 // 完成后回归密集存档
                    });
                    this.refreshThumbFun();
                    uni.redirectTo({
                        url: '/pages/iron/iron?id=' + work.id
                    });
                }
            });
        },

        /* ---------- 存档 / 缩略图 ---------- */
        scheduleSaveFun() {
            if (this.saveTimer) {
                return;
            }
            this.saveTimer = setTimeout(() => {
                this.saveTimer = 0;
                this.flushSaveFun();
            }, 600);
        },

        // 进行中的自由作品只存稀疏豆表（几 KB 级），不存渲染窗口的大数组
        flushSaveFun() {
            if (!this.work || this.work.completed) {
                return;
            }
            clearTimeout(this.saveTimer);
            this.saveTimer = 0;
            const beads = [];
            for (const [k, v] of this.sparse) {
                const c = k.indexOf(',');
                beads.push([+k.slice(0, c), +k.slice(c + 1), v]);
            }
            store.update(this.work.id, {
                w: WIN,
                h: WIN,
                cells: [],
                placed: [],
                freeBeads: beads,
                freeX0: this.win.x0,
                freeY0: this.win.y0
            });
        },

        refreshThumbFun() {
            if (!this.utilCanvas || !this.work || this._gone) {
                return;
            }
            // 缩略图只画作品实际范围；thumbBeads 戳记供首页判断是否过期
            const cp = this.croppedPatternFun();
            if (!cp) {
                return;
            }
            const n = this.sparse.size;
            const work = this.work;
            const clone = {
                id: work.id,
                thumb: work.thumb,
                w: cp.w,
                h: cp.h,
                cells: cp.cells
            };
            this.uq(() => ui.makeThumb(this, this.utilCanvas, clone, false))
                .then((path) => {
                    work.thumb = path;
                    store.update(
                        work.id,
                        {
                            thumb: path,
                            thumbV: ui.THUMB_V,
                            thumbShape: getBeadShape(),
                            thumbBeads: n
                        },
                        true
                    );
                })
                .catch(() => {
                    /* 缩略图失败不影响流程 */
                });
        }
    }
};
</script>
<style>
/* 自由画布：主体样式在 app.wxss 的 playpage 骨架里 */
.free-info {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 16px 8px;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
}
.fi-count {
    background: var(--card);
    border: 2px solid var(--ink);
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 800;
    flex-shrink: 0;
}
.fi-count .b {
    color: var(--accent-dark);
}
.fi-hint {
    font-size: 12px;
    color: var(--ink2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}

/* 完成按钮：用主色调醒目一点（淡彩主色配深玫瑰字） */
.tool-chip.done-chip {
    background: var(--accent);
    color: #7a4a55;
    box-shadow: 3px 3px 0 var(--accent-dark);
}

/* 自由模式色卡不显示数量，豆子块稍小一点放得下更多色 */
.pchip .pdot {
    width: 30px;
    height: 30px;
}
</style>
