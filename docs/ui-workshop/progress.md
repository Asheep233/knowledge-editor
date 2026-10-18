# UI 创意工坊实施进度与证据台账

> 任务包：`astranota-ui-workshop-taskpack-2026-10-18`（sha256 zip `09969e62…52fa`，自校验 PASS）。
> 状态词：`todo / in_progress / passed / failed / blocked / deferred`；验收结果另用 `PASS / FAIL / BLOCKED / NOT_RUN / NOT_APPLICABLE`。

## 当前接手点

```text
日期/时区：2026-10-19 01:00 (Asia/Shanghai)
仓库/分支：knowledge-editor / feat/ui-workshop（基于 master v1.2.18）
HEAD（分支起点）：4c71233（v1.2.18）；overlay 提交：e54d37b
overlay patch SHA-256 / 状态：cfaebc7ac59e42d91ca23dc1c05e17f94d3f38b596aac415ad80a6c1d75eaa92 / APPLIED（README 手合并 3 行）
未提交改动摘要：无
基线差异：任务包基线 v1.2.16（9dd19e7）→ 实施基线 v1.2.18（4c71233，领先 18 提交）；
  verify_package 对原仓库报告 MIXED_OR_DIFFERENT_BASE；补丁对当前 HEAD 自动应用通过（README 除外）。
  v1.2.17（审查修复）/v1.2.18（导出回归修复）全部保留；参考报告中的 v1.2.16 数字仅作参考，
  所有验收在本基线上重跑。
OS / Node / Python / Rust / Tauri / WebView2：
  Windows 11 + WSL2（Ubuntu）；Node 24.19.0（CI 用 22，需在 lockfile/npm ci 上复核）；Python 3.14.4；
  cargo 1.97.1；Tauri v2 + WebView2 已在本机完成 v1.2.17/18 真机/安装包验收（W/I 证据可执行）。
Windows 实机可用性：可用（本机；通过 CDP/安装包实测过 v1.2.17、v1.2.18）。
本轮基线命令与结果（2026-10-19）：
  - frontend: npx tsc -b --noEmit → 0 错
  - frontend: npx vitest run --maxWorkers=2 → 108 files / 1617 passed + 1 skipped，exit 0
  - backend:  python3 -m pytest backend/tests -q → exit 0（全绿；数量见 evidence/T00-baseline.md）
已知失败归属：无新增；历史 v1.2.16 报告中「3 个 Linux 超长文件名失败」在当前基线未复现
  （参见 CHANGELOG_DEV v1.2.17：已随 CI 可移植性修复收敛）。
测试数据目录：临时目录/沙箱（C:\ke-tmp\ke-sandbox 等）；禁止真实笔记。
当前里程碑状态：P0 进行中（T00 in_progress）
```

## 任务进度

| Task ID | 状态 | 实现提交/文件 | 验收 ID 与证据 | 剩余问题 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| T00 | in_progress | e54d37b（overlay）、scripts/ui-workshop/{sandbox-env,collect-env,bench}.sh/ps1、docs/ui-workshop/fixtures/、tools/make_fixtures.py | evidence/T00-baseline.md、evidence/T00-measurements.md、evidence/env-*.txt | 两 shell 预热/内存/切换、Windows 侧启动与 PDF 基线尚未采集 | Windows 测量脚本 + 数据采集 |
| T01 | in_progress | tools/build_feature_baseline.py、feature-baseline.csv（130 行种子）、fixtures/、known-failures.md | CSV 生成自源码（shortcuts/API/toolbar/settings/menu/验收域）；officialBaselineResult 均 NOT_RUN | 需逐项真实入口核对并填结果（130 行），补 packA/B 入口列 | 逐域核对 F01–F16 → 填 result；再谈 W01+ |
| T02–T06 | todo | | | | P0 五原型（S1 运行域/S2 编辑面/S3 保存/S4 打印/S5 事务） |
| T07 | todo | | | | 路线 ADR |
| T08–T28 | todo | | | | 按 TASKS.md 依赖推进 |

## 单项验收记录

（格式见任务包 REPORT_TEMPLATE.md；随任务推进追加）

## 路线 ADR

见 `docs/ui-workshop/adr/`；已记录 ADR-000（实施基线选择）。

## 本轮交付（2026-10-19，T00/T01 种子）

- `scripts/ui-workshop/sandbox-env.sh|.ps1`：隔离测试数据目录（KE_WORKSPACE/KE_APP_CONFIG/LEGACY/WebView2 user data）
- `scripts/ui-workshop/collect-env.sh` → `evidence/env-*.txt`：环境快照
- `scripts/ui-workshop/bench.sh` → `evidence/T00-measurements.md`：
  tsc 19.7s / build 21.9s（dist-build 2,830,583 B）/ backend health 805ms（隔离目录）
- `docs/ui-workshop/tools/make_fixtures.py` → `fixtures/`：basic.md、large-256kb.md、
  large-512kb.md、附件占位、fixtures-manifest.json（5 files，确定性可复现）
- `docs/ui-workshop/tools/build_feature_baseline.py` → `feature-baseline.csv`：
  130 行种子（快捷键动作 42 / API 路由 / 工具栏 / 设置 / 原生菜单 / 导出与对话框 / F01–F16+W 验收域）
- `docs/ui-workshop/known-failures.md`：当前无新增失败；历史 3 条登记且本基线未复现
