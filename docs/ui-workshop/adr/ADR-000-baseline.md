# ADR-000 实施基线选择：v1.2.18 + overlay 移植

- 决策 ID / 日期：ADR-000 / 2026-10-19
- 待解决问题：任务包基线为 v1.2.16（9dd19e7），但当前仓库已发布 v1.2.18（4c71233，领先 18 提交）；overlay 文件不在当前仓库。
- 实际证据：
  - `python tools/verify_package.py --repo .` → `MIXED_OR_DIFFERENT_BASE`（列出缺失的 24 个 overlay 文件）；
  - 任务包补丁对当前 HEAD `git apply --check` exit 0；仅 README/App.tsx/EditorArea.tsx 与 v1.2.16 不同，补丁 hunk 上下文仍匹配；
  - 在当前分支应用后：tsc 0；appearance/settings 66 tests 绿；前端全量 108 files / 1617 passed + 1 skipped；后端 pytest 绿。
- 候选方案：
  - A（采纳）：基于当前 v1.2.18 开 `feat/ui-workshop` 分支，移植 overlay 并适配 v1.2.17/18 变更。
  - B（拒）：v1.2.16 干净基线 + 原 patch；证据链更接近参考报告，但工坊分支落后已发布版本，v1.2.17/18 修复需回合并或双线维护。
- 选择与理由：采纳 A，主理人 2026-10-19 拍板。保留已发布修复（含导出回归修复），工坊面向最新代码；参考报告数字仅作参考，所有验收在本基线重跑。
- 被拒方案与限制：B 会造成工坊与正式发行版长期分叉；A 的代价是包基线差异需在 feature 矩阵/ADR 中持续记录。
- 是否改变产品边界：否（仍为常驻官方编辑面 + 独立周边 UI 包）。
- 回滚方式：分支可整体放弃；overlay 移植为 e54d37b，可单独 revert。
- 进入下一阶段门槛：T00/T01 完成后进入 P0 原型；S1/S2 Windows 证据缺失时 T07 保持 blocked。
