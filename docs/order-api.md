# 代拼服务接口契约（pindou-server 实现）

小程序端已完成：下单页 `pages/order`、订单页 `pages/orders`、报价引擎 `utils/pricing.js`、
接口封装 `utils/order.js`、配置消费 `utils/config.js`（`cfg.ORDER`）。后端按本文档实现
**1 个配置字段 + 6 个客户接口 + 1 个支付回调 + 后台派单/状态流转 + 支付机构收款与分账**即可联调。
统一响应 `{code, message, data}`（code 0 成功），客户接口鉴权走现有 Bearer token，与 /api/works 一致。

> **2026-09-30 新增：多图订单 + 派单导入码标记。后端要做的全部改动集中在 §11**，照着 §11 逐条做即可，其他章节只是背景说明。
> **2026-09-30 新增：物流查询（接快递100，客户在小程序看快递进度），全部写在 §12。** 和 §11 互不依赖，可以分开做。

## 0. 业务一句话

客户在小程序里把某张图纸「交给商家代拼」并付款 → **平台后台人工把单派给某个商家** → 商家拼好、熨烫定型 →
快递寄出或客户到店自取 → 订单完成时**通过持牌第三方支付机构的分账把商家的钱切过去**。

三条已定的规矩：

- **多商家、后台人工派单，客户端不展示商家**（2026-09-16）：所有付款订单（含自取）进「待派单」队列，管理员选商家。
  合作商家都在杭州，自取单派单后把该商家的地址写回订单，客户在订单详情里才看到具体取货地址。
- **收款与分账走持牌第三方支付机构**（2026-09-18 拍板，下称「支付机构」；候选汇付斗拱 / 富友 / 易宝 / 通联，签约后把名字填进 §6.0）。
  客户在小程序里照旧用微信支付付款，钱进支付机构的银行监管专户（不进平台商户号），订单完成时按规则分给商家与平台。
  **不走微信直连分账**：直连分账上限 30%，提额被微信按「平台统收涉及二清」拒绝；也不改「先付款后派单」流程去做服务商模式。
  平台自己的微信支付商户号 1117800336 保留但代拼不用。
- **用户价 = 商家报价 ÷ 0.8946（向上取整到角）**，
  **分账铁律：支付通道手续费（微信渠道现行 0.6%，以支付机构合同费率为准）先从实付扣，剩下的商家 90%、平台 10%，含运费没有例外**（商家 ≈ 实付的 89.46%）。代拼费/格利特加过价所以商家到手 ≥ 报价；
  运费表值就是客户付的整数运费（不再加价），分账时和商品一起按比例切，商家报运费时自己把这 10% 算进去。
  费率不是 0.6% 的话在 `order.pricing.feeRate` 里配（§2），用户价和分账都跟着变。

价格由平台统一定（就是下面那张表），商家接受平台价；运费统一按杭州发货的分区算。
门槛：豆数 ≥ 100；板子长边 ≤ 104 格（原表「104 以上根据图纸具体情况收费」，v1 不自助）。

## 1. 报价规则（服务端必须复算，客户端只做展示）

商家报价原表（2026-09）：

| 尺寸 | 代烫（默认单面无孔） | 格利特（代烫基础上额外） | 豆子数量 | 颜色 | 代拼 | 每颗标准 | 材料包 |
|---|---|---|---|---|---|---|---|
| 10×10 | 0.25 | 0.50 | 100 | 15 色 | 1 | 0.01/颗 | 0.50 |
| 20×20 | 0.50 | 0.50 | 400 | 15 色 | 4 | 0.01/颗 | 2.00 |
| 30×30 | 1.00 | 0.50 | 900 | 15 色 | 9 | 0.01/颗 | 4.50 |
| 40×40 | 2.00 | 0.50 | 1,600 | 15 色 | 24 | 0.015/颗 | 8.00 |
| 52×52 | 5.00 | 1.00 | 2,704 | 15 色 | 40 | 0.015/颗 | 13.52 |
| 78×78 | 7.00 | 1.50 | 6,084 | 25 色 | 121 | 0.02/颗 | 30.42 |
| 104×104 | 10.00 | 2.00 | 10,816 | 30 色 | 216 | 0.02/颗 | 54.08 |
| 104 以上 | 根据图纸具体情况收费 | | | | | | |

落地规则（全部在 `utils/pricing.js`，**零 wx 依赖，可原样拷进服务端**，`tests/pricing.test.js` 逐行复现上表）：

**原表三列是三种独立服务**：材料包（只买豆子）、代烫（自己拼好寄去烫）、代拼（商家备豆、拼好、烫好寄成品）。
小程序只卖代拼，**代拼价已含豆子与熨烫，订单不收材料包费和代烫费**（2026-09-16 用户确认）。

| 项 | 规则 |
|---|---|
| 代拼费 `labor` | 豆数 × 每颗单价，**精确到分、不抹零**（1242 颗 = 12.42；表里 2704 颗写 40 是抹零展示，实算 40.56），档位按**豆数、达到哪档按哪档**：不足 1600 颗 0.01 / 1600~6083 颗 0.015 / 6084 颗起 0.02（1600 颗报 24 元即 0.015；4592 颗 = 68.88）。含豆子与单面熨烫 |
| 格利特 `glitter` | 客户选的烫法属闪粉类时按**板子档**（能放下 max(w,h) 的最小板 10/20/30/40/52/78/104）加收（按 `finish` 判断，别信客户端的 `glitter` 字段）。原表写「代烫基础上额外收费」，代拼含烫仍加收——待商家确认，不加收就把各档 glitter 置 0 |
| 运费 `shipping` | 自取 0；快递按收货省份分区（§2 默认表）。**表值就是用户价**（整数，不 ÷0.8946），分账时随订单按比例切（商家得约 89.46%），商家定运费时自己把平台 10% 算进去 |
| 含色数 | 15/25/30 只做提示（`colorOver`），不加价 |
| 不收 | 材料费、代烫费（原表另两列，不适用于代拼订单） |

金额一律整数「分」；每颗单价用「厘」。合计 `totalFen = goods + shipping`。

**两层价格**：上表与规则算出来的都是**商家报价**（`items[].baseFen`，商家到手的钱）。用户看到、支付的是
**用户价**（`items[].fen`），每一行各自换算，不单列「平台服务费」：

```
fen = ceil( baseFen ÷ 0.8946 ／ 10 ) × 10    0.8946 = (1 − 通道手续费 0.6%) × 90%；向上取整到角（pricing.grossUp；feeRate 改了系数跟着变）
```

例：1242 颗商家报 12.42 → 用户价 13.90（手续费 0.08，余 13.82 → 平台 1.38、商家 12.44）；4592 颗商家报 68.88 → 用户价 77.00。运费不走这个换算：`items[shipping].fen = baseFen = 表值`（浙江省内就是 6.00），
用户要求运费显示不能贵、代拼费不随配送方式变、平台的 10% 不能少——三者同时满足的唯一办法就是运费表直接定成用户价。

**分账金额（`pricing.settle(totalFen)`，total = 用户实付，含运费）**：

```
wxFee    = round(total × feeRate)     支付通道手续费（微信渠道 0.6%，支付机构按整单收、交易时直接扣；字段名沿用 wxFeeFen）
net      = total − wxFee              待分金额
platform = round(net × 10%)           分给平台
merchant = net − platform             分给商家（≈ 实付 89.46%；商品部分 ≥ 商家报价，运费也按此比例）
```

支付机构的「可分金额」就是扣完手续费的实收，`merchant` / `platform` 就是分账请求里两笔的金额（见 §6.4）。
`merchantQuoteFen` 只算商品部分（代拼费 + 格利特）的商家报价。默认常量 `WX_FEE_RATE` / `PLATFORM_RATE` / `ROUND_FEN` 在 pricing.js 顶部，
`feeRate` 可由 `order.pricing.feeRate` 覆盖（§2），`pricing.rates()` 取当前生效值。

### 1.1 多图订单（一单多张图；客户端 / 后台已就绪，接口见 §3.1b，`order.multi` 开关见 §2）

客户一次把几张图打包下单，**整单派给一个商家、合寄一个包裹、运费只收一次**。报价用 `pricing.quoteCart(list, {delivery, province})`：

- 每张图各自走单图规则（代拼费按该张豆数定档、格利特按该张板子档、各自 ÷0.8946 取整到角），**豆数不加总**——
  加总会让 3 张 900 颗跳到 0.015 档，客户反而多付。
- 运费 = 分区首重价 `fee` + 续重份数 × 分区续重价 `extra`，计费重按快递规矩取实重和体积重的大者：

```
板子实物边长 = 格数 × pitchMm（默认 2.6mm）
箱型   = boxes 里第一个 长 ≥ 最长边+marginMm、宽 ≥ 最宽短边+marginMm、高 ≥ 张数×sheetMm+padMm 的
实重   = Σ豆数 × beadMg + packG
体积重 = 箱子长×宽×高(cm³) ÷ volDivisor × 1000（克）
计费重 = max(实重, 体积重)
续重份数 = 计费重 ≤ firstG ? 0 : ceil((计费重 − firstG) ÷ stepG)
```

  用默认参数：单张图任何尺寸都在首重内，**`quoteCart([x])` 与 `quote(x)` 结果完全一致**；3 张 30 板合寄浙江还是 6 元；
  10 张 104 满板寄北京实重约 1.23kg → 10 + 5 = 15 元；12 张 52 板要用加高箱，体积重 1.54kg → 续 1 份。
- 拦截（`ok=false`）：超过 `maxItems` 张（默认 10）/ 某一张不合格（`badIndex` 指出第几张）/ 所有箱型都装不下或计费重超 `maxG`
  （提示分两单或找客服）/ 港澳台。
- 分账不变：整单实付先扣通道费再 90/10，商家到手 ≥ 各张商品报价之和 + 运费 × 89.46%。
- 退款仍然只能整单、只能在分账前（§5.2），不支持退其中一张。
- ⚠ `parcel` 里的数字（每颗豆重、箱型、抛比、续重价）**全是占位**，要商家称成品、量箱子、拿快递合同价后在 §2 下发覆盖。

## 2. `GET /api/config` 新增 `order` 字段

```json
"order": {
  "enabled": true,
  "multi": false,
  "pickupArea": "杭州市内到店自取",
  "pickupHint": "具体取货地址在派单后的订单详情里显示，做好后商家会电话联系你约时间",
  "notice": "下单后 3-7 天内完成制作，节假日顺延",
  "pricing": null
}
```

- `enabled`：缺省 = 开；下发 `false` 客户端收起所有入口（首页横条 / 拼豆页 chip / 查看页按钮 / 设置页），不发版即可下线。
- `pickupArea` / `pickupHint`：下单页「到店自取」只显示这两句，**不出现任何商家名或地址**；具体地址派单后走订单 VO 的 `pickupAddress`。
- `notice`：下单页费用明细下方的说明。三个字符串空或缺省用客户端内置值。
- `finishImages`（可选）：烫法示例实拍**放大图**的高清 URL，`{ "towel": "https://…/towel.jpg", … }`，key 为烫法
  key（smooth/towel/bath/glaze/paper/mesh/glitter/glitterFine），只认 https。缺省用包内 `assets/finish/<key>-l.jpg`
  （长边 640）；缩略图始终用包内 220×220 的 `<key>.jpg`。想换图不发版就下发这个。
- `multi`：多图订单（代拼篮）开关，**缺省 `false`**。后端实现 §3.1b 的 `works[]` 后下发 `true`，下单页才出现「再加一张」。
- `pricing`：报价表覆盖，缺省 `null` 用内置表。形状（都是可选项，只接受合法的）：

```json
"pricing": {
  "feeRate": 0.006,
  "minBeads": 100, "maxSide": 104,
  "tiers": [{ "size": 10, "beads": 100, "rate": 10, "glitter": 50, "colors": 15 }, "…"],
  "shipping": {
    "base": 1000, "baseExtra": 500, "baseName": "其他省份",
    "zones": [
      { "key": "zj",  "name": "浙江省内",       "fee": 600,  "extra": 200,  "provinces": ["浙江"] },
      { "key": "jsh", "name": "江苏/上海/安徽", "fee": 800,  "extra": 300,  "provinces": ["江苏", "上海", "安徽"] },
      { "key": "far", "name": "偏远地区",       "fee": 1800, "extra": 1000, "provinces": ["新疆", "西藏", "内蒙古", "青海", "甘肃", "宁夏", "海南"] }
    ],
    "blocked": ["香港", "澳门", "台湾"]
  },
  "parcel": {
    "maxItems": 10, "firstG": 1000, "stepG": 1000, "volDivisor": 8000, "maxG": 5000,
    "beadMg": 10, "pitchMm": 2.6, "marginMm": 20, "sheetMm": 5, "padMm": 10, "packG": 150,
    "boxes": [
      { "key": "s",  "name": "小箱",     "l": 180, "w": 180, "h": 40 },
      { "key": "m",  "name": "中箱",     "l": 250, "w": 250, "h": 50 },
      { "key": "l",  "name": "大箱",     "l": 320, "w": 320, "h": 60 },
      { "key": "xl", "name": "加高大箱", "l": 320, "w": 320, "h": 120 }
    ]
  }
}
```

`fee` 是首重价、`extra` 是续重价（每 `stepG` 克），zone 不给 `extra` 时用 `baseExtra`；续重只有多图订单才可能用上（§1.1）。
`parcel` 长度单位毫米、重量单位克（`beadMg` 毫克/颗），`boxes` 是箱子内径，按体积从小到大挑。

单位：`rate` 厘/颗；`feeRate` 是支付通道费率（小数，0～0.05，支付机构合同不是 0.6% 时改这里，用户价与分账同步变）；其余金额分。上面就是客户端内置默认值——**运费分区是客户付的价（分账时随订单按比例切，商家得约 89.46%），
默认值是杭州发通达系的常见价，上线前和商家定**。`provinces` 按 `wx.chooseAddress` 的 `provinceName` 前缀匹配。
客户端冷启动拉一次并缓存，改配置下次冷启动生效（与广告位同机制）。

## 3. 客户接口

### 3.1 创建订单 + 预下单 `POST /api/orders`

请求体：

| 字段 | 类型 | 说明 |
|---|---|---|
| clientOrderId | string | 幂等键。同一 (userId, clientOrderId) 重复调用返回已有订单（客户端改选项会换键） |
| workId | string | 作品在客户端的 id（仅溯源） |
| name | string | 作品名 ≤20 字，**过 msgSecCheck** |
| w, h | int | 图纸尺寸 1~256（校验 max(w,h) ≤ maxSide） |
| beads, colorN | int | 豆数 / 色数（服务端从 payload 重算校验，豆数 ≥ minBeads） |
| colors | array | `[{num, code, name, hex, count, approx}]` 每色用量，商家备豆用；`approx=true` 表示自带色板作品的近似 MARD 码 |
| finish | string | 烫法 key（smooth/towel/bath/glaze/paper/mesh/glitter/glitterFine）。闪粉在下单页只分粗闪 `glitter` / 细闪 `glitterFine`，作品原选的彩虹款已归并；具体闪粉款式客户写在 note |
| finishName | string | 烫法中文名（给商家看；闪粉为「闪粉（粗闪）」/「闪粉（细闪）」） |
| glitter | bool | 客户端判断的是否闪粉，**仅参考** |
| hole | string | 固定 `none`：商家只做单面无孔，页面只展示「豆孔 无孔」不可选；字段保留以防以后开放小孔/大孔 |
| delivery | string | `pickup` 到店自取 / `express` 快递（两种都不带商家，商家由后台派单决定） |
| phone | string | 联系手机（自取必填 11 位；快递用地址里的电话） |
| address | object\|null | 快递必填：`{name, tel, province, city, county, detail, full}`（来自 wx.chooseAddress） |
| note | string | 备注 ≤100 字，**过 msgSecCheck** |
| clientQuote | object | 客户端估算 `{items:[{key,fen}], totalFen}`，仅用于比对/埋点 |
| payload | string | 图纸 JSON `{w, h, cells, palette?, name}` ≤256KB，**与导入码 payload 同构**（见 §5.3） |

行为：

1. 校验：尺寸/豆数/色数从 payload 重算；豆数 < minBeads 或长边 > maxSide → `400`；快递省份在 blocked → `400`。
2. 用 `pricing.quote()` 复算金额（**以服务端为准**），落库 `items/goodsFen/shippingFen/totalFen`，同时算好 `settle(totalFen)` 三个数存到订单上。
3. 建订单 `status = unpaid`，30 分钟支付超时（超时未付 → `cancelled`，reason「支付超时」）。
4. 调支付机构的「微信小程序支付」下单接口（各家叫法不同，本质都是替我们向微信要 JSAPI 的 prepay_id）：
   `openid` 用登录时的 openid，商户订单号 = 订单 id，金额 = totalFen，商品描述 = 「拼豆代拼·作品名」，
   **按支付机构的方式把这单标成「延时分账 / 待分账」**（不标就分不了账，钱会按 T+1 直接结给平台），
   回调地址见 §3.7。支付机构返回的就是小程序 `wx.requestPayment` 要的五个参数，原样透传。
5. 响应：

```json
{ "order": { "…订单 VO，见 §4" },
  "payParams": { "timeStamp": "1700000000", "nonceStr": "…", "package": "prepay_id=…", "signType": "RSA", "paySign": "…" } }
```

客户端拿到后：若 `order.totalFen` ≠ 本地估算，先弹「金额已更新」确认；然后 `wx.requestPayment(payParams)`。`signType` 以支付机构返回为准（RSA / MD5），客户端透传。
用户取消支付订单仍保留为 `unpaid`，可在订单页「继续支付」。

### 3.1b 多图订单（客户端与管理后台已做，等后端实现后下发 `order.multi: true` 打开）

> 这里是概要，后端实现以 §11 为准。

客户端：下单页顶部「代拼篮」作品条（点一张切换编辑、× 移除、「再加一张」从作品库挑），每张各选烫法；
篮子存本地 `pindou.order.cart.v1 = [{id, finish}]`（不存图纸），建单成功后清空；「我的订单」顶部有「代拼篮里还有 N 张」入口。
**`multi` 没打开时客户端只发单图格式，老接口不受影响；只有 1 张时即便打开也照发单图格式。**

同一个 `POST /api/orders`，2 张及以上时把单图字段挪进 `works[]`，订单级字段不变：

| 字段 | 说明 |
|---|---|
| works | `[{ workId, name, w, h, beads, colorN, colors, finish, finishName, glitter, hole, payload }]`，2 ~ `parcel.maxItems` 张，每张字段含义同 §3.1；**烫法每张各选**；每张 payload 各自 ≤256KB |
| clientOrderId / delivery / phone / address / note | 同 §3.1 |
| clientQuote | `{ items: [{key, fen, work?}], totalFen }`，`work` 是该行属于第几张（运费行没有） |

服务端逐张校验（任一张不合格 → `400`，message 里指明第几张）、用 `pricing.quoteCart()` 复算；`quoteCart().ok=false`（超张数 / 包裹装不下 / 超 maxG）→ `400` 带 reason。
支付商品描述用「拼豆代拼·作品名等 N 件」。

订单 VO（§4）多图时：

```json
{
  "name": "爱心 等 3 件", "w": 0, "h": 0, "beads": 4333, "colorN": 0, "finish": "", "finishName": "",
  "works": [
    { "workId": "…", "name": "爱心", "w": 16, "h": 16, "beads": 136, "colorN": 3, "finish": "towel", "finishName": "毛巾烫", "hole": "none",
      "items": [{ "key": "labor", "label": "代拼费", "desc": "136 颗 · 含豆子与熨烫定型", "baseFen": 136, "fen": 160 }], "goodsFen": 160,
      "patternCode": "HMFUKXC6", "colors": ["…仅管理端"], "payload": "…仅管理端详情" },
    { "…": "第 2、3 张同结构" }
  ],
  "items": [{ "key": "shipping", "label": "运费", "desc": "其他省份", "baseFen": 1000, "fen": 1000 }],
  "goodsFen": 7190, "shippingFen": 1000, "totalFen": 8190, "merchantQuoteFen": 6410
}
```

顶层 `name` 由服务端拼好「第一张名 等 N 件」、`beads` 为合计；顶层 `items` 只放运费，金额字段都是整单合计。单图订单没有 `works`，VO 保持现状。
客户接口的 `works[]` 不带 `colors/payload/patternCode`。派单（§5.3）**每张建一条 pattern、各给一个导入码**（`clientWorkId = 'order:' + 订单id + ':' + 序号`），
派单文案逐张列「作品 · 尺寸 · 烫法 · 导入码」，备豆清单按色号合并（自带色板按 hex 合并），格式照 `pindou-admin/src/lib/format.js buildDispatch`。

### 3.2 我的订单 `GET /api/orders`

`data = { orders: [VO…] }`，按 createdAt 倒序，最多 100 条。客户端会用它刷新本地索引。

### 3.3 订单详情 `GET /api/orders/:id`

`data = { order: VO }`。非本人订单 `404`。刚支付完客户端会 1.5s × 6 次轮询它等回调落地。

### 3.4 继续支付 `POST /api/orders/:id/pay`

仅 `unpaid`。复用未过期的支付参数或重新向支付机构下单（换商户订单号 = 订单id + '-' + 次数，同样标成待分账），
返回 `data = { payParams }`。非 unpaid → `409`。

### 3.5 取消 `POST /api/orders/:id/cancel`

仅 `unpaid` 可由客户取消（支付机构侧顺手关单）。已付款的取消/退款走客服，由后台操作（§5.2）。`data = { order: VO }`。

### 3.6 确认收货 `POST /api/orders/:id/confirm`

`shipped` / `ready` → `done`，记 `doneAt`，**触发分账（§6.3）**。`data = { order: VO }`。
发货/待自取 10 天未确认由定时任务自动 `done`（同样触发分账）。支付机构的延时分账也有最长期限（签约时问清，常见 30～180 天），
保底逻辑见 §6.4。

### 3.7 支付回调 `POST /api/pay/notify`（支付机构 → 服务端，无鉴权）

按支付机构文档验签 → 支付成功且金额一致 → 订单 `unpaid → paid`，记 `paidAt`、`transactionId`（支付机构的交易流水号，分账、退款要用）；
**幂等**（重复通知直接按成功应答）。成功后进「待派单」队列并通知管理员（§5.1）。应答格式按支付机构要求。

## 4. 订单 VO

```json
{
  "id": "od_20260916_000123",
  "status": "assigned",
  "workId": "lx1…", "name": "小熊", "w": 30, "h": 30, "beads": 812, "colorN": 12,
  "finish": "towel", "finishName": "毛巾烫", "hole": "none",
  "delivery": "express",
  "phone": "138…",
  "address": { "name": "张三", "tel": "138…", "province": "浙江省", "city": "杭州市", "county": "西湖区", "detail": "…", "full": "浙江省杭州市西湖区…" },
  "pickupAddress": "",
  "note": "",
  "items": [
    { "key": "labor", "label": "代拼费", "desc": "812 颗 · 含豆子与熨烫定型", "baseFen": 800, "fen": 900 },
    { "key": "shipping", "label": "运费", "desc": "浙江省内", "baseFen": 600, "fen": 600 }
  ],
  "goodsFen": 900, "shippingFen": 600, "totalFen": 1500, "merchantQuoteFen": 800,
  "carrier": "", "trackingNo": "", "merchantNote": "", "cancelReason": "",
  "createdAt": 1758000000000, "paidAt": 1758000060000, "assignedAt": 0, "acceptedAt": 0, "shippedAt": 0, "doneAt": 0
}
```

客户端对缺字段容错；`items` 直接展示。**商家信息（`merchantId`/名称/联系方式）不下发给客户端**，
客户看不到有几家、派给了谁；自取单派单后把所派商家的地址写进 `pickupAddress`，客户详情里只看到这个地址
（派单前为空，客户端显示「杭州市内到店自取，派单后在这里显示具体地址」）。
分账字段（`wxFeeFen/platformFen/merchantFen/sharingStatus`）也不下发。
快递单发货后多一个 `logistics`（物流状态）和 `carrierCode`，见 §12.8。

## 5. 状态机、商家与后台

```
unpaid ─支付回调─▶ paid ─后台派单─▶ assigned ─商家接单─▶ accepted ─发货─▶ shipped ─客户确认/10天─▶ done ─▶ 分账
  │                                                           └─做好(自取)─▶ ready ─客户确认/10天─▶ done ─▶ 分账
  ├─客户取消/30min超时─▶ cancelled
  └─(已付)后台退款─▶ refunded
```

客户端文案：unpaid 待支付 / paid 待接单 / assigned 已派单 / accepted 制作中 / shipped 已发货 /
ready 待自取 / done 已完成 / cancelled 已取消 / refunded 已退款。

### 5.1 商家表与派单

商家表 `merchants`：`id, name, contactName, contactPhone, pickupAddress, pickupHint,
webhook(企业微信群机器人), provider{merchantNo, status, settleName, settleBankTail, reason}（支付机构进件信息，§6.3）, status(active/paused), createdAt`。
商家都在杭州；客户端不消费这张表，只有后台用。

- 支付成功 → 订单进「待派单」（`paid`），自取单和快递单一样，都由管理员挑商家。
- 通知管理员有新单：v1 管理员看后台「待派单」列表即可；有条件再接平台自己的企业微信群机器人推一条。
- 管理员在后台点派单 → `assigned`，记 `merchantId`；**自取单同时把该商家的 `pickupAddress` 写进订单**
  （客户详情页据此显示取货地址）。**通知商家 v1 走人工转发**：后台派单成功后展示一段「派单文案」（§5.3 的内容，
  带「复制」按钮），管理员粘贴到微信发给商家。商家表的 `webhook` 可留空；配了就自动推（§5.4），没配就只出文案。
- 改派：重新写 `merchantId` 和 `pickupAddress`，给新商家推消息；自取单已告知客户地址的要通过客服知会。

### 5.2 后台管理接口（后台鉴权，非小程序 token）

**管理后台前端已做好：桌面 `pindou-admin/` 目录（Vite + Vue 3，`npm run dev` 预览、`npm run build` 出 dist/，手机/桌面自适应，自带假数据模式）。
管理接口的权威契约（请求/响应字段、状态前置条件、错误码）在 `pindou-admin/README.md`，下表只是索引。**

| 接口 | 作用 |
|---|---|
| `GET /admin/orders?status=paid` | 待派单队列（其它 status 也可筛） |
| `POST /admin/orders/:id/assign` `{merchantId}` | paid → assigned；改派：assigned → assigned（重发通知） |
| `POST /admin/orders/:id/accept` | assigned → accepted（商家在群里回「接了」后管理员点；以后可给商家独立页面） |
| `POST /admin/orders/:id/ship` `{carrier, trackingNo}` | accepted → shipped（快递单） |
| `POST /admin/orders/:id/ready` | accepted → ready（自取单） |
| `POST /admin/orders/:id/done` | shipped/ready → done（客户不点确认时手动完成，触发分账） |
| `POST /admin/orders/:id/refund` `{reason}` | paid/assigned/accepted/shipped/ready → refunded：通过支付机构原路退款（§6.5），全额。**done（已分账）一律 `409` 拒绝**——分账后系统不再动账，纠纷按合作协议 6.3 由商家把钱退给平台、平台再退客户 |
| `POST /admin/orders/:id/note` `{merchantNote}` | 商家留言（客户端详情展示） |
| `GET/POST/PUT /admin/merchants` | 商家增改、暂停接单、向支付机构进件（§6.3） |
| `GET /admin/sharing?status=` | 分账记录列表（失败的可重试） |

客户售后走微信客服：订单详情「联系客服」按钮 `open-type="contact"`，`session-from = "order:<id>"`。

### 5.3 派单消息与图纸交付

`payload` 与导入码（docs/import-code-api.md）的 payload **完全同构**。派单时后端为该订单建一条 pattern
（`clientWorkId = 'order:' + 订单id`，多图订单每张一条 `'order:' + 订单id + ':' + 序号`，`status = active`）得到导入码，随派单消息发给商家。商家用自己的微信打开
小程序 → 新作品 → 输入导入码 → 拼豆页「分享 → 保存图纸」拿到带 MARD 色号的高清图纸打印。

**建 pattern 时往 payload 里加 `order` 标记**（客户下单时传上来的 payload 没有，派单时由后端补）：

```json
{ "w": 30, "h": 30, "cells": [ … ], "name": "小熊",
  "order": { "no": "0123", "idx": 1, "n": 3, "finish": "towel" } }
```

| 字段 | 说明 |
|---|---|
| no | 订单号后 4 位（`od_20260916_000123` → `0123`），1~8 位字母数字 |
| idx / n | 第几张 / 共几张（单图订单 1 / 1） |
| finish | 客户选的烫法 key |

`name` 保持客户起的原名，**不用后端拼前缀**。小程序导入时认出 `order`，会做三件事：
- 作品名自动改成「`no`-`idx` 原名」，比如「0123-1 小熊」，超过 20 字截断。商家的作品库里一眼能对上是哪一单的第几张。
- 首页角标显示「代拼单」（包裹图标），和普通口令导入的作品（角标「口令」）区分开。
- 烫法预先选成客户下单时选的。

`order` 格式不对时，小程序会忽略这个字段，按普通口令导入，所以老版本的小程序也不受影响。
订单完成（done）、退款（refunded）或取消后，把这些 pattern 置为 `disabled`（导入码作废）。这样客户的图纸不会一直能被人导入；商家已经导入的作品不受影响。

推给商家群机器人的内容（markdown）：订单号、作品名与尺寸/豆数/色数、烫法·豆孔、配送方式与地址电话
（自取只给电话）、备注、导入码、备豆清单（`colors` 逐色 `code×count`）。多图订单的格式见 §11.8。

### 5.4 企业微信群机器人（可选的自动通知渠道，v1 可不接）

单量小的时候管理员手动把 §5.3 的派单文案发给商家就够了。想自动推再接：企业微信免费注册、不用认证；商家用手机号加为**内部成员**（机器人只在内部群可用），每个商家一个群，
平台自己人另建一个群收「待派单」提醒。Webhook 地址是群的钥匙，只存后端配置 / 商家表，不进客户端。

`POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<商家表里的 key>`：

```json
{
  "msgtype": "markdown",
  "markdown": {
    "content": "**新代拼订单 od_20260916_000123**\n> 作品：小熊 30×30 · 812 颗 · 12 色\n> 烫法：毛巾烫 · 无孔\n> 配送：快递 浙江省杭州市西湖区… 张三 138****1234\n> 备注：无\n> 导入码：<font color=\"warning\">PD-3K7F-9QWW</font>（新作品 → 输入导入码 → 分享 → 保存图纸）\n> 备豆：H2×120 C8×88 F13×60 …\n[后台查看](https://admin.…/orders/od_20260916_000123)"
  }
}
```

- 返回 `{"errcode":0}` 视为发成功；失败记日志并在后台标「通知失败」可重发，不要阻塞派单事务。
- 机器人限流 20 条/分钟/群，够用；markdown 单条 ≤ 4096 字节，备豆清单太长就截断加「…共 N 色，详见后台」。
- 平台群的「待派单」提醒同样格式，少带地址电话（管理员进后台看）。

## 6. 第三方支付机构：收款与分账

运营侧（选机构、签约、商家进件）见 `docs/third-party-sharing-guide.md`。这里只写规则与后端接入。
微信直连分账的老方案留档在 `docs/wxpay-profitsharing-guide.md`，已弃用。

### 6.0 选定的支付机构（签约后填）

| 项 | 值 |
|---|---|
| 机构 | （汇付斗拱 / 富友 / 易宝 / 通联 …） |
| 平台在机构的商户号 | |
| 微信渠道费率 | 0.6%（合同为准；不是 0.6% 就同步改 `order.pricing.feeRate`） |
| 分账手续费 / 提现费 | |
| 延时分账最长天数 | |
| 结算周期 | T+1 |
| 对接文档 | |

### 6.1 对支付机构的硬要求（选型时逐条确认，缺一条换一家）

- 央行《支付业务许可证》在有效期内、含互联网支付，能在央行官网「已获许可机构」查到。
- 支持微信小程序支付，能绑定我们的 AppID `wx483d6f0b4bf6eaec`。
- 支持**先收后分 / 延时分账**：付款时不指定商家，钱先冻在监管专户，订单完成后再分；分账比例可到 100%。
- 商家可以以个体工商户或小微（身份证 + 银行卡）进件，进件有接口或有后台。
- 未分账的订单能全额原路退款；已分账的支持分账回退（没有也行，走线下）。
- 有支付、分账、退款的异步回调，有每日对账文件。

### 6.2 平台接入（一次）

签约 → 平台进件（营业执照、法人身份证、对公账户）→ 绑定小程序 AppID（按机构指引，一般在他们后台授权）→
拿到机构给的商户号、密钥 / 证书 → 交后端，走私密渠道。**这些和微信直连的 APIv3 密钥是两套，别混。**

### 6.3 商家进件（每个商家一次）

后台「商家管理」填商家资料后点「发起进件」→ `POST /admin/merchants/:id/onboard` 调机构进件接口
（个体户：营业执照 + 经营者身份证 + 结算银行卡；小微：身份证 + 银行卡；商家本人要配合短信 / 人脸验证）→
结果写 `merchants.provider = { merchantNo, status: none|pending|active|rejected, settleName, settleBankTail, reason }`。
机构只支持后台人工进件的，就把结果手填进商家资料。`provider.status ≠ active` 的商家不能派单（后台派单下拉里不出现，`assign` 返回 409）。

### 6.4 分账时机与流程

**订单 `done` 时分账**（客户确认收货 / 10 天自动完成 / 管理员手动完成），之前钱冻在支付机构、随时可全额退款。
**保底**：定时任务扫「已付且未分账未退款、支付时间 ≥ 延时分账最长天数 − 5」的订单——
已发货 / 待自取的强制 `done` 并分账；还没发货的自动全额退款并置 `refunded`，通知管理员。
**退款只发生在分账之前**：客户端无自助退款，后台退款接口对 `done` 拒绝。流程：

1. `settle(totalFen)` 三个数付款时已存在订单上；分账请求按机构接口传两个接收方：商家 `merchantFen`、平台 `platformFen`
   （机构要求「平台留存不用列」的就只传商家那一笔，剩余自动归平台）。手续费 `wxFeeFen` 是机构自己扣的，不在请求里；
   机构算出的可分金额与我们差 1 分以内按机构为准，差额归商家。
2. 分账请求号 `'ps-' + 订单id`；记 `sharing` 表：`{orderId, transactionId, outOrderNo, merchantId, amount, status: PROCESSING/FINISHED/FAILED, failReason, createdAt, finishedAt}`。
3. 结果靠机构回调或查询接口落定；失败写 `failReason`，后台可重试（`POST /admin/sharing/:id/retry`，请求号加后缀）。
4. 订单 `cancelled`（未付）不涉及；`refunded` 走 §6.5，不分账。

### 6.5 退款

- 未分账（done 之前）：调机构退款接口，退款单号 = 订单id + '-r1'，全额原路退。
- 已分账后要退（极少，走客服协商）：机构支持分账回退的先回退再退款；不支持的按合作协议 6.3 由商家把钱退给平台，平台再退客户。

### 6.6 对账

每日拉机构对账文件，核三样：支付流水对 `paid` 订单、分账流水对 `sharing` 表、退款流水对 `refunded` 订单。对不上的进后台告警。

## 7. 支付接入要点

- 客户端只认 `payParams` 里 `wx.requestPayment` 的五个参数（`timeStamp/nonceStr/package/signType/paySign`），`signType` 以机构返回为准（RSA 或 MD5），客户端透传。
- 服务端配置：机构商户号、密钥 / 证书、回调验签公钥，全部走环境变量。
- 商户订单号建议 = 订单 id（字母数字 ≤32）；继续支付换后缀。
- 回调地址走 HTTPS 域名 `https://api.pindoubianlidian.com/api/pay/notify`（env.js 的 prod 域名），分账 / 退款回调同域。
- 幂等：回调可能重复；`POST /api/orders` 用 clientOrderId 去重。

### 7.1 支付机构接通之前的联调（模拟支付 / 模拟分账）

签约、进件没走完时，其余接口都能先做完并联调，只需要给服务端加一个开关 `PAY_MOCK`（**只允许在开发环境为 true**）：

- `POST /api/orders`：正常建单，跳过机构下单，直接把订单置为 `paid`（记 `paidAt`，`transactionId = 'mock'`），
  响应 `payParams: { "mock": true }`。
- `POST /api/orders/:id/pay`：同样返回 `{ "mock": true }` 并把订单置为 `paid`。
- 客户端（`utils/order.js` requestPay）只在 `ENV === 'dev'` 时认 `mock:true`，直接当支付成功进订单页；线上包收到 `mock` 会按「支付参数缺失」处理，不会误标已付。
- 派单 / 接单 / 发货 / 待自取 / 确认收货照常；`done` 时的分账在 mock 下只写 `sharing` 记录（status FINISHED）不调机构；退款只改状态；商家进件直接置 active。整条状态机可以跑通。

机构接通后：服务端关掉 `PAY_MOCK`，接 §3.1 第 4 步、§3.7、§6。客户端不用改。

## 8. 防刷与限额（沿用 docs/abuse-protection.md 的口径）

| 接口 | 限额 |
|---|---|
| POST /api/orders | 10 次/小时、30 次/日（每单都有 msgSecCheck + 支付机构下单调用） |
| GET /api/orders | 60 次/小时 |
| GET /api/orders/:id | 300 次/小时（支付后轮询） |
| POST …/pay | 10 次/小时 |
| 未支付订单存量 | 单用户 ≤ 5 个 unpaid，超出先让他付或取消 |
| payload | ≤256KB，w/h ≤256，豆数/色数从 payload 重算，不信客户端数字 |

## 9. 合规

- 隐私保护指引要有「地址」（wx.chooseAddress 的收货地址）与「手机号」（自取联系）、「订单信息」。接了物流查询后，还要写明会把收件人手机号和快递单号提供给快递100（§12.12）。
- 订单里的地址/电话是个人信息：后台脱敏展示、只推给接单的那家商家、订单完成 90 天后脱敏归档。
- 页面已有「以支付时显示的金额为准」提示；退款政策在 `notice` 里写清（如「商家接单前可全额退，接单后按进度协商」）。
- 多商家但由平台统一定价、统一派单、统一收款分账，仍是「平台提供代拼服务」形态；不做商家公开列表/评价。
  收款和分账由持牌支付机构完成，平台不触碰、不沉淀交易资金，避免二清。

## 10. 联调验收清单

| # | 场景 | 预期 |
|---|---|---|
| 1 | config 不带 `order` 字段 | 入口照常显示（默认开），内置报价表与自取文案 |
| 2 | config `order.enabled=false` | 首页横条 / 拼豆页 chip / 查看页按钮 / 设置项全部消失 |
| 3 | 自取单派单前后 | 下单页与派单前详情只显示「杭州市内到店自取」文案、无商家信息；后台派单后详情出现该商家地址并可复制 |
| 4 | 30×30 满板作品，普通烫，自取 | 明细只有代拼费 ¥10.10（商家报价 9.00 ÷ 0.8946 取整到角）和运费 0，合计 ¥10.10；没有材料费、代烫费行 |
| 5 | 同上换「粗闪格利特」 | 多一行格利特 ¥0.60（商家 0.50），合计 ¥10.70 |
| 6 | 99 颗作品 / 长边 105 | 红条提示，去支付不可用 |
| 7 | 快递 + 浙江 / 北京 / 香港地址 | 运费 ¥6.00 / ¥10.00（商家成本原价，不加价）/ 红条「暂不支持快递」；切换自取与快递时代拼费不变 |
| 8 | 服务端复算与本地不一致 | 弹「金额已更新」，确认后按服务端金额支付 |
| 9 | 支付成功 | 订单页自动展开该单，状态 1.5s 内从待支付变待接单；后台待派单队列出现该单，平台群收到通知 |
| 10 | 后台派单给商家 A | 客户端状态「已派单」+ 显示商家名；商家 A 的群收到派单消息与导入码；商家用导入码能导入并保存图纸 |
| 11 | 支付中取消 / 待支付取消 | 「继续支付」能再拉起；取消后状态已取消、支付机构侧关单 |
| 12 | 后台 ship 填单号 → 客户确认收货 | 详情显示快递单号可复制；确认后 done，`sharing` 表出现该单记录并变 FINISHED，商家结算卡按支付机构结算周期到账 90% 净额 |
| 13 | 接单后后台退款 | 订单 refunded，通过支付机构原路退款，`sharing` 无记录 |
| 14 | 后端未部署订单接口（404） | 下单 toast「代拼服务还没开通」，订单页显示本机记录 |

多图订单与派单导入码的验收见 §11.11。

## 11. 本期后端接入清单：多图订单 + 派单导入码（2026-09-30）

小程序和管理后台都已经做完，**后端做完下面 11.1～11.9 再按 11.10 打开开关**。开关打开前，小程序只会发老的单图格式，现有接口完全不受影响。

| # | 改什么 | 必须 / 可选 |
|---|---|---|
| 11.1 | 更新服务端的 `pricing.js` | 必须 |
| 11.2 | `/api/config` 的 `order` 加 `multi`，`pricing` 可带 `parcel` 和续重价 | 必须 |
| 11.3 | 数据表：订单挂多张作品 | 必须 |
| 11.4 | `POST /api/orders` 同时接受单图和多图两种请求 | 必须 |
| 11.5 | 客户订单 VO 带 `works[]` | 必须 |
| 11.6 | 管理端订单列表 / 详情带 `works[]` | 必须 |
| 11.7 | 派单：每张一个导入码，payload 加 `order` 标记；订单结束后作废导入码 | 必须 |
| 11.8 | 企业微信机器人的多图派单消息 | 接了机器人才要 |
| 11.9 | 请求体大小与限额 | 必须 |
| 11.10 | 上线开关 | 必须 |
| 11.11 | 验收用例 | — |

### 11.1 更新服务端的 `pricing.js`

把小程序 `utils/pricing.js` **整个文件原样拷过去**，替换服务端现有那份（零依赖，Node 直接 `require`）。这次新增的函数：

| 函数 | 作用 |
|---|---|
| `quoteCart(list, { delivery, province })` | 多图报价。`list = [{ w, h, beads, colorN, glitter, name }]`，每张各自定档计价，运费整单一次（首重 + 续重，计费重见 §1.1） |
| `parcelOf(pieces)` | 估算包裹（箱型 / 实重 / 体积重 / 计费重），`quoteCart` 内部用，也可以单独调来展示 |

`quoteCart` 的返回值：

```js
{
  ok, reason,          // ok=false 时 reason 就是给客户看的中文提示，原样放进 400 的 message
  badIndex,            // 出问题的是第几张（从 0 开始），-1 表示不是某一张的问题（超张数 / 包裹太大 / 港澳台）
  lines: [{ ok, reason, name, items, goodsFen, merchantQuoteFen, tier, rateTier, colorOver }], // 每张一项
  shipping,            // 运费行 { key:'shipping', label, desc, baseFen, fen }
  goodsFen, shippingFen, totalFen, merchantQuoteFen,
  zone, parcel,        // parcel = { box, actualG, volG, billedG, steps, ok, tooBig }
  needAddress, colorOver,
}
```

服务端启动和配置变更时，要用下发给客户端的同一份 `order.pricing` 调 `pricing.configure()`，保证两边算出来的金额一致。
拷完先跑一遍 `node tests/pricing.test.js`（测试文件一起拷），22 组应全部通过。

### 11.2 `/api/config` 的 `order` 字段

- 加 `multi`（布尔，默认 `false`）。含义和上线顺序见 11.10。管理后台「配置」页已经有这个下拉，
  `GET/PUT /admin/config/order` 要能读写它（`pindou-admin/README.md`「代拼配置」）。
- `order.pricing` 允许带新字段（都可选，形状见 §2）：
  - `shipping.baseExtra`：没有单独配续重价的分区，用这个续重价。
  - `shipping.zones[].extra`：各分区的续重价。
  - `parcel`：包裹参数，包括每颗豆重、箱型、抛比、首重、续重粒度、最多张数、计费重上限。
- ⚠ `parcel` 和 `extra` 的默认值都是占位。商家确认实际重量、箱子尺寸和快递合同价之后，在这里下发。

### 11.3 数据表

推荐新建子表 `order_works`；也可以在 `orders` 上加一个 JSON 列 `works`，二选一。

| 字段 | 说明 |
|---|---|
| order_id, idx | 所属订单、第几张（从 1 开始） |
| work_id | 客户端作品 id（仅溯源） |
| name, w, h, beads, color_n | 作品名、尺寸、豆数、色数（由服务端从 payload 重算） |
| colors | JSON，备豆清单，结构同 §3.1 |
| finish, finish_name, hole | 这一张的烫法 |
| payload | 图纸 JSON（≤256KB） |
| items | JSON，这一张的费用行（代拼费 / 格利特），取自 `quoteCart().lines[i].items` |
| goods_fen, merchant_quote_fen | 这一张的用户价小计 / 商家报价小计 |
| pattern_code | 派单时生成的导入码（11.7） |

多图订单的 `orders` 主表这样填：

- `name` = 「第一张名 等 N 件」，比如「小熊 等 3 件」。
- `beads` = 各张豆数合计。
- `w / h / color_n` = 0；`finish / finish_name / payload / colors / pattern_code` 留空。
- `items` 只存运费一行。
- `goods_fen / shipping_fen / total_fen / merchant_quote_fen` 存整单合计。
- `settle(total_fen)` 算出的三个数照常存。

单图订单不写 `order_works`，和现在完全一样。

### 11.4 `POST /api/orders`：两种请求都要接

**怎么区分：** 请求体有非空的 `works` 数组就是多图，否则按 §3.1 的单图处理。单图逻辑不用改。
小程序只在有 2 张及以上时才发 `works`，但服务端收到只有 1 项的 `works` 也要能处理（按多图存或转成单图都行）。

多图请求体：

```json
{
  "clientOrderId": "m1abc…",
  "delivery": "express",
  "phone": "13900000000",
  "address": { "name": "张三", "tel": "13900000000", "province": "北京市", "city": "北京市", "county": "海淀区", "detail": "…", "full": "…" },
  "note": "三张一起寄",
  "clientQuote": { "items": [ { "key": "labor", "fen": 1010, "work": 0 }, { "key": "glitter", "fen": 60, "work": 1 }, { "key": "labor", "fen": 170, "work": 1 }, { "key": "shipping", "fen": 1000 } ], "totalFen": 2240 },
  "works": [
    { "workId": "…", "name": "小熊", "w": 30, "h": 30, "beads": 900, "colorN": 12, "colors": [ … ],
      "finish": "towel", "finishName": "毛巾烫", "glitter": false, "hole": "none", "payload": "{\"w\":30,…}" },
    { "workId": "…", "name": "色块", "w": 12, "h": 12, "beads": 144, "colorN": 3, "colors": [ … ],
      "finish": "glitter", "finishName": "闪粉（粗闪）", "glitter": true, "hole": "none", "payload": "{…}" }
  ]
}
```

`works[]` 每一项的字段、含义、校验规则都和 §3.1 的单图字段一样；订单级字段（`clientOrderId / delivery / phone / address / note`）也和 §3.1 一样。

处理步骤：

1. **幂等**：同 (userId, clientOrderId) 已有订单时直接返回它，和单图一样。
2. **张数**：`works.length` 超过 `parcel.maxItems`（默认 10）→ `400`，message「一单最多 10 张图，请分开下单」。
3. **逐张校验**，和单图一样：
   - 解析 payload，尺寸、豆数、色数以服务端重算为准，不信客户端传的数字。
   - `name` 过 msgSecCheck。
   - 闪粉按 `finish` 判断，不看客户端的 `glitter`。
   - 任何一张不合格 → `400`，message 带上是哪一张，格式和客户端一致：「第 2 张「小猫」：豆子不足 100 颗，暂不支持代拼」。
4. `note` 过 msgSecCheck；快递单校验 `address`，自取单校验 `phone`，和单图一样。
5. **复算**：`q = pricing.quoteCart(works.map(w => ({ w, h, beads, colorN, glitter: 按 finish 判断, name })), { delivery, province: address?.province })`。
   `q.ok === false` → `400`，message = `q.reason`。可能的原因：包裹太大（「这些图装一个包裹太大了，请分成两单或联系客服」）、港澳台、某一张不合格。
6. **落库**：主表按 11.3 写；每张写 `order_works`，`items = q.lines[i].items`，`goods_fen = q.lines[i].goodsFen`，`merchant_quote_fen = q.lines[i].merchantQuoteFen`；
   主表 `items = [q.shipping]`，金额取 `q.goodsFen / q.shippingFen / q.totalFen / q.merchantQuoteFen`，再存 `settle(q.totalFen)`。
7. **支付下单**：和单图一样，金额用 `q.totalFen`。商品描述用「拼豆代拼·小熊等3件」，超过支付机构的长度限制就截断作品名。
8. **响应**：`{ order: VO（11.5）, payParams }`。如果服务端金额和 `clientQuote.totalFen` 不一样，客户端会弹「金额已更新」让客户确认，服务端不用额外处理。

错误码：业务校验失败都用 `400` + 中文 `message`，客户端直接 toast 出来；其他错误码的含义不变。

### 11.5 客户订单 VO（`POST /api/orders`、`GET /api/orders`、`GET /api/orders/:id` 都一样）

多图订单在 §4 的基础上：主表字段按 11.3 下发，另外加 `works[]`：

```json
{
  "id": "od_20260930_000140", "status": "paid",
  "name": "爱心 等 3 件", "w": 0, "h": 0, "beads": 4333, "colorN": 0, "finish": "", "finishName": "", "hole": "none",
  "works": [
    { "workId": "…", "name": "爱心", "w": 16, "h": 16, "beads": 136, "colorN": 3, "finish": "towel", "finishName": "毛巾烫", "hole": "none",
      "items": [ { "key": "labor", "label": "代拼费", "desc": "136 颗 · 含豆子与熨烫定型", "baseFen": 136, "fen": 160 } ],
      "goodsFen": 160 },
    { "…": "第 2 张：色块 12×12 · 144 颗 · 闪粉（粗闪），代拼费 170 + 格利特 60；第 3 张：76×78 · 4053 颗 · 普通烫，代拼费 6800" }
  ],
  "items": [ { "key": "shipping", "label": "运费", "desc": "其他省份", "baseFen": 1000, "fen": 1000 } ],
  "goodsFen": 7190, "shippingFen": 1000, "totalFen": 8190, "merchantQuoteFen": 6410,
  "…": "其余字段（delivery/address/phone/pickupAddress/note/carrier/trackingNo/时间戳…）同 §4"
}
```

- 客户接口的 `works[]` **不带** `colors / payload / patternCode`，只有管理端带（11.6）。
- 单图订单**不带** `works` 字段（也不要下发空数组），VO 和现在一样。
- 小程序订单详情用 `works[].name / w / h / beads / colorN / finish / finishName / items`，列表用主表 `name / beads / totalFen`。

### 11.6 管理端接口（`pindou-admin/README.md` 已同步）

- `GET /admin/orders`（列表）：多图订单带 `works[]`，可以不带 `works[].payload`。
  搜索参数 `q` 除了订单号、主表名称、手机号，还要能搜到 `works[].name`。
- `GET /admin/orders/:id`（详情）：多图订单的 `works[]` 带全字段（含 `colors / payload / patternCode`）。
  顶层的 `colors / payload / patternCode` 留空，后台会自己按张画图纸，并把各张备豆清单按色号合计。
- 其余管理接口（接单、发货、待自取、完成、退款、留言、分账）都**按整单操作**，逻辑不变。退款仍然只能整单、只能在分账前。

### 11.7 派单：每张一个导入码，payload 加 `order` 标记；订单结束后作废

`POST /admin/orders/:id/assign` 首次派单时生成导入码（复用 `POST /api/patterns` 的建档逻辑）：

| 订单 | clientWorkId | 导入码写到哪 |
|---|---|---|
| 单图 | `'order:' + 订单id`（和现在一样） | 主表 `pattern_code` |
| 多图 | 每张一条 `'order:' + 订单id + ':' + idx` | 各张的 `order_works.pattern_code` |

建 pattern 时，pattern 的 payload = 这张图的 payload **再加一个 `order` 字段**。单图、多图都加：

```json
{ "w": 30, "h": 30, "cells": [ … ], "palette": ["…可选"], "name": "小熊",
  "order": { "no": "0140", "idx": 1, "n": 3, "finish": "towel" } }
```

| 字段 | 取值 |
|---|---|
| `no` | 订单号后 4 位：`od_20260930_000140` → `"0140"`（字母数字，1~8 位） |
| `idx` | 第几张，从 1 开始（单图就是 1） |
| `n` | 共几张（单图就是 1） |
| `finish` | 这一张的烫法 key |

- `name` 放客户起的**原名**，不要自己加前缀。小程序导入时会把名字改成「0140-1 小熊」，首页标「代拼单」，并预先选好烫法（见 §5.3）。
- 改派（`assigned → assigned`）：沿用已经生成的导入码。因为按 clientWorkId 幂等，重复调用会拿到同一个码。
- **作废**：订单变成 `done`、`refunded`、`cancelled` 时，把该订单的所有 pattern 置 `status = disabled`。之后再用这些码导入会返回 410；商家已经导入的作品不受影响。
  放在状态流转的同一个事务里，或者之后异步处理都可以，作废失败不要影响订单状态变更。

### 11.8 企业微信机器人消息（接了机器人才需要做）

多图订单的派单消息逐张列作品、烫法和导入码，备豆清单按色号合计。内容和后台「派单文案」（`pindou-admin/src/lib/format.js` 的 `buildDispatch`）一致，markdown 里可以把每张压成一行：

```
**新代拼订单 od_20260930_000140**（共 3 件，合寄一个包裹）
> 1. 小熊 30×30 · 900 颗 · 12 色 · 毛巾烫 · 无孔 · 导入码 PD-3K7F-9QWW
> 2. 色块 12×12 · 144 颗 · 3 色 · 闪粉（粗闪） · 无孔 · 导入码 PD-9Z8B-J2JB
> 3. …
> 配送：快递 北京市… 李四 137****1111
> 备注：三张一起寄
> 导入后作品名是「0140-序号 作品名」，首页标「代拼单」
> 备豆（合计）：C8×1812 H7×1266 …
```

备豆合计的规则：有实体色号的按色号 `code` 相加；自带色板作品（`approx=true`）按 `hex` 相加。按用量从多到少排。超过 4096 字节时截断。

### 11.9 请求体大小与限额

- 多图订单的请求体最大约为 `maxItems × 256KB`，默认 10 张约 2.6MB。**网关和框架的 body 上限至少要设到 3MB**，否则大单会被 413 拒绝。
- 每张 payload 仍然限制 ≤256KB，w/h ≤256。
- §8 的频率限额按**订单数**算，不按张数。每单的 msgSecCheck 调用次数 = 张数 + 1（备注），额度要留够。

### 11.10 上线开关

1. 11.1～11.9 部署到测试环境，`order.multi` 保持 `false`，跑一遍 §10 的老用例，确认单图没有被改坏。
2. 测试环境下发 `"multi": true`，跑 11.11 的用例。
3. 生产部署后下发 `"multi": true`，所有用户下次冷启动生效。
4. 出问题时下发 `false` 就能关掉，不用发版。已经下好的多图订单照常流转。

小程序代码里 `multi` 的默认值是 `false`（`utils/config.js ORDER_DEF`）。这个默认值只在配置从来没拉到过时才起作用，平时以下发的值为准。

### 11.11 验收用例

| # | 场景 | 预期 |
|---|---|---|
| M1 | `multi=false` | 下单页没有作品条，下单请求仍是单图格式，§10 老用例全过 |
| M2 | `multi=true`，只选 1 张下单 | 请求仍是单图格式（没有 `works`），VO 没有 `works`，和老流程一样 |
| M3 | 3 张 30×30（900 颗）+ 自取 | 每张代拼费 ¥10.10，合计 ¥30.30。豆数不加总：加总会跳到 0.015 档变成 ¥45.30，这是错的 |
| M4 | 3 张 30 板 + 快递浙江 | 运费 ¥6.00，只收一次；VO 顶层 `items` 只有运费一行，`works[]` 各带自己的代拼费 |
| M5 | 10 张 104 满板 + 快递北京（默认 parcel） | 运费 ¥15.00，desc「其他省份 · 计费重 1.2kg」 |
| M6 | 第 2 张豆子不足 100 颗 | `400`，message「第 2 张「…」：豆子不足 100 颗，暂不支持代拼」 |
| M7 | 11 张 | `400`「一单最多 10 张图，请分开下单」 |
| M8 | 客户端发来的 `glitter` 和 `finish` 对不上 | 按 `finish` 算格利特 |
| M9 | 多图订单支付成功 → 后台 | 列表显示「小熊 等 3 件」「3 件 · 共 N 颗」；详情能按张切换图纸，备豆清单是合计 |
| M10 | 派单 | 每张生成一个导入码；派单文案逐张列出；商家输码后作品名是「0140-1 小熊」、首页角标「代拼单」、烫法已预选 |
| M11 | 单图订单派单 | 导入码的 payload 也带 `order`（`idx:1, n:1`），商家导入后叫「0140-1 名字」 |
| M12 | 改派 | 导入码不变 |
| M13 | 订单 done / refunded | 该单所有导入码再导入返回 410；商家已导入的作品还在 |
| M14 | 老版本小程序导入带 `order` 的码 | 正常导入（名字没有前缀），不报错 |
| M15 | 同一个 clientOrderId 重复提交多图订单 | 返回同一个订单 |
| M16 | 多图订单整单退款（分账前） | 整单 refunded，全额原路退，导入码作废 |

## 12. 物流查询：客户在小程序看快递进度（2026-09-30）

小程序订单详情和管理后台都已经做好物流展示，**只等后端接入**。后端没接之前，订单数据里没有 `logistics` 字段，小程序就不显示物流，只显示单号，现有流程不受影响。接好后也不需要开关，订单数据里有 `logistics` 就会显示。

### 12.0 整体流程

```
商家寄出后把快递单号发给我们 → 后台点「发货」，只粘贴单号（不用选快递公司）
  → 后端用快递100「智能单号识别」认出是哪家快递
  → 后端存单号和快递公司，向快递100「订阅」这个单号（一个单号订一次）
  → 快递公司有新轨迹时，快递100 主动推送到我们的回调地址（每次推全量轨迹）
  → 后端验签、更新订单的 logistics 和轨迹表
  → 客户打开订单详情：小程序读后端库里存的数据（GET /api/orders/:id/track），不会实时去查快递100
```

**为什么用订阅推送、不用实时查询：** 实时查询是客户每打开一次就查一次、花一次钱，而且有频率限制。订阅推送是一个单号只收一次订阅费，之后快递100 一直推送到签收为止，客户看多少次都不花钱。

### 12.1 服务商：快递100（推荐）

| 项 | 说明 |
|---|---|
| 产品 | 快递100 企业版「订阅推送」接口（快递100 叫 poll 接口） |
| 开通 | 在快递100 注册企业账号 → 实名认证 → 开通订阅推送 → 充值。在后台拿到 **`customer`、`key`**（放服务端环境变量，不进客户端） |
| 计费 | 按订阅的单号数计费，具体单价和免费额度以快递100 官网为准 |
| 回调地址 | `https://api.pindoubianlidian.com/api/logistics/notify`（HTTPS，和支付回调同域） |
| 备选 | 快递鸟、阿里云市场的快递查询也可以，按下面的归一规则映射即可，小程序和后台都不用改 |

> 快递100 的请求参数、签名算法、状态码以**快递100 官方最新文档**为准。本节写的是我们自己的契约，以及按快递100 常见用法给出的映射参考，接入时逐项核对。

### 12.2 快递公司：按单号自动识别

**后台发货只填单号，不选快递公司。** 商家用哪家快递寄都可以，后端负责认出来：

1. 收到单号后，调快递100「智能单号识别」接口（快递100 叫 autonumber），传入单号，返回可能的快递公司列表（快递100 编码 + 名称），按可能性从高到低排列。
   请求地址、参数和返回格式以快递100 官方文档为准。
2. 取第一个候选，映射成我方代码 `carrierCode`（下表），把展示名写进 `carrier`，然后用这个快递公司编码去订阅（12.6）。
3. 候选有多个、而订阅后快递100 推送"查不到"或"监控中止"时，换下一个候选重新订阅，最多试 3 个。
4. 一个候选都没有：`carrierCode` 和 `carrier` 留空，`logistics_sub = unknown`，不订阅。后台会提示"没识别出快递公司，请核对单号"，小程序只显示单号。

我方代码对照表。表里没有的快递公司，`carrierCode` 填 `other`，`carrier` 用快递100 返回的名称，照常订阅：

| carrierCode | 名称 | 快递100 编码（参考，上线前按其编码表核对） |
|---|---|---|
| zto | 中通快递 | zhongtong |
| yto | 圆通速递 | yuantong |
| yunda | 韵达快递 | yunda |
| sto | 申通快递 | shentong |
| jt | 极兔速递 | jtexpress |
| sf | 顺丰速运 | shunfeng |
| ems | EMS | ems |
| post | 邮政快递包裹 | youzhengguonei |
| jd | 京东快递 | jd |
| db | 德邦快递 | debangkuaidi |
| other | 其他（名称用快递100 返回的） | 快递100 识别出的原编码，另存一列 `carrier_kd100` |

- 订阅和后续处理都用快递100 的原编码，所以建议另存一列 `carrier_kd100`；`carrierCode` 只是给前端展示和统计用。
- **顺丰、中通等快递要求带手机号才能查到轨迹**：订阅时把收件人手机号（订单 `address.tel`）一起传上去（快递100 的 `phone` 参数）。
- 识别接口同样按调用次数计费（以官网为准），每次发货或改单号只调一次。

### 12.3 物流状态（我方归一，8 种）

小程序和后台只认下面这 8 种 `state`：

| state | 小程序显示 | 快递100 状态（参考） |
|---|---|---|
| pending | 待揽收 | 刚订阅、还没有任何轨迹 |
| collected | 已揽收 | 1 揽收 |
| transit | 运输中 | 0 在途、7 转投，以及其他没列出来的中间状态 |
| delivering | 派送中 | 5 派件 |
| signed | 已签收 | 3 签收 |
| exception | 物流异常 | 2 疑难、4 退签、14 拒签 |
| returning | 退回中 | 6 退回 |
| returned | 已退回 | 退回件已被寄件方签收（如果快递100 有单独状态就用它；没有就不产生这个状态） |

- 快递100 返回的状态码不在表里时，归为 `transit` 并记日志，事后补映射。
- 可以额外下发 `stateText` 覆盖显示文字（比如「清关中」），小程序优先用它。

### 12.4 数据表

订单表 `orders` 新增字段：

| 字段 | 说明 |
|---|---|
| carrier_code / carrier | 我方快递代码和展示名，由后端识别后回填（12.2） |
| carrier_kd100 | 快递100 的原快递公司编码（订阅用） |
| carrier_candidates | 识别接口返回的候选编码列表（JSON），换候选重订时用 |
| logistics_state | 12.3 的状态，未发货为空 |
| logistics_last_text / logistics_last_time | 最新一条轨迹的文字和时间 |
| logistics_updated_at | 最近一次收到推送的时间 |
| signed_at | 签收时间（state 第一次变成 signed 时记下） |
| logistics_sub | 订阅状态：`none` 未订阅 / `ok` 订阅成功 / `unknown` 没识别出快递公司 / `failed` 订阅失败（记原因） / `abort` 快递100 中止监控（候选都试过了） |

新建轨迹表 `order_traces`（或者订单上放一个 JSON 列，二选一）：`order_id, time, text, area(可选), raw_status(可选)`。
快递100 每次推送的是**全量轨迹**，收到后整批替换这一单的轨迹，不要追加，否则会重复。

### 12.5 发货接口改动：`POST /admin/orders/:id/ship`

请求体：`{ trackingNo }`。**只有单号**，快递公司由后端识别（12.2）。

| 项 | 规则 |
|---|---|
| 前置状态 | `accepted`（发货）或 **`shipped`（改单号，新增）**；其他状态 409 |
| 校验 | `trackingNo` 去掉空格后是 6~32 位字母、数字或 `-`，否则 400 |
| 发货 | 状态改为 `shipped`，记 `shippedAt`；存 `tracking_no`；`logistics_state = pending`，清空轨迹 |
| 改单号 | 状态不变，`shippedAt` 不变；更新单号，清空快递公司、候选、轨迹和 `signed_at`，`logistics_state` 重置为 `pending`，**用新单号重新识别、重新订阅** |
| 识别 + 订阅 | 按 12.2 识别快递公司、回填 `carrier_code / carrier / carrier_kd100`，再订阅（12.6）。**识别或订阅失败都不影响发货成功**：识别不到记 `logistics_sub = unknown`；订阅失败记 `failed`，由定时任务重试（比如 5 分钟、30 分钟、2 小时各重试一次）。可以同步做（接口慢一两秒），也可以异步做（先返回，`carrier` 暂时为空，后台显示"识别中…"） |
| 响应 | `{ order }`，订单里带 `carrierCode` 和 `logistics` |

### 12.6 订阅请求（后端 → 快递100）

按快递100 订阅接口的格式（参考，以官方文档为准）：

```
POST https://poll.kuaidi100.com/poll
Content-Type: application/x-www-form-urlencoded

schema=json&param={
  "company": "zhongtong",
  "number": "73123456789012",
  "key": "<授权 key>",
  "parameters": {
    "callbackurl": "https://api.pindoubianlidian.com/api/logistics/notify?oid=od_20260930_000140",
    "salt": "<我们自己生成的随机串，回调验签用>",
    "resultv2": "1",
    "phone": "13912345678"
  }
}
```

- `callbackurl` 里带上订单号 `oid`，回调时直接定位订单，不用按单号反查。
- `salt` 每个环境配一个固定值，放环境变量里。
- 快递100 返回成功，或返回"重复订阅"，都视为订阅成功，记 `logistics_sub = ok`。
- 单号属于客户的个人信息，调用日志里要脱敏。

### 12.7 推送回调：`POST /api/logistics/notify`（快递100 → 服务端，无登录鉴权）

1. **验签**：快递100 用 form 提交 `param`（JSON 字符串）和 `sign`。按官方规则用我们的 `salt` 校验 `sign`（常见做法是 `MD5(param + salt)` 转大写后比对，以官方文档为准）。验签失败直接返回失败，不落库。
2. **定位订单**：用 query 里的 `oid` 找到订单，再核对推送里的单号和订单的 `tracking_no` 一致（不一致说明已经改过单号，是旧单号的推送，丢弃并返回成功）。
3. **落库**：
   - 推送里的轨迹列表整批替换 `order_traces`，按时间倒序存。
   - 按 12.3 把状态映射成我方 `state`，写 `logistics_state / logistics_last_text / logistics_last_time / logistics_updated_at`。
   - 第一次变成 `signed` 时记 `signed_at`。
4. **中止监控**：快递100 推送"监控中止"或"查不到"（比如快递公司认错了，或者单号填错）时，如果还有没试过的候选快递公司，换下一个重新订阅（12.2 第 3 步）；候选都试过了，记 `logistics_sub = abort` 和原因。后台会提示核对单号，管理员用"改快递单号"重新保存一次就会重新识别、重新订阅。
5. **应答**：按快递100 要求的格式返回成功（常见是 `{"result":true,"returnCode":"200","message":"成功"}`）。不按格式返回的话快递100 会重复推送。
6. **幂等**：同样的推送来多次，结果相同即可（整批替换天然幂等）。

订单已经 `refunded` 或 `cancelled` 时，照常落库，不改订单状态。

### 12.8 客户接口

**订单 VO（§4）新增 `logistics`**：只有快递单，且已发货或已完成时才下发；自取单和未发货的单不下发这个字段。

```json
"logistics": {
  "state": "delivering",
  "stateText": "",
  "lastText": "【北京市】快递员正在派送，电话 138****0000",
  "lastTime": 1790700000000,
  "signedAt": 0
}
```

`GET /api/orders`（列表）也要带 `logistics`，小程序列表卡片会显示"快递到家 · 派送中"。

**新增 `GET /api/orders/:id/track`**（客户打开订单详情时调）：

```json
{
  "carrier": "中通快递", "carrierCode": "zto", "trackingNo": "73123456789012",
  "state": "delivering", "stateText": "",
  "lastText": "【北京市】快递员正在派送，电话 138****0000", "lastTime": 1790700000000,
  "signedAt": 0,
  "traces": [
    { "time": 1790700000000, "text": "【北京市】快递员正在派送，电话 138****0000" },
    { "time": 1790675000000, "text": "【北京市】快件已到达 北京转运中心" },
    { "time": 1790600000000, "text": "【杭州市】快件已在杭州拱墅区营业部揽收" }
  ]
}
```

- `traces` 按时间**倒序**（最新的在前），最多返回 100 条。
- 只读库，不实时查快递100。
- 不是本人的订单返回 404；没有物流数据时返回 `state: "pending"` 和空的 `traces`。
- 轨迹文字里快递员的手机号，快递100 一般已经打码；没打码的话后端打码后再下发。
- 限额：300 次/小时/用户（和订单详情一样）。

### 12.9 管理端接口

- `GET /admin/orders`（列表）：多带 `carrierCode` 和 `logistics`，不带轨迹。
- `GET /admin/orders/:id`（详情）：多带 `carrierCode`、`logistics`、`traces`（格式同 12.8，按时间倒序）。
- 管理端的 `logistics` 比客户端多一个 `subStatus`（就是 `logistics_sub`）。后台看到 `unknown` 提示"没识别出快递公司，请核对单号"，看到 `abort` 提示"快递公司长时间查不到这个单号"。
- 后台会根据 `logistics.state` 给出提示：签收了提示"可以完成并分账"，异常或退回提示"联系商家 / 客户处理"。
- 发货接口见 12.5。

### 12.10 自动完成（先不变，可选优化）

现在的规则不变：**发货后 10 天**客户没确认收货，就自动完成并分账（§3.6）。

接了物流以后，可以加一条可选规则：**签收后 N 天**客户没确认，自动完成。商家能更早拿到钱。
- 配置项 `order.autoDoneAfterSignedDays`，默认 0 表示不启用。要不要开、N 取几天，由运营决定。
- 两条规则谁先满足就按谁执行。物流状态是异常或退回中的单，不走这条自动完成。

### 12.11 开发环境模拟

快递100 账号没开通之前，给服务端加一个开关 `LOGI_MOCK`（只允许开发环境为 true）：
- 发货后不调快递100。
- 每隔几分钟往这一单的轨迹里加一条假轨迹，依次经过已揽收、运输中、派送中、已签收。

这样小程序和后台的物流展示都能先联调。后台的假数据模式（`VITE_USE_MOCK`）已经带了物流样例。

### 12.12 合规

- 收件人手机号和单号会发给快递100，属于向第三方提供个人信息。小程序的《用户隐私保护指引》里要写明"为查询物流进度，会将收件人手机号、快递单号提供给快递查询服务商（快递100）"。
- 轨迹数据和订单一起，按 §9 的规则在订单完成 90 天后脱敏归档。

### 12.13 验收用例

| # | 场景 | 预期 |
|---|---|---|
| L1 | 后端没接物流（订单没有 `logistics` 字段） | 小程序和现在一样，只显示单号，可复制 |
| L2 | 后台发货：只粘贴一个中通单号 | 订单变"已发货"；后端识别出"中通快递"并回填；`logistics.state = pending`，订阅成功，`logistics_sub = ok` |
| L3 | 快递100 推送"揽收"和"在途" | 小程序详情显示"已揽收"或"运输中"，轨迹按时间倒序，默认显示最近 3 条，可以展开全部 |
| L4 | 推送"派件" | 列表卡片显示"快递到家 · 派送中" |
| L5 | 推送"签收" | 状态显示"已签收"，记 `signed_at`；后台提示"可以完成并分账" |
| L6 | 后台改单号 | 旧轨迹清空，状态回到"待揽收"，用新单号重新订阅；旧单号的推送被丢弃 |
| L7 | 快递100 推送的签名不对 | 返回失败，不落库 |
| L8 | 同一次推送重复到达 | 轨迹不重复 |
| L9 | 顺丰单 | 订阅时带了收件人手机号，能查到轨迹 |
| L10 | 填一个识别不出来的单号（比如随便打的数字） | 能正常发货；`carrier` 为空，`logistics_sub = unknown`，后台提示核对单号，小程序只显示单号 |
| L14 | 识别出多个候选，第一个查不到 | 快递100 推送"查不到"后自动换下一个候选重新订阅，`carrier` 更新为新的快递公司 |
| L15 | 表里没有的快递公司（比如某家小快递） | `carrierCode = other`，`carrier` 显示快递100 返回的名称，照常订阅和显示物流 |
| L11 | 推送"疑难"或"拒签" | 小程序显示"物流异常"，后台提示处理 |
| L12 | 订阅失败（快递100 超时） | 发货照样成功，定时任务稍后重试订阅 |
| L13 | 看别人的订单 `/track` | 404 |
