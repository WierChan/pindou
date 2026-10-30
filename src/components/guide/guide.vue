<template>
    <view v-if="shown" class="g-ov" @touchmove.stop.prevent="noop" @tap.stop.prevent="next">
        <!-- 聚光灯：洞外由巨投影压暗，步骤切换时洞平滑移动；没有目标就整屏压暗 -->
        <view v-if="hole" class="g-hole" :style="'left:' + hole.x + 'px;top:' + hole.y + 'px;width:' + hole.w + 'px;height:' + hole.h + 'px'"></view>
        <view v-else class="g-dim"></view>

        <view :class="'g-stage ' + (mascotRight ? 'right' : '')" :style="stageStyle">
            <view class="g-bubble">
                <view class="g-count" v-if="total > 1">{{ idx + 1 }} / {{ total }}</view>
                <text class="g-txt">{{ txt }}</text>
                <view class="g-btns">
                    <view class="g-skip" hover-class="pressed" @tap.stop.prevent="skip">跳过</view>
                    <view class="g-next" hover-class="pressed" @tap.stop.prevent="next">{{ last ? '开始吧！' : '下一步 ›' }}</view>
                </view>
            </view>
            <view :class="'g-mascot ' + (blink ? 'blink' : '') + ' ' + (talk ? 'talk' : '')"></view>
        </view>
    </view>
</template>

<script>
// 新手引导组件：豆豆吉祥物讲解。
// 聚光灯挖孔点亮目标控件（步骤间平滑移动），气泡逐字打出，
// 打字时豆豆嘴巴一张一合，平时随机眨眼；点任意处推进，跳过/看完记 storage。
// 用法：<guide gid="play" steps="{{guideSteps}}" bind:done="onGuideDone" />
// steps 由 utils/guidance.buildGuide 生成：[{ text, rect|null }]
const { markGuideSeen } = require('../../utils/guidance');
const ui = require('../../utils/ui');
export default {
    data() {
        return {
            shown: false,
            idx: 0,
            total: 0,
            txt: '',
            hole: null,
            // 聚光灯洞（视口坐标）
            mascotRight: false,
            // 洞在左半屏时豆豆站右边，不挡目标
            stageStyle: '',
            // 气泡+豆豆的定位：贴着聚光灯（洞在下半屏→放洞上方，反之放下方）
            blink: false,
            talk: false,
            last: false
        };
    },
    options: {
        styleIsolation: 'apply-shared'
    },
    props: {
        gid: {
            type: String,
            default: ''
        },
        steps: {
            type: Array,
            default: () => []
        }
    },
    destroyed() {
        this.stop(false);
    },
    methods: {
        start() {
            if (this.shown) {
                return;
            }
            this.setData({
                shown: true,
                total: this.steps.length
            });
            this.blinkLoopFun();
            this.stepFun(0);
        },
        stop(hide) {
            clearTimeout(this._typeT);
            clearTimeout(this._blinkT);
            clearTimeout(this._blinkT2);
            clearInterval(this._talkT);
            this._typing = false;
            if (hide) {
                this.setData({
                    shown: false,
                    txt: '',
                    hole: null
                });
            }
        },
        stepFun(i) {
            const s = this.steps[i];
            if (!s) {
                this.finish();
                return;
            }
            const win = ui.winInfo();
            const H = win.windowHeight;
            const W = win.windowWidth;
            let hole = null;
            let mascotRight = false;
            let stageStyle = '';
            if (s.rect) {
                hole = {
                    x: Math.max(2, s.rect.left - 6),
                    y: Math.max(2, s.rect.top - 6),
                    w: s.rect.width + 12,
                    h: s.rect.height + 12
                };
                mascotRight = hole.x + hole.w / 2 < W / 2;
                // 气泡贴着聚光灯：洞在下半屏→底边压在洞顶上方（向上生长）；上半屏→放到洞下方
                const gap = 14;
                if (hole.y + hole.h / 2 > H * 0.5) {
                    stageStyle = 'top:auto;bottom:' + Math.round(H - hole.y + gap) + 'px';
                } else {
                    stageStyle = 'bottom:auto;top:' + Math.round(hole.y + hole.h + gap) + 'px';
                }
            }
            this.setData({
                idx: i,
                hole,
                mascotRight,
                stageStyle,
                last: i === this.steps.length - 1,
                txt: ''
            });
            this.typeFun(s.text);
        },
        // 逐字打出 + 说话嘴型（打完闭嘴）
        typeFun(full) {
            clearTimeout(this._typeT);
            clearInterval(this._talkT);
            this._typing = true;
            this._full = full;
            this._talkT = setInterval(
                () =>
                    this.setData({
                        talk: !this.talk
                    }),
                150
            );
            let n = 0;
            const tick = () => {
                n++;
                this.setData({
                    txt: full.slice(0, n)
                });
                if (n < full.length && this._typing) {
                    this._typeT = setTimeout(tick, 34);
                } else {
                    this.doneTypingFun();
                }
            };
            tick();
        },
        doneTypingFun() {
            this._typing = false;
            clearInterval(this._talkT);
            this.setData({
                talk: false,
                txt: this._full
            });
        },
        blinkLoopFun() {
            const loop = () => {
                this._blinkT = setTimeout(() => {
                    this.setData({
                        blink: true
                    });
                    this._blinkT2 = setTimeout(
                        () =>
                            this.setData({
                                blink: false
                            }),
                        150
                    );
                    loop();
                }, 1800 + Math.random() * 2400);
            };
            loop();
        },
        next() {
            if (this._typing) {
                this.doneTypingFun();
                return;
            } // 先把这句话放完
            this.stepFun(this.idx + 1);
        },
        skip() {
            this.finish();
        },
        finish() {
            this.stop(true);
            if (this.gid) {
                markGuideSeen(this.gid);
            }
            this.$emit('done');
        },
        noop() {}
    },
    created: function () {},
    watch: {
        steps: {
            handler: function (v) {
                if (v && v.length) this.start();
                else if (this.shown) {
                    this.stop(true);
                }
            },

            immediate: true,
            deep: true
        }
    }
};
</script>
<style>
/* 新手引导：聚光灯 + 豆豆 + 像素风气泡 */
.g-ov {
    position: fixed;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 200;
}
/* 聚光灯洞：洞外全部由巨投影压暗；换步骤时位置尺寸平滑过渡 */
.g-hole {
    position: absolute;
    border: 2px dashed var(--blue);
    border-radius: 2px;
    box-shadow: 0 0 0 4000px rgba(63, 48, 51, 0.62);
    transition: left 0.35s ease, top 0.35s ease, width 0.35s ease, height 0.35s ease;
}
.g-dim {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    background: rgba(63, 48, 51, 0.62);
}

/* 豆豆 + 气泡：默认站左下；洞在左半屏时整组去右边，洞在下半屏时整组去上方 */
.g-stage {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: calc(30px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    animation: gpop 0.35s cubic-bezier(0.2, 1.4, 0.4, 1);
}
.g-stage.right {
    align-items: flex-end;
}
@keyframes gpop {
    from {
        transform: translateY(24px);
        opacity: 0;
    }
}

.g-bubble {
    background: var(--card);
    border: 3px solid var(--ink);
    border-radius: 0;
    box-shadow: 4px 4px 0 rgba(95, 74, 78, 0.35);
    padding: 13px 14px 10px;
    max-width: 320px;
    min-width: 220px;
}
.g-count {
    font-size: 11px;
    font-weight: 800;
    color: var(--ink2);
    margin-bottom: 4px;
}
.g-txt {
    display: block;
    font-size: 14.5px;
    line-height: 1.65;
    font-weight: 600;
    min-height: 48px;
}
.g-btns {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
}
.g-skip {
    font-size: 12.5px;
    color: var(--ink2);
    padding: 6px 8px;
    transition: transform 0.12s;
}
.g-next {
    padding: 7px 16px;
    background: var(--accent);
    color: #7a4a55;
    font-size: 13.5px;
    font-weight: 800;
    letter-spacing: 1px;
    border: 3px solid var(--ink);
    box-shadow: 3px 3px 0 var(--accent-dark);
    transition: transform 0.12s;
}

/* 豆豆三帧：睁眼 / 眨眼 / 张嘴（16×16 像素画，内联 PNG） */
.g-mascot {
    width: 62px;
    height: 62px;
    margin: 0 10px;
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAACTElEQVR4Ae3BMW4TQQCF4X+eXKXOBTabessUGy5DwQkokbZYiZITRCKXAReUW8f4AtRuhxMwkTKyYvPe9xUu3DjMlSt2OO4LF0yENRHWRFgTYU2ENRHWRFgrnNk4zJUO21q4ZtNS6XE47gtnJMKaCGsirImwJsKaCGsirBU6jcNcadjWQrzdtFRaDsd9oYMIayKsibAmwpoIayKsibBWeMU4zJWGbS203Hz4TI/Tj2/Ev01LpeVw3BcaRFgTYU2ENRHWRFgTYU2EtR3v7PTjG/F+RFgTYU2ENRHWRFgTYU2EtTIOc6VhWwvnNC2VlpffP2m5v3ukZVsLPaal0vLy+yct93ePtGxr4ZympdIiwpoIayKsibAmwpoIayKsibAmwpoIayKsibAmwpoIayKs7bhw93ePXLL7u0eumQhrIqyJsCbCmghrIqyJsLaj082fj/T5jrObPx/pcbp9pocIayKsibAmwpoIayKsibAmwpoIayKsibAmwpoIayKsibC2o9Pp9pke21o4p69Pv+ixrQ+c04ln3pMIayKsibAmwpoIayKsibBWeMU4zJWGbS1csq9Pv+jx5dMDl2xaKi2H477QIMKaCGsirImwJsKaCGsirO34z3359ED8mwhrIqyJsCbCmghrIqyJsFboNA5zpWFbC/F201JpORz3hQ4irImwJsKaCGsirImwJsJa4czGYa502NbCNZuWSo/DcV84IxHWRFgTYU2ENRHWRFgTYa1w4cZhrlyxw3FfuGAirImwJsKaCGsirImwJsLaX5ckWtpJgT4MAAAAAElFTkSuQmCC');
    background-size: 100% 100%;
    background-repeat: no-repeat;
    image-rendering: pixelated;
    animation: gbob 2.2s ease-in-out infinite;
}
@keyframes gbob {
    0%,
    100% {
        transform: translateY(0);
    }
    50% {
        transform: translateY(-4px);
    }
}
.g-mascot.blink {
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAACMUlEQVR4Ae3BIU7sUACF4f+ejEKzgaa+EtG8zSBYwZMkFU2QrADBZkgFsr6ZDaDH3rcCSsLNZGbeOd9XuHJ9N1Zu2HZcCldMhDUR1kRYE2FNhDUR1kRYK5xZ342VButcuGXDVGmxHZfCGYmwJsKaCGsirImwJsKaCGuFRn03VnascyF+b5gqe7bjUmggwpoIayKsibAmwpoIayKsFX7Qd2NlxzoX9tz9+UuL08cr8b1hquzZjkthhwhrIqyJsCbCmghrIqyJsHbgwk4fr8TliLAmwpoIayKsibAmwpoIa6XvxsqOdS7E7Rqmyh4R1kRYE2FNhDUR1kRYE2FNhDUR1kRYE2FNhDUR1kRYE2HtwIUNU+Wc1rnQYpgq57TOhUsSYU2ENRHWRFgTYU2ENRHWDjS6+3qkxTq/c83WuXBOd1+PtDjdv9NChDUR1kRYE2FNhDUR1kRYE2FNhDUR1kRYE2FNhDUR1kRYO9DodP/ONXt5+6TF89MD53S6f+eSRFgTYU2ENRHWRFgTYU2EtcIP+m6s7FjnwjV7efukxfPTA9dsmCp7tuNS2CHCmghrIqyJsCbCmghrIqwd+M89Pz0Q3xNhTYQ1EdZEWBNhTYQ1EdYKjfpurOxY50L83jBV9mzHpdBAhDUR1kRYE2FNhDUR1kRYK5xZ342VButcuGXDVGmxHZfCGYmwJsKaCGsirImwJsKaCGuFK9d3Y+WGbcelcMVEWBNhTYQ1EdZEWBNhTYS1f5PTVM15acthAAAAAElFTkSuQmCC');
}
.g-mascot.talk {
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAABw0lEQVR42u3dsQ3CMBAFUEuIORBiC5Bo2IolWICOnpWYgjqMEJAT7my/L/06Tu4VLiynlOQ57I9Tyy0CgAAgAAgAAoAAIAAY4Nd9P05Nd3hAAAAAAAAAAAAAAAAAAAAAAHQFoPcBZgcEAAAAAAAAAAAAAAAAAAAAAACZBjy9nlWFIBgIAAAAAAAAAAAAAAAAAAAAAAAsCMAQAVAAFAAFQAFQABQA/R+A6AMdc8+fy9rrz76+aiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAkPAixWgA2S/CBAAAAAAAAAAAAAAAAAAAAACAJQFMt3tVRwdQ+/0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIOOBkLV7PW+r2v1FkgAAAAAAAAAAAAAAANAtgMtu81MBAGAMANn/JwBA438MAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAICWA1oG0DiB8wAAAAAAAAADQ6SbRJg8AAAAAAAAAYoD0Dqj2/UvrAQAAAAAAAAAAAAAAAAAAAGAoANGAolsEAAFAABAABAABQADIkw962YE2tM5epgAAAABJRU5ErkJggg==');
}
</style>
