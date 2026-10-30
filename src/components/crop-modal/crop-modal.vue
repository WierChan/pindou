<template>
    <view v-if="show" class="overlay" @touchmove.stop.prevent="noop" @tap="onCancel">
        <view class="modal cropm" @tap.stop.prevent="noop">
            <view class="cm-head">
                <view class="cm-title">{{ title }}</view>
                <view class="cm-x" hover-class="pressed" @tap.stop.prevent="onCancel">✕</view>
            </view>

            <!-- 手势统一在舞台层处理：单指按四角/框内/框外各有分工，双指捏合缩放 -->
            <view
                class="cm-stage"
                id="cmStage"
                @touchstart.stop.prevent="onTouchStart"
                @touchmove.stop.prevent="onTouchMove"
                @touchend.stop.prevent="onTouchEnd"
                @touchcancel.stop.prevent="onTouchEnd"
            >
                <image v-if="box" class="cm-img" :src="src" :style="'left:' + box.left + 'px;top:' + box.top + 'px;width:' + box.w + 'px;height:' + box.h + 'px'" />
                <view v-if="crop" class="cm-crop" :style="'left:' + crop.x + 'px;top:' + crop.y + 'px;width:' + crop.w + 'px;height:' + crop.h + 'px'">
                    <view v-if="selText" class="cm-sel">{{ selText }}</view>
                    <view class="cm-hd hd-tl" />
                    <view class="cm-hd hd-tr" />
                    <view class="cm-hd hd-bl" />
                    <view class="cm-hd hd-br" />
                </view>
                <view v-if="!box" class="cm-loading">图片加载中…</view>
            </view>

            <!-- 网格磁吸模式（自由画布导出）按格吸附，比例档没有意义，隐藏 -->
            <view class="cm-ratio-grp" v-if="!grid">
                <view class="cm-ratio-lb">
                    画布比例
                    <text class="cm-ratio-sub">裁成什么比例，拼豆画布就是什么比例</text>
                </view>
                <view class="cm-ratios">
                    <view
                        :class="'cm-ratio ' + (ratio === item.k ? 'active' : '')"
                        hover-class="pressed"
                        :data-r="item.k"
                        @tap.stop.prevent="setRatio"
                        v-for="(item, index) in ratios"
                        :key="index"
                    >
                        {{ item.label }}
                    </view>
                </view>
            </view>

            <view class="cm-hint">{{ hint }}</view>

            <view class="modal-btns">
                <view class="btn-ghost slim2" hover-class="pressed" @tap.stop.prevent="onReset">复原</view>
                <view class="btn-primary slim" hover-class="pressed" @tap.stop.prevent="onConfirm">使用图片</view>
            </view>
        </view>
    </view>
</template>

<script>
// 裁剪弹窗：选图后框选要用的区域（导入图纸时框网格、普通图片框想拼的部分）。
// 纯视图实现：图片按 contain 放进舞台（四周留边让四角把手完整露出）。
// 取景框模式：框不跟随缩放 —— 双指捏合、框外单指拖动只动图片，
// 图片必须始终盖满取景框；框本身只通过 框内拖动（平移）和 四角拖拽（调大小）改变，
// 且被限制在 图片∩舞台 范围内。
// 手势统一在舞台层做命中判断；确认时输出相对原图的归一化裁剪区 rect（0~1）
const ui = require('../../utils/ui');
const MIN_CROP = 48; // 裁剪框最小边长（舞台像素），保证四角把手不重叠
const STAGE_PAD = 22; // 图片与舞台边缘的留白 ≥ 把手半径，边角把手才好抓
const CORNER_HIT = 26; // 四角命中半径（切比雪夫距离）
const MAX_ZOOM = 8; // 相对初始适配尺寸的最大放大倍数
const FRAME_M = 4; // 取景框到舞台边缘的最小留白

export default {
    data() {
        return {
            box: null,
            // 图片在舞台里的展示区 {left, top, w, h}（随缩放平移变化）
            crop: null,
            // 裁剪框（舞台坐标）{x, y, w, h}
            selText: '',
            ratio: 'free',
            ratios: [
                {
                    k: 'free',
                    label: '自由'
                },
                {
                    k: '1:1',
                    label: '1:1'
                },
                {
                    k: '3:4',
                    label: '3:4'
                },
                {
                    k: '4:3',
                    label: '4:3'
                },
                {
                    k: '9:16',
                    label: '9:16'
                },
                {
                    k: '16:9',
                    label: '16:9'
                }
            ]
        };
    },
    options: {
        styleIsolation: 'apply-shared'
    },
    props: {
        show: {
            type: Boolean,
            default: false
        },
        src: {
            type: String,
            default: ''
        },
        title: {
            type: String,
            default: '裁剪图片'
        },
        hint: {
            type: String,
            default: '拖四角调整范围，双指缩放看细节'
        },
        // 网格磁吸，两种形态：
        //   {cols, rows} —— 图片即整片格子矩阵（自由画布导出，pad=0 渲染）；
        //   {px, py, ox, oy} —— 归一化格距+相位（图纸导入预识别的真实格线，
        //     格线位于 ox + k*px，覆盖整张图）。
        // 传了它：框的四边实时吸附到格线、显示已框格数、最小框 = 1 格、隐藏比例档
        grid: {
            type: Object,
            default: null
        },
        // 初始框（归一化图片坐标 {x,y,w,h}）：图纸导入预识别出的图案范围，开门即框好
        initRect: {
            type: Object,
            default: null
        }
    },
    methods: {
        setup() {
            const src = this.src;
            if (!src) {
                return;
            }
            this.pointers = new Map();
            this.drag = null;
            this.pinch = null;
            this.setData({
                box: null,
                crop: null,
                ratio: 'free',
                selText: ''
            });
            uni.getImageInfo({
                src,
                success: (info) => {
                    // 等弹窗的弹跳动画（.35s 缩放）结束再量舞台：
                    // 动画中 boundingClientRect 拿到的是缩放中的尺寸，图会摆歪
                    setTimeout(() => {
                        ui.queryNode(this, '#cmStage').then((r) => {
                            if (!r || !this.show) {
                                return;
                            }
                            this.stage = {
                                left: r.left,
                                top: r.top,
                                w: r.width,
                                h: r.height
                            };
                            const availW = r.width - STAGE_PAD * 2;
                            const availH = r.height - STAGE_PAD * 2;
                            const k = Math.min(availW / info.width, availH / info.height);
                            const w = info.width * k;
                            const h = info.height * k;
                            this.fitW = w;
                            this.fitH = h;
                            const box = {
                                left: (r.width - w) / 2,
                                top: (r.height - h) / 2,
                                w,
                                h
                            };
                            // 初始框：有预识别范围就直接框上（微调即可），否则整图
                            const ir = this.initRect;
                            const c0 =
                                ir && ir.w > 0 && ir.h > 0
                                    ? {
                                          x: box.left + ir.x * box.w,
                                          y: box.top + ir.y * box.h,
                                          w: ir.w * box.w,
                                          h: ir.h * box.h
                                      }
                                    : {
                                          x: box.left,
                                          y: box.top,
                                          w: box.w,
                                          h: box.h
                                      };
                            this.setData(
                                {
                                    box
                                },
                                () => this.setCropFun(c0)
                            );
                        });
                    }, 360);
                },
                fail: () => {
                    ui.toast('图片打开失败，换一张试试');
                    this.$emit('cancel');
                }
            });
        },
        ratioValFun() {
            const r = this.ratio;
            if (!r || r === 'free') {
                return 0;
            }
            const p = r.split(':');
            return +p[0] / +p[1];
        },
        /* ---- 网格磁吸 ---- */

        // 把 grid 属性统一成舞台坐标下的「格距 + 相位」：
        // 格线位于 ox + k*px（x 向）/ oy + k*py（y 向），k 为任意整数
        gridSpecFun() {
            const g = this.grid;
            const b = this.box;
            if (!g || !b) {
                return null;
            }
            if (g.cols && g.rows) {
                return {
                    px: b.w / g.cols,
                    py: b.h / g.rows,
                    ox: b.left,
                    oy: b.top
                };
            }
            if (g.px > 0 && g.py > 0) {
                return {
                    px: g.px * b.w,
                    py: g.py * b.h,
                    ox: b.left + (g.ox || 0) * b.w,
                    oy: b.top + (g.oy || 0) * b.h
                };
            }
            return null;
        },
        // 最小框：有网格 = 1 格（配合放大可以精确到单格），无网格 = MIN_CROP
        minCropFun() {
            const s = this.gridSpecFun();
            if (s) {
                return Math.max(6, Math.min(s.px, s.py));
            }
            return MIN_CROP;
        },
        // 四边吸附到最近的格线（按格线下标取整；限制在图片范围内、至少 1 格）
        snappedRectFun(c) {
            const s = this.gridSpecFun();
            const b = this.box;
            if (!s || !b) {
                return c;
            }
            const eps = 0.01;
            const kLoX = Math.ceil((b.left - s.ox) / s.px - eps);
            const kHiX = Math.floor((b.left + b.w - s.ox) / s.px + eps);
            const kLoY = Math.ceil((b.top - s.oy) / s.py - eps);
            const kHiY = Math.floor((b.top + b.h - s.oy) / s.py + eps);
            if (kHiX - kLoX < 1 || kHiY - kLoY < 1) {
                return c;
            } // 格距异常大，放弃吸附
            const i0 = ui.clamp(Math.round((c.x - s.ox) / s.px), kLoX, kHiX - 1);
            const j0 = ui.clamp(Math.round((c.y - s.oy) / s.py), kLoY, kHiY - 1);
            const i1 = ui.clamp(Math.round((c.x + c.w - s.ox) / s.px), i0 + 1, kHiX);
            const j1 = ui.clamp(Math.round((c.y + c.h - s.oy) / s.py), j0 + 1, kHiY);
            this._sel = {
                w: i1 - i0,
                h: j1 - j0
            };
            return {
                x: s.ox + i0 * s.px,
                y: s.oy + j0 * s.py,
                w: (i1 - i0) * s.px,
                h: (j1 - j0) * s.py
            };
        },
        // 所有改框操作的统一出口：有网格先吸附，并刷新「几 × 几 格」角标
        setCropFun(c) {
            if (this.gridSpecFun()) {
                c = this.snappedRectFun(c);
                this.setData({
                    crop: c,
                    selText: this._sel ? this._sel.w + ' × ' + this._sel.h + ' 格' : ''
                });
            } else {
                this.setData({
                    crop: c
                });
            }
        },
        // 取景框的活动范围：图片显示区 ∩ 舞台（留一点边）
        frameBoundsFun() {
            const b = this.box;
            const st = this.stage;
            return {
                x0: Math.max(b.left, FRAME_M),
                y0: Math.max(b.top, FRAME_M),
                x1: Math.min(b.left + b.w, st.w - FRAME_M),
                y1: Math.min(b.top + b.h, st.h - FRAME_M)
            };
        },
        // 选比例：以当前框中心放一个该比例的最大框（限制在活动范围内）
        setRatio(e) {
            const key = e.currentTarget.dataset.r;
            const c = this.crop;
            this.setData({
                ratio: key
            });
            if (!this.box || !c || key === 'free') {
                return;
            }
            const p = key.split(':');
            const r = +p[0] / +p[1];
            const B = this.frameBoundsFun();
            const w = Math.min(B.x1 - B.x0, (B.y1 - B.y0) * r);
            const h = w / r;
            const x = ui.clamp(c.x + c.w / 2 - w / 2, B.x0, B.x1 - w);
            const y = ui.clamp(c.y + c.h / 2 - h / 2, B.y0, B.y1 - h);
            this.setCropFun({
                x,
                y,
                w,
                h
            });
        },
        /* ---- 手势 ---- */

        ptFun(t) {
            return {
                x: t.clientX - this.stage.left,
                y: t.clientY - this.stage.top
            };
        },
        // 命中判断：四角把手 → 框内 → 框外（图片平移）
        hitFun(p) {
            const c = this.crop;
            if (!c) {
                return 'pan';
            }
            const corners = [
                ['tl', c.x, c.y],
                ['tr', c.x + c.w, c.y],
                ['bl', c.x, c.y + c.h],
                ['br', c.x + c.w, c.y + c.h]
            ];
            let best = null;
            let bd = Infinity;
            for (const [role, cx, cy] of corners) {
                const d = Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy));
                if (d <= CORNER_HIT && d < bd) {
                    bd = d;
                    best = role;
                }
            }
            if (best) {
                return best;
            }
            if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) {
                return 'move';
            }
            return 'pan';
        },
        onTouchStart(e) {
            if (!this.box || !this.stage) {
                return;
            }
            for (const t of e.touches) {
                if (!this.pointers.has(t.identifier)) {
                    this.pointers.set(t.identifier, this.ptFun(t));
                }
            }
            if (this.pointers.size >= 2) {
                // 双指：进入捏合缩放（打断单指拖拽）；只缩放图片，取景框不动
                this.drag = null;
                const [a, b] = [...this.pointers.values()];
                this.pinch = {
                    d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
                    mid0: {
                        x: (a.x + b.x) / 2,
                        y: (a.y + b.y) / 2
                    },
                    box0: Object.assign({}, this.box)
                };
            } else if (this.pointers.size === 1) {
                const p = [...this.pointers.values()][0];
                this.drag = {
                    role: this.hitFun(p),
                    sx: p.x,
                    sy: p.y,
                    crop0: Object.assign({}, this.crop),
                    box0: Object.assign({}, this.box)
                };
            }
        },
        onTouchMove(e) {
            if (!this.stage) {
                return;
            }
            for (const t of e.touches) {
                if (this.pointers.has(t.identifier)) {
                    this.pointers.set(t.identifier, this.ptFun(t));
                }
            }
            if (this.pinch && this.pointers.size >= 2) {
                const [a, b] = [...this.pointers.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d < 1) {
                    return;
                }
                const mid = {
                    x: (a.x + b.x) / 2,
                    y: (a.y + b.y) / 2
                };
                this.applyZoomFun(this.pinch, d / this.pinch.d0, mid);
                return;
            }
            if (!this.drag) {
                return;
            }
            const t = e.touches[0];
            if (!t || !this.pointers.has(t.identifier)) {
                return;
            }
            const p = this.ptFun(t);
            const dx = p.x - this.drag.sx;
            const dy = p.y - this.drag.sy;
            const role = this.drag.role;
            if (role === 'pan') {
                this.panImageFun(dx, dy);
                return;
            }
            const B = this.frameBoundsFun();
            const c0 = this.drag.crop0;
            if (role === 'move') {
                this.setCropFun({
                    x: ui.clamp(c0.x + dx, B.x0, B.x1 - c0.w),
                    y: ui.clamp(c0.y + dy, B.y0, B.y1 - c0.h),
                    w: c0.w,
                    h: c0.h
                });
                return;
            }
            const r = this.ratioValFun();
            if (r) {
                this.setCropFun(this.cornerWithRatioFun(role, dx, dy, B, c0, r));
                return;
            }
            // 自由比例：对应边跟手，另一边不动（有网格时最小框 = 1 格）
            const MC = this.minCropFun();
            let x = c0.x;
            let y = c0.y;
            let x1 = c0.x + c0.w;
            let y1 = c0.y + c0.h;
            if (role.indexOf('l') >= 0) {
                x = ui.clamp(c0.x + dx, B.x0, x1 - MC);
            }
            if (role.indexOf('r') >= 0) {
                x1 = ui.clamp(x1 + dx, c0.x + MC, B.x1);
            }
            if (role.indexOf('t') >= 0) {
                y = ui.clamp(c0.y + dy, B.y0, y1 - MC);
            }
            if (role.indexOf('b') >= 0) {
                y1 = ui.clamp(y1 + dy, c0.y + MC, B.y1);
            }
            this.setCropFun({
                x,
                y,
                w: x1 - x,
                h: y1 - y
            });
        },
        onTouchEnd(e) {
            for (const t of e.changedTouches) {
                this.pointers.delete(t.identifier);
            }
            const pinchEnded = this.pinch && this.pointers.size < 2;
            if (this.pointers.size < 2) {
                this.pinch = null;
            }
            if (this.pointers.size === 0) {
                const wasPan = this.drag && this.drag.role === 'pan';
                this.drag = null;
                // 图片在框下面移动过（缩放/平移）：手势结束后把框重新吸回格线
                if ((pinchEnded || wasPan) && this.crop) {
                    this.setCropFun(this.crop);
                }
            }
        },
        // 捏合：围绕双指中点缩放图片 + 跟随中点平移，取景框不动。
        // 缩放下限 = 图片仍能盖满取景框；位置钳制 = 图片边缘不许缩进框内
        applyZoomFun(pn, k, mid) {
            const c = this.crop;
            // box 保持图片纵横比：盖满框需要 w ≥ crop.w 且 h ≥ crop.h
            const wMin = Math.max(this.fitW, c.w, (c.h * this.fitW) / this.fitH);
            const w = ui.clamp(pn.box0.w * k, wMin, this.fitW * MAX_ZOOM);
            const kk = w / pn.box0.w;
            const h = pn.box0.h * kk;
            const left = ui.clamp(mid.x - (pn.mid0.x - pn.box0.left) * kk, c.x + c.w - w, c.x);
            const top = ui.clamp(mid.y - (pn.mid0.y - pn.box0.top) * kk, c.y + c.h - h, c.y);
            this.setData({
                box: {
                    left,
                    top,
                    w,
                    h
                }
            });
        },
        // 单指在框外拖：只平移图片（取景框不动），图片始终盖满框
        panImageFun(dx, dy) {
            const b0 = this.drag.box0;
            const c = this.crop;
            this.setData({
                box: {
                    left: ui.clamp(b0.left + dx, c.x + c.w - b0.w, c.x),
                    top: ui.clamp(b0.top + dy, c.y + c.h - b0.h, c.y),
                    w: b0.w,
                    h: b0.h
                }
            });
        },
        // 固定比例的四角拖拽：对角为锚点，横竖哪个方向拉得多就跟哪个，
        // 尺寸按比例锁定，出活动范围（B）时整体等比缩回；
        // 距离带符号 —— 手指越过锚点按 0 算（缩到最小框），不许反向翻大
        cornerWithRatioFun(role, dx, dy, B, c0, r) {
            const ox = role.indexOf('l') >= 0 ? c0.x + c0.w : c0.x;
            const oy = role.indexOf('t') >= 0 ? c0.y + c0.h : c0.y;
            const hx = (role.indexOf('l') >= 0 ? c0.x : c0.x + c0.w) + dx;
            const hy = (role.indexOf('t') >= 0 ? c0.y : c0.y + c0.h) + dy;
            let w = Math.max(0, role.indexOf('l') >= 0 ? ox - hx : hx - ox);
            let h = Math.max(0, role.indexOf('t') >= 0 ? oy - hy : hy - oy);
            if (w > h * r) {
                h = w / r;
            } else {
                w = h * r;
            }
            const minW = Math.max(MIN_CROP, MIN_CROP * r);
            if (w < minW) {
                w = minW;
                h = minW / r;
            }
            const availW = role.indexOf('l') >= 0 ? ox - B.x0 : B.x1 - ox;
            const availH = role.indexOf('t') >= 0 ? oy - B.y0 : B.y1 - oy;
            const k = Math.min(1, availW / w, availH / h);
            w *= k;
            h *= k;
            return {
                x: role.indexOf('l') >= 0 ? ox - w : ox,
                y: role.indexOf('t') >= 0 ? oy - h : oy,
                w,
                h
            };
        },
        onReset() {
            const b = this.box;
            if (!b || !this.stage) {
                return;
            }
            const box = {
                left: (this.stage.w - this.fitW) / 2,
                top: (this.stage.h - this.fitH) / 2,
                w: this.fitW,
                h: this.fitH
            };
            this.setData(
                {
                    ratio: 'free',
                    box
                },
                () =>
                    this.setCropFun({
                        x: box.left,
                        y: box.top,
                        w: box.w,
                        h: box.h
                    })
            );
        },
        onConfirm() {
            const b = this.box;
            const c = this.crop;
            if (!b || !c) {
                return;
            }
            this.$emit('confirm', {
                detail: {
                    rect: {
                        x: (c.x - b.left) / b.w,
                        y: (c.y - b.top) / b.h,
                        w: c.w / b.w,
                        h: c.h / b.h
                    }
                }
            });
        },
        onCancel() {
            this.$emit('cancel');
        },
        noop() {}
    },
    created: function () {},
    watch: {
        show: {
            handler: function (v) {
                if (v) {
                    this.setup();
                }
            },

            immediate: true
        }
    }
};
</script>
<style>
.modal.cropm {
    max-width: 430px;
    padding: 16px 14px 18px;
    gap: 12px;
    text-align: left;
}

.cm-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.cm-title {
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 2px;
}
.cm-x {
    width: 34px;
    height: 34px;
    background: var(--card);
    border: 3px solid var(--ink);
    box-shadow: 3px 3px 0 #e2dad3;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 700;
    transition: transform 0.12s;
}

.cm-stage {
    position: relative;
    width: 100%;
    height: 40vh;
    max-height: 410px;
    background: #efe7dc;
    border: 3px solid var(--ink);
    overflow: hidden;
}
.cm-img {
    position: absolute;
}
.cm-loading {
    position: absolute;
    left: 0;
    right: 0;
    top: 45%;
    text-align: center;
    color: var(--ink2);
    font-size: 13px;
}

/* 裁剪框：粗边 + 巨投影压暗框外区域 */
.cm-crop {
    position: absolute;
    border: 2px solid var(--accent-dark);
    box-shadow: 0 0 0 2000px rgba(95, 74, 78, 0.38);
}

/* 网格磁吸模式的「几 × 几 格」角标 */
.cm-sel {
    position: absolute;
    left: 3px;
    top: 3px;
    padding: 2px 7px;
    background: rgba(95, 74, 78, 0.82);
    color: #fff7f0;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 1px;
    pointer-events: none;
    white-space: nowrap;
}

/* 四角把手：40px 触摸热区（舞台四周留了边，热区完整露出），中间画 18px 曦黄方块 */
.cm-hd {
    position: absolute;
    width: 40px;
    height: 40px;
}
.cm-hd::after {
    content: '';
    position: absolute;
    left: 11px;
    top: 11px;
    width: 18px;
    height: 18px;
    background: var(--blue);
    border: 3px solid var(--ink);
    box-sizing: border-box;
}
.hd-tl {
    left: -20px;
    top: -20px;
}
.hd-tr {
    right: -20px;
    top: -20px;
}
.hd-bl {
    left: -20px;
    bottom: -20px;
}
.hd-br {
    right: -20px;
    bottom: -20px;
}

/* 裁剪比例（= 拼豆画布比例） */
.cm-ratio-grp {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.cm-ratio-lb {
    font-size: 13px;
    font-weight: 700;
    color: var(--ink);
}
.cm-ratio-sub {
    font-size: 11px;
    font-weight: 400;
    color: var(--ink2);
    margin-left: 6px;
}
.cm-ratios {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}
.cm-ratio {
    flex: 1;
    min-width: 48px;
    padding: 7px 0;
    text-align: center;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink2);
    background: var(--card);
    border: 2px solid var(--ink);
    box-shadow: 2px 2px 0 #e2dad3;
    transition: transform 0.12s;
}
.cm-ratio.active {
    background: var(--blue);
    color: #7a5a2e;
    box-shadow: 2px 2px 0 var(--blue-dark);
}

.cm-hint {
    font-size: 12.5px;
    color: var(--ink2);
    text-align: center;
    line-height: 1.6;
}
</style>
