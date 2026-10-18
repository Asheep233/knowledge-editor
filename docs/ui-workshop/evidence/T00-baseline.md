# T00 基线证据（2026-10-19）

## 环境

```text
OS: Windows 11（桌面/WebView2/Tauri 可用）+ WSL2 Ubuntu（开发/测试）
Node: v24.19.0（CI 使用 Node 22，后续 npm ci 一致性待复核）
Python: 3.14.4（WSL）；Windows 侧 CI 对齐 venv 为 Python 3.10
Rust/cargo: 1.97.1（F:\Work\Dev\cargo）
Tauri: desktop/src-tauri（v2），WebView2 本机可用
仓库分支: feat/ui-workshop（起点 v1.2.18 master 4c71233；overlay 提交 e54d37b）
```

## 命令与结果

| 命令 | 目录 | 结果 | 日志 |
| --- | --- | --- | --- |
| `npx tsc -b --noEmit` | frontend/ | exit 0，0 错 | 会话输出 |
| `npx vitest run --maxWorkers=2` | frontend/ | exit 0：**108 files / 1617 passed + 1 skipped** | /tmp/ke-workshop-baseline-vitest.log（本机临时，结论如上） |
| `python3 -m pytest backend/tests -q` | 仓库根 | exit 0（全绿） | /tmp/ke-workshop-baseline-pytest.log（同上） |
| `python3 tools/verify_package.py` | 任务包目录 | PASS：20 payload files 校验通过 | 任务包 PACK_VALIDATION.md |
| `git apply --check baseline/local-changes.patch` | 原 v1.2.18 仓库 | exit 0（可应用；README 手合并 3 行） | 会话输出 |

## 与参考报告的差异说明

- 任务包参考的轻量外观验证记录（v1.2.16：1590 tests / 105 files）不是本基线结果；
  本基线（v1.2.18 + overlay）重跑为 1617 tests / 108 files，差异来自 v1.2.17/18 修复与新增测试。
- 历史「3 个 Linux 超长文件名失败」在当前基线未复现（v1.2.17 已修 CI 可移植性）。

## 尚未完成的 T00 子项

- 256/512 KB 文档、公式/附件样本、两 shell 预热参数化测量脚本与数据。
- 独立测试用户数据目录（KE_WORKSPACE / KE_APP_CONFIG / WEBVIEW2 user data）固化脚本。
- Windows 实机基线（启动/切换/内存/PDF）测量脚本与产物目录约定。
