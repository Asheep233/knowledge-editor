# 既有失败与基线差异台账（T01）

> 规则：只登记**与基线一致的既有失败**；任何保存/保真/恢复相关新增失败直接阻止对应 gate。
> 每条记录：测试/场景、复现命令、基线归属、当前基线结果、traceback/证据、处理决定。

## 当前基线（2026-10-19，分支 feat/ui-workshop @ overlay e54d37b / T00 提交）

| ID | 测试/场景 | 复现命令 | 基线归属 | 本轮结果 | 处理 |
| --- | --- | --- | --- | --- | --- |
| （空） | 无新增失败 | `npx vitest run --maxWorkers=2` / `pytest backend/tests -q` | — | 前端 108 files/1617 passed+1 skipped；后端 exit 0 | — |

## 历史记录（来自任务包/前序报告，未在本基线复现）

| ID | 来源 | 描述 | 当前基线 | 说明 |
| --- | --- | --- | --- | --- |
| H-01 | BASELINE.md（v1.2.16 报告） | 3 个 Linux 超长文件名失败：`test_move_fixes_verify.py::test_f9c_sanitizes_illegal_target_name` | **未复现**（全绿） | v1.2.17 已修 CI 可移植性（quiet FS probes / OSError 收口），见 CHANGELOG_DEV |
| H-02 | custom-appearance-v1-validation.md | 初次并行前端全量运行有 1 次解析性能门槛失败 + ProseMirror teardown 定时器异常 | **未复现** | v1.2.17 增加 test-setup 两层防护（Editor.destroy forceFlush + 每例清短定时器） |
| H-03 | BASELINE.md | 轻量外观参考实现曾 105 files/1590 tests | 本基线 108 files/1617 tests | 差异来自 v1.2.17/18 修复与新增测试；参考数字不作为本基线结果 |
