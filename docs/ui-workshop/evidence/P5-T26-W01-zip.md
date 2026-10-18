# P5-T26 W01 证据：ZIP 离线包 staging/安装 + 解压安全 — 产品 W 8/8 PASS

- 日期：2026-10-19 · 平台：Windows 11 + WebView2（隔离测试构建 com.astranota.uiws.e2e）
- 工具：`tools/run_t26_zip_probe.py`（真实产品命令 + Python 构造签名包 zip/恶意 zip；
  隔离 APPDATA/工作区/公钥信任根）
- 原始结果：`evidence/T26-W01-zip-results.json` · 证据类型：**U（Rust/TS 单测）+ W（真实产品）**

## 实测结果：8/8 PASS

| 检查 | 结果 |
| --- | --- |
| W-T26-W01-1 产品启动 + IPC 就绪 | PASS |
| **W-T26-W01-2 有效 ZIP staging 扫描成功（签名 valid + token）** | PASS |
| **W-T26-W01-3 staged 安装成功（active=1.0.0）** | PASS |
| W-T26-W01-4 安装列表可见 | PASS |
| **W-T26-W01-5 zip-slip 条目 → staging 拒绝** | PASS（`E_ZIP: 非法条目路径`） |
| **W-T26-W01-6 非 staging 路径 → E_STAGED 拒绝** | PASS |
| W-T26-W01-7 主进程存活 | PASS |
| W-T26-W01-8 用户实例未受影响 | PASS |

## 实现要点（W01 解压安全）

- 产品 Rust 新命令：`workshop_pack_stage_zip`（安全解压到 `.staging-zip-*` + 扫描预览）、
  `workshop_pack_install_staged`（仅允许 staging 目录 + 原子安装后清理）、`workshop_pack_abort_staged`；
- 保护：条目数 ≤1000、单文件 ≤10MB、解压总量 ≤64MB、zip-slip/绝对路径拒绝、符号链接拒绝、
  必须含 `manifest.json`、staging 路径白名单（必须在 app data 内且前缀 `.staging-zip-`）；
- 前端：`tauriPackAdapter.stageFromZip()`（dialog zip 过滤 → 预览）、`confirmInstall` 对 staging
  token 路由 `install_staged`、`cancelPreview` 清理 staging；工坊面板「选择 ZIP 离线包…」按钮；
- 单测：Rust cargo **50 passed**（zip valid/zip-slip/条目数/缺 manifest/staging guard）；
  前端 adapter/panel 测试通过。

## 剩余（W01/W08 I 门禁）

- 真实安装/覆盖升级 I 证据未执行（`reports/T27-installer-upgrade-plan.md`，需专用环境/授权）；
- ZIP 炸弹的压缩比异常/嵌套 zip 等更深攻击面未覆盖（后续硬化）。
