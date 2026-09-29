# 代拼服务接口契约（pindou-server 实现）

小程序端已完成：下单页 `pages/order`、订单页 `pages/orders`、报价引擎 `utils/pricing.js`、
接口封装 `utils/order.js`、配置消费 `utils/config.js`（`cfg.ORDER`）。后端按本文档实现
**1 个配置字段 + 6 个客户接口 + 1 个支付回调 + 后台派单/状态流转 + 支付机构收款与分账**即可联调。
统一响应 `{code, message, data}`（code 0 成功），客户接口鉴权走现有 Bearer token，与 /api/works 一致。

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

## 2. `GET /api/config` 新增 `order` 字段

```json
"order": {
  "enabled": true,
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
- `pricing`：报价表覆盖，缺省 `null` 用内置表。形状（都是可选项，只接受合法的）：

```json
"pricing": {
  "feeRate": 0.006,
  "minBeads": 100, "maxSide": 104,
  "tiers": [{ "size": 10, "beads": 100, "rate": 10, "glitter": 50, "colors": 15 }, "…"],
  "shipping": {
    "base": 1000, "baseName": "其他省份",
    "zones": [
      { "key": "zj",  "name": "浙江省内",       "fee": 600,  "provinces": ["浙江"] },
      { "key": "jsh", "name": "江苏/上海/安徽", "fee": 800,  "provinces": ["江苏", "上海", "安徽"] },
      { "key": "far", "name": "偏远地区",       "fee": 1800, "provinces": ["新疆", "西藏", "内蒙古", "青海", "甘肃", "宁夏", "海南"] }
    ],
    "blocked": ["香港", "澳门", "台湾"]
  }
}
```

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
（`clientWorkId = 'order:' + 订单id`，`status = active`）得到导入码，随派单消息发给商家。商家用自己的微信打开
小程序 → 新作品 → 输入导入码 → 拼豆页「分享 → 保存图纸」拿到带 MARD 色号的高清图纸打印。

推给商家群机器人的内容（markdown）：订单号、作品名与尺寸/豆数/色数、烫法·豆孔、配送方式与地址电话
（自取只给电话）、备注、导入码、备豆清单（`colors` 逐色 `code×count`）。

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

- 隐私保护指引要有「地址」（wx.chooseAddress 的收货地址）与「手机号」（自取联系）、「订单信息」。
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
