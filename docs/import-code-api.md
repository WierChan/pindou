# 导入码接口契约（pindou-server 实现）

小程序端已完成（`utils/importcode.js`），后端按此文档实现三个接口即可联调。
统一响应 `{code, message, data}`（code 0 成功），鉴权走现有 Bearer token，与 /api/works 一致。

## 码的规则

- 8 位随机字符，字符集 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`（31 个，去掉 0/O/1/I/L 易混）。
  空间 31^8 ≈ 8500 亿，不可枚举；生成时碰撞重试。
- 展示层格式 `PD-XXXX-XXXX` 由客户端处理，服务端只存/只认 8 位裸码。
- 客户端已做输入清洗（大写化、去符号、剥 PD 前缀、正则提取）。

## 1. 生成导入码

`POST /api/patterns`（需鉴权）

请求体：

| 字段 | 类型 | 说明 |
|---|---|---|
| clientWorkId | string | 作品在客户端的 id，用于幂等 |
| name | string | 作品名（≤20 字），**须过 msgSecCheck** |
| w, h | int | 图纸尺寸（1~256，服务端校验） |
| total | int | 豆子数（仅统计展示用） |
| payload | string | JSON 字符串：`{w, h, cells, palette?, name}`，≤ 256KB |

行为：

- **幂等**：同一 (userId, clientWorkId) 重复调用返回已有码，不重复建档。
- 建档字段建议：id、ownerId、code(唯一索引)、clientWorkId、name、w、h、total、payload、
  status(`active`/`disabled`)、importCount、createdAt。
- 内容安全：name 过 msgSecCheck；有余力可把 payload 渲染成缩略图过 mediaCheckAsync（v1 可先不做）。
- 限频建议：单用户 20 次/天。

响应 `data`：`{ code: "3K7F9QWW" }`

## 2. 凭码取图纸

`GET /api/patterns/code/:code`（需鉴权）

- 命中且 `active`：`data = { name, w, h, total, payload }`（payload 原样返回，客户端负责解析校验）。
  顺手 `importCount += 1`。
- 不存在：`code: 404, message: "口令不存在"`。
- 已作废（举报下架/作者删除）：`code: 410, message: "该图纸已下架"`。
- 限频建议：单用户 60 次/小时（防扫码枚举，虽然空间上扫不动）。

## 3. 举报

`POST /api/patterns/code/:code/report`（需鉴权）

请求体：`{ reason: string }`。落库 (patternId, reporterId, reason, createdAt)，同一用户对同一图纸只记一次。
达到阈值（如 3 个独立用户）自动置 `disabled` 待人工复核；后台可手动 disable/恢复。
响应 `data: {}`。

## 合规要点（对应小程序端已有的配套）

- 生成前客户端已弹「请确认这是你原创或有权分享的图纸」确认框（上传者责任声明）；
- 导入方在配置页有「举报」入口（仅口令导入的图纸显示）；
- 码可作废（status=disabled → 410），这是版权投诉的处置抓手；
- 无公开列表/检索/推荐接口——**不要加“热门图纸”类接口**，那会把产品性质变成 UGC 公开平台（合规等级完全不同）。
