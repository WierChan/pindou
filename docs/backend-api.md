# 拼豆便利店 · 后端接口总览（pindou-server 实现）

这份文档是**给后端的总入口**：列出小程序和管理后台要用到的全部接口，写清通用约定，并补齐之前没有单独文档的接口（登录、作品云同步、模板、配置）。
已经有详细文档的接口（代拼订单、导入码、管理后台）这里只列清单，细节以对应文档为准。

| 文档 | 内容 |
|---|---|
| **本文** | 通用约定、全部接口清单、登录 / 配置 / 模板 / 作品云同步的完整契约、对接顺序、上线检查 |
| `docs/order-api.md` | 代拼订单：报价、下单支付、订单状态、派单、分账、多图订单（§11）、物流查询（§12） |
| `docs/import-code-api.md` | 导入码：生成、凭码取图纸、举报 |
| `docs/ad-config-api.md` | `/api/config` 里的广告位 `adUnits` |
| `docs/abuse-protection.md` | 各接口的限额、熔断、防刷 |
| `pindou-admin/README.md`（仓库 github.com/WierChan/pindou-admin） | 管理后台的全部 `/admin/*` 接口 |

> 关于"状态"一列：登录、配置、模板、作品同步、导入码这几组，旧文档里称"已有接口"，这里标"已有，按本文核对"；代拼订单和物流是全新的。**以后端实际实现为准**，对接时请逐条确认。

## 1. 通用约定

### 1.1 地址

| 环境 | 地址 | 配置位置 |
|---|---|---|
| 开发 | `http://192.168.50.62:7000` | 小程序 `utils/env.js` 的 `HOSTS.dev`（开发者工具已关闭域名校验） |
| 生产 | `https://api.pindoubianlidian.com`（待确认） | `utils/env.js` 的 `HOSTS.prod`，发版前把 `ENV` 改成 `'prod'` |

生产域名必须是 HTTPS，并且要加进微信小程序后台「开发管理 → 服务器域名 → request 合法域名」。

### 1.2 请求和响应

- 请求体一律 JSON（`Content-Type: application/json`）。**例外**：支付回调、物流回调按第三方的格式来。
- 响应统一是：

```json
{ "code": 0, "message": "", "data": { } }
```

- `code = 0` 表示成功，小程序只取 `data`。
- `code ≠ 0` 表示失败，小程序会把 `message` 直接展示给用户，所以 **message 要写成用户能看懂的中文**，比如"豆子不足 100 颗，暂不支持代拼"，不要写技术报错。
- 金额单位一律是**分**（整数）；时间一律是**毫秒时间戳**。

### 1.3 错误码

`code` 用 HTTP 语义，HTTP 状态码和 `code` 保持一致：

| code | 含义 | 小程序的处理 |
|---|---|---|
| 400 | 参数不对、业务校验不通过 | 展示 message |
| 401 | 没登录或 token 失效 | **自动重新登录并重试一次**（见 §2），用户无感 |
| 404 | 资源不存在，或不是本人的 | 展示 message；代拼接口整体 404 时提示"代拼服务还没开通" |
| 409 | 状态不允许（比如订单已支付又来取消） | 展示 message |
| 410 | 已作废（导入码被禁用） | 和 404 一样提示"没找到这个口令对应的图纸" |
| 429 | 太频繁 | 展示 message；作品同步会进重试队列，不丢数据 |
| 5xx | 服务端异常 | 提示"服务异常" |

### 1.4 鉴权

- 除了 `POST /api/auth/login` 和两个第三方回调，**所有 `/api/*` 接口都要带** `Authorization: Bearer <token>`。
- token 来自 §2 的登录接口，身份是微信 openid。
- 所有数据按 openid 隔离：作品、口令、订单都只能看、改自己的；访问别人的资源一律返回 404（不要返回 403，避免暴露资源存在）。
- 管理后台 `/admin/*` 用的是另一套 token，**两套不能互相通用**（见管理后台 README「登录」）。

## 2. 接口总表

### 2.1 小程序调用的接口（`/api/*`）

| # | 方法 + 路径 | 用途 | 小程序什么时候调 | 详细契约 | 状态 |
|---|---|---|---|---|---|
| 1 | `POST /api/auth/login` | 微信登录，换 token | 第一次请求前；token 失效时 | 本文 §3 | 已有，按本文核对 |
| 2 | `GET /api/config` | 运行时配置（调试开关、广告位、代拼配置） | 每次冷启动一次 | 本文 §4 | **要改造**：加 `order` 字段 |
| 3 | `GET /api/templates` | 图案库 | 进创建页，会话内缓存 | 本文 §5 | 已有，按本文核对 |
| 4 | `GET /api/works` | 作品云同步：拉清单 | 首页显示时（60 秒冷却） | 本文 §6.2 | 已有，按本文核对 |
| 5 | `GET /api/works/:id` | 作品云同步：拉单个作品 | 清单里有比本地新的作品时 | 本文 §6.3 | 已有，按本文核对 |
| 6 | `PUT /api/works/:id` | 作品云同步：上传作品 | 作品修改后停手 20 秒 | 本文 §6.4 | 已有，按本文核对 |
| 7 | `DELETE /api/works/:id` | 作品云同步：删除 | 删除作品时 | 本文 §6.5 | 已有，按本文核对 |
| 8 | `POST /api/patterns` | 生成导入码 | 分享图纸时 | `import-code-api.md` §1 | 已有，按文档核对 |
| 9 | `GET /api/patterns/code/:code` | 凭导入码取图纸 | 输入口令时 | `import-code-api.md` §2 | **要改造**：payload 可带 `order` 标记（`order-api.md` §11.7） |
| 10 | `POST /api/patterns/code/:code/report` | 举报导入码 | 用户举报时 | `import-code-api.md` §3 | 已有，按文档核对 |
| 11 | `POST /api/orders` | 代拼下单 + 预支付 | 下单页点"去支付" | `order-api.md` §3.1、多图 §11.4 | **新增** |
| 12 | `GET /api/orders` | 我的订单列表 | 进"我的订单" | `order-api.md` §3.2 | **新增** |
| 13 | `GET /api/orders/:id` | 订单详情 | 打开订单详情；支付后轮询 | `order-api.md` §3.3 | **新增** |
| 14 | `POST /api/orders/:id/pay` | 继续支付 | 待支付订单点"继续支付" | `order-api.md` §3.4 | **新增** |
| 15 | `POST /api/orders/:id/cancel` | 取消未支付订单 | 点"取消订单" | `order-api.md` §3.5 | **新增** |
| 16 | `POST /api/orders/:id/confirm` | 确认收货 | 点"确认收货" | `order-api.md` §3.6 | **新增** |
| 17 | `GET /api/orders/:id/track` | 物流轨迹 | 打开有物流的快递单详情 | `order-api.md` §12.8 | **新增** |

### 2.2 第三方回调（第三方 → 后端，不带我们的 token）

| # | 方法 + 路径 | 谁调 | 详细契约 | 状态 |
|---|---|---|---|---|
| 18 | `POST /api/pay/notify` | 支付机构：支付结果（分账、退款结果如果也是回调，同域另开） | `order-api.md` §3.7、§6 | **新增** |
| 19 | `POST /api/logistics/notify` | 快递100：物流轨迹推送 | `order-api.md` §12.7 | **新增** |

回调必须验签，验签失败不落库；必须幂等（同一个通知来多次结果一样）；按第三方要求的格式应答，否则对方会一直重发。

### 2.3 管理后台调用的接口（`/admin/*`）

契约全部在 `pindou-admin/README.md`，那边开头有同样的总表。共 17 个：登录（+ 可选退出）、订单 9 个、商家 4 个、分账 2 个、代拼配置 2 个。**全部是新增**。

### 2.4 后端定时任务（不是接口，但要做）

| 任务 | 频率 | 详见 |
|---|---|---|
| 未支付订单 30 分钟超时取消 | 每分钟 | `order-api.md` §3.1 |
| 已发货 / 待自取 10 天自动完成并分账 | 每小时 | `order-api.md` §3.6 |
| 延时分账保底（快到期的已发货单强制完成，未发货的自动退款） | 每天 | `order-api.md` §6.4 |
| 分账失败重试 | 每 10 分钟 | `order-api.md` §6.4 |
| 物流订阅失败重试 | 每 5 分钟 | `order-api.md` §12.5 |
| 支付 / 分账 / 退款对账 | 每天 | `order-api.md` §6.6 |
| 订单完成 90 天后脱敏归档 | 每天 | `order-api.md` §9 |

## 3. 登录：`POST /api/auth/login`

小程序调 `wx.login` 拿到临时 `code`，传给后端换 token。**不需要带 token**。

请求：

```json
{ "code": "0a3xxxxxxxxxxxxxxxx" }
```

后端处理：

1. 用 `code` 调微信 `code2session`（需要小程序的 AppID `wx483d6f0b4bf6eaec` 和 AppSecret，AppSecret 放环境变量），拿到 `openid`（有 `unionid` 也存下）。
2. openid 不存在就**自动注册**一个用户，不需要用户填任何东西。
3. 生成 token 返回。`session_key` 只存服务端，**不下发**给小程序。

响应：

```json
{ "code": 0, "data": { "token": "…" } }
```

- 小程序只用 `data.token`，存在本地长期使用。
- token 建议有效期 30 天。过期后接口返回 401，小程序会自动重新 `wx.login` 再登录，再重试原请求一次，用户无感。
- `code` 无效或过期（微信返回错误）→ 返回 400，message「微信登录失败，请重试」。
- 同一时刻小程序只会发一个登录请求（客户端已做并发去重）。
- 限额：每 IP 60 次/小时（`abuse-protection.md`），因为登录时还没有 openid。

## 4. 运行时配置：`GET /api/config`

小程序每次冷启动拉一次，拉到后缓存在本地；拉不到就用上次的缓存。**后台改了配置，用户下次冷启动生效**。

完整的 `data`：

```json
{
  "debug": false,
  "adUnits": {
    "bannerHome": "", "bannerTpl": "", "rvChart": "", "rvExport": "", "interstitialDone": ""
  },
  "freeRowUses": 3,
  "order": {
    "enabled": true,
    "multi": false,
    "pickupArea": "杭州市内到店自取",
    "pickupHint": "具体取货地址在派单后的订单详情里显示，做好后商家会电话联系你约时间",
    "notice": "下单后 3-7 天内完成制作，节假日顺延",
    "finishImages": {},
    "pricing": null
  }
}
```

| 字段 | 说明 | 详见 |
|---|---|---|
| `debug` | 调试开关：拼豆 / 熨烫页出现「一键完成」按钮。**生产必须是 false** | — |
| `adUnits` | 流量主广告位表，空串 = 该位关闭 | `ad-config-api.md` |
| `freeRowUses` | 旧版客户端还在用，灰度期保留，旧版淘汰后删 | `ad-config-api.md` §4 |
| `order` | 代拼配置：总开关、多图订单开关、自取文案、报价覆盖（含运费分区、包裹参数） | `order-api.md` §2 |

- `order` 整个缺省时，小程序按内置默认值处理（代拼入口打开、多图订单关闭）。
- `order` 的值由管理后台「配置」页读写（`GET/PUT /admin/config/order`），保存后这里立刻按新值下发。
- 建议加缓存头（`Cache-Control: max-age=60`），这个接口很便宜。

## 5. 图案库：`GET /api/templates`

创建页「图案库」的数据。小程序在一次会话里只拉一次；拉失败时显示错误和「重试」按钮，**没有本地兜底数据**，所以这个接口必须稳定。

响应的 `data` **直接是数组**（不包一层对象）：

```json
[
  {
    "name": "小爱心",
    "rows": [
      "..XX..XX..",
      ".XPPXXPPX.",
      "XPPPPPPPPX",
      ".XPPPPPPX.",
      "..XPPPPX..",
      "...XPPX...",
      "....XX...."
    ],
    "colors": { "X": "#1A1A1A", "P": "#F29FB5" }
  }
]
```

| 字段 | 说明 |
|---|---|
| `name` | 图案名，显示在列表里，选中后也是新作品的默认名（≤20 字） |
| `rows` | 字符画，每个字符是一颗豆，**每行长度必须相同**。`.` 表示这格不放豆 |
| `colors` | 字符 → 颜色（`#RRGGBB`）。小程序会把每个颜色换成最接近的 MARD 色号；没配颜色的字符按黑色处理 |

- 数组顺序就是列表显示顺序。
- 建议每个图案不超过 64×64；图案总数不超过 100 个（小程序会逐个生成缩略图）。
- 后端入库时就校验好：`rows` 非空、每行等长、只有 `colors` 里有的字符和 `.`、颜色格式正确。格式不对的图案会让小程序渲染出错。
- 很少变，建议加缓存头或放 CDN。

## 6. 作品云同步：`/api/works`

用户的作品存在手机本地，同时同步到云端，换手机、重装后能拉回来。规则是**按修改时间，后写入的赢**；删除用"墓碑"传播到其他设备。

### 6.1 数据怎么存

每个作品一行，按 `(openid, clientId)` 唯一：

| 字段 | 说明 |
|---|---|
| `clientId` | 作品在小程序里的 id（小程序生成的字符串），**URL 里的 `:id` 就是它** |
| `name, w, h, total, placedN` | 作品名、尺寸、总豆数、已拼豆数（列表摘要用） |
| `completed, ironDone, free, completedAt` | 是否拼完、是否熨烫完、是否自由画布、完成时间 |
| `clientCreatedAt, clientUpdatedAt` | 小程序记录的创建 / 修改时间（毫秒）。**合并冲突只看 `clientUpdatedAt`** |
| `payload` | 完整作品 JSON 字符串（格子、进度、色板、烫法等全部数据）。**后端原样存取，不需要解析** |
| `updatedAt` | 服务端写入时间（后端自己用，小程序不依赖） |

另有墓碑表：`(openid, clientId, deletedAt)`，记录被删除的作品。建议保留 90 天，过期清理。

### 6.2 拉清单：`GET /api/works`

```json
{
  "works": [
    { "clientId": "m1abc2de", "name": "小熊", "w": 30, "h": 30, "total": 812, "placedN": 400,
      "completed": false, "ironDone": false, "free": false, "completedAt": 0,
      "clientCreatedAt": 1790000000000, "clientUpdatedAt": 1790700000000 }
  ],
  "deletedIds": ["m0zzz9yx"]
}
```

- `works` **不带 payload**（只要摘要），小程序比对 `clientUpdatedAt` 后，只拉需要的作品。
- `deletedIds` 是墓碑表里这个用户的 `clientId` 列表。小程序会删掉本地对应的作品（本地有还没上传的修改除外）。

### 6.3 拉单个：`GET /api/works/:id`

`data` 是作品完整信息，**一定要带 `payload`**：

```json
{ "clientId": "m1abc2de", "name": "小熊", "…": "同 6.2 的字段", "payload": "{\"id\":\"m1abc2de\",\"w\":30,…}" }
```

- 小程序直接把 `payload` 解析后覆盖本地作品。
- 不存在返回 404（小程序会跳过这一个，不影响其他）。

### 6.4 上传：`PUT /api/works/:id`

请求体：

```json
{
  "name": "小熊", "w": 30, "h": 30, "total": 812, "placedN": 400,
  "completed": false, "ironDone": false, "free": false, "completedAt": 0,
  "clientCreatedAt": 1790000000000, "clientUpdatedAt": 1790700000000,
  "payload": "{\"id\":\"m1abc2de\",…}"
}
```

后端处理：

1. **校验**：`w, h ≤ 256`；`payload ≤ 600KB`；这个用户云端作品数 ≤ 300（新建时才查）。超限返回 400 和中文 message。
2. **冲突判断**：云端已有这个作品，且云端的 `clientUpdatedAt` **大于**请求里的 `clientUpdatedAt`（别的设备写过更新的版本）→ **不覆盖**，返回：
   ```json
   { "stale": true, "work": { "…": "云端的完整作品，同 6.3，带 payload" } }
   ```
   小程序会用云端版本覆盖本地。
3. 否则**新建或覆盖**，并**删掉这个作品的墓碑**（用户在一台设备删了、另一台设备又改了，以修改为准，作品复活）。返回：
   ```json
   { "stale": false }
   ```

- 作品修改后，小程序停手 20 秒才上传一次；失败的会进本地重试队列，下次同步补传，不会丢。
- 这是服务器最大的写入量，限额见 `abuse-protection.md`（60 次/小时、600 次/日）。

### 6.5 删除：`DELETE /api/works/:id`

- 删除作品，并写一条墓碑。
- **必须幂等：作品不存在也返回成功**（`code: 0`）。小程序只有在收到成功后才会把这条删除从重试队列里移除；如果不存在返回 404，这条删除会永远重试。
- 响应 `data` 可以为空对象。

## 7. 导入码、代拼订单、管理后台

这三块已有完整文档，这里只提示这次新增的改动：

- **导入码**（`import-code-api.md`）：派单时后端生成的导入码，payload 里要多带一个 `order` 标记（订单号后 4 位、第几张、共几张、烫法），小程序导入后会把作品名改成「0140-1 小熊」。见 `order-api.md` §11.7。
- **代拼订单**（`order-api.md`）：全新。**建议先读 §0～§10 把单图订单跑通，再做 §11 多图订单、§12 物流查询**。§11、§12 开头都有逐条的接入清单和验收用例。
- **管理后台**（`pindou-admin/README.md`）：全新，前端已做好，有假数据模式可以对照效果。

## 8. 建议的对接顺序

1. **核对已有接口**：登录、配置、模板、作品同步、导入码，按本文和对应文档逐条核对字段和边界情况（特别是 §6.4 的冲突判断和 §6.5 的幂等删除）。
2. **单图代拼订单**：`order-api.md` §3、§4、§5，支付先用 `PAY_MOCK` 模拟（§7.1），整条流程先跑通。
3. **管理后台**：登录 → 订单列表和详情 → 派单（含导入码）→ 接单 / 发货 / 完成 / 退款 → 商家 → 分账 → 配置。前端把 `.env.development` 的 `VITE_USE_MOCK` 改成 false 就能连真接口。
4. **接真实支付和分账**：支付机构签约后，按 `order-api.md` §6、§7 接入，关掉 `PAY_MOCK`。
5. **物流查询**：`order-api.md` §12，开发时先用 `LOGI_MOCK` 模拟推送。
6. **多图订单**：`order-api.md` §11，做完后在管理后台「配置」页打开「多图订单」。

## 9. 上线检查清单

| # | 检查项 |
|---|---|
| 1 | 生产域名是 HTTPS，已加入小程序后台 request 合法域名 |
| 2 | 小程序 `utils/env.js` 的 `ENV` 改成 `'prod'`，`HOSTS.prod` 是真实域名 |
| 3 | `/api/config` 的 `debug` 是 false |
| 4 | 服务端 `PAY_MOCK`、`LOGI_MOCK` 都是关的 |
| 5 | AppSecret、支付机构密钥、快递100 key、管理后台密码都在环境变量里，不在代码和 git 里 |
| 6 | 支付回调、物流回调地址能从公网访问，验签已打开 |
| 7 | `abuse-protection.md` 第一批的限额和熔断已上线 |
| 8 | 管理后台用的是正式打包（`VITE_USE_MOCK=false`），登录限次数、HTTPS 已生效 |
| 9 | 小程序《用户隐私保护指引》写了：收货地址、手机号、订单信息、剪贴板，以及物流查询时向快递100 提供手机号和单号 |
| 10 | 各定时任务（§2.4）已启动 |
