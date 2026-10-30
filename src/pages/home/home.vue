<template>
    <view>
        <view class="screen home" :style="'padding-top:' + padTop + 'px'">
            <view class="home-header">
                <!-- 便利店遮阳棚（粉白条纹 + 方齿垂边，纯装饰） -->
                <view class="awning" />
                <!-- 云朵地平线小场景：装饰 + 轻互动（点豆豆/豆子/标题有动画音效；连戳豆豆 5 下撒花） -->
                <view class="px-scene">
                    <view class="sun" />
                    <view class="cloud c2" />
                    <view class="spark sp1" />
                    <view class="spark sp2" />
                    <view :class="'store ' + stAnim" @tap="tapStore" />
                    <view class="grass g1" />
                    <view class="grass g2" />
                    <view class="gshadow gs-m" />
                    <view class="gshadow gs-b" />
                    <view :class="'mascot ' + mAnim + ' ' + (mBlink ? 'blink' : '')" @tap="tapMascot" />
                    <view class="logo-dots">
                        <view :class="'ld ld1 ' + b0" @tap="tapBead" data-i="0"><view class="ld-hole ldh1" /></view>
                        <view :class="'ld ld2 ' + b1" @tap="tapBead" data-i="1"><view class="ld-hole ldh2" /></view>
                        <view :class="'ld ld3 ' + b2" @tap="tapBead" data-i="2"><view class="ld-hole ldh3" /></view>
                    </view>
                    <view class="emote" :style="'left:' + item.x" v-for="(item, index) in emotes" :key="index">{{ item.txt }}</view>
                </view>
                <view :class="'h1 ' + (titleWave ? 'wave' : '')" @tap="tapTitle">
                    <text class="h1c">拼</text>
                    <text class="h1c">豆</text>
                    <text class="h1c">便</text>
                    <text class="h1c">利</text>
                    <text class="h1c">店</text>
                </view>
                <view class="h-sub">欢迎光临！把喜欢的图片，一颗一颗拼出来</view>
            </view>

            <view :class="'cta-new ' + ctaAnim" hover-class="pressed" @tap="goCreate">＋ 开始新作品</view>

            <!-- 已有代拼订单的查看入口；下单从具体作品进入 -->
            <view v-if="orderOn" class="home-order" hover-class="pressed" @tap="goOrders">
                <image class="pxi" src="/static/assets/icons/parcel.png" />
                <view class="ho-txt">我的代拼订单</view>
                <view class="ho-r">{{ orderN ? orderN + ' 单 · ' : '' }}查看 ›</view>
            </view>

            <view class="tabs home-tabs">
                <view :class="'tab ' + (tab === 'doing' ? 'active' : '')" @tap="switchTab" data-tab="doing">
                    <image class="pxi" src="/static/assets/icons/basket.png" />
                    进行中{{ doing.length ? ' · ' + doing.length : '' }}
                </view>
                <view :class="'tab ' + (tab === 'done' ? 'active' : '')" @tap="switchTab" data-tab="done">
                    <image class="pxi" src="/static/assets/icons/trophy.png" />
                    已完成{{ done.length ? ' · ' + done.length : '' }}
                </view>
                <view class="home-set" hover-class="pressed" @tap="goSettings"><image class="pxi-l" src="/static/assets/icons/gear.png" /></view>
            </view>

            <view class="home-list">
                <view v-if="!shown.length" class="empty-tip">
                    <block v-if="tab === 'done'">
                        <view>还没有完成的作品～</view>
                        <view>
                            拼完并熨烫定型后，就会收藏在这里
                            <image class="pxi-s" src="/static/assets/icons/trophy.png" />
                        </view>
                    </block>
                    <block v-else>
                        <view>没有进行中的作品～</view>
                        <view>
                            上传一张图片，或者从图案库挑一个开始吧
                            <image class="pxi-s" src="/static/assets/icons/star.png" />
                        </view>
                    </block>
                </view>
                <view v-else class="works-grid">
                    <view class="work-card" hover-class="pressed" @tap="openWork" :data-id="item.id" :data-st="item.st" v-for="(item, index) in shown" :key="index">
                        <view class="wc-thumb">
                            <image v-if="item.thumb" :src="item.thumb" mode="aspectFit" />
                            <view v-if="item.badgeText" :class="'wc-badge ' + item.badgeClass">
                                <image v-if="item.badgeIcon" class="pxi-s" :src="item.badgeIcon" />
                                {{ item.badgeText }}
                            </view>
                        </view>

                        <view class="wc-body">
                            <view class="wc-name">{{ item.name }}</view>
                            <view class="wc-meta">{{ item.dims }}</view>
                            <block v-if="item.st !== 'done'">
                                <view class="wc-progress"><view class="fill" :style="'width:' + item.pct + '%'" /></view>
                                <view class="wc-meta">{{ item.footText }}</view>
                            </block>
                        </view>

                        <view class="wc-del" @tap.stop.prevent="delWork" :data-id="item.id" :data-name="item.name">✕</view>
                    </view>
                </view>
            </view>

            <!-- 流量主 banner（bannerHome）：位 ID 未下发或列表为空不渲染；加载失败整体隐藏不留坑 -->
            <view v-if="adHome && shown.length" class="ad-slot">
                <ad :unit-id="adHome" @error="onAdError"></ad>
            </view>
        </view>

        <canvas v-if="celebrating" type="2d" id="confetti" class="confetti"></canvas>
        <canvas type="2d" id="util" class="util-canvas" :style="'width:' + capW + 'px;height:' + capH + 'px'"></canvas>

        <guide :gid="guideId" :steps="guideSteps" @done="onGuideDone" />
    </view>
</template>

<script>
// 首页 / 作品库
const { store } = require('../../utils/store');
const { audio } = require('../../utils/audio');
const { celebrate } = require('../../utils/confetti');
const { getBeadShape } = require('../../utils/board');
const ui = require('../../utils/ui');
const sync = require('../../utils/sync');
const ads = require('../../utils/ads');
const order = require('../../utils/order');
const { cfg } = require('../../utils/config');
const { buildGuide, guideSeen, markGuideSeen } = require('../../utils/guidance');

// 从自由画布的稀疏豆表裁出密集图纸（heal 重建缩略图用）
function freePattern(work) {
    const bs = work && work.freeBeads;
    if (!Array.isArray(bs) || !bs.length) {
        return null;
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const b of bs) {
        if (b[0] < x0) {
            x0 = b[0];
        }
        if (b[0] > x1) {
            x1 = b[0];
        }
        if (b[1] < y0) {
            y0 = b[1];
        }
        if (b[1] > y1) {
            y1 = b[1];
        }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const cells = new Array(w * h).fill(-1);
    for (const b of bs) {
        cells[(b[1] - y0) * w + (b[0] - x0)] = b[2];
    }
    return {
        w,
        h,
        cells
    };
}
const EMOTES = ['♪', '★', '!', '✦', '♥'];
const BEAD_NOTES = [523, 659, 784]; // do mi sol
const MASCOT_X = 'calc(50% - 51px)'; // 表情泡锚点：豆豆头顶
const BEADS_X = 'calc(50% + 28px)'; // 表情泡锚点：豆子上方

export default {
    data() {
        return {
            padTop: 60,
            tab: 'doing',
            doing: [],
            done: [],
            shown: [],
            capW: 700,
            capH: 900,
            mAnim: '',

            // 豆豆动画类：jump / wobble
            stAnim: '',

            // 便利店小房子弹跳
            mBlink: false,

            // 眨眼帧
            b0: '',

            b1: '',
            b2: '',

            // 三颗豆的弹跳类
            titleWave: false,

            // 标题跳舞
            ctaAnim: '',

            // CTA 按压回弹
            emotes: [],

            // 表情泡 [{id, txt, x}]
            celebrating: false,

            guideSteps: [],
            adHome: '',

            // 流量主 banner 位 ID（空 = 不渲染）
            orderOn: false,

            // 代拼入口默认隐藏
            // 本机记录的代拼订单数（入口角标）
            orderN: 0,

            guideId: ''
        };
    },
    onShow() {
        this.refresh();
        this.healThumbsFun();
        this.startBlinkFun();
        this.cloudSyncFun();
        this.refreshAdFun();
        this.setData({
            orderOn: cfg.ORDER.enabled,
            orderN: order.localCount()
        });
    },
    onReady() {
        // 首次进入：豆豆开场引导。设置入口是后加的：看过老版 home 引导的用户单步补看（home-set）
        const setStep = {
            sel: '.home-set',
            text: '右上角这个齿轮是「设置」：音效、背景音乐、豆子形状，还有默认的熨烫质感和豆孔，都能在这儿调～'
        };
        if (guideSeen('home')) {
            buildGuide(this, 'home-set', [setStep]);
        } else {
            buildGuide(this, 'home', [
                {
                    text: '欢迎光临拼豆便利店！我是豆豆～这里可以把喜欢的图片一颗一颗拼出来，跟你转一圈！'
                },
                {
                    sel: '.cta-new',
                    text: '一切从这里开始：选一张图片、导入拼豆图纸，或者开一块自由画布随便画！'
                },
                {
                    sel: '.home-tabs',
                    text: '拼到一半的作品放在「进行中」，拼完熨烫定型的收藏在「已完成」。去开你的第一个作品吧！'
                },
                setStep
            ]);
        }
    },
    onHide() {
        this.stopFxFun();
    },
    onUnload() {
        this.stopFxFun();
    },
    onResize() {
        this.setData({
            padTop: this.padTopFun()
        });
    },
    onShareAppMessage() {
        return {
            title: '拼豆便利店 · 把喜欢的图片，一颗一颗拼出来',
            path: '/pages/home/home'
        };
    },
    methods: {
        goOrders() {
            uni.navigateTo({
                url: '/pages/orders/orders'
            });
        },

        // banner 位 ID 可能在启动配置拉到后才有值，每次回首页补一次；
        // binderror 清空后下次 onShow 重新取值，相当于自然重试
        refreshAdFun() {
            const id = ads.unit('bannerHome');
            if (id !== this.adHome) {
                this.setData({
                    adHome: id
                });
            }
        },

        onAdError(e) {
            console.warn('首页 banner 加载失败', e && e.detail);
            this.setData({
                adHome: ''
            });
        },

        onGuideDone() {
            // 完整版 home 引导已含设置一步，别再让这些用户单独补看
            if (this.guideId === 'home') {
                markGuideSeen('home-set');
            }
            this.setData({
                guideSteps: []
            });
        },

        // 作品云同步：补发挂起操作 → 拉取合并云端 → 有变化则刷新列表
        cloudSyncFun() {
            if (this._syncing) {
                return;
            }
            this._syncing = true;
            sync.syncAll()
                .then((changed) => {
                    this._syncing = false;
                    if (changed) {
                        this.refresh();
                        this.healThumbsFun(); // 拉下来的作品没有本地缩略图，就地重建
                    }
                })
                .catch((err) => {
                    this._syncing = false;
                    console.warn('云同步失败（下次进入首页重试）', err);
                });
        },

        // 老缩略图需要重新生成：v4 之前可能只截到局部，v5 起为像素方豆，v6 去豆子描边、
        // v7 起奶油淡彩配色，v9 回归详情画板质感（白底板 + 蒙孔 + 颗颗豆，熨烫作品熔合），
        // v11 豆子改纯色块（去高光去豆孔，靠豆缝出颗粒感），
        // v12 熨烫作品按作品的质感选择铺颗粒纹理；
        // 另外豆子形状设置变化后（thumbShape 与当前不一致）也重新生成。
        // 失败不写版本号（下次启动还能重试），只在本次会话内跳过，避免每次 onShow 反复重跑。
        healThumbsFun() {
            if (this._healing) {
                return;
            }
            const shape = getBeadShape();
            const tried = this._healTried || (this._healTried = {});
            const list = store.list().filter((s) => {
                if (tried[s.id + '|' + shape]) {
                    return false;
                }
                const stale = !s.thumbV || s.thumbV < ui.THUMB_V || (s.thumbShape || 'square') !== shape;
                if (s.free && !s.completed) {
                    // 进行中的自由画布：样式版本、豆子数戳记或形状对不上（或还没有图）就重建
                    return s.placedN > 0 && (!s.thumb || stale || s.thumbBeads !== s.placedN);
                }
                return stale;
            });
            if (!list.length) {
                return;
            }
            this._healing = true;
            ui.queryNode(this, '#util').then((r) => {
                if (!r || !r.node) {
                    this._healing = false;
                    return;
                }
                let chain = Promise.resolve();
                for (const s of list) {
                    chain = chain.then(() => {
                        const work = store.get(s.id);
                        if (!work) {
                            return null;
                        }
                        const isFreeLive = work.free && !work.completed;
                        // 自由画布进行中：从稀疏豆表裁出作品图；其余作品直接画整幅
                        const src = isFreeLive ? freePattern(work) : work;
                        if (!src) {
                            return null;
                        }
                        const target = isFreeLive
                            ? {
                                  id: work.id,
                                  thumb: work.thumb,
                                  w: src.w,
                                  h: src.h,
                                  cells: src.cells
                              }
                            : work;
                        return (
                            ui
                                .makeThumb(this, r.node, target, !!work.ironDone)
                                .then((path) => {
                                    const patch = {
                                        thumb: path,
                                        thumbV: ui.THUMB_V,
                                        thumbShape: shape
                                    };
                                    if (isFreeLive) {
                                        patch.thumbBeads = work.freeBeads.length;
                                    }
                                    store.update(work.id, patch, true);
                                })
                                // 只在失败时标记跳过（保留旧图，本次会话不再重试）；
                                // 成功后戳记已更新，下次内容/形状变化时才会再生成
                                .catch(() => {
                                    tried[s.id + '|' + shape] = 1;
                                })
                        );
                    });
                }
                chain.then(() => {
                    this._healing = false;
                    this.refresh();
                });
            });
        },

        padTopFun() {
            const ins = ui.navInsets();
            return ins.top + ins.h;
        },

        refresh() {
            const works = store.list();
            const doing = [];
            const done = [];
            for (const s of works) {
                const isDone = s.completed && s.ironDone;
                const needIron = s.completed && !s.ironDone;
                const isFree = s.free && !s.completed; // 自由画布进行中
                const pct = s.total ? Math.round((s.placedN / s.total) * 100) : 0;
                const vm = {
                    id: s.id,
                    name: s.name,
                    thumb: s.thumb || '',
                    dims: isFree ? '自由画布 · 已拼 ' + s.placedN + ' 颗' : s.w + '×' + s.h + ' · ' + s.total + ' 颗',
                    st: isDone ? 'done' : needIron ? 'iron' : isFree ? 'free' : 'doing',
                    // 状态角标优先（待熨烫/自由），其次来源角标（代拼单 > 口令导入）；
                    // 已完成 tab 里「已完成」本就冗余，让位给来源标。图标用自绘像素图（不用系统 emoji）
                    badgeText: needIron ? '待熨烫' : isFree ? '自由' : s.fromOrder ? '代拼单' : s.fromCode ? '口令' : isDone ? '已完成' : '',
                    badgeIcon: needIron
                        ? '/static/assets/icons/flame.png'
                        : isFree
                        ? '/static/assets/icons/pencil.png'
                        : s.fromOrder
                        ? '/static/assets/icons/parcel.png'
                        : s.fromCode
                        ? '/static/assets/icons/key.png'
                        : '',
                    badgeClass: needIron ? 'iron' : isFree ? 'freeb' : s.fromOrder ? 'orderb' : s.fromCode ? 'codeb' : '',
                    pct: needIron ? 100 : isFree ? 0 : pct,
                    footText: needIron ? '豆子拼齐了 · 去熨烫 →' : isFree ? '自由创作 · 继续 →' : pct + '%　继续拼 →'
                };
                (isDone ? done : doing).push(vm);
            }
            let tab = 'doing';
            try {
                if (uni.getStorageSync('pindou.homeTab') === 'done') {
                    tab = 'done';
                }
            } catch (e) {
            } /* 忽略 */
            this.setData({
                doing,
                done,
                tab,
                shown: tab === 'done' ? done : doing,
                padTop: this.padTopFun()
            });
        },

        /* ---------- 顶部小互动（纯装饰层，不影响任何功能） ---------- */

        // 豆豆待机眨眼
        startBlinkFun() {
            clearInterval(this._blinkT);
            this._blinkT = setInterval(() => {
                this.setData({
                    mBlink: true
                });
                setTimeout(
                    () =>
                        this.setData({
                            mBlink: false
                        }),
                    140
                );
            }, 3200);
        },

        stopFxFun() {
            clearInterval(this._blinkT);
        },

        // 重新触发某个动画类：先清空再设值（同名 class 不会重播动画）
        animClsFun(key, cls, dur) {
            this._animT = this._animT || {};
            clearTimeout(this._animT[key]);
            this.setData({
                [key]: ''
            });
            setTimeout(
                () =>
                    this.setData({
                        [key]: cls
                    }),
                30
            );
            this._animT[key] = setTimeout(
                () =>
                    this.setData({
                        [key]: ''
                    }),
                dur
            );
        },

        // 冒一个表情泡
        emoteFun(txt, x) {
            this._emoteId = (this._emoteId || 0) + 1;
            const id = this._emoteId;
            this.setData({
                emotes: this.emotes
                    .concat({
                        id,
                        txt,
                        x
                    })
                    .slice(-4)
            });
            setTimeout(() => {
                this.setData({
                    emotes: this.emotes.filter((e) => e.id !== id)
                });
            }, 900);
        },

        tapMascot() {
            const now = Date.now();
            this._mTaps = (this._mTaps || []).filter((t) => now - t < 2500);
            this._mTaps.push(now);
            audio.hop();
            this.animClsFun('mAnim', 'jump', 560);
            if (this._mTaps.length >= 5) {
                // 彩蛋：连戳 5 下，晕头转向 + 撒花 + 号角
                this._mTaps = [];
                setTimeout(() => this.animClsFun('mAnim', 'wobble', 860), 80);
                this.emoteFun('@_@', MASCOT_X);
                audio.fanfare();
                this.confettiFun();
            } else {
                this.emoteFun(EMOTES[Math.floor(Math.random() * EMOTES.length)], MASCOT_X);
            }
        },

        // 点便利店小房子：叮咚门铃 + 弹跳 + 欢迎光临气泡
        tapStore() {
            audio.note(784);
            setTimeout(() => audio.note(587), 140);
            this.animClsFun('stAnim', 'pop', 460);
            this.emoteFun('欢迎光临', 'calc(3% + 32px)');
        },

        tapBead(e) {
            const i = +e.currentTarget.dataset.i;
            audio.note(BEAD_NOTES[i]);
            this.animClsFun('b' + i, 'pop', 460);
            this.emoteFun('♪', BEADS_X);
            // 短时间内三颗都点过：依次波浪弹跳 + 高八度琶音
            const now = Date.now();
            this._bTaps = (this._bTaps || []).filter((t) => now - t.t < 1300);
            this._bTaps.push({
                i,
                t: now
            });
            const got = {};
            this._bTaps.forEach((t) => {
                got[t.i] = 1;
            });
            if (got[0] && got[1] && got[2]) {
                this._bTaps = [];
                [0, 1, 2].forEach((k) =>
                    setTimeout(() => {
                        this.animClsFun('b' + k, 'pop', 460);
                        audio.note(BEAD_NOTES[k] * 2);
                    }, 140 + k * 110)
                );
            }
        },

        tapTitle() {
            if (this._waveT) {
                return;
            }
            this.setData({
                titleWave: true
            });
            [0, 1, 2, 3, 4].forEach((i) => setTimeout(() => audio.note(Math.round(523 * Math.pow(1.19, i))), i * 80));
            this._waveT = setTimeout(() => {
                this._waveT = 0;
                this.setData({
                    titleWave: false
                });
            }, 1000);
        },

        // 复用完成庆祝的撒花模块
        confettiFun() {
            if (this.celebrating) {
                return;
            }
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
                        celebrate(r.node, r.width, r.height, dpr, ['#EABFC3', '#F2CB8E', '#F5D5D9', '#9EB995', '#C9838F'], () =>
                            this.setData({
                                celebrating: false
                            })
                        );
                    });
                }
            );
        },

        goSettings() {
            uni.navigateTo({
                url: '/pages/settings/settings'
            });
        },

        goCreate() {
            if (this._navT) {
                return;
            }
            // 一点小仪式感：按钮回弹 + 豆豆起跳，再进入创建页
            audio.hop();
            this.animClsFun('ctaAnim', 'pump', 420);
            this.animClsFun('mAnim', 'jump', 560);
            this._navT = setTimeout(() => {
                this._navT = 0;
                uni.navigateTo({
                    url: '/pages/create/create'
                });
            }, 140);
        },

        switchTab(e) {
            const tab = e.currentTarget.dataset.tab;
            try {
                uni.setStorageSync('pindou.homeTab', tab);
            } catch (err) {
            } /* 忽略 */
            this.setData({
                tab,
                shown: tab === 'done' ? this.done : this.doing
            });
        },

        openWork(e) {
            const d = e.currentTarget.dataset;
            const page = d.st === 'done' ? 'view' : d.st === 'iron' ? 'iron' : d.st === 'free' ? 'free' : 'play';
            uni.navigateTo({
                url: '/pages/' + page + '/' + page + '?id=' + d.id
            });
        },

        delWork(e) {
            const d = e.currentTarget.dataset;
            uni.showModal({
                title: '删除作品',
                content: '确定删除「' + d.name + '」吗？删掉就找不回来啦',
                confirmText: '删除',
                confirmColor: '#C9838F',
                success: (r) => {
                    if (r.confirm) {
                        store.remove(d.id);
                        ui.toast('已删除');
                        this.refresh();
                    }
                }
            });
        }
    }
};
</script>
<style>
.home {
    padding-bottom: 40px;
}

/* 设置入口：放在「进行中 / 已完成」这一排右端（挪出热闹的门头场景，不跟装饰打架）。
   深玫瑰底 + 白齿轮，和左边两个 tab 区分开；高度跟 tab 齐平 */
.home-set {
    flex-shrink: 0;
    width: 46px;
    align-self: stretch;
    border: 3px solid var(--ink);
    background: var(--accent-dark);
    box-shadow: 3px 3px 0 rgba(95, 74, 78, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
}

.home-header {
    text-align: center;
    padding: 0 0 20px;
}

/* 便利店遮阳棚：粉白条纹 + 方齿垂边（出血到屏幕两侧） */
.awning {
    position: relative;
    height: 13px;
    margin: 0 -16px 8px;
    background: repeating-linear-gradient(90deg, var(--accent) 0, var(--accent) 18px, #ffffff 18px, #ffffff 36px);
}
.awning::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    height: 7px;
    background: repeating-linear-gradient(90deg, var(--accent) 0, var(--accent) 18px, transparent 18px, transparent 36px);
}

/* ================= 云朵地平线小场景 ================= */
.px-scene {
    position: relative;
    height: 100px;
    margin: 2px 0 0;
    border-bottom: 2.5px dashed rgba(95, 74, 78, 0.7); /* 地平线 */
}

/* 像素太阳（104×88 内联 PNG） */
.sun {
    position: absolute;
    right: 18px;
    top: 0;
    width: 46px;
    height: 39px;
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGgAAABYCAYAAAAZZrIMAAABcElEQVR4Ae3BsVHcUABF0fvf7Iwz5e7DyokJaIEKSLYBhgaUUAEtEBCTy304V+ZI7kDJDrN38TtncOO2ddk5MM3nwQ0LpRZKLZRaKLVQaqHUQqmFUgulFkotlFootVBqodRCqQ0utK3LzoFpPg++sW1ddg5M83lwgVBqodRCqYVSC6UWSi2U2uDKHu8fdsTePt4HVxRKLZRaKLVQaqHUQqmFUjsh9/pyx1d6ev7ELJRaKLVQaqHUQqmFUguldtrWZecC03weXNGPn7848vfPb65pW5edC4RSC6UWSi2UWii1UGqh1AZX9nj/sHPg9eWOr/T0/MmRt4/3wRWFUgulFkotlFootVBqodROyD09f/I/C6UWSi2UWii1UGqh1EKpDS60rcvOgWk+D76xbV12DkzzeXCBUGqh1EKphVILpRZKLZTa4MZt67JzYJrPgxsWSi2UWii1UGqh1EKphVILpRZKLZRaKLVQaqHUQqmFUvsHNzwyp1P/PaUAAAAASUVORK5CYII=');
    background-size: 100% 100%;
    background-repeat: no-repeat;
    image-rendering: pixelated;
}

/* 圆包像素云（112×56 内联 PNG） */
.cloud {
    position: absolute;
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHAAAAA4CAYAAAAl63xKAAAA7klEQVR4Ae3BgYmEMABE0Z8pTyGWoKVpCQraXq6DLJwsYZZ5rzDYOtXGQMdzFYyJsCbCmghrIqyJsCbCmghrhS9bp9ro2O+TkbZ54Y3juQoDibAmwpoIayKsibAmwpoIa4WX1qk2Ovb75Jdt88Ibx3MVXhBhTYQ1EdZEWBNhTYQ1EdYKH6xTbXTs90n83zYv9BzPVegQYU2ENRHWRFgTYU2ENRHWyjrVRsd+n8Q427zQI8KaCGsirImwJsKaCGsirImwJsKaCGsirImwJsKaCGsirBU+WKfaiGGO5yp0iLAmwpoIayKsibAmwpoIa39cOCJhMoYH0gAAAABJRU5ErkJggg==');
    background-size: 100% 100%;
    background-repeat: no-repeat;
    image-rendering: pixelated;
}
.c2 {
    right: 76px;
    top: 2px;
    width: 62px;
    height: 31px;
    animation: drift 12s ease-in-out infinite reverse;
}
@keyframes drift {
    0%,
    100% {
        transform: translateX(0);
    }
    50% {
        transform: translateX(12px);
    }
}

/* 像素十字星（闪烁） */
.spark {
    position: absolute;
    animation: twk 2.4s ease-in-out infinite;
}
.spark::before,
.spark::after {
    content: '';
    position: absolute;
}
.sp1 {
    width: 12px;
    height: 12px;
    left: 36%;
    top: 30px;
}
.sp1::before {
    left: 4px;
    top: 0;
    width: 4px;
    height: 12px;
    background: var(--coin);
}
.sp1::after {
    left: 0;
    top: 4px;
    width: 12px;
    height: 4px;
    background: var(--coin);
}
.sp2 {
    width: 10px;
    height: 10px;
    right: 26%;
    top: 10px;
    animation-delay: 0.9s;
}
.sp2::before {
    left: 3.5px;
    top: 0;
    width: 3px;
    height: 10px;
    background: var(--accent);
}
.sp2::after {
    left: 0;
    top: 3.5px;
    width: 10px;
    height: 3px;
    background: var(--accent);
}
@keyframes twk {
    0%,
    100% {
        transform: scale(1);
        opacity: 0.9;
    }
    50% {
        transform: scale(0.5);
        opacity: 0.35;
    }
}

/* 草丛 */
.grass {
    position: absolute;
    bottom: 0;
    width: 4px;
    height: 4px;
    background: #8fbf87;
}
.grass::before {
    content: '';
    position: absolute;
    left: 4px;
    top: -4px;
    width: 4px;
    height: 8px;
    background: #8fbf87;
}
.grass::after {
    content: '';
    position: absolute;
    left: 8px;
    top: 0;
    width: 4px;
    height: 4px;
    background: #8fbf87;
}
.g1 {
    left: 22%;
}
.g2 {
    right: 9%;
}

/* 落地阴影 */
.gshadow {
    position: absolute;
    bottom: 1px;
    height: 3px;
    background: rgba(95, 74, 78, 0.14);
}
.gs-m {
    left: calc(50% - 73px);
    width: 44px;
}
.gs-b {
    left: calc(50% - 20px);
    width: 94px;
}

/* 吉祥物「豆豆」：站在地平线上，可戳（睁眼/眨眼两帧内联 PNG，16×16 大眼可爱版） */
.mascot {
    position: absolute;
    left: calc(50% - 75px);
    bottom: 0;
    width: 48px;
    height: 48px;
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAACTElEQVR4Ae3BMW4TQQCF4X+eXKXOBTabessUGy5DwQkokbZYiZITRCKXAReUW8f4AtRuhxMwkTKyYvPe9xUu3DjMlSt2OO4LF0yENRHWRFgTYU2ENRHWRFgrnNk4zJUO21q4ZtNS6XE47gtnJMKaCGsirImwJsKaCGsirBU6jcNcadjWQrzdtFRaDsd9oYMIayKsibAmwpoIayKsibBWeMU4zJWGbS203Hz4TI/Tj2/Ev01LpeVw3BcaRFgTYU2ENRHWRFgTYU2EtR3v7PTjG/F+RFgTYU2ENRHWRFgTYU2EtTIOc6VhWwvnNC2VlpffP2m5v3ukZVsLPaal0vLy+yct93ePtGxr4ZympdIiwpoIayKsibAmwpoIayKsibAmwpoIayKsibAmwpoIayKs7bhw93ePXLL7u0eumQhrIqyJsCbCmghrIqyJsLaj082fj/T5jrObPx/pcbp9pocIayKsibAmwpoIayKsibAmwpoIayKsibAmwpoIayKsibC2o9Pp9pke21o4p69Pv+ixrQ+c04ln3pMIayKsibAmwpoIayKsibBWeMU4zJWGbS1csq9Pv+jx5dMDl2xaKi2H477QIMKaCGsirImwJsKaCGsirO34z3359ED8mwhrIqyJsCbCmghrIqyJsFboNA5zpWFbC/F201JpORz3hQ4irImwJsKaCGsirImwJsJa4czGYa502NbCNZuWSo/DcV84IxHWRFgTYU2ENRHWRFgTYa1w4cZhrlyxw3FfuGAirImwJsKaCGsirImwJsLaX5ckWtpJgT4MAAAAAElFTkSuQmCC');
    background-size: 100% 100%;
    background-repeat: no-repeat;
    image-rendering: pixelated;
}
.mascot.blink {
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAACMUlEQVR4Ae3BIU7sUACF4f+ejEKzgaa+EtG8zSBYwZMkFU2QrADBZkgFsr6ZDaDH3rcCSsLNZGbeOd9XuHJ9N1Zu2HZcCldMhDUR1kRYE2FNhDUR1kRYK5xZ342VButcuGXDVGmxHZfCGYmwJsKaCGsirImwJsKaCGuFRn03VnascyF+b5gqe7bjUmggwpoIayKsibAmwpoIayKsFX7Qd2NlxzoX9tz9+UuL08cr8b1hquzZjkthhwhrIqyJsCbCmghrIqyJsHbgwk4fr8TliLAmwpoIayKsibAmwpoIa6XvxsqOdS7E7Rqmyh4R1kRYE2FNhDUR1kRYE2FNhDUR1kRYE2FNhDUR1kRYE2HtwIUNU+Wc1rnQYpgq57TOhUsSYU2ENRHWRFgTYU2ENRHWDjS6+3qkxTq/c83WuXBOd1+PtDjdv9NChDUR1kRYE2FNhDUR1kRYE2FNhDUR1kRYE2FNhDUR1kRYO9DodP/ONXt5+6TF89MD53S6f+eSRFgTYU2ENRHWRFgTYU2EtcIP+m6s7FjnwjV7efukxfPTA9dsmCp7tuNS2CHCmghrIqyJsCbCmghrIqwd+M89Pz0Q3xNhTYQ1EdZEWBNhTYQ1EdYKjfpurOxY50L83jBV9mzHpdBAhDUR1kRYE2FNhDUR1kRYK5xZ342VButcuGXDVGmxHZfCGYmwJsKaCGsirImwJsKaCGuFK9d3Y+WGbcelcMVEWBNhTYQ1EdZEWBNhTYS1f5PTVM15acthAAAAAElFTkSuQmCC');
}
/* 像素便利店小房子（128×80 内联 PNG，可点：叮咚 + 欢迎光临气泡） */
.store {
    position: absolute;
    left: 3%;
    bottom: 0;
    width: 64px;
    height: 40px;
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAABQCAYAAADRAH3kAAABYklEQVR4Ae3BIW6TAQCG4bdf/gQ1WcE9GlRFdZt0R9iOwMQcEocAhWZHYMlmqagivcfEJGqq3KBL+POnLN/7PDNecbXeHtGbdfd4P+OEoGpB1YKqBVULqhZULajacLXeHjnhy+0tY8xXS8Z43u0ZY75aMsbzbs8Y89WSMZ53e0Y6ckJQtaBqQdWCqgVVC6oWVC2oWlC1oGpB1YKqBVULqhZUbcYrrtbbI3qz7h7vZ5wQVC2oWlC1oGpB1YKqBVUbGOnHw090PtebS8YIqhZULahaULWgakHVgqoNTOzP4SvndLG4YUq/P39jSh8+fWRKQdWCqgVVC6oWVC2oWlC1gTN7937BGC9PB/TvgqoFVQuqFlQtqFpQtaBqA2f28nRA5xNULahaULWgakHVgqoFVRuY2MXiBv2/gqoFVQuqFlQtqFpQtaBqAyNdby7RdL5vfjGloGpB1YKqBVULqhZULajaXyoIKA9zBVVxAAAAAElFTkSuQmCC');
    background-size: 100% 100%;
    background-repeat: no-repeat;
    image-rendering: pixelated;
}
/* 门头灯：曦黄小方灯，像素式硬闪 */
.store::after {
    content: '';
    position: absolute;
    right: 15%;
    top: -7px;
    width: 8px;
    height: 8px;
    background: var(--blue);
    box-shadow: 0 0 6px 2px rgba(242, 203, 142, 0.8);
    animation: lampblink 1.6s steps(1) infinite;
}
@keyframes lampblink {
    0%,
    100% {
        opacity: 1;
    }
    50% {
        opacity: 0.25;
    }
}
.store.pop {
    animation: bpop 0.42s ease-out;
    transform-origin: bottom center;
}
.mascot.jump {
    animation: pjump 0.5s ease-out;
}
.mascot.wobble {
    animation: pwobble 0.8s ease-in-out;
}
@keyframes pjump {
    0% {
        transform: translateY(0) scale(1, 1);
    }
    14% {
        transform: translateY(3px) scale(1.14, 0.84);
    }
    45% {
        transform: translateY(-20px) scale(0.94, 1.1);
    }
    72% {
        transform: translateY(0) scale(1.08, 0.92);
    }
    100% {
        transform: translateY(0) scale(1, 1);
    }
}
@keyframes pwobble {
    0%,
    100% {
        transform: rotate(0);
    }
    15% {
        transform: rotate(-14deg);
    }
    35% {
        transform: rotate(12deg);
    }
    55% {
        transform: rotate(-9deg);
    }
    75% {
        transform: rotate(6deg);
    }
}

/* 三颗方豆 logo：站在地平线上，可弹（像素方豆：方块 + 方孔 + 硬高光） */
.logo-dots {
    position: absolute;
    left: calc(50% - 19px);
    bottom: 2px;
    display: flex;
    gap: 8px;
}
.ld {
    width: 26px;
    height: 26px;
    border-radius: 0;
    border: 3px solid var(--ink);
    position: relative;
    box-shadow: inset 3px 3px 0 rgba(255, 255, 255, 0.45);
}
.ld.pop {
    animation: bpop 0.42s ease-out;
}
@keyframes bpop {
    0% {
        transform: scale(1, 1);
    }
    30% {
        transform: scale(1.25, 0.7) translateY(3px);
    }
    60% {
        transform: scale(0.85, 1.2) translateY(-7px);
    }
    100% {
        transform: scale(1, 1);
    }
}
.ld-hole {
    position: absolute;
    left: 32%;
    top: 32%;
    right: 32%;
    bottom: 32%;
    border-radius: 0;
}
.ld1 {
    background: var(--accent);
}
.ldh1 {
    background: var(--accent-dark);
}
.ld2 {
    background: var(--blue);
}
.ldh2 {
    background: var(--blue-dark);
}
.ld3 {
    background: var(--coin);
}
.ldh3 {
    background: var(--coin-dark);
}

/* 表情泡 */
.emote {
    position: absolute;
    top: 6px;
    transform: translate(-50%, 0);
    background: #fff;
    border: 2.5px solid var(--ink);
    padding: 2px 8px;
    font-size: 14px;
    font-weight: 800;
    color: var(--ink);
    z-index: 3;
    animation: emoterise 0.85s ease-out forwards;
}
@keyframes emoterise {
    0% {
        transform: translate(-50%, 0) scale(0.4);
        opacity: 0;
    }
    20% {
        transform: translate(-50%, -8px) scale(1.15);
        opacity: 1;
    }
    100% {
        transform: translate(-50%, -32px) scale(1);
        opacity: 0;
    }
}

/* ================= 标题（四个字可跳舞） ================= */
.h1 {
    display: flex;
    justify-content: center;
    gap: 7px;
    margin-top: 14px;
}
.h1c {
    font-size: 30px;
    font-weight: 800;
    text-shadow: 3px 3px 0 rgba(201, 131, 143, 0.35);
}
.h1.wave .h1c {
    animation: chb 0.45s ease-out both;
}
.h1.wave .h1c:nth-child(2) {
    animation-delay: 0.08s;
}
.h1.wave .h1c:nth-child(3) {
    animation-delay: 0.16s;
}
.h1.wave .h1c:nth-child(4) {
    animation-delay: 0.24s;
}
.h1.wave .h1c:nth-child(5) {
    animation-delay: 0.32s;
}
@keyframes chb {
    0% {
        transform: translateY(0);
    }
    40% {
        transform: translateY(-11px) scale(1.12);
    }
    100% {
        transform: translateY(0);
    }
}

.h-sub {
    color: var(--ink2);
    margin-top: 6px;
    font-size: 14px;
}

.cta-new {
    display: block;
    width: 100%;
    padding: 15px;
    background: var(--accent);
    color: #7a4a55; /* 淡彩主色配深玫瑰字 */
    font-size: 17px;
    font-weight: 800;
    letter-spacing: 3px;
    text-align: center;
    border: 3px solid var(--ink);
    border-radius: 0;
    box-shadow: 5px 5px 0 var(--accent-dark);
    transition: transform 0.12s;
}
.cta-new.pump {
    animation: pump 0.4s ease-out;
}
@keyframes pump {
    0% {
        transform: translate(0, 0);
    }
    30% {
        transform: translate(3px, 3px);
    }
    65% {
        transform: translate(-1px, -1px);
    }
    100% {
        transform: translate(0, 0);
    }
}

.home-tabs {
    margin-top: 16px;
}
.home-list {
    margin-top: 16px;
}

.empty-tip {
    text-align: center;
    color: var(--ink2);
    padding: 48px 20px;
    line-height: 1.9;
    font-size: 15px;
    border: 3px dashed rgba(95, 74, 78, 0.3);
    border-radius: 0;
    margin-top: 8px;
}

.works-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
}
@media (min-width: 560px) {
    .works-grid {
        grid-template-columns: repeat(3, 1fr);
    }
}
@media (min-width: 900px) {
    .works-grid {
        grid-template-columns: repeat(4, 1fr);
    }
}

.work-card {
    background: var(--card);
    border: 3px solid var(--ink);
    border-radius: 0;
    box-shadow: var(--shadow);
    overflow: hidden;
    position: relative;
    transition: transform 0.12s;
}
.wc-thumb {
    width: 100%;
    padding-top: 100%; /* 1:1，兼容不支持 aspect-ratio 的旧内核 */
    background: #f9f0ea;
    position: relative;
}
.wc-thumb image {
    /* image 组件不支持 width:auto，必须给显式尺寸，否则回退 320×240 被裁切 */
    position: absolute;
    left: 10px;
    top: 10px;
    width: calc(100% - 20px);
    height: calc(100% - 20px);
}
.wc-badge {
    position: absolute;
    left: 8px;
    top: 8px;
    background: #9eb995;
    color: #fff;
    font-size: 11px;
    padding: 3px 8px;
    border: 2px solid var(--ink);
    border-radius: 0;
    font-weight: 700;
}
.wc-badge.iron {
    background: var(--coin);
    color: var(--ink);
}
.wc-badge.freeb {
    background: var(--blue);
    color: #7a5a2e;
}
.wc-badge.codeb {
    background: #cde3f2;
    color: #3d5a78;
}
.wc-badge.orderb {
    background: #ffe39a;
    color: #7a5a2e;
} /* 代拼派单码导入的作品（商家那边） */
.wc-body {
    padding: 10px 12px 12px;
}
.wc-name {
    font-weight: 700;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.wc-meta {
    color: var(--ink2);
    font-size: 12px;
    margin-top: 3px;
}
.wc-progress {
    height: 10px;
    background: var(--chipbg);
    border: 2px solid var(--ink);
    border-radius: 0;
    margin-top: 8px;
    overflow: hidden;
}
.wc-progress .fill {
    display: block;
    height: 100%;
    /* 像素分段进度条 */
    background: repeating-linear-gradient(90deg, var(--accent) 0, var(--accent) 6px, #f4dcdf 6px, #f4dcdf 8px);
    border-radius: 0;
}
.wc-del {
    position: absolute;
    right: 6px;
    top: 6px;
    width: 26px;
    height: 26px;
    border-radius: 0;
    background: var(--card);
    border: 2px solid var(--ink);
    color: var(--ink);
    font-size: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.92;
}

/* 代拼订单入口：CTA 下面一条细横条 */
.home-order {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    padding: 9px 12px;
    background: var(--blue);
    border: 3px solid var(--ink);
    box-shadow: 3px 3px 0 var(--blue-dark);
    color: #7a5a2e;
    transition: transform 0.12s;
}
.home-order .pxi {
    margin-right: 2px;
    flex-shrink: 0;
}
.ho-txt {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ho-r {
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 800;
}
</style>
