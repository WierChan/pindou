<template>
    <view class="splash">
        <!-- 避开状态栏 + 胶囊（onLoad 里按真机测量，首帧即正确） -->
        <view class="sp-safe" :style="'height:' + safeH + 'px'" />

        <!-- 便利店遮阳棚 -->
        <view class="sp-awning" />

        <!-- 标题区 -->
        <view class="sp-head">
            <view class="sp-h1">
                <text class="c1">拼</text>
                <text class="c2">豆</text>
                <text class="c3">便</text>
                <text class="c4">利</text>
                <text class="c5">店</text>
            </view>
            <view class="sp-sub">把喜欢的图片，一颗一颗拼出来</view>
        </view>

        <!-- 小场景：太阳 / 云 / 漂浮的彩色拼豆 / 便利店小房子站在虚线地平线上 / 草丛 -->
        <view class="sp-scene">
            <view class="sp-sun" />
            <view class="sp-cloud" />
            <view class="sp-cloud c2" />
            <view class="fb fb1" />
            <view class="fb fb2" />
            <view class="fb fb3" />
            <view class="fb fb4" />
            <view class="fb fb5" />
            <view class="fb fb6" />
            <view class="fb fb7" />
            <view class="sp-store" />
            <view class="sp-grass g1" />
            <view class="sp-grass g2" />
            <view class="sp-grass g3" />
            <view class="sp-grass g4" />
            <view class="sp-grass g5" />
        </view>

        <!-- 底部：豆豆骑进度条进店 -->
        <view class="sp-bottom">
            <view class="sp-track">
                <view :class="'sp-bean ' + (landed ? 'landed' : '')" :style="'left:' + leftPx + 'px'">
                    <view :class="'sprite ' + (blink ? 'blink' : '')" />
                    <view class="shadow" />
                </view>
                <view class="sp-bar">
                    <view class="fill" :style="'width:' + pct + '%'" />
                </view>
            </view>
            <view class="sp-txt">{{ stage }}中… {{ pct }}%</view>
        </view>
    </view>
</template>

<script>
// 启动页：便利店开门仪式感 —— 底部进度条，豆豆骑着进度前沿一路蹦进店。
// 进度是演出节奏（随机小步进 + 尾段减速，全程约 2.2s），不阻塞在网络上；
// 期间顺手预热云登录，让首页的云同步更快返回。
// 分享卡直达 /pages/home/home 不走这里，只有正常冷启动会看到。
const ui = require('../../utils/ui');
const { audio } = require('../../utils/audio');
const HOP_MS = 550; // 与 wxss 里 sphop 动画周期一致：落地声按周期对拍

const STAGES = [
    [0, '擦亮豆子'],
    [30, '摆放货架'],
    [62, '整理色板'],
    [88, '打开店门']
];
export default {
    data() {
        return {
            safeH: 68,
            // 状态栏+胶囊占位（初始估值给静态渲染缓存用，onLoad 实测覆盖）
            pct: 0,
            leftPx: 24,
            stage: STAGES[0][1],
            blink: false,
            landed: false
        };
    }, // 云登录预热由 app.js onLaunch 统一做，这里不重复发起

    onLoad() {
        // onLoad 在首帧渲染前执行：内容块避开状态栏+胶囊，首帧位置就是对的
        const ins = ui.navInsets();
        this.setData({
            safeH: ins.top + ins.h + 6
        });
        // 轨道几何：进度条左右各留 24px，豆豆 54px 宽骑在填充前沿
        this.trackX = 24;
        this.trackW = ins.winW - 48;
    },
    onReady() {
        this._pct = 0;
        this.syncFun(0);
        this.tickFun();
        this.blinkLoopFun();
        // 开店小曲 + 跟着弹跳周期的落地声（都走全局静音开关；个别机型不给自动播则静默）
        audio.splashTune();
        this._hopT = setInterval(() => audio.bounce(), HOP_MS);
    },
    onUnload() {
        clearTimeout(this._t);
        clearTimeout(this._bt);
        clearTimeout(this._bt2);
        clearInterval(this._hopT);
        this._gone = true;
    },
    methods: {
        tickFun() {
            if (this._gone) {
                return;
            }
            // 小步随机推进，85 之后放慢，压一点"最后冲刺"的节奏感
            const p = this._pct;
            const step = p < 85 ? 2.5 + Math.random() * 4 : 0.8 + Math.random() * 1.6;
            this._pct = Math.min(100, p + step);
            this.syncFun(this._pct);
            if (this._pct >= 100) {
                this.landFun();
                return;
            }
            this._t = setTimeout(() => this.tickFun(), 88);
        },

        syncFun(p) {
            const pct = Math.round(p);
            let stage = STAGES[0][1];
            for (const [at, txt] of STAGES) {
                if (pct >= at) {
                    stage = txt;
                }
            }
            this.setData({
                pct,
                stage,
                // 豆豆中心跟随填充前沿，两端收在轨道内
                leftPx: Math.round(this.trackX + (this.trackW - 54) * (p / 100))
            });
        },

        // 到站：停跳停声，来一个大落地弹跳 + 小号角，然后进店
        landFun() {
            clearInterval(this._hopT);
            this.setData({
                landed: true
            });
            audio.bounce();
            audio.fanfare();
            try {
                uni.vibrateShort({
                    type: 'light'
                });
            } catch (e) {
            } /* 忽略 */
            setTimeout(() => {
                if (!this._gone) {
                    uni.redirectTo({
                        url: '/pages/home/home'
                    });
                }
            }, 520);
        },

        blinkLoopFun() {
            if (this._gone) {
                return;
            }
            this._bt = setTimeout(() => {
                this.setData({
                    blink: true
                });
                this._bt2 = setTimeout(() => {
                    this.setData({
                        blink: false
                    });
                    this.blinkLoopFun();
                }, 140);
            }, 1400 + Math.random() * 1800);
        }
    }
};
</script>
<style>
/* 启动页：奶油像素风便利店开门 */
.splash {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

/* 遮阳棚：粉白条纹 + 玫瑰褐描边 */
.sp-awning {
    height: 22px;
    background: repeating-linear-gradient(90deg, #f5d5d9 0 26px, #fff7f0 26px 52px);
}

/* 标题 */
.sp-head {
    text-align: center;
    margin-top: 34px;
}
.sp-h1 {
    font-size: 40px;
    font-weight: 900;
    letter-spacing: 6px;
}
.sp-h1 text {
    display: inline-block;
    text-shadow: 3px 3px 0 #e8dcd4;
    animation: h1bob 2.6s ease-in-out infinite;
}
.sp-h1 .c1 {
    color: #c9838f;
    animation-delay: 0s;
}
.sp-h1 .c2 {
    color: #c29040;
    animation-delay: 0.18s;
}
.sp-h1 .c3 {
    color: #7e9e6b;
    animation-delay: 0.36s;
}
.sp-h1 .c4 {
    color: #6e86b0;
    animation-delay: 0.54s;
}
.sp-h1 .c5 {
    color: #a9789e;
    animation-delay: 0.72s;
}
@keyframes h1bob {
    0%,
    100% {
        transform: translateY(0);
    }
    50% {
        transform: translateY(-3px);
    }
}
.sp-sub {
    margin-top: 12px;
    color: var(--ink2);
    font-size: 14px;
    letter-spacing: 2px;
}

/* 小场景：店铺站在虚线地平线上 */
.sp-scene {
    flex: 1;
    position: relative;
    margin: 0 24px;
    border-bottom: 2px dashed rgba(95, 74, 78, 0.28);
}
.sp-sun {
    position: absolute;
    right: 14%;
    top: 12%;
    width: 14px;
    height: 14px;
    background: var(--blue);
    box-shadow: 0 0 0 4px rgba(242, 203, 142, 0.35);
    animation: suntw 2.4s ease-in-out infinite;
}
@keyframes suntw {
    0%,
    100% {
        transform: scale(1);
    }
    50% {
        transform: scale(0.72);
    }
}
.sp-cloud {
    position: absolute;
    left: 10%;
    top: 18%;
    width: 46px;
    height: 14px;
    background: #fff;
    border: 3px solid var(--ink);
    border-radius: 8px 8px 0 0;
    animation: clouddrift 7s ease-in-out infinite alternate;
}
@keyframes clouddrift {
    from {
        transform: translateX(0);
    }
    to {
        transform: translateX(26px);
    }
}
.sp-cloud.c2 {
    left: auto;
    right: 8%;
    top: 44%;
    width: 34px;
    height: 11px;
    opacity: 0.75;
    animation-duration: 9s;
    animation-delay: 1.2s;
}

/* 漂浮的彩色拼豆：方块 + 左上高光 + 中心方孔，错落慢浮 */
.fb {
    position: absolute;
    border: 3px solid var(--ink);
    box-shadow: 2px 2px 0 rgba(95, 74, 78, 0.15);
    animation: fbfloat 3s ease-in-out infinite alternate;
}
.fb::before {
    content: '';
    position: absolute;
    left: 12%;
    top: 12%;
    width: 24%;
    height: 24%;
    background: rgba(255, 255, 255, 0.8);
}
.fb::after {
    content: '';
    position: absolute;
    left: 33%;
    top: 33%;
    width: 34%;
    height: 34%;
    background: rgba(35, 33, 58, 0.26);
}
@keyframes fbfloat {
    from {
        transform: translateY(-5px);
    }
    to {
        transform: translateY(7px);
    }
}
.fb1 {
    left: 14%;
    top: 6%;
    width: 22px;
    height: 22px;
    background: #eabfc3;
    animation-duration: 3.2s;
}
.fb2 {
    right: 22%;
    top: 14%;
    width: 16px;
    height: 16px;
    background: #f2cb8e;
    animation-duration: 2.6s;
    animation-delay: 0.5s;
}
.fb3 {
    left: 32%;
    top: 30%;
    width: 18px;
    height: 18px;
    background: #a9d4f0;
    animation-duration: 3.6s;
    animation-delay: 1s;
}
.fb4 {
    right: 30%;
    top: 40%;
    width: 24px;
    height: 24px;
    background: #c3a2e6;
    animation-duration: 2.9s;
    animation-delay: 0.3s;
}
.fb5 {
    left: 10%;
    top: 52%;
    width: 15px;
    height: 15px;
    background: #8fbf87;
    animation-duration: 3.4s;
    animation-delay: 1.4s;
}
.fb6 {
    right: 10%;
    top: 60%;
    width: 20px;
    height: 20px;
    background: #f5d5d9;
    animation-duration: 2.7s;
    animation-delay: 0.8s;
}
.fb7 {
    left: 54%;
    top: 10%;
    width: 14px;
    height: 14px;
    background: #ff9e9e;
    animation-duration: 3.1s;
    animation-delay: 1.8s;
}
/* 便利店小房子（复用首页内联 PNG） */
.sp-store {
    position: absolute;
    left: 50%;
    bottom: 0;
    width: 112px;
    height: 70px;
    margin-left: -56px;
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAABQCAYAAADRAH3kAAABYklEQVR4Ae3BIW6TAQCG4bdf/gQ1WcE9GlRFdZt0R9iOwMQcEocAhWZHYMlmqagivcfEJGqq3KBL+POnLN/7PDNecbXeHtGbdfd4P+OEoGpB1YKqBVULqhZULajacLXeHjnhy+0tY8xXS8Z43u0ZY75aMsbzbs8Y89WSMZ53e0Y6ckJQtaBqQdWCqgVVC6oWVC2oWlC1oGpB1YKqBVULqhZUbcYrrtbbI3qz7h7vZ5wQVC2oWlC1oGpB1YKqBVUbGOnHw090PtebS8YIqhZULahaULWgakHVgqoNTOzP4SvndLG4YUq/P39jSh8+fWRKQdWCqgVVC6oWVC2oWlC1gTN7937BGC9PB/TvgqoFVQuqFlQtqFpQtaBqA2f28nRA5xNULahaULWgakHVgqoFVRuY2MXiBv2/gqoFVQuqFlQtqFpQtaBqAyNdby7RdL5vfjGloGpB1YKqBVULqhZULajaXyoIKA9zBVVxAAAAAElFTkSuQmCC');
    background-size: 100% 100%;
    image-rendering: pixelated;
}
/* 门头灯 */
.sp-store::after {
    content: '';
    position: absolute;
    right: 15%;
    top: -10px;
    width: 10px;
    height: 10px;
    background: var(--blue);
    box-shadow: 0 0 8px 3px rgba(242, 203, 142, 0.8);
    animation: splamp 1.6s steps(1) infinite;
}
@keyframes splamp {
    0%,
    100% {
        opacity: 1;
    }
    50% {
        opacity: 0.25;
    }
}
.sp-grass {
    position: absolute;
    bottom: 0;
    width: 5px;
    height: 5px;
    background: #8fbf87;
}
.sp-grass::before {
    content: '';
    position: absolute;
    left: 5px;
    top: -5px;
    width: 5px;
    height: 10px;
    background: #8fbf87;
}
.sp-grass::after {
    content: '';
    position: absolute;
    left: 10px;
    top: 0;
    width: 5px;
    height: 5px;
    background: #8fbf87;
}
.g1 {
    left: 12%;
}
.g2 {
    right: 16%;
}
.g3 {
    left: 30%;
    opacity: 0.6;
}
.g4 {
    right: 32%;
    opacity: 0.75;
}
.g5 {
    left: 48%;
    opacity: 0.5;
}

/* 底部进度区 */
.sp-bottom {
    padding: 0 24px calc(34px + env(safe-area-inset-bottom));
}
.sp-track {
    position: relative;
    height: 84px;
}

/* 豆豆：外层走水平位置（跟随进度），里层跳（挤压拉伸），脚下影子同步缩放 */
.sp-bean {
    position: absolute;
    bottom: 24px;
    left: 24px;
    width: 54px;
    height: 60px;
    transition: left 0.12s linear;
}
.sp-bean .sprite {
    position: absolute;
    left: 0;
    bottom: 6px;
    width: 54px;
    height: 54px;
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAACTElEQVR4Ae3BMW4TQQCF4X+eXKXOBTabessUGy5DwQkokbZYiZITRCKXAReUW8f4AtRuhxMwkTKyYvPe9xUu3DjMlSt2OO4LF0yENRHWRFgTYU2ENRHWRFgrnNk4zJUO21q4ZtNS6XE47gtnJMKaCGsirImwJsKaCGsirBU6jcNcadjWQrzdtFRaDsd9oYMIayKsibAmwpoIayKsibBWeMU4zJWGbS203Hz4TI/Tj2/Ev01LpeVw3BcaRFgTYU2ENRHWRFgTYU2EtR3v7PTjG/F+RFgTYU2ENRHWRFgTYU2EtTIOc6VhWwvnNC2VlpffP2m5v3ukZVsLPaal0vLy+yct93ePtGxr4ZympdIiwpoIayKsibAmwpoIayKsibAmwpoIayKsibAmwpoIayKs7bhw93ePXLL7u0eumQhrIqyJsCbCmghrIqyJsLaj082fj/T5jrObPx/pcbp9pocIayKsibAmwpoIayKsibAmwpoIayKsibAmwpoIayKsibC2o9Pp9pke21o4p69Pv+ixrQ+c04ln3pMIayKsibAmwpoIayKsibBWeMU4zJWGbS1csq9Pv+jx5dMDl2xaKi2H477QIMKaCGsirImwJsKaCGsirO34z3359ED8mwhrIqyJsCbCmghrIqyJsFboNA5zpWFbC/F201JpORz3hQ4irImwJsKaCGsirImwJsJa4czGYa502NbCNZuWSo/DcV84IxHWRFgTYU2ENRHWRFgTYa1w4cZhrlyxw3FfuGAirImwJsKaCGsirImwJsLaX5ckWtpJgT4MAAAAAElFTkSuQmCC');
    background-size: 100% 100%;
    image-rendering: pixelated;
    animation: sphop 0.55s cubic-bezier(0.36, 0, 0.64, 1) infinite;
}
.sp-bean .sprite.blink {
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAACMUlEQVR4Ae3BIU7sUACF4f+ejEKzgaa+EtG8zSBYwZMkFU2QrADBZkgFsr6ZDaDH3rcCSsLNZGbeOd9XuHJ9N1Zu2HZcCldMhDUR1kRYE2FNhDUR1kRYK5xZ342VButcuGXDVGmxHZfCGYmwJsKaCGsirImwJsKaCGuFRn03VnascyF+b5gqe7bjUmggwpoIayKsibAmwpoIayKsFX7Qd2NlxzoX9tz9+UuL08cr8b1hquzZjkthhwhrIqyJsCbCmghrIqyJsHbgwk4fr8TliLAmwpoIayKsibAmwpoIa6XvxsqOdS7E7Rqmyh4R1kRYE2FNhDUR1kRYE2FNhDUR1kRYE2FNhDUR1kRYE2HtwIUNU+Wc1rnQYpgq57TOhUsSYU2ENRHWRFgTYU2ENRHWDjS6+3qkxTq/c83WuXBOd1+PtDjdv9NChDUR1kRYE2FNhDUR1kRYE2FNhDUR1kRYE2FNhDUR1kRYO9DodP/ONXt5+6TF89MD53S6f+eSRFgTYU2ENRHWRFgTYU2EtcIP+m6s7FjnwjV7efukxfPTA9dsmCp7tuNS2CHCmghrIqyJsCbCmghrIqwd+M89Pz0Q3xNhTYQ1EdZEWBNhTYQ1EdYKjfpurOxY50L83jBV9mzHpdBAhDUR1kRYE2FNhDUR1kRYK5xZ342VButcuGXDVGmxHZfCGYmwJsKaCGsirImwJsKaCGuFK9d3Y+WGbcelcMVEWBNhTYQ1EdZEWBNhTYS1f5PTVM15acthAAAAAElFTkSuQmCC');
}
.sp-bean .shadow {
    position: absolute;
    left: 9px;
    bottom: 0;
    width: 36px;
    height: 6px;
    background: rgba(95, 74, 78, 0.18);
    border-radius: 50%;
    animation: spshadow 0.55s cubic-bezier(0.36, 0, 0.64, 1) infinite;
}
@keyframes sphop {
    0%,
    100% {
        transform: translateY(0) scale(1.08, 0.9);
    }
    18% {
        transform: translateY(-2px) scale(0.96, 1.05);
    }
    50% {
        transform: translateY(-22px) scale(0.92, 1.1);
    }
    82% {
        transform: translateY(-3px) scale(0.98, 1.03);
    }
}
@keyframes spshadow {
    0%,
    100% {
        transform: scale(1);
        opacity: 1;
    }
    50% {
        transform: scale(0.55);
        opacity: 0.5;
    }
}
/* 到站落地：停止循环跳，来一个大挤压回弹 */
.sp-bean.landed .sprite {
    animation: spland 0.52s cubic-bezier(0.2, 1.6, 0.4, 1) forwards;
}
.sp-bean.landed .shadow {
    animation: none;
    transform: scale(1.15);
}
@keyframes spland {
    0% {
        transform: translateY(-24px) scale(0.9, 1.12);
    }
    45% {
        transform: translateY(0) scale(1.28, 0.72);
    }
    70% {
        transform: translateY(-6px) scale(0.95, 1.06);
    }
    100% {
        transform: translateY(0) scale(1.04, 0.96);
    }
}

/* 进度条：像素分段 */
.sp-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 20px;
    background: var(--card);
    border: 3px solid var(--ink);
    box-shadow: 3px 3px 0 rgba(95, 74, 78, 0.18);
    overflow: hidden;
}
.sp-bar .fill {
    display: block;
    height: 100%;
    background: repeating-linear-gradient(90deg, var(--accent) 0, var(--accent) 10px, #f4dcdf 10px, #f4dcdf 13px);
    transition: width 0.12s linear;
}

.sp-txt {
    margin-top: 12px;
    text-align: center;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink2);
    letter-spacing: 1px;
}
</style>
