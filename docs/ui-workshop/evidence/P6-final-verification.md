# P6 证据：会话末段全量回归 + W 门禁复跑（2026-10-19）

- 环境：WSL Ubuntu（前端/后端）+ Windows 11 + WebView2 155（产品壳/原型探针）
- 目的：在多次产品修复（PrintRenderState manage、activate 幂等、打印 ready 握手等）后做一次
  **全量回归 + 全部 W 探针复跑**，确认无回归；数字用于 HANDOVER/总结基线。

## 结果

| 套件 | 结果 |
| --- | --- |
| frontend `tsc -b --noEmit` | 0 错 |
| frontend `vitest --maxWorkers=2` | **130 files / 1796 passed + 1 skipped（exit 0）** |
| backend `pytest backend/tests` | **847 collected / exit 0**（WSL；新增 frontmatter merge 测试） |
| 产品 `cargo test --release` | **39 passed**（+ release 构建成功） |
| 原型 W 探针一键门禁（13 探针） | **13/13 PASS**（`run_all_w_probes.py --check`） |
| 验证矩阵 | **35 行**（W/A/U/B 分层），`--check` PASS |

## 本轮修掉的探针稳定性缺陷

- **T20 runner boot 检测竞态**：`host-js: boot` 事件可能晚于 recover 状态落盘，单次读取导致
  W-T20-5 偶发 FAIL（本次全量门禁复跑暴露）→ 改为最长 3s 轮询等待；T20 恢复 9/9，
  全量 W 门禁恢复 **13/13 PASS**。
- 说明：该缺陷在 runner 判读层，不影响产品行为；已记录避免以后误判。

## 结论

- 前端/后端/产品 Rust/原型 W 门禁全部绿；无已知回归；
- 真实产品壳 T26 A1–A6 证据仍有效（本轮未改动相关实现，除既有修复）；A7/A8/IME/多 DPI/
  安装包升级仍未完成，T26 未最终认证。

## 追加回归（A8 修复后，2026-10-19）

- A8 排查修复（coreSaveRuntime base URL、context write frontmatter merge、sidecar 版本问题）后复跑：
  frontend 130 files / **1796 passed** +1 skipped、tsc 0；backend **847 collected / exit 0**；
  产品 cargo **39 passed**；矩阵 **35 行** --check PASS。无回归。

## A7/A5 产品 W 后追加回归（2026-10-19）

- frontend：133 files / **1809 passed** + 1 skipped、tsc 0；
- backend：**847 collected / exit 0**；
- 产品 cargo：**44 passed**（新增 workshop_protocol 3 例等）；
- 验证矩阵：更新基线（session 42/packs 82/workshop UI 18/cargo 44），--check PASS；
- 无回归（A7/A5 新代码均为增量 + 修复型改动）。

## W01 ZIP 后追加回归（2026-10-19）

- frontend：133 files / **1811 passed** + 1 skipped、tsc 0；
- backend：847 collected / exit 0；
- 产品 cargo：**50 passed**（含 zip 安全/staging guard 测试）；
- 验证矩阵基线更新（packs 83/workshop UI 19/cargo 50），--check PASS。

## W02 后追加回归（2026-10-19）

- frontend：134 files / **1819 passed** + 1 skipped、tsc 0；
- backend：847 collected / exit 0；
- 产品 cargo：50 passed；
- 验证矩阵基线更新（session 48/packs 85/全量 1819），--check 通过。

## G1/G2 + Agent Team 后最终回归（2026-10-19 末段）

- frontend：134 files / **1834 passed** + 1 skipped、tsc 0；
- backend：847 collected / exit 0；
- 产品 cargo：**51 passed**（含 context.write 能力门禁单测）；
- 验证矩阵：**53 行**，--check PASS（G1/G2、W07 boot 行纳入；W07 boot = PASS_WITH_FINDINGS(4 缺口)）。

## G3/G4 后最终回归（2026-10-19）

- frontend：**140 files / 1879 passed** + 1 skipped、tsc 0（新增 print/事件/探针相关单测）；
- backend：847 collected / exit 0（未改）；产品 cargo：51 passed（未改 Rust）；
- 验证矩阵：**55 行**，--check PASS（G3/G4 真实打印+事件证据纳入）。
