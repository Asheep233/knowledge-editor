# P4-T25 证据：平台验证矩阵（自动生成，18 行）

- 日期：2026-10-19 · 工具：`docs/ui-workshop/tools/build_validation_matrix.py`（可重跑）
- 产出：`docs/ui-workshop/validation-matrix.csv`（evidence/task/kind/platform/result/passed/total/reproduce）
- 证据类型：**汇总证据（矩阵由已有 W/A/U 证据 JSON 与回归基线生成，不产生新结论）**

## 矩阵内容（18 行）

| 类别 | 行数 | 说明 |
| --- | --- | --- |
| Windows/WebView2 W 探针 | 9 | S1b/S2/S4/T11/T13/T15/T18/T19/T21（含 2 项已知 S1 发现） |
| A（真实后端/Core） | 2 | T10 e2e 19/19、T13 Core 门禁 21/21 |
| A/U 双平台（pytest） | 2 | S3 10/10、S5 10/10（Linux+Windows） |
| 代码回归基线 | 3 | frontend 1747+1 skipped、backend 846 collected、产品 cargo 34 passed |
| 构建基线 | 1 | 原型壳 cargo build release |

已知说明：
- `P0-S1-probe-results.json` 的 2 项失败是**已记录的发现约束**（iframe 继承 Tauri globals、同源 iframe 可
  调用 app 命令），结论已进 ADR-001；矩阵标注为 `PASS_WITH_FINDINGS(2)`，不作为回归失败。
- `kind` 明确区分 W（Windows/WebView2 实机）、A（真实后端/API）、U（单测/happy-dom）、B（构建）；
  **不把 U/A 证据冒充 W**。

## 结论

- T25 的平台验证矩阵已可**自动生成并审计**：任何证据 JSON 更新/新增后重跑脚本即可反映；
  矩阵与 HANDOVER 的 W 证据索引、progress 台账一致。
- 尚未完成（T25 继续）：加入产品端到端交互 W（T21/T23/T26）与真实 OS IME/多 DPI 列；矩阵可视化
  （工坊/文档表格）与 CI 门禁化（矩阵中出现 FAIL 即阻断）；随 T26 Windows 认证补齐平台/版本列。
