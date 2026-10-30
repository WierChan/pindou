<template>
    <view>
        <view class="odpage">
            <view class="topbar" :style="'padding-top:' + insets.top + 'px;padding-right:' + insets.right + 'px'">
                <view class="tb-back" hover-class="pressed" @tap="goBack">‹</view>
                <view class="tb-title">找商家代拼</view>
                <view class="tb-actions"></view>
            </view>

            <scroll-view scroll-y class="od-scroll" enhanced :show-scrollbar="false">
                <!-- 作品 -->
                <view class="od-sec">
                    <!-- 代拼篮（多图订单）：点一张切换编辑，× 移除，末尾「再加一张」 -->
                    <block v-if="multi">
                        <scroll-view scroll-x class="wk-strip" enhanced :show-scrollbar="false" :scroll-into-view="'wk' + cur">
                            <view
                                :id="'wk' + index"
                                :class="'wk-it ' + (cur === index ? 'on' : '') + ' ' + (item.bad ? 'bad' : '')"
                                hover-class="pressed"
                                :data-i="index"
                                @tap="selectWork"
                                v-for="(item, index) in works"
                                :key="index"
                            >
                                <view class="wk-pv">
                                    <image v-if="item.thumb" class="wk-img" :src="item.thumb" mode="aspectFit" />
                                    <view v-if="works.length > 1" class="wk-x" :data-i="index" @tap.stop.prevent="removeWork">✕</view>
                                </view>

                                <view class="wk-nm">{{ item.name }}</view>

                                <view class="wk-fin">{{ item.finishText }}</view>
                            </view>
                            <view :class="'wk-it wk-add ' + (canAdd ? '' : 'off')" hover-class="pressed" @tap="openPicker">
                                <view class="wk-pv"><text class="wk-plus">＋</text></view>
                                <view class="wk-nm">再加一张</view>
                                <view class="wk-fin">运费只收一次</view>
                            </view>
                        </scroll-view>
                        <view v-if="works.length > 1" class="od-hint wk-hint">共 {{ works.length }} 张，派给同一位商家、合寄一个包裹。点上面的作品分别选烫法。</view>
                    </block>
                    <view class="od-card od-work">
                        <view class="od-pv-wrap">
                            <image v-if="preview" class="od-pv" :src="preview" mode="aspectFit" />
                            <view v-else class="od-pv ph"></view>
                        </view>
                        <view class="od-work-info">
                            <view class="od-work-name">{{ title }}</view>
                            <view class="od-work-meta">{{ dims }} · {{ beads }} 颗 · {{ colorN }} 色</view>
                            <view class="od-work-sub">商家备豆、按这张图纸拼好并熨烫定型，寄给你或到店自取；豆子和熨烫都含在代拼费里</view>
                        </view>
                    </view>
                    <view class="od-hint od-rights-hint">图片授权提醒：请确认本单图纸为您原创，或已获得用于代拼制作的授权；未经授权请勿下单。</view>
                    <view v-if="blocked" class="od-block">{{ blocked }}</view>
                </view>

                <!-- 成品要求 -->
                <view class="od-sec">
                    <view class="od-sec-t">成品要求</view>
                    <view class="od-card">
                        <view class="od-row col">
                            <view class="od-lb">
                                烫法
                                <text v-if="works.length > 1" class="od-cur">「{{ title }}」</text>
                                <text class="od-sub">点小图看成品实拍；闪粉按板子档加收，款式写在备注</text>
                            </view>
                            <view class="fin-groups">
                                <view class="fin-group" v-for="(item, index) in finishGroups" :key="index">
                                    <view class="fin-cat">{{ item.label }}</view>

                                    <view class="fin-chips">
                                        <!-- 卡片 = 示例实拍缩略图 + 名称：点名称/卡片选中，点小图放大看 -->
                                        <view
                                            :class="'fin-card ' + (finish === it.key ? 'on' : '')"
                                            hover-class="pressed"
                                            :data-v="it.key"
                                            @tap="pickFinish"
                                            v-for="(it, index1) in item.items"
                                            :key="index1"
                                        >
                                            <view class="fin-pv">
                                                <image class="fin-img" :src="it.img" mode="aspectFill" />
                                                <view class="fin-zoom" :data-v="it.key" :data-n="it.name" :data-s="it.sub" :data-fee="it.fee" @tap.stop.prevent="previewFinish">
                                                    放大
                                                </view>
                                            </view>

                                            <view class="fin-nm">
                                                {{ it.name }}
                                                <text v-if="it.fee" class="fin-fee">{{ it.fee }}</text>
                                            </view>
                                        </view>
                                    </view>
                                </view>
                            </view>
                        </view>
                        <!-- 商家只做单面无孔：只展示、不可选（hole 固定 none 随单提交） -->
                        <view class="od-row">
                            <view class="od-lb">
                                豆孔
                                <text class="od-sub">默认单面无孔</text>
                            </view>
                            <view class="seg"><view class="seg-i on">无孔</view></view>
                        </view>
                    </view>
                </view>

                <!-- 配送 -->
                <view class="od-sec">
                    <view class="od-sec-t">配送方式</view>
                    <view class="od-card">
                        <view class="od-row">
                            <view class="od-lb">方式</view>
                            <view class="seg">
                                <view :class="'seg-i ' + (delivery === 'pickup' ? 'on' : '')" hover-class="pressed" data-v="pickup" @tap="setDelivery">到店自取</view>
                                <view :class="'seg-i ' + (delivery === 'express' ? 'on' : '')" hover-class="pressed" data-v="express" @tap="setDelivery">快递到家</view>
                            </view>
                        </view>
                        <block v-if="delivery === 'pickup'">
                            <view class="od-row col">
                                <view class="od-lb">
                                    自取
                                    <text class="od-sub">运费 0</text>
                                </view>
                                <view class="od-addr">
                                    <view class="od-addr-l1">{{ pickupArea }}</view>
                                    <view class="od-addr-l2">{{ pickupHint }}</view>
                                </view>
                            </view>
                            <view class="od-row">
                                <view class="od-lb">
                                    <text class="od-req">*</text>
                                    联系手机
                                </view>
                                <input
                                    class="od-input"
                                    type="number"
                                    maxlength="11"
                                    placeholder="必填，商家做好后联系你"
                                    placeholder-class="od-ph"
                                    :value="phone"
                                    @input="onPhone"
                                />
                            </view>
                        </block>
                        <block v-else>
                            <!-- #ifdef MP-WEIXIN -->
                            <view class="od-row col" hover-class="pressed" @tap="chooseAddress">
                                <view class="od-lb">
                                    收货地址
                                    <text class="od-sub">运费按地区计算</text>
                                </view>
                                <view v-if="addr" class="od-addr">
                                    <view class="od-addr-l1">
                                        {{ addr.name }} {{ addr.tel }}
                                        <text class="od-copy">更换</text>
                                    </view>
                                    <view class="od-addr-l2">{{ addr.full }}</view>
                                </view>
                                <view v-else class="od-addr empty">点击选择微信收货地址 ›</view>
                            </view>
                            <!-- #endif -->
                            <!-- #ifndef MP-WEIXIN -->
                            <view class="od-row col">
                                <view class="od-lb">
                                    收货地址
                                    <text class="od-sub">请填写完整信息，运费按省份计算</text>
                                </view>
                                <view class="od-address-form">
                                    <input class="od-input full" data-key="name" :value="addr && addr.name" placeholder="收货人" @input="onAddressInput" />
                                    <input class="od-input full" data-key="tel" type="number" maxlength="11" :value="addr && addr.tel" placeholder="11 位手机号" @input="onAddressInput" />
                                    <input class="od-input full" data-key="province" :value="addr && addr.province" placeholder="省/直辖市，例如：浙江省" @input="onAddressInput" />
                                    <input class="od-input full" data-key="city" :value="addr && addr.city" placeholder="城市，例如：杭州市" @input="onAddressInput" />
                                    <input class="od-input full" data-key="county" :value="addr && addr.county" placeholder="区/县，例如：西湖区" @input="onAddressInput" />
                                    <textarea class="od-textarea" data-key="detail" :value="addr && addr.detail" maxlength="100" placeholder="街道、门牌号等详细地址" @input="onAddressInput" auto-height />
                                </view>
                            </view>
                            <!-- #endif -->
                        </block>
                        <view class="od-row col">
                            <view class="od-lb">
                                备注
                                <text class="od-sub">选填，≤100 字</text>
                            </view>
                            <textarea
                                class="od-textarea"
                                maxlength="100"
                                placeholder="给商家的话，比如闪粉款式（彩虹粗闪格利特、彩虹细闪格利特…）、颜色替换等"
                                :value="note"
                                @input="onNote"
                                auto-height
                            />
                        </view>
                    </view>
                </view>

                <!-- 费用 -->
                <view class="od-sec">
                    <view class="od-sec-t">费用明细</view>
                    <view v-if="quoteLoading" class="od-hint od-quote-status">正在获取报价…</view>
                    <view v-if="quoteError" class="od-hint od-quote-status warn" @tap="retryQuote">{{ quoteError }}，点击重试</view>
                    <view class="od-card od-fees-card">
                        <view class="od-fee" v-for="(item, index) in items" :key="index">
                            <view class="od-fee-l">
                                <text class="od-fee-nm">{{ item.label }}</text>
                                <text class="od-fee-desc">{{ item.desc }}</text>
                            </view>

                            <view class="od-fee-v">¥{{ item.yuan }}</view>
                        </view>
                    </view>
                    <view class="od-hint">
                        代拼费已包含豆子、熨烫定型与平台服务费，按颗数分档计价；闪粉烫法另加格利特费，快递另加运费。下单时服务器复核，以支付时显示的金额为准。
                    </view>
                    <view class="od-hint warn">
                        退款提醒：代拼为按图定制产品。商家接单前可联系客服申请全额退款；开始制作后，如因个人原因取消，退款金额需按制作进度协商。收到成品如有质量或制作问题，请及时联系客服处理。
                    </view>
                    <view v-if="notice" class="od-hint">{{ notice }}</view>
                </view>
                <view class="od-pad"></view>
            </scroll-view>

            <view class="od-bar">
                <view class="od-total">
                    <text class="od-total-lb">合计</text>
                    <text class="od-total-v">¥{{ totalYuan }}</text>
                </view>
                <view :class="'btn-primary od-pay ' + (canPay ? '' : 'off')" hover-class="pressed" @tap="submit">{{ submitting ? '提交中…' : '去支付' }}</view>
            </view>
        </view>

        <canvas type="2d" id="util" class="util-canvas" :style="'width:' + capW + 'px;height:' + capH + 'px'"></canvas>

        <!-- 「再加一张」选作品 -->
        <view v-if="picker" class="pk-mask" @tap="closePicker">
            <view class="pk-sheet" @tap.stop.prevent="noop">
                <view class="pk-head">
                    <text class="pk-t">加一张作品到这单</text>
                    <text class="pk-x" @tap.stop.prevent="closePicker">✕</text>
                </view>
                <scroll-view scroll-y class="pk-body" enhanced :show-scrollbar="false">
                    <view
                        :class="'pk-row ' + (item.low ? 'off' : '')"
                        hover-class="pressed"
                        :data-id="item.id"
                        :data-low="item.low"
                        @tap="pickWork"
                        v-for="(item, index) in picker"
                        :key="index"
                    >
                        <view class="pk-pv"><image v-if="item.thumb" class="wk-img" :src="item.thumb" mode="aspectFit" /></view>

                        <view class="pk-info">
                            <view class="pk-nm">{{ item.name }}</view>
                            <view class="pk-dims">{{ item.dims }}{{ item.low ? ' · 豆子太少不能代拼' : '' }}</view>
                        </view>

                        <view class="pk-go">{{ item.low ? '' : '加入' }}</view>
                    </view>
                </scroll-view>
            </view>
        </view>

        <!-- 烫法示例实拍放大（页面根节点、高层级，盖住一切） -->
        <view v-if="zoom" class="fz-mask" @tap="closeZoom">
            <view class="fz-box" @tap.stop.prevent="noop">
                <!-- 双指缩放：movable-view 原生支持 scale，1~4 倍，放大后可拖动看细节；弹层每次重建所以自动复位 -->
                <movable-area class="fz-area" scale-area>
                    <movable-view class="fz-mv" direction="all" scale scale-min="1" scale-max="4" scale-value="1" inertia>
                        <image class="fz-img" :src="zoom.img" mode="aspectFit" />
                    </movable-view>
                </movable-area>
                <view class="fz-hint">双指缩放看细节</view>
                <view class="fz-t">
                    {{ zoom.name }}
                    <text class="fz-sub">{{ zoom.sub }}</text>
                    <text v-if="zoom.fee" class="fin-fee">{{ zoom.fee }}</text>
                </view>
                <view class="fz-d">{{ zoom.desc }}</view>
                <view class="fz-btns">
                    <view class="btn-ghost slim2 c-mute" hover-class="pressed" @tap.stop.prevent="closeZoom">关闭</view>
                    <view class="btn-primary slim" hover-class="pressed" :data-v="zoom.key" @tap.stop.prevent="pickFromZoom">就选这个</view>
                </view>
            </view>
        </view>
    </view>
</template>

<script>
// 代拼下单：把图纸交给商家拼好（烫法 / 豆孔 → 自取或快递 → 报价 → 微信支付）。
// 下单页金额与费用明细从服务端报价接口获取；创建订单时服务端再次复核。
// 多图订单（cfg.ORDER.multi）：一单可放几张作品（代拼篮，本地只存 id + 烫法），每张各选烫法、各自计价，
// 整单派给一个商家合寄，运费只收一次。上面的作品卡 / 烫法 / 预览都跟着「当前选中的那张」走。
const { store } = require('../../utils/store');
const { finishList, finishInfo, renderPatternTo, patternSize } = require('../../utils/board');
const finishimg = require('../../utils/finishimg');
const order = require('../../utils/order');
const pricing = require('../../utils/pricing');
const { cfg } = require('../../utils/config');
const { isApp } = require('../../utils/platform');
const ui = require('../../utils/ui');
function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
            multi: false,

            // 多图订单开关（cfg.ORDER.multi）
            works: [],

            // 代拼篮作品条 [{id,name,thumb,finishText,bad}]，multi 开了才显示
            cur: 0,

            // 当前编辑的那张
            canAdd: false,

            // 还能再加一张
            picker: null,

            // 「再加一张」选作品弹层 [{id,name,dims,thumb,low}]
            title: '',

            dims: '',
            beads: 0,
            colorN: 0,
            preview: '',

            // 成品预览（先用作品缩略图占位，canvas 就绪后按所选烫法重渲）
            finishGroups: [],

            // [{cat,label,items:[{key,name,sub,fee,img}]}]，闪粉类带加价标注，img 为示例实拍缩略图
            zoom: null,

            // 点缩略图放大：{key,name,sub,fee,img,desc}
            finish: 'smooth',

            hole: 'none',
            delivery: 'pickup',

            // pickup 到店自取 / express 快递到家
            pickupArea: '',

            // 自取范围（商家由平台派单后决定，下单时不展示具体哪家）
            pickupHint: '',

            phone: '',
            addr: null,

            // 微信收货地址 {name, tel, province, city, county, detail, full}
            note: '',

            items: [],

            // 费用明细 [{key,label,desc,yuan}]
            totalYuan: '--',

            quoteLoading: false,
            quoteError: '',
            blocked: '',

            // 不能下单的原因（豆数不足 / 尺寸超档 / 地区不可达）
            notice: '',

            canPay: false,
            submitting: false,

            it: {
                key: '',
                img: '',
                name: '',
                sub: '',
                fee: ''
            }
        };
    },
    onLoad(q) {
        const work = store.get(q.id);
        if (!work) {
            ui.backHome();
            return;
        }
        if (work.free && !work.completed) {
            ui.toast('自由画布先完成定型，再找商家代拼');
            setTimeout(() => ui.backHome(), 700);
            return;
        }
        this.uq = ui.serialQueue();
        this.addr = null;
        const o = cfg.ORDER;
        this.multi = !!o.multi;
        // 代拼篮：之前加过没下单的作品还在（作品被删 / 变回未定型的自动剔除）；这次点进来的那张没在就追加并选中
        const items = this.multi
            ? order
                  .cartRead()
                  .map((c) => this.mkItemFun(store.get(c.id), c.finish))
                  .filter(Boolean)
            : [];
        let cur = items.findIndex((x) => x.work.id === work.id);
        if (cur < 0) {
            items.push(this.mkItemFun(work));
            cur = items.length - 1;
        }
        this.items = items;
        this.cur = cur;
        this.saveCartFun();
        this.setData({
            insets: ui.navInsets(),
            multi: this.multi,
            hole: 'none',
            // 商家只做单面无孔：页面只展示「无孔」不可选，固定 none 随单提交、预览按无孔渲
            pickupArea: o.pickupArea,
            pickupHint: o.pickupHint,
            notice: o.notice,
            phone: order.lastPhone()
        });
        this.syncFun();
    },
    onReady() {
        ui.queryNode(this, '#util').then((r) => {
            if (r && r.node) {
                this.utilCanvas = r.node;
                this.renderPreviewFun();
            }
        });
    },
    onUnload() {
        clearTimeout(this._pvT);
        this._quoteSeq = (this._quoteSeq || 0) + 1;
    },
    methods: {
        // 新加入的作品默认普通烫；篮子里已选过的烫法继续保留。
        mkItemFun(work, finish) {
            if (!work || (work.free && !work.completed)) {
                return null;
            }
            return {
                work,
                stats: order.workStats(work),
                finish: finish || 'smooth'
            };
        },

        saveCartFun() {
            if (this.multi) {
                order.cartWrite(
                    this.items.map((x) => ({
                        id: x.work.id,
                        finish: x.finish
                    }))
                );
            }
        },

        // 当前那张 → 作品卡 / 烫法 / 预览；作品条整体刷新，然后重新报价
        syncFun() {
            const it = this.items[this.cur];
            this.work = it.work;
            this.stats = it.stats;
            this.setData({
                works: this.items.map((x) => ({
                    id: x.work.id,
                    name: x.work.name,
                    thumb: x.work.thumb || '',
                    finishText: order.finishLabel(x.finish),
                    bad: false
                })),
                cur: this.cur,
                canAdd: this.multi && this.items.length < pricing.current().parcel.maxItems,
                title: it.work.name,
                dims: it.work.w + '×' + it.work.h,
                beads: it.stats.beads,
                colorN: it.stats.colorN,
                preview: it.work.thumb || '',
                finish: it.finish,
                finishGroups: this.finishGroupsFun()
            });
            this.requoteFun();
            this.renderPreviewFun();
        },

        /* ---------- 代拼篮 ---------- */
        selectWork(e) {
            const i = +e.currentTarget.dataset.i;
            if (!(i >= 0 && i < this.items.length) || i === this.cur) {
                return;
            }
            this.cur = i;
            this.syncFun();
        },

        removeWork(e) {
            const i = +e.currentTarget.dataset.i;
            if (!(i >= 0 && i < this.items.length) || this.items.length <= 1) {
                return;
            }
            this.items.splice(i, 1);
            if (this.cur > i || this.cur >= this.items.length) {
                this.cur = Math.max(0, this.cur - 1);
            }
            this.saveCartFun();
            this.syncFun();
        },

        // 「再加一张」：列出其它能代拼的作品（进行中的自由画布不行）
        openPicker() {
            const P = pricing.current();
            if (!this.canAdd) {
                ui.toast('一单最多 ' + P.parcel.maxItems + ' 张');
                return;
            }
            const inCart = {};
            this.items.forEach((x) => {
                inCart[x.work.id] = 1;
            });
            const list = store
                .list()
                .filter((s) => !inCart[s.id] && !(s.free && !s.completed) && s.total > 0)
                .map((s) => ({
                    id: s.id,
                    name: s.name,
                    thumb: s.thumb || '',
                    dims: s.w + '×' + s.h + ' · ' + s.total + ' 颗',
                    low: s.total < P.minBeads
                }));
            if (!list.length) {
                ui.toast('没有别的作品可以加了');
                return;
            }
            this.setData({
                picker: list
            });
        },

        closePicker() {
            this.setData({
                picker: null
            });
        },

        pickWork(e) {
            const d = e.currentTarget.dataset;
            if (d.low) {
                ui.toast('豆子不足 ' + pricing.current().minBeads + ' 颗，暂不支持代拼');
                return;
            }
            const it = this.mkItemFun(store.get(d.id));
            if (!it) {
                ui.toast('这张作品暂时不能代拼');
                return;
            }
            this.items.push(it);
            this.cur = this.items.length - 1;
            this.saveCartFun();
            this.setData({
                picker: null
            });
            this.syncFun();
        },

        goBack() {
            uni.navigateBack({
                fail: () => ui.backHome()
            });
        },

        // 烫法分组卡片（示例实拍缩略图 + 名称）；闪粉只给「粗闪 / 细闪」两档，
        // 具体款式客户在备注里写
        finishGroupsFun() {
            return finishList().map((g) => ({
                cat: g.cat,
                label: g.label,
                items:
                    g.cat === 'glitter'
                        ? Object.keys(order.ORDER_FINISH).map((key) => ({
                              key,
                              name: order.ORDER_FINISH[key].chip,
                              sub: finishInfo(key).sub,
                              fee: '加价',
                              img: finishimg.thumb(key)
                          }))
                        : g.items.map((it) => ({
                              key: it.key,
                              name: it.name,
                              sub: it.sub,
                              fee: '',
                              img: finishimg.thumb(it.key)
                          }))
            }));
        },

        // 点缩略图：放大看这种烫法的成品实拍（弹层，不改选中）
        previewFinish(e) {
            const d = e.currentTarget.dataset;
            const key = d.v;
            if (!key) {
                return;
            }
            this.setData({
                zoom: {
                    key,
                    name: d.n || finishInfo(key).name,
                    sub: d.s || finishInfo(key).sub,
                    fee: d.fee || '',
                    img: finishimg.zoom(key),
                    desc: finishimg.desc(key)
                }
            });
        },

        closeZoom() {
            this.setData({
                zoom: null
            });
        },

        // 放大弹层里的「就选这个」
        pickFromZoom(e) {
            this.pickFinish(e);
            this.setData({
                zoom: null
            });
        },

        noop() {},

        // 服务端报价。内容一变就换幂等键；旧请求即使晚返回，也不能覆盖当前选项的价格。
        // 明细：单张照旧逐项（代拼费 / 格利特 / 运费）；多张每张一行小计 + 一行运费
        requoteFun() {
            const d = this;
            const seq = (this._quoteSeq = (this._quoteSeq || 0) + 1);
            this.q = null;
            this.coid = genId();
            this.setData({
                items: [],
                totalYuan: '--',
                canPay: false,
                quoteLoading: true,
                quoteError: '',
                blocked: ''
            });
            order
                .quote(this.items, {
                    hole: d.hole,
                    delivery: d.delivery,
                    address: d.delivery === 'express' ? this.addr : null
                })
                .then((q) => {
                    if (seq !== this._quoteSeq) {
                        return;
                    }
                    if (
                        !q ||
                        typeof q.ok !== 'boolean' ||
                        !Array.isArray(q.lines) ||
                        q.lines.length !== this.items.length ||
                        q.lines.some((l) => !l || !Array.isArray(l.items) || !Number.isInteger(l.goodsFen) || l.items.some((i) => !i || !Number.isInteger(i.fen))) ||
                        !q.shipping ||
                        !Number.isInteger(q.shipping.fen) ||
                        !Number.isInteger(q.totalFen) ||
                        q.totalFen < 0
                    ) {
                        throw new Error('服务器报价格式不完整');
                    }
                    this.q = q;
                    this.showQuoteFun(q);
                })
                .catch((err) => {
                    if (seq !== this._quoteSeq) {
                        return;
                    }
                    this.q = null;
                    this.setData({
                        quoteLoading: false,
                        quoteError: (err && err.message) || '报价失败，请重试',
                        canPay: false
                    });
                });
        },

        retryQuote() {
            if (!this.quoteLoading) {
                this.requoteFun();
            }
        },

        showQuoteFun(q) {
            const row = (key, label, desc, fen) => ({
                key,
                label,
                desc,
                yuan: pricing.yuan(fen)
            });
            let items;
            if (q.lines.length === 1) {
                items = q.lines[0].items.map((i) => row(i.key, i.key === 'labor' ? order.finishLabel(this.items[0].finish) + '代拼费' : i.label, i.desc, i.fen));
            } else {
                items = q.lines.map((l, i) => {
                    const g = l.items.find((x) => x.key === 'glitter');
                    const beads = this.items[i].stats.beads;
                    return row(
                        'w' + i,
                        order.finishLabel(this.items[i].finish) + '代拼费 · ' + (l.name || '第 ' + (i + 1) + ' 张'),
                        beads + ' 颗' + (g ? ' · 含闪粉 ' + pricing.yuan(g.fen) : ''),
                        l.goodsFen
                    );
                });
            }
            if (q.shipping) {
                items.push(row('shipping', q.shipping.label, q.shipping.desc, q.shipping.fen));
            }
            const patch = {
                items,
                totalYuan: pricing.yuan(q.totalFen),
                blocked: q.ok ? '' : q.reason,
                canPay: q.ok && !q.needAddress,
                quoteLoading: false,
                quoteError: ''
            };
            this.works.forEach((w, i) => {
                patch['works[' + i + '].bad'] = i === q.badIndex;
            });
            this.setData(patch);
        },

        // 成品预览：按当前烫法 / 豆孔渲一张熨烫后的融合图（整幅图案，不看拼豆进度）
        renderPreviewFun() {
            if (!this.utilCanvas || !this.work) {
                return;
            }
            clearTimeout(this._pvT);
            this._pvT = setTimeout(() => {
                const work = this.work;
                const cellPx = ui.clamp(Math.floor(320 / Math.max(work.w, work.h)), 4, 16);
                const size = patternSize(work, {
                    cellPx
                });
                const scale = Math.max(size.width, size.height) > 900 ? 1 : 2;
                const finish = this.finish;
                const hole = this.hole;
                const draw = () =>
                    renderPatternTo(this.utilCanvas, work, {
                        cellPx,
                        fused: true,
                        matte: true,
                        finish,
                        hole,
                        scale
                    });
                this.uq(() => ui.captureCanvas(this, this.utilCanvas, draw))
                    .then((p) => {
                        if (work === this.work && finish === this.finish && hole === this.hole) {
                            this.setData({
                                preview: p
                            });
                        }
                    })
                    .catch(() => {
                        /* 保留占位图 */
                    });
            }, 150);
        },

        /* ---------- 成品要求 ---------- */
        pickFinish(e) {
            const v = e.currentTarget.dataset.v;
            if (!v || v === this.finish) {
                return;
            }
            this.items[this.cur].finish = v;
            this.saveCartFun();
            this.setData({
                finish: v,
                ['works[' + this.cur + '].finishText']: order.finishLabel(v)
            });
            this.requoteFun();
            this.renderPreviewFun();
        },

        /* ---------- 配送 ---------- */
        setDelivery(e) {
            const v = e.currentTarget.dataset.v;
            if (!v || v === this.delivery) {
                return;
            }
            this.setData({
                delivery: v
            });
            this.requoteFun();
            if (v === 'express' && !this.addr) {
                if (isApp()) {
                    this.setData({ addr: { name: '', tel: '', province: '', city: '', county: '', detail: '', full: '' } });
                } else {
                    this.chooseAddress();
                }
            }
        },

        // 微信收货地址（运费按省份分区计算）
        chooseAddress() {
            if (isApp()) {
                if (!this.addr) this.setData({ addr: { name: '', tel: '', province: '', city: '', county: '', detail: '', full: '' } });
                return;
            }
            uni.chooseAddress({
                success: (r) => {
                    this.addr = {
                        name: r.userName || '',
                        tel: r.telNumber || '',
                        province: r.provinceName || '',
                        city: r.cityName || '',
                        county: r.countyName || '',
                        detail: r.detailInfo || '',
                        full: [r.provinceName, r.cityName, r.countyName, r.detailInfo].filter(Boolean).join('')
                    };
                    this.setData({
                        addr: this.addr
                    });
                    this.requoteFun();
                },
                fail: (err) => {
                    const m = (err && err.errMsg) || '';
                    if (m.indexOf('cancel') >= 0) {
                        return;
                    }
                    if (m.indexOf('deny') >= 0 || m.indexOf('auth') >= 0) {
                        uni.showModal({
                            title: '需要收货地址权限',
                            content: '请在设置里允许使用通讯地址，才能选择快递收货地址',
                            confirmText: '去设置',
                            confirmColor: '#C9838F',
                            success: (r) => {
                                if (r.confirm) {
                                    uni.openSetting();
                                }
                            }
                        });
                    } else {
                        ui.toast('没拿到地址，再试一次');
                    }
                }
            });
        },

        onAddressInput(e) {
            const key = e.currentTarget.dataset.key;
            const value = String(e.detail.value || '').trim();
            const next = Object.assign({ name: '', tel: '', province: '', city: '', county: '', detail: '' }, this.addr || {});
            next[key] = value;
            next.full = [next.province, next.city, next.county, next.detail].filter(Boolean).join('');
            this.addr = next;
            this.setData({ addr: next });
            clearTimeout(this._addressQuoteTimer);
            this._addressQuoteTimer = setTimeout(() => this.requoteFun(), 350);
        },

        onPhone(e) {
            this._phone = String(e.detail.value || '');
        },

        onNote(e) {
            this._note = String(e.detail.value || '');
        },

        /* ---------- 下单 + 支付 ---------- */
        submit() {
            if (this.submitting) {
                return;
            }
            const d = this;
            const q = this.q;
            if (!q || !q.ok || q.needAddress || d.quoteLoading) {
                ui.toast(q && q.needAddress ? '先选一下收货地址' : q && !q.ok ? q.reason : '请等待服务器报价');
                if (q && q.needAddress) {
                    this.chooseAddress();
                }
                return;
            }
            let phone = String(this._phone != null ? this._phone : d.phone || '').replace(/\D/g, '');
            if (d.delivery === 'express') {
                if (!this.addr || !this.addr.name || !/^1\d{10}$/.test(this.addr.tel || '') || !this.addr.province || !this.addr.detail) {
                    ui.toast('请填写完整的收货人、手机号、省份和详细地址');
                    this.chooseAddress();
                    return;
                }
                phone = this.addr.tel;
            } else if (!/^1\d{10}$/.test(phone)) {
                ui.toast('请填 11 位手机号，做好后商家联系你取货');
                return;
            }
            const note = String(this._note != null ? this._note : d.note || '')
                .trim()
                .slice(0, 100);
            this.setData({
                submitting: true
            });
            uni.showLoading({
                title: '创建订单',
                mask: true
            });
            order
                .create(
                    this.items.map((x) => ({
                        work: x.work,
                        finish: x.finish,
                        stats: x.stats
                    })),
                    {
                        clientOrderId: this.coid,
                        hole: d.hole,
                        delivery: d.delivery,
                        phone,
                        address: d.delivery === 'express' ? this.addr : null,
                        note,
                        quote: q
                    }
                )
                .then((res) => {
                    uni.hideLoading();
                    const o = res && res.order;
                    if (!o || !o.id) {
                        throw {
                            message: '下单失败，稍后再试'
                        };
                    }
                    if (d.delivery === 'pickup') {
                        order.rememberPhone(phone);
                    }
                    // 报价后价格又有变化：停止本次支付，刷新报价让用户重新确认。
                    if ((o.totalFen | 0) !== q.totalFen) {
                        this.setData({
                            submitting: false
                        });
                        order.cancel(o.id).catch(() => {
                            /* 已创建订单仍可在我的订单处理 */
                        });
                        this.requoteFun();
                        ui.toast('价格有变化，请确认新报价后再支付');
                        return;
                    }
                    if (this.multi) {
                        order.cartClear();
                    } // 金额一致且订单已建，篮子清空
                    return this.payFun(o, res.payParams);
                })
                .catch((err) => {
                    uni.hideLoading();
                    this.setData({
                        submitting: false
                    });
                    ui.toast(order.errText(err));
                });
        },

        payFun(o, params) {
            return order
                .requestPay(params)
                .then((r) => {
                    if (r === 'ok') {
                        ui.toast('支付成功 ✨');
                    } else {
                        ui.toast('还没支付，可在「我的订单」里继续');
                    }
                    this.goOrdersFun(o.id, r === 'ok');
                })
                .catch((err) => {
                    ui.toast(order.errText(err));
                    this.goOrdersFun(o.id, false);
                });
        },

        // 订单已创建：无论付没付都进订单页（待支付的可以继续付）
        goOrdersFun(id, paid) {
            uni.redirectTo({
                url: '/pages/orders/orders?id=' + id + (paid ? '&paid=1' : '')
            });
        }
    }
};
</script>
<style>
/* 代拼下单页：卡片式表单 + 底部合计栏（沿用设置页的卡片骨架与像素风控件） */
.odpage {
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
}
.odpage .topbar {
    padding-left: 16px;
    background: var(--bg);
    position: relative;
}
.od-scroll {
    flex: 1;
    min-height: 0;
}

.od-sec {
    max-width: 560px;
    margin: 0 auto 16px;
    padding: 0 16px;
}
.od-sec-t {
    font-size: 13px;
    font-weight: 800;
    color: var(--accent-dark);
    letter-spacing: 1px;
    margin: 0 0 8px 2px;
}
.od-card {
    background: var(--card);
    border: 3px solid var(--ink);
    box-shadow: 4px 4px 0 #e2dad3;
}

/* 作品卡 */
.od-work {
    display: flex;
    gap: 12px;
    padding: 12px;
    align-items: center;
}
.od-pv-wrap {
    width: 96px;
    height: 96px;
    flex-shrink: 0;
    background: #f9f0ea;
    border: 2px solid var(--ink);
    display: flex;
    align-items: center;
    justify-content: center;
}
.od-pv {
    width: 88px;
    height: 88px;
}
.od-pv.ph {
    background: repeating-linear-gradient(45deg, #f0e7df 0 6px, #f6efe8 6px 12px);
}
.od-work-info {
    flex: 1;
    min-width: 0;
}
.od-work-name {
    font-size: 16px;
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.od-work-meta {
    font-size: 13px;
    color: var(--ink2);
    margin-top: 4px;
    font-weight: 700;
}
.od-work-sub {
    font-size: 12px;
    color: var(--ink2);
    margin-top: 6px;
    line-height: 1.5;
}
.od-rights-hint {
    color: var(--accent-dark);
    font-weight: 700;
    margin: 10px 2px 0;
}
.od-block {
    margin-top: 10px;
    padding: 10px 12px;
    background: #ffe3e3;
    border: 2px solid #c94a4a;
    color: #a32c2c;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.5;
}

/* 代拼篮作品条（多图订单） */
.wk-strip {
    white-space: nowrap;
    margin-bottom: 10px;
}
.wk-it {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    width: 78px;
    margin-right: 8px;
    padding: 6px 4px 7px;
    box-sizing: border-box;
    vertical-align: top;
    background: var(--card);
    border: 2px solid var(--ink);
}
.wk-it.on {
    background: var(--coin);
    box-shadow: 2px 2px 0 var(--coin-dark);
}
.wk-it.bad {
    border-color: #c94a4a;
    background: #ffe3e3;
}
.wk-pv {
    position: relative;
    width: 56px;
    height: 56px;
    border: 2px solid var(--ink);
    background: #f9f0ea;
    display: flex;
    align-items: center;
    justify-content: center;
}
.wk-img {
    width: 100%;
    height: 100%;
    display: block;
}
.wk-x {
    position: absolute;
    right: -8px;
    top: -8px;
    width: 18px;
    height: 18px;
    line-height: 18px;
    text-align: center;
    font-size: 10px;
    font-weight: 900;
    color: #fff;
    background: var(--ink);
    border-radius: 50%;
}
.wk-nm {
    width: 100%;
    font-size: 11px;
    font-weight: 800;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.wk-fin {
    width: 100%;
    font-size: 10px;
    color: var(--ink2);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.wk-add {
    border-style: dashed;
    background: var(--chipbg);
}
.wk-add.off {
    opacity: 0.45;
}
.wk-plus {
    font-size: 26px;
    font-weight: 900;
    color: var(--accent-dark);
}
.wk-hint {
    margin: -2px 2px 10px;
}
.od-cur {
    font-size: 13px;
    color: var(--accent-dark);
    margin-left: 2px;
}

/* 「再加一张」选作品弹层 */
.pk-mask {
    position: fixed;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    background: rgba(30, 20, 15, 0.5);
    z-index: 200;
    display: flex;
    align-items: flex-end;
    animation: fadeIn 0.2s;
}
.pk-sheet {
    width: 100%;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--card);
    border-top: 4px solid var(--ink);
    padding-bottom: env(safe-area-inset-bottom);
}
.pk-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 2px solid #f0e5de;
}
.pk-t {
    font-size: 16px;
    font-weight: 900;
}
.pk-x {
    font-size: 16px;
    padding: 0 4px;
    color: var(--ink2);
}
.pk-body {
    flex: 1;
    min-height: 0;
    max-height: calc(70vh - 50px);
}
.pk-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
}
.pk-row + .pk-row {
    border-top: 2px solid #f0e5de;
}
.pk-row.off {
    opacity: 0.5;
}
.pk-pv {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
    border: 2px solid var(--ink);
    background: #f9f0ea;
}
.pk-info {
    flex: 1;
    min-width: 0;
}
.pk-nm {
    font-size: 14px;
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.pk-dims {
    font-size: 12px;
    color: var(--ink2);
    margin-top: 2px;
}
.pk-go {
    font-size: 13px;
    font-weight: 800;
    color: var(--accent-dark);
    flex-shrink: 0;
}

/* 表单行 */
.od-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    padding: 12px 14px;
}
.od-row + .od-row {
    border-top: 2px solid #f0e5de;
}
.od-row.col {
    flex-direction: column;
    align-items: stretch;
}
.od-lb {
    font-size: 15px;
    font-weight: 700;
    color: var(--ink);
}
.od-sub {
    font-size: 11px;
    font-weight: 400;
    color: var(--ink2);
    margin-left: 6px;
}
.od-hint {
    font-size: 12px;
    color: var(--ink2);
    line-height: 1.6;
    margin: 8px 2px 0;
}
.od-hint.warn {
    color: #b0702b;
}

/* 烫法分组卡片：示例实拍缩略图 + 名称（一行三个），格利特加价角标 */
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
.fin-card {
    width: calc((100% - 16px) / 3);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 6px 4px 7px;
    background: #fff9f7;
    border: 2px solid var(--ink);
    transition: transform 0.12s;
}
.fin-card.on {
    background: var(--coin);
    box-shadow: 2px 2px 0 var(--coin-dark);
}
.fin-pv {
    position: relative;
    width: 66px;
    height: 66px;
    border: 2px solid var(--ink);
    background: #f9f0ea;
    overflow: hidden;
}
.fin-img {
    width: 100%;
    height: 100%;
    display: block;
}
.fin-zoom {
    position: absolute;
    right: 0;
    top: 0;
    font-size: 9px;
    font-weight: 800;
    line-height: 1;
    padding: 2px 4px;
    background: rgba(95, 74, 78, 0.8);
    color: #fff;
}
.fin-nm {
    font-size: 12px;
    font-weight: 800;
    color: var(--ink);
    text-align: center;
    line-height: 1.2;
}
.fin-fee {
    font-size: 10px;
    color: var(--accent-dark);
    margin-left: 4px;
    font-weight: 800;
}

/* 示例实拍放大弹层 */
.fz-mask {
    position: fixed;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    background: rgba(30, 20, 15, 0.6);
    z-index: 210;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    animation: fadeIn 0.2s;
}
.fz-box {
    width: 100%;
    max-width: 340px;
    background: var(--card);
    border: 4px solid var(--ink);
    box-shadow: 6px 6px 0 rgba(95, 74, 78, 0.3);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
/* 缩放容器：area 定尺寸并裁切，view 与 area 同尺寸（未放大时不可拖），放大后在 area 内拖动 */
.fz-area {
    width: 100%;
    height: 300px;
    background: #f9f0ea;
    border: 2px solid var(--ink);
    overflow: hidden;
}
.fz-mv {
    width: 100%;
    height: 100%;
}
.fz-img {
    width: 100%;
    height: 100%;
    display: block;
}
.fz-hint {
    font-size: 11px;
    color: var(--ink2);
    text-align: center;
    margin-top: -4px;
}
.fz-t {
    font-size: 17px;
    font-weight: 900;
}
.fz-sub {
    font-size: 12px;
    font-weight: 400;
    color: var(--ink2);
    margin-left: 6px;
}
.fz-d {
    font-size: 13px;
    color: var(--ink);
    line-height: 1.6;
}
.fz-btns {
    display: flex;
    gap: 10px;
}
.fz-btns > view {
    flex: 1;
    text-align: center;
    align-self: auto;
}

/* 地址块 / 输入 */
.od-addr {
    padding: 10px 12px;
    background: var(--chipbg);
    border: 2px dashed rgba(95, 74, 78, 0.35);
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink);
}
.od-addr.empty {
    color: var(--accent-dark);
    text-align: center;
    border-color: var(--accent-dark);
    font-weight: 700;
}
.od-addr-l1 {
    font-weight: 800;
}
.od-addr-l2 {
    color: var(--ink2);
    margin-top: 2px;
}
.od-address-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.od-address-form .od-input.full,
.od-address-form .od-textarea {
    width: 100%;
}
.od-copy {
    color: var(--accent-dark);
    font-weight: 800;
    margin-left: 8px;
    font-size: 12px;
}
.od-input {
    flex: 1;
    min-width: 0;
    min-height: 34px;
    padding: 4px 10px;
    border: 2px solid var(--ink);
    background: #fff;
    font-size: 14px;
    font-weight: 700;
    text-align: right;
    box-sizing: border-box;
}
.od-textarea {
    width: 100%;
    min-height: 64px;
    padding: 8px 10px;
    border: 2px solid var(--ink);
    background: #fff;
    font-size: 13px;
    line-height: 1.5;
    box-sizing: border-box;
}

/* 费用明细 */
.od-fees-card {
    background: var(--coin);
}
.od-fee {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 14px;
}
.od-fee + .od-fee {
    border-top: 2px solid #f0e5de;
}
.od-fee-l {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.od-fee-nm {
    font-size: 14px;
    font-weight: 700;
}
.od-fee-desc {
    font-size: 11px;
    color: var(--ink2);
}
.od-fee-v {
    font-size: 14px;
    font-weight: 800;
    flex-shrink: 0;
}
.od-pad {
    height: 20px;
}

/* 底部合计栏 */
.od-bar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
    background: var(--card);
    border-top: 3px solid var(--ink);
    box-shadow: 0 -4px 0 #f0e5de;
}
.od-total {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
}
.od-total-lb {
    font-size: 13px;
    color: var(--ink2);
    font-weight: 700;
}
.od-total-v {
    font-size: 22px;
    font-weight: 900;
    color: var(--accent-dark);
}
.od-pay {
    padding: 12px 28px;
    font-size: 15px;
    flex-shrink: 0;
}
.od-pay.off {
    opacity: 0.5;
}

/* 必填标记（自取联系手机：标签前红星）与输入框占位色 */
.od-req {
    color: #c94a4a;
    font-weight: 800;
    margin-right: 2px;
}
.od-ph {
    color: #b9ada9;
    font-weight: 400;
}
</style>
