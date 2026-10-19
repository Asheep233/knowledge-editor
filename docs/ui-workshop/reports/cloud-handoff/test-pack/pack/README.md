# Cloud VM Smoke (UI 工坊包)

- id: `com.astranota.cloud.smoke`
- version: `1.0.0`
- capabilities: ui.shell

## 流程（无需修改宿主源码）

1. 生成签名密钥：`node docs/ui-workshop/tools/sign_pack.mjs --generate-key release.pem`
2. 签名：`node docs/ui-workshop/tools/sign_pack.mjs --dir . --key release.pem --keyid k1 --write`
3. 打 zip（可选）：`zip -r ../com.astranota.cloud.smoke-1.0.0.zip .`
4. 在工坊 UI「选择包并预览 / 选择 ZIP 离线包」安装；授予 trusted 后启用 guest。
5. 宿主公钥配置：环境变量 `KE_WORKSHOP_PUBKEYS`（生产由构建配置提供）。

> 命令名（manifest.commands）必须为小写：例如 `article.set-title`。
