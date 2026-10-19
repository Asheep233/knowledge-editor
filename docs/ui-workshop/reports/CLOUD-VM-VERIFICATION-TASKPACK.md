# 云端 Windows VM 实机验收任务包（v2，Linux 预检后修正版）

> 用途：在**专用 Windows VM** 执行 T27 I 门禁（U1–U6）+ 安装态工坊冒烟（B），回传证据后由 Lead 登记。
> **当前状态**：Linux 预检 PASS（脚本回归 39/39、SHA256 64/64、完整 sources.bundle）；**Windows 执行仍未发生**，
> I 门禁 NOT_RUN/BLOCKED（见 `evidence/P5-T26-T27-I-gate-preflight.md`）——**不得当作验收通过**。

## 一键包

- 交接目录：`docs/ui-workshop/reports/cloud-handoff/`
- 生成/重新生成 zip：`python3 docs/ui-workshop/tools/build_cloud_handoff.py`
- 产物：`docs/ui-workshop/reports/cloud-vm-taskpack.zip`（含完整 `sources.bundle`，无需 GitHub clone）

## 执行方（Codex）最短步骤

1. 专用 **Windows 10/11 x64 VM**（先快照；管理员；自建数据；不 push/不 Release）。
2. 安装 Git、**PowerShell 7（pwsh）**、Node.js **24**、Python 3.10+、Rust stable x86_64-pc-windows-msvc、
   VS Build Tools（C++ 桌面）、WebView2 Runtime；网络可访问 npm/pip/crates/NSIS 下载。
3. 解压到 `C:\ke-cloud`，按 `cloud-handoff/README.md`：
   - `git clone --branch feat/ui-workshop .\sources.bundle .\repo`
   - `pwsh ... scripts/cloud_build.ps1 -Repo C:\ke-cloud\repo` → 基线/候选默认/候选 workshop 安装包
   - `python scripts/cloud_t27_gate.py ...`（先 dry-run；再 `KE_CLOUD_VM=1` + `--execute` 交互终端；U3 人工补证）
   - 安装 workshop-enabled 包 → `scripts/cloud_verify_installed.py --expect-entry yes`；默认包 `--expect-entry no`
4. 回传 `C:\ke-cloud\windows-evidence\` zip：`T27-I-results.json`、两份 `cloud-workshop-verify*.json`、
   U1–U6 截图/logs、`P5-T26-T27-I-gate.md`。

## 边界与红线

- 只在快照 VM；测试数据自建；不得使用真实笔记/真实用户目录；
- 不 push、不创建 Release；失败保留 VM 现状与日志，任何未执行项如实 NOT_RUN；
- 安装包无 Authenticode 签名（P4-6 已知）→ 证据注明，不作为失败；
- U3/U6 的人工语义不能由脚本自动签发 PASS，必须有截图/文件/日志。

## 拿到回传后 Lead 做什么

登记 `T27-I-results.json` 到矩阵与 W03/W08、更新 `milestone-assessment`/`FINAL-DELIVERY-STATUS`，
复评里程碑是否可前进（还需人工 IME/DPI 结果 + 主理人授权发布）。
