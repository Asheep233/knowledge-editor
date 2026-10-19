# P5-T26 W04 证据：外部开发者路径（脚手架 → 外部签名 → 产品安装 → 启用 guest）— W 7/7 PASS

- 日期：2026-10-19 · 平台：Windows 11 + WebView2（隔离产品构建）
- 工具：`tools/create_pack.mjs`（脚手架/自检）、`tools/sign_pack.mjs`（外部签名）、
  `tools/run_t26_w04_probe.py`（真实产品路径）；原始结果：`evidence/T26-W04-sdk-results.json`
- 证据类型：**B（脚手架自检 5/5）+ W（真实产品 7/7）**

## 实测结果：W 7/7 PASS

| 检查 | 结果 |
| --- | --- |
| W-T26-W04-1 外部脚手架生成包（manifest/index/README） | PASS |
| W-T26-W04-2 脚手架 manifest 合法（id/apiVersion/entry/assets hash） | PASS |
| W-T26-W04-3 外部签名成功（不依赖宿主源码修改） | PASS |
| **W-T26-W04-4 产品安装外部签名包（signature valid）** | PASS |
| **W-T26-W04-5 外部包 guest 启用 active（无需宿主源码修改）** | PASS |
| W-T26-W04-6 会话状态 active / 能力子集（ui.shell） | PASS |
| W-T26-W04-7 主进程存活（用户 App 未运行 → N/A） | PASS |

## 外部开发者流程（已脚本化/文档化）

```bash
node docs/ui-workshop/tools/create_pack.mjs --dir my-pack --id com.demo.hello --name "Hello" \
     --version 1.0.0 --capability ui.shell [--with-css]
node docs/ui-workshop/tools/sign_pack.mjs --generate-key release.pem
node docs/ui-workshop/tools/sign_pack.mjs --dir my-pack --key release.pem --keyid k1 --write
# 工坊 UI：选择包并预览 / 选择 ZIP 离线包 → 授予 trusted → 启用 guest
```

- 脚手架自检：`node tools/create_pack.mjs --self-test` **5/5 PASS**
  （manifest 合法/hash 一致/非法 id 与能力拒绝）；结果 `evidence/W04-scaffold-selftest.json`；
- 约束已写入生成的 README：命令名必须小写（`article.set-title` 等）、宿主公钥经
  `KE_WORKSHOP_PUBKEYS` 配置、离线 zip 可选；
- **不需要修改宿主源码** 即可生成→签名→安装→启用（本轮 W 验证）。

## 未完成（W04 剩余）

- **guest SDK 以发布形态分发**（当前外部包需自行内联/打包 SDK 代码；无 npm 包/tgz/模板仓库）；
- 外部包开发文档站、示例集合、调试工具（开发者面板/协议日志）；
- 签名工具的分发与文档（当前位于宿主仓库 `tools/`）。
