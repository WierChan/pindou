# 拼豆便利店 App

`App` 分支保留原微信小程序源码，同时在 `src/` 中提供一套基于 uni-app Vue 3 / Vite 的 App 源码。该源码共用业务逻辑，可分别构建 Android 和 iOS。

## 本地校验

```bash
npm install
npm run dev:h5
npm run build:h5
npm run build:app
```

`build:app` 生成 App 公共资源。最终 APK/AAB 和 IPA 需要使用 HBuilderX 打开本仓库，在“发行”中选择 Android 或 iOS，并使用对应平台的签名资料打包。

## 上线前必须配置

1. 在 HBuilderX 中为 `src/manifest.json` 申请或填写 DCloud AppID。
2. 在微信开放平台创建移动应用，准备移动应用 AppID。Android 需配置应用包名和签名；iOS 需配置 Bundle ID 和 Universal Link。
3. 在 `src/manifest.json` 的 App 模块 / 微信支付 SDK 配置中填写移动应用 AppID 和 Universal Link。移动应用 AppID 与微信小程序 AppID 不是同一个配置。
4. 后端生产环境配置 `WX_APP_APP_ID=<微信开放平台移动应用AppID>`，并设置 `PINDOU_PAY_MOCK=false` 后重新部署。
5. Android 云打包时配置包名、签名证书和证书密码；iOS 云打包时配置 Bundle ID、发布证书和 provisioning profile。

不要把签名文件、证书密码、微信密钥或 Universal Link 私钥提交到 Git。

## 与后端的配套改动

- App 启动后调用 `POST /api/auth/app-login`，用本机安装标识换取登录令牌；后端只保存标识的 SHA-256 摘要。
- 下单和订单接口继续复用现有 `/api/orders` 系列接口。
- App 发起支付时，后端自动使用微信 App 支付接口，并返回 uni-app 所需的 `provider` 与 `orderInfo`；微信小程序支付流程保持不变。
- App 不使用微信小程序的 `chooseAddress`，配送地址由用户在 App 页面手动填写。

后端新接口请求示例：

```json
{
  "installationId": "app-installation-id"
}
```

成功响应沿用现有登录响应结构，`data` 中返回 `token`、`userId` 和 `newUser`。
